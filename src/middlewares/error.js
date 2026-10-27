import { ZodError } from "zod";
import mongoose from "mongoose";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";

export function notFoundHandler(req, res) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}

/** Single place that turns errors into `{ error: { code, message, details? } }`. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
    let status = 500;
    let body = { code: "INTERNAL", message: "Something went wrong." };

    if (err instanceof AppError) {
        status = err.status;
        body = { code: err.code, message: err.message, ...(err.details && { details: err.details }) };
    } else if (err instanceof ZodError) {
        status = 400;
        body = {
            code: "VALIDATION",
            message: "Invalid request.",
            details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        };
    } else if (err instanceof mongoose.Error.CastError) {
        status = 400;
        body = { code: "BAD_REQUEST", message: `Invalid value for ${err.path}.` };
    } else if (err instanceof mongoose.Error.ValidationError) {
        status = 400;
        body = {
            code: "VALIDATION",
            message: "Invalid data.",
            details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
        };
    } else if (err?.code === 11000) {
        status = 409;
        body = { code: "DUPLICATE", message: `Already exists: ${Object.keys(err.keyValue || {}).join(", ")}.` };
    } else if (err?.name === "MulterError") {
        const big = err.code === "LIMIT_FILE_SIZE";
        status = big ? 413 : 400;
        body = {
            code: big ? "FILE_TOO_LARGE" : "BAD_UPLOAD",
            message: big ? "File is too large." : `Upload rejected (${err.code}).`,
        };
    } else if (err?.status >= 400 && err.status < 500 && !err.type) {
        // Errors from Express internals (e.g. express.static 404 / dotfile 403) — keep the status,
        // never the internal message (it can contain file paths).
        status = err.status;
        body = { code: status === 404 ? "NOT_FOUND" : "BAD_REQUEST", message: status === 404 ? "Not found" : "Bad request" };
    } else if (err?.type === "entity.parse.failed") {
        status = 400;
        body = { code: "BAD_JSON", message: "Malformed JSON body." };
    } else if (err?.type === "entity.too.large") {
        status = 413;
        body = { code: "TOO_LARGE", message: "Request body too large." };
    }

    if (status >= 500) req.log?.error({ err }, "Unhandled error");
    else req.log?.debug({ err: { code: body.code, message: err.message } }, "Request rejected");

    // Never leak stack traces / internals in production.
    if (status >= 500 && !env.isProd) body.debug = err?.message;
    res.status(status).json({ error: body });
}
