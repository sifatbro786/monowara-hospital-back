import express from "express";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { securityHeaders, corsPolicy } from "./middlewares/security.js";
import { sanitizeInput } from "./middlewares/sanitize.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.js";
import api from "./routes.js";

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    const tp = env.TRUST_PROXY;
    app.set("trust proxy", tp === "false" ? false : /^\d+$/.test(tp) ? Number(tp) : tp);
    app.set("query parser", "simple"); // flat strings only — no ?a[$ne]= objects
    app.set("etag", "weak");

    app.use(
        pinoHttp({
            logger,
            autoLogging: { ignore: (req) => req.url === "/api/health" },
            customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
            serializers: {
                req: (req) => ({ method: req.method, url: req.url }),
                res: (res) => ({ status: res.statusCode }),
            },
        }),
    );
    app.use(securityHeaders);
    app.use(corsPolicy);
    app.use(express.json({ limit: "100kb" }));
    app.use(sanitizeInput);

    app.use("/api", api);

    app.use(notFoundHandler);
    app.use(errorHandler); // Express 5 forwards rejected async handlers here automatically
    return app;
}
