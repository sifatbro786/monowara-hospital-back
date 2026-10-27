import mongoose from "mongoose";
import { L, baseOptions, listable, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// Careers openings (applications with CV upload arrive in B1.4).
const jobSchema = new Schema(
    {
        _id: stringId,
        title: { type: L, required: true },
        department: { type: String, ref: "Department", default: null },
        type: { type: L, default: () => ({}) },
        location: { type: L, default: () => ({}) },
        summary: { type: L, default: () => ({}) },
        responsibilities: { type: [L], default: [] },
        requirements: { type: [L], default: [] },
        deadline: { type: Date, default: null },
    },
    baseOptions,
);
listable(jobSchema);
sluggable(jobSchema);

export const Job = model("Job", jobSchema, "jobs");
