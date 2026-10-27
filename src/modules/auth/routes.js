import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate.js";
import { requireAuth } from "../../middlewares/auth.js";
import { strictLimiter } from "../../middlewares/rateLimit.js";
import { passwordSchema } from "../../lib/password.js";
import { permissionsFor } from "../../lib/permissions.js";
import { ok } from "../../lib/public.js";
import { ACCESS_COOKIE, clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "./cookies.js";
import { verifyAccessToken } from "./tokens.js";
import { changePassword, login, logout, refresh, revokeAllSessions } from "./service.js";
import { logActivity } from "../activity/service.js";

const router = Router();

// Per IP, failures only (a whole office signs in from one NAT IP), on top of the per-account lockout.
const loginLimiter = strictLimiter({ windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true });
const passwordLimiter = strictLimiter({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true });
const refreshLimiter = strictLimiter({ windowMs: 15 * 60_000, limit: 120 });

const session = (user) => ({ user, permissions: permissionsFor(user.role) });

// POST /api/auth/login { email, password }
router.post(
    "/login",
    loginLimiter,
    validate({
        body: z.object({
            email: z.string().trim().toLowerCase().email().max(254),
            password: z.string().min(1).max(200),
        }),
    }),
    async (req, res) => {
        const { user, tokens } = await login(req.valid.body, req);
        setAuthCookies(res, tokens);
        ok(res, session(user));
    },
);

// POST /api/auth/refresh — rotates both cookies (call on 401 TOKEN_EXPIRED)
router.post("/refresh", refreshLimiter, async (req, res) => {
    try {
        const { user, tokens } = await refresh(req.cookies?.[REFRESH_COOKIE], req);
        setAuthCookies(res, tokens);
        ok(res, session(user));
    } catch (err) {
        if (err.status === 401) clearAuthCookies(res); // dead session → drop the cookies too
        throw err;
    }
});

// POST /api/auth/logout — always succeeds and clears cookies
router.post("/logout", async (req, res) => {
    let sessionId;
    try {
        // An expired access token still identifies the session.
        sessionId = verifyAccessToken(req.cookies?.[ACCESS_COOKIE] ?? "", { ignoreExpiration: true }).sid;
    } catch {
        sessionId = undefined;
    }
    await logout({ refreshToken: req.cookies?.[REFRESH_COOKIE], sessionId }, req);
    clearAuthCookies(res);
    ok(res, { loggedOut: true });
});

// GET /api/auth/me — current user + permissions (admin UI shows/hides menus with these)
router.get("/me", requireAuth({ allowPasswordChange: true }), (req, res) => {
    ok(res, session(req.user));
});

// POST /api/auth/password { currentPassword, newPassword } — logs out every other browser
router.post(
    "/password",
    passwordLimiter,
    requireAuth({ allowPasswordChange: true }),
    validate({
        body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }),
    }),
    async (req, res) => {
        const { user, tokens } = await changePassword(req.user._id, req.valid.body, req);
        setAuthCookies(res, tokens);
        ok(res, session(user));
    },
);

// POST /api/auth/logout-all — "sign out on all devices"
router.post("/logout-all", requireAuth({ allowPasswordChange: true }), async (req, res) => {
    await revokeAllSessions(req.user._id, "logout_all");
    await logActivity(req, { action: "auth.logout_all", entity: "users", entityId: req.user._id });
    clearAuthCookies(res);
    ok(res, { loggedOut: true });
});

export default router;
