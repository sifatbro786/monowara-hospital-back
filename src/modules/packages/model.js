import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

export const PACKAGE_CATEGORIES = ["maternity", "surgical", "checkup"];

// Prices are never shown: priceMode "call" → "Call for Price" (client requirement).
const packageSchema = new Schema(
    {
        _id: stringId,
        category: { type: String, enum: PACKAGE_CATEGORIES, required: true },
        name: { type: L, required: true },
        summary: { type: L, default: () => ({}) },
        description: { type: L, default: () => ({}) },
        whoFor: { type: L, default: () => ({}) },
        typicalStay: { type: L, default: () => ({}) },
        inclusions: { type: [L], default: [] },
        departments: { type: [{ type: String, ref: "Department" }], default: [] },
        image: imagePath,
        priceMode: { type: String, enum: ["call"], default: "call" },
        isFeatured: { type: Boolean, default: false },
    },
    baseOptions,
);
listable(packageSchema);
sluggable(packageSchema);
packageSchema.index({ category: 1, isActive: 1, order: 1 });
packageSchema.index({ departments: 1 });

export const Package = model("Package", packageSchema, "packages");
