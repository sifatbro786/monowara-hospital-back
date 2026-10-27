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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    console.error(`Invalid environment:\n${lines.join("\n")}`);
    process.exit(1);
}

export const env = Object.freeze({
    ...parsed.data,
    isProd: parsed.data.NODE_ENV === "production",
});
