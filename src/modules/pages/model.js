import mongoose from "mongoose";
import { L, baseOptions, listable, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

export const PAGE_TYPES = ["legal", "site"];

/**
 * Section body differs by page type: legal = `{ en: [paragraphs], bn: [paragraphs] }`,
 * site = `{ en: "text", bn: "text" }`. Stored as-is (Mixed); the admin validator (B2) enforces the
 * right shape per type. Rendered as plain text only — never HTML.
 */
const Section = new Schema(
    {
        id: { type: String, trim: true, match: /^[a-z0-9-]+$/ }, // in-page anchor
        heading: { type: L, default: () => ({}) },
        body: { type: Schema.Types.Mixed, default: () => ({ en: "", bn: "" }) },
        points: { type: [L], default: undefined },
        confirm: { type: Boolean, default: undefined },
        link: { type: new Schema({ href: String, label: L }, { _id: false }), default: undefined },
    },
    { _id: false, minimize: false },
);

const Pillar = new Schema({ title: { type: L, default: () => ({}) }, body: { type: L, default: () => ({}) } }, { _id: false });

// Legal pages (privacy, patient rights, terms) + content pages (about, patients-visitors).
const pageSchema = new Schema(
    {
        _id: stringId,
        type: { type: String, enum: PAGE_TYPES, required: true },
        title: { type: L, required: true },
        summary: { type: L, default: () => ({}) },
        body: { type: L, default: undefined },
        sections: { type: [Section], default: [] },
        pillars: { type: [Pillar], default: undefined },
        mission: { type: L, default: undefined },
        vision: { type: L, default: undefined },
        isDraft: { type: Boolean, default: false }, // legal copy awaiting the client's lawyer
    },
    baseOptions,
);
listable(pageSchema);
sluggable(pageSchema);
pageSchema.index({ type: 1, isActive: 1 });

export const Page = model("Page", pageSchema, "pages");
