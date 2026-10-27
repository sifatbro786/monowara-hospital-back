import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { createApp } from "./app.js";

process.on("unhandledRejection", (err) => {
    logger.fatal({ err }, "Unhandled rejection — exiting (PM2 restarts)");
    process.exit(1);
});

try {
    await connectDb();
} catch (err) {
    logger.fatal(
        { err: err.message },
        "Cannot connect to MongoDB — check MONGODB_URI / that mongod is running",
    );
    process.exit(1);
}

const server = createApp().listen(env.PORT, env.HOST, () => {
    logger.info(`mh-api listening on http://${env.HOST}:${env.PORT}/api (${env.NODE_ENV})`);
});
server.keepAliveTimeout = 65_000; // > Nginx upstream keepalive_timeout (60s)
server.headersTimeout = 66_000;

let closing = false;
async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received — closing`);
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
        await disconnectDb().catch(() => {});
        clearTimeout(force);
        process.exit(0);
    });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
