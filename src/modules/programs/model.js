import mongoose from "mongoose";
import { L, baseOptions, imagePath, SLUG_RE, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

export const AESTHETIC_ID = "aesthetic_main";
export const BHRPC_ID = "bhrpc_main";

const doctorRefs = { type: [{ type: String, ref: "Doctor" }], default: [] };

const Treatment = new Schema({
    _id: stringId,
    slug: { type: String, trim: true, lowercase: true, match: SLUG_RE, required: true },
    name: { type: L, required: true },
    summary: { type: L, default: () => ({}) },
    image: imagePath,
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
});

// MH Aesthetic & Wellness Clinic — sub-brand singleton with its own numbers.
const aestheticSchema = new Schema(
    {
        _id: { type: String, default: AESTHETIC_ID },
        name: { type: L, required: true },
        tagline: { type: L, default: () => ({}) },
        about: { type: L, default: () => ({}) },
        mission: { type: L, default: () => ({}) },
        vision: { type: L, default: () => ({}) },
        phone: { type: String, trim: true, default: null },
        whatsapp: { type: String, trim: true, default: null },
        email: { type: String, trim: true, lowercase: true, default: null },
        hours: { type: L, default: () => ({}) },
        location: { type: L, default: () => ({}) },
        heroImage: imagePath,
        doctors: doctorRefs, // ordered
        treatments: { type: [Treatment], default: [] },
    },
    baseOptions,
);

// BHRPC — high-risk pregnancy programme singleton.
const bhrpcSchema = new Schema(
    {
        _id: { type: String, default: BHRPC_ID },
        short: { type: String, trim: true, default: "BHRPC" },
        name: { type: L, required: true },
        tagline: { type: L, default: () => ({}) },
        about: { type: L, default: () => ({}) },
        whoFor: { type: [L], default: [] },
        services: { type: [L], default: [] },
        doctors: doctorRefs, // ordered
        topics: { type: [String], default: [] }, // article slugs
    },
    baseOptions,
);

export const Aesthetic = model("Aesthetic", aestheticSchema, "aesthetic");
export const Bhrpc = model("Bhrpc", bhrpcSchema, "bhrpc");
