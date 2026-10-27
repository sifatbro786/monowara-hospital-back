import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// Pathology, CT/X-ray, ECG/ETT/Echo, Holter, Endoscopy… (timing + preparation notes per test group)
const diagnosticSchema = new Schema(
    {
        _id: stringId,
        name: { type: L, required: true },
        summary: { type: L, default: () => ({}) },
        description: { type: L, default: () => ({}) },
        tests: { type: [L], default: [] },
        timing: { type: L, default: () => ({}) },
        preparation: { type: L, default: () => ({}) },
        image: imagePath,
    },
    baseOptions,
);
listable(diagnosticSchema);
sluggable(diagnosticSchema, { legacy: true });

export const Diagnostic = model("Diagnostic", diagnosticSchema, "diagnostics");
