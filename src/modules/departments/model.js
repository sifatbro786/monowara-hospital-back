import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// Specialties only (facilities and diagnostics are separate collections).
const departmentSchema = new Schema(
    {
        _id: stringId,
        name: { type: L, required: true },
        summary: { type: L, default: () => ({}) },
        description: { type: L, default: () => ({}) }, // paragraphs split by a blank line
        services: { type: [L], default: [] },
        conditions: { type: [L], default: [] },
        image: imagePath,
        isFeatured: { type: Boolean, default: false },
        seo: {
            title: { type: L, default: () => ({}) },
            description: { type: L, default: () => ({}) },
        },
    },
    baseOptions,
);
listable(departmentSchema);
sluggable(departmentSchema, { legacy: true });
departmentSchema.index({ "name.en": 1 });

export const Department = model("Department", departmentSchema, "departments");
