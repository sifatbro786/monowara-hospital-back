import mongoose from "mongoose";
import { L, baseOptions, imagePath, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// Per-page Google title/description overrides, keyed by the locale-less path ("/doctors/<slug>").
const seoSchema = new Schema(
    {
        _id: stringId,
        path: { type: String, required: true, trim: true, match: /^\/[a-z0-9\-/]*$/ },
        title: { type: L, default: () => ({}) },
        description: { type: L, default: () => ({}) },
        image: imagePath,
        isActive: { type: Boolean, default: true },
    },
    baseOptions,
);
seoSchema.index({ path: 1 }, { unique: true });

export const SeoOverride = model("SeoOverride", seoSchema, "seo");
