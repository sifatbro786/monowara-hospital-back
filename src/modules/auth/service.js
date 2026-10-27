import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { User, toPublicUser } from "../users/model.js";
import { Session } from "./session.model.js";
import { logActivity } from "../activity/service.js";
import { newRefreshSecret, parseRefreshToken, sha256, signAccessToken } from "./tokens.js";

const MIN = 60_000;
const REFRESH_RACE_MS = 30_000; // two tabs refreshing at once is not theft

const unauthorized = (code = "SESSION_EXPIRED", message = "Please sign in again.") =>
    new AppError(401, code, message);
const invalidCredentials = () =>
    new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");

/** New session + token pair for a user (login, password change). */
export async function createSession(user, req) {
    const now = Date.now();
    const secret = newRefreshSecret();
    const session = await Session.create({
        user: user._id,
        tokenHash: sha256(secret),
        lastUsedAt: new Date(now),
        expiresAt: new Date(now + env.SESSION_MAX_DAYS * 24 * 60 * MIN),
        ip: req.ip ?? null,
        userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    });
    return {
        accessToken: signAccessToken({ user, sessionId: session._id }),
        refreshToken: `${session._id}.${secret}`,
        sessionExpiresAt: session.expiresAt,
        sessionId: session._id,
    };
}

export async function login({ email, password }, req) {
    const user = await User.findOne({ email }).select(
        "+passwordHash +tokenVersion +failedLogins +lockUntil",
    );
    const now = Date.now();

    if (user?.lockUntil && user.lockUntil.getTime() > now) {
        await logActivity(req, { action: "auth.login_locked", entity: "users", entityId: user._id, actor: { email } });
        const mins = Math.ceil((user.lockUntil.getTime() - now) / MIN);
        throw new AppError(429, "ACCOUNT_LOCKED", `Too many failed attempts. Try again in ${mins} min.`);
    }

    // Always run bcrypt (dummy hash for unknown emails) → same timing either way.
    const ok = await verifyPassword(password, user?.passwordHash);

    if (!user || !ok || !user.isActive) {
        if (user && !ok) {
            // $inc is atomic → parallel guesses can't slip past the counter.
            const after = await User.findOneAndUpdate(
                { _id: user._id },
                { $inc: { failedLogins: 1 } },
                { new: true, projection: { failedLogins: 1 } },
            ).lean();
            if ((after?.failedLogins ?? 0) >= env.LOGIN_MAX_ATTEMPTS) {
                await User.updateOne(
                    { _id: user._id },
                    { $set: { failedLogins: 0, lockUntil: new Date(now + env.LOGIN_LOCK_MIN * MIN) } },
                );
            }
        }
        await logActivity(req, {
            action: "auth.login_failed",
            entity: "users",
            entityId: user?._id ?? null,
            summary: !user ? "unknown email" : !user.isActive ? "account disabled" : "wrong password",
            actor: { email },
        });
        throw invalidCredentials(); // never reveal which part was wrong
    }

    await User.updateOne(
        { _id: user._id },
        { $set: { failedLogins: 0, lockUntil: null, lastLoginAt: new Date(now) } },
    );
    const tokens = await createSession(user, req);
    const pub = toPublicUser({ ...user.toObject(), lastLoginAt: new Date(now) });
    await logActivity(req, { action: "auth.login", entity: "users", entityId: user._id, actor: pub });
    return { user: pub, tokens };
}

async function revokeSession(sessionId, reason) {
    await Session.updateOne(
        { _id: sessionId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } },
    );
}

/**
 * Rotate the refresh token. Rejects: unknown/revoked/expired session, idle > SESSION_IDLE_MIN,
 * disabled user. A replayed old token outside the race window revokes the session (theft).
 */
export async function refresh(rawToken, req) {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) throw unauthorized();
    const { sessionId, secret } = parsed;
    const now = Date.now();

    const session = await Session.findById(sessionId).lean();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) throw unauthorized();

    const hash = sha256(secret);
    if (hash !== session.tokenHash) {
        if (hash === session.previousHash) {
            if (session.rotatedAt && now - session.rotatedAt.getTime() < REFRESH_RACE_MS) {
                // Another tab already rotated it; the browser now holds the new cookie → just retry.
                throw new AppError(409, "REFRESH_RACE", "Session was just refreshed — retry the request.");
            }
            await revokeSession(sessionId, "refresh_reuse");
            await logActivity(req, {
                action: "auth.refresh_reuse",
                entity: "sessions",
                entityId: sessionId,
                summary: "old refresh token replayed — session revoked",
                actor: { _id: session.user },
            });
        }
        throw unauthorized();
    }

    if (now - session.lastUsedAt.getTime() > env.SESSION_IDLE_MIN * MIN) {
        await revokeSession(sessionId, "idle");
        throw unauthorized("SESSION_IDLE", "Signed out after inactivity. Please sign in again.");
    }

    const user = await User.findById(session.user).select("+tokenVersion").lean();
    if (!user || !user.isActive) {
        await revokeSession(sessionId, "user_disabled");
        throw unauthorized();
    }

    const nextSecret = newRefreshSecret();
    // Atomic compare-and-swap: only one concurrent refresh can win.
    const updated = await Session.findOneAndUpdate(
        { _id: sessionId, tokenHash: hash, revokedAt: null },
        {
            $set: {
                tokenHash: sha256(nextSecret),
                previousHash: hash,
                rotatedAt: new Date(now),
                lastUsedAt: new Date(now),
            },
        },
        { new: true, projection: { expiresAt: 1 } },
    ).lean();
    if (!updated) throw new AppError(409, "REFRESH_RACE", "Session was just refreshed — retry the request.");

    return {
        user: toPublicUser(user),
        tokens: {
            accessToken: signAccessToken({ user, sessionId }),
            refreshToken: `${sessionId}.${nextSecret}`,
            sessionExpiresAt: updated.expiresAt,
        },
    };
}

/** Logout this browser. Accepts whichever credential is still around (refresh cookie or session id). */
export async function logout({ refreshToken, sessionId }, req) {
    const sid = sessionId ?? parseRefreshToken(refreshToken)?.sessionId;
    if (!sid) return;
    const session = await Session.findOneAndUpdate(
        { _id: sid, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: "logout" } },
        { projection: { user: 1 } },
    ).lean();
    if (session) await logActivity(req, { action: "auth.logout", entity: "sessions", entityId: sid });
}

/**
 * Kill every session of a user (password change/reset, role change, deactivation, "log out
 * everywhere"). Bumping tokenVersion also invalidates access tokens that are still unexpired.
 */
export async function revokeAllSessions(userId, reason) {
    await Promise.all([
        Session.updateMany(
            { user: userId, revokedAt: null },
            { $set: { revokedAt: new Date(), revokedReason: reason } },
        ),
        User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } }),
    ]);
}

/** Own password change → all other sessions die, this browser gets a fresh session. */
export async function changePassword(userId, { currentPassword, newPassword }, req) {
    const user = await User.findById(userId).select("+passwordHash +tokenVersion");
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new AppError(400, "WRONG_PASSWORD", "Current password is incorrect.");
    }
    if (currentPassword === newPassword) {
        throw new AppError(400, "SAME_PASSWORD", "Choose a password you haven't just used.");
    }
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();
    await revokeAllSessions(user._id, "password_changed");

    const fresh = await User.findById(userId).select("+tokenVersion").lean();
    const tokens = await createSession(fresh, req);
    await logActivity(req, { action: "auth.password_change", entity: "users", entityId: user._id });
    return { user: toPublicUser(fresh), tokens };
}
