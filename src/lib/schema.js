import mongoose from "mongoose";

const { Schema, Types } = mongoose;

/**
 * Shared building blocks so every model has the exact shape of mh-front/data/*.js
 * (that's what makes DATA_SOURCE=api a zero-refactor switch).
 */

/** Translatable text `{ en, bn }` — either may be empty, the frontend falls back. */
export const L = new Schema(
    { en: { type: String, trim: true, default: "" }, bn: { type: String, trim: true, default: "" } },
    { _id: false },
);

/** Translatable paragraphs `{ en: [..], bn: [..] }` (legal page sections). */
export const LList = new Schema({ en: { type: [String], default: [] }, bn: { type: [String], default: [] } }, { _id: false });

/** Optional translatable field that is `null` when unused (e.g. doctor.affiliation). */
export const optionalL = { type: L, default: null };

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * String `_id`s: seeded docs keep their readable ids ("doc_dr-x", "dept_cardiology") and relations
 * stay plain strings, exactly like the static data. New admin docs get an ObjectId-hex string.
 */
export const stringId = { type: String, default: () => new Types.ObjectId().toHexString() };

export const baseOptions = { timestamps: true, versionKey: false, strict: true };

/** isActive + order on every listable collection. */
export function listable(schema) {
    schema.add({
        isActive: { type: Boolean, default: true },
        order: { type: Number, default: 0 },
    });
    schema.index({ isActive: 1, order: 1 });
}

/**
 * slug + previousSlugs (admin renames keep old links alive → frontend 308s) + legacySlugs (old
 * WordPress slugs, used by mh-front's build-time redirects).
 */
export function sluggable(schema, { legacy = false } = {}) {
    schema.add({
        slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 160, match: SLUG_RE },
        previousSlugs: { type: [String], default: [] },
        ...(legacy && { legacySlugs: { type: [String], default: [] } }),
    });
    schema.index({ slug: 1 }, { unique: true });
    schema.index({ previousSlugs: 1 });
}

/** Image path as served by Nginx: "/uploads/<collection>/<file>". No external URLs (no Cloudinary). */
export const imagePath = {
    type: String,
    trim: true,
    default: null,
    validate: {
        validator: (v) => v == null || v === "" || /^\/uploads\/[\w\-./]+$/.test(v),
        message: "must be a /uploads/... path",
    },
};

/** Where a placeholder photo came from (Unsplash/Pexels/own) — keeps the attribution trail. */
export const ImageSource = new Schema(
    { type: { type: String, trim: true }, url: String, download: String },
    { _id: false },
);
