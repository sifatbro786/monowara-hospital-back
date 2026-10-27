import helmet from "helmet";
import cors from "cors";
import { env } from "../config/env.js";

// JSON-only API: nothing here should ever render or be framed.
export const securityHeaders = helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    // monowarahospital.com and api.monowarahospital.com are the same *site*.
    crossOriginResourcePolicy: { policy: "same-site" },
});

export const allowedOrigins = new Set(env.CORS_ORIGINS);
const allowed = allowedOrigins;

/**
 * Browser calls (admin dashboard, public forms) must come from an allow-listed origin.
 * No Origin header = server-to-server (Next SSR, curl) → CORS does not apply; auth/rate limits do.
 */
export const corsPolicy = cors({
    origin(origin, cb) {
        if (!origin || allowed.has(origin)) return cb(null, true);
        return cb(null, false); // no CORS headers → the browser blocks the response
    },
    credentials: true, // admin auth cookies (B1.3)
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Accept", "X-Requested-With"],
    exposedHeaders: ["Content-Disposition"], // admin Excel/CV downloads read the file name
    maxAge: 600,
});
