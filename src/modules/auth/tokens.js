import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

const ISSUER = "mh-api";
const AUDIENCE = "mh-admin";

/** Short-lived access JWT. Role is NOT trusted from it — requireAuth re-reads the user each request. */
export function signAccessToken({ user, sessionId }) {
    return jwt.sign({ sid: sessionId, tv: user.tokenVersion ?? 0 }, env.JWT_ACCESS_SECRET, {
        algorithm: "HS256",
        subject: String(user._id),
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
    });
}

/** Throws jwt errors (TokenExpiredError, JsonWebTokenError). Algorithm pinned → no "alg: none". */
export const verifyAccessToken = (token, { ignoreExpiration = false } = {}) =>
    jwt.verify(token, env.JWT_ACCESS_SECRET, {
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
        ignoreExpiration,
    });

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const newRefreshSecret = () => randomBytes(32).toString("base64url"); // 43 chars

const REFRESH_RE = /^([a-f0-9]{24})\.([A-Za-z0-9_-]{43})$/;

/** "<sessionId>.<secret>" → { sessionId, secret } | null */
export function parseRefreshToken(value) {
    const m = typeof value === "string" ? REFRESH_RE.exec(value) : null;
    return m ? { sessionId: m[1], secret: m[2] } : null;
}
