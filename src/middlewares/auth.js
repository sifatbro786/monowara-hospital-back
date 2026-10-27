import jwt from "jsonwebtoken";
import { AppError } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { User, toPublicUser } from "../modules/users/model.js";
import { Session } from "../modules/auth/session.model.js";
import { ACCESS_COOKIE } from "../modules/auth/cookies.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";

/**
 * Staff authentication. Every request re-reads the user + session (two indexed lookups), so a
 * role change, deactivation, password reset or logout takes effect immediately — not when the
 * 10-minute access token expires.
 *   requireAuth()                             all admin routes
 *   requireAuth({ allowPasswordChange: true }) /auth/me, /auth/password, /auth/logout-all
 * 401 TOKEN_EXPIRED → the admin UI calls POST /api/auth/refresh and retries.
 */
export const requireAuth =
    ({ allowPasswordChange = false } = {}) =>
    async (req, _res, next) => {
        const token = req.cookies?.[ACCESS_COOKIE];
        if (!token) throw new AppError(401, "AUTH_REQUIRED", "Please sign in.");

        let payload;
        try {
            payload = verifyAccessToken(token);
        } catch (err) {
            if (err instanceof jwt.TokenExpiredError) {
                throw new AppError(401, "TOKEN_EXPIRED", "Session token expired.");
            }
            throw new AppError(401, "AUTH_INVALID", "Please sign in.");
        }

        const [user, session] = await Promise.all([
            User.findById(payload.sub).select("+tokenVersion").lean(),
            Session.exists({ _id: payload.sid, user: payload.sub, revokedAt: null }),
        ]);
        if (!user || !user.isActive || user.tokenVersion !== payload.tv || !session) {
            throw new AppError(401, "SESSION_REVOKED", "Please sign in again.");
        }
        if (user.mustChangePassword && !allowPasswordChange) {
            throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Set a new password to continue.");
        }

        req.user = toPublicUser(user);
        req.auth = { sessionId: payload.sid };
        next();
    };

/** Permission gate (see lib/permissions.js). Use after requireAuth(). */
export const requirePermission = (permission) => {
    can("super_admin", permission); // fail at boot on a typo'd permission name
    return (req, _res, next) => {
        if (!req.user || !can(req.user.role, permission)) {
            throw new AppError(403, "FORBIDDEN", "You don't have access to this.");
        }
        next();
    };
};
