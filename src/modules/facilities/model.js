import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, optionalL, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// Emergency, OT, ICU, NICU, Dialysis, Ambulance, Pharmacy, Blood bank…
const facilitySchema = new Schema(
    {
        _id: stringId,
        name: { type: L, required: true },
        summary: { type: L, default: () => ({}) },
        description: { type: L, default: () => ({}) },
        features: { type: [L], default: [] },
        whenTo: optionalL,
        is24x7: { type: Boolean, default: false },
        image: imagePath,
    },
    baseOptions,
);
listable(facilitySchema);
sluggable(facilitySchema, { legacy: true });

export const Facility = model("Facility", facilitySchema, "facilities");
