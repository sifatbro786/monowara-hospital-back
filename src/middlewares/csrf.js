import { AppError } from "../lib/errors.js";
import { allowedOrigins } from "./security.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for cookie-authenticated routes (/api/auth, /api/admin), on top of SameSite=Strict:
 *  1. A browser-sent Origin must be allow-listed (blocks a forged form post from any other origin,
 *     including a sibling subdomain — SameSite treats those as the same site).
 *  2. Unsafe methods must carry `X-Requested-With`. A custom header forces a CORS preflight, which
 *     a non-allow-listed origin fails, and plain HTML forms can't set it.
 * The admin UI sends `X-Requested-With: mh-admin` on every request.
 */
export function csrfGuard(req, _res, next) {
    const origin = req.get("origin");
    if (origin && !allowedOrigins.has(origin.replace(/\/$/, ""))) {
        throw new AppError(403, "BAD_ORIGIN", "Request origin not allowed.");
    }
    if (!SAFE.has(req.method) && !req.get("x-requested-with")) {
        throw new AppError(403, "CSRF", "Missing X-Requested-With header.");
    }
    next();
}

/** Auth/admin responses carry personal data → never cached by browsers or proxies. */
export function noStore(_req, res, next) {
    res.set("Cache-Control", "no-store");
    next();
}
