import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../lib/logger.js";

// Unknown filter keys are dropped instead of matching everything (defence in depth next to zod).
mongoose.set("strictQuery", true);

export async function connectDb() {
    mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
    mongoose.connection.on("reconnected", () => logger.info("MongoDB reconnected"));
    mongoose.connection.on("error", (err) => logger.error({ err }, "MongoDB error"));

    await mongoose.connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 10, // 1 vCPU VPS — plenty for SSR + admin
    });
    logger.info({ db: mongoose.connection.name }, "MongoDB connected");
}

export const disconnectDb = () => mongoose.disconnect();
export const isDbUp = () => mongoose.connection.readyState === 1;
