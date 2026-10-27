import { timingSafeEqual } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const internalKey = env.INTERNAL_API_KEY ? Buffer.from(env.INTERNAL_API_KEY) : null;

/**
 * Trusted server-to-server callers skip the public limiter, otherwise every SSR render of the Next
 * server (same VPS → same IP) would share one bucket and the site would throttle itself.
 *  - Direct loopback call with NO X-Forwarded-For → Next server on the box calling 127.0.0.1:5020.
 *    (Anything that came through Nginx carries X-Forwarded-For, so internet traffic never matches.
 *     Nginx must SET the header: `proxy_set_header X-Forwarded-For $remote_addr;`.)
 *  - Valid `x-mh-internal-key` → e.g. `next build` on a CI machine (optional, INTERNAL_API_KEY).
 */
export function isTrustedServerCall(req) {
    if (!req.headers["x-forwarded-for"] && LOOPBACK.has(req.socket.remoteAddress)) return true;
    const sent = req.get("x-mh-internal-key");
    if (!internalKey || !sent) return false;
    const given = Buffer.from(sent);
    return given.length === internalKey.length && timingSafeEqual(given, internalKey);
}

const tooMany = (req, res) =>
    res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many requests, please slow down." },
    });

/** Public reads. Stricter limiters for login / forms are added with those routes (B1.3, B1.4). */
export const publicLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.RATE_LIMIT_PUBLIC_PER_MIN,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: isTrustedServerCall,
    handler: tooMany,
});

/** Factory for the stricter per-route limiters (login, contact form, CV upload…). */
export const strictLimiter = ({ windowMs, limit }) =>
    rateLimit({ windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false, handler: tooMany });
