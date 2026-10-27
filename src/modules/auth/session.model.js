import mongoose from "mongoose";
import { stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

/**
 * One document per login (per browser). The refresh token is opaque: "<sessionId>.<secret>"; only
 * sha256(secret) is stored. Every refresh rotates the secret; presenting the PREVIOUS secret again
 * (outside a short race window) means it was stolen → the whole session is revoked.
 */
const sessionSchema = new Schema(
    {
        _id: stringId,
        user: { type: String, ref: "User", required: true },
        tokenHash: { type: String, required: true },
        previousHash: { type: String, default: null },
        rotatedAt: { type: Date, default: null },
        lastUsedAt: { type: Date, required: true }, // idle timeout
        expiresAt: { type: Date, required: true }, // absolute lifetime (TTL index deletes it after)
        revokedAt: { type: Date, default: null },
        revokedReason: { type: String, default: null },
        ip: { type: String, default: null },
        userAgent: { type: String, default: null, maxlength: 300 },
    },
    { timestamps: true, versionKey: false },
);
sessionSchema.index({ user: 1, revokedAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model("Session", sessionSchema, "sessions");
