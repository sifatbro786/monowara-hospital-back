/** Operational error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const badRequest = (message, details) => new AppError(400, "BAD_REQUEST", message, details);
