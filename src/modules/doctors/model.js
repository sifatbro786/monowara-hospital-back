import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, optionalL, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

export const DAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]; // BD week
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/; // 24h, Asia/Dhaka

const ScheduleSlot = new Schema(
    {
        day: { type: String, enum: DAYS, required: true },
        from: { type: String, match: HHMM, required: true },
        to: { type: String, match: HHMM, required: true },
    },
    { _id: false },
);

const Leave = new Schema(
    { from: { type: Date, default: null }, until: { type: Date, required: true }, note: { type: L, default: null } },
    { _id: false },
);

const doctorSchema = new Schema(
    {
        _id: stringId,
        name: { type: L, required: true },
        designation: { type: L, default: () => ({}) },
        degrees: { type: String, trim: true, default: "" },
        specialty: { type: L, default: () => ({}) },
        affiliation: optionalL,
        department: { type: String, ref: "Department", default: null },
        bmdc: { type: String, trim: true, default: null },
        phone: { type: String, trim: true, default: null },
        photo: imagePath,
        schedule: { type: [ScheduleSlot], default: [] },
        scheduleNote: optionalL, // replaces the timetable when no fixed chamber hours are published
        leave: { type: Leave, default: null }, // "On leave until …" badge
        isFeatured: { type: Boolean, default: false },
        legacyUrl: { type: String, trim: true, default: null }, // old WordPress URL → 308 (mh-front build)
    },
    baseOptions,
);
listable(doctorSchema);
sluggable(doctorSchema);
doctorSchema.index({ department: 1, isActive: 1, order: 1 });
doctorSchema.index({ "schedule.day": 1 });
doctorSchema.index({ isFeatured: 1 });

export const Doctor = model("Doctor", doctorSchema, "doctors");
