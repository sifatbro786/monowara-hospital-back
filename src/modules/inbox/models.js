import mongoose from "mongoose";
import { stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

/**
 * Patient/visitor submissions from the public site. Personal data (names, phones) → admin-only,
 * never returned by a public route, kept out of logs. Plain text only (rendered escaped).
 */
const meta = {
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
    source: { type: String, default: null, maxlength: 200 }, // page the form was sent from
    handledBy: { type: String, ref: "User", default: null },
    handledAt: { type: Date, default: null },
    staffNote: { type: String, default: null, maxlength: 1000 },
};
const opts = { timestamps: true, versionKey: false };

export const MESSAGE_STATUSES = ["new", "read", "replied", "archived"];
const messageSchema = new Schema(
    {
        _id: stringId,
        name: { type: String, required: true, maxlength: 80 },
        phone: { type: String, required: true, maxlength: 20 },
        email: { type: String, default: null, maxlength: 120 },
        subject: { type: String, default: null, maxlength: 120 },
        message: { type: String, required: true, maxlength: 800 },
        status: { type: String, enum: MESSAGE_STATUSES, default: "new" },
        ...meta,
    },
    opts,
);
messageSchema.index({ status: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 });

export const APPLICATION_STATUSES = ["new", "reviewed", "shortlisted", "rejected", "hired"];
const applicationSchema = new Schema(
    {
        _id: stringId,
        job: { type: String, ref: "Job", default: null },
        jobTitle: { type: String, default: null, maxlength: 160 }, // snapshot (job may be removed later)
        name: { type: String, required: true, maxlength: 80 },
        phone: { type: String, required: true, maxlength: 20 },
        email: { type: String, required: true, maxlength: 120 },
        note: { type: String, default: null, maxlength: 1000 },
        cv: {
            file: { type: String, required: true }, // name inside PRIVATE_DIR/cv — never a public path
            originalName: { type: String, maxlength: 160 },
            mime: String,
            size: Number,
        },
        status: { type: String, enum: APPLICATION_STATUSES, default: "new" },
        ...meta,
    },
    opts,
);
applicationSchema.index({ status: 1, createdAt: -1 });
applicationSchema.index({ job: 1, createdAt: -1 });

export const BOOKING_STATUSES = ["new", "confirmed", "completed", "cancelled", "no_show"];
const bookingSchema = new Schema(
    {
        _id: stringId,
        name: { type: String, required: true, maxlength: 80 },
        phone: { type: String, required: true, maxlength: 20 },
        doctor: { type: String, ref: "Doctor", default: null },
        doctorName: { type: String, default: null, maxlength: 160 }, // snapshots for the export
        department: { type: String, ref: "Department", default: null },
        departmentName: { type: String, default: null, maxlength: 160 },
        date: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ }, // Dhaka calendar day
        slot: { type: new Schema({ from: String, to: String }, { _id: false }), default: null },
        note: { type: String, default: null, maxlength: 300 },
        status: { type: String, enum: BOOKING_STATUSES, default: "new" },
        serial: { type: Number, min: 1, max: 999, default: null }, // set by the OPD desk when confirming
        ...meta,
    },
    opts,
);
bookingSchema.index({ status: 1, date: 1 });
bookingSchema.index({ doctor: 1, date: 1 });
bookingSchema.index({ phone: 1, date: 1 });
bookingSchema.index({ createdAt: -1 });

export const Message = model("Message", messageSchema, "messages");
export const Application = model("Application", applicationSchema, "applications");
export const Booking = model("Booking", bookingSchema, "bookings");
