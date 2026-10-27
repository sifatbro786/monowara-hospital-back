import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
    level: env.LOG_LEVEL,
    // Never log credentials (B1.3 adds auth cookies / Authorization).
    redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
        censor: "[redacted]",
    },
    ...(env.isProd
        ? {}
        : { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } }),
});
