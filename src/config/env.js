import { z } from "zod";

/**
 * Every env var the API reads, validated once at boot. A bad/missing value stops the process with a
 * readable list instead of failing later at request time.
 */
const csv = (fallback) =>
    z
        .string()
        .default(fallback)
        .transform((s) =>
            s
                .split(",")
                .map((v) => v.trim().replace(/\/$/, ""))
                .filter(Boolean),
        );

const schema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // Bind to loopback: on the VPS only Nginx talks to the API (api.monowarahospital.com → 127.0.0.1:5020).
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5020),
    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// URI"),

    // Browser origins allowed to call the API with credentials (admin dashboard, public forms).
    CORS_ORIGINS: csv("http://localhost:3000,http://127.0.0.1:3000"),
    // Express "trust proxy": Nginx on the same box → "loopback". Never "true" (spoofable X-Forwarded-For).
    TRUST_PROXY: z.string().default("loopback"),

    // Public read limit per client IP. The Next server's own SSR calls are exempt (see rateLimit.js).
    RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().positive().default(300),
    // Optional shared secret for trusted server-to-server callers that are NOT on loopback
    // (e.g. `next build` on a CI/local machine hitting the public API). Header: x-mh-internal-key.
    INTERNAL_API_KEY: z
        .string()
        .min(32, "use at least 32 random characters")
        .optional()
        .or(z.literal("").transform(() => undefined)),

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    // ── Admin auth (B1.3) ──
    // HS256 secret for the short-lived access JWT. Generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
    JWT_ACCESS_SECRET: z.string().min(32, "use at least 32 random characters"),
    ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(10),
    SESSION_IDLE_MIN: z.coerce.number().int().min(5).max(24 * 60).default(30), // auto logout after inactivity
    SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(30).default(7), // absolute session lifetime
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5), // per account, then lock
    LOGIN_LOCK_MIN: z.coerce.number().int().min(1).max(24 * 60).default(15),
    // Host-only cookies on the API host by default. Set ".monowarahospital.com" only if the Next
    // server must read the session cookie (e.g. server-side admin route guard).
    COOKIE_DOMAIN: z.string().optional().or(z.literal("").transform(() => undefined)),
    // Secure cookies (HTTPS only). Defaults to true in production.
    COOKIE_SECURE: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === "true")),

    // ── Files (B1.4) ──
    // Public images. VPS: /var/www/mh/uploads (Nginx serves it at https://monowarahospital.com/uploads/).
    UPLOAD_DIR: z.string().default("./uploads"),
    // Private files (CVs). NEVER inside a web-served folder. VPS: /var/www/mh/private
    PRIVATE_DIR: z.string().default("./private"),
    // Dev only: let the API serve UPLOAD_DIR at /uploads (on the VPS Nginx does it).
    SERVE_UPLOADS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    UPLOAD_MAX_MB: z.coerce.number().positive().max(25).default(10),
    CV_MAX_MB: z.coerce.number().positive().max(15).default(5),

    // ── Mail (B1.4) — alerts are skipped (and logged) when SMTP_HOST is empty ──
    SMTP_HOST: z.string().optional().or(z.literal("").transform(() => undefined)),
    SMTP_PORT: z.coerce.number().int().default(465),
    SMTP_SECURE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(), // default: "Monowara Hospital Website <SMTP_USER>"
    ADMIN_EMAIL: csv(""), // alert recipients, comma-separated
    ADMIN_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)), // link in alerts

    // ── Site cache (B3) — admin saves tell the Next server to drop cached pages ──
    // VPS: http://127.0.0.1:3000/api/revalidate (loopback, no Nginx hop). Empty = no revalidation.
    SITE_REVALIDATE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
    // Same value as REVALIDATE_SECRET in mh-front. ≥ 32 random chars.
    REVALIDATE_SECRET: z
        .string()
        .min(32, "use at least 32 random characters")
        .optional()
        .or(z.literal("").transform(() => undefined)),
});

const parsed = schema
    .refine((e) => !e.SITE_REVALIDATE_URL || e.REVALIDATE_SECRET, {
        path: ["REVALIDATE_SECRET"],
        message: "required when SITE_REVALIDATE_URL is set",
    })
    .safeParse(process.env);
if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    console.error(`Invalid environment:\n${lines.join("\n")}`);
    process.exit(1);
}

const isProd = parsed.data.NODE_ENV === "production";

export const env = Object.freeze({
    ...parsed.data,
    isProd,
    COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? isProd,
});
