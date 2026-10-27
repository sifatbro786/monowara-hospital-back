import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

const Section = new Schema({ heading: { type: L, default: () => ({}) }, body: { type: L, default: () => ({}) } }, { _id: false });

// Health Tips & News (incl. the old BHRPC Bangla articles).
const articleSchema = new Schema(
    {
        _id: stringId,
        category: { type: String, trim: true, lowercase: true, required: true },
        title: { type: L, required: true },
        excerpt: { type: L, default: () => ({}) },
        image: imagePath,
        readMinutes: { type: Number, min: 1, max: 120, default: null },
        publishedAt: { type: Date, required: true },
        sections: { type: [Section], default: [] },
        author: { type: String, ref: "Doctor", default: null }, // doctor byline once agreed (E-E-A-T)
        reviewedBy: { type: String, ref: "Doctor", default: null },
    },
    baseOptions,
);
listable(articleSchema);
sluggable(articleSchema);
articleSchema.index({ isActive: 1, publishedAt: -1 });
articleSchema.index({ category: 1 });

export const Article = model("Article", articleSchema, "articles");
