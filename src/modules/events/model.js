import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Contact-tap counters (WhatsApp / call buttons). Aggregated per Dhaka day × channel × target —
 * no visitor data at all (no IP, no user agent, no phone number of the visitor): only which hospital
 * desk/number was tapped and from which part of the site. One upsert per tap.
 */
const tapStatSchema = new Schema(
    {
        _id: { type: String }, // `${day}|${channel}|${target}|${section}`
        day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        channel: { type: String, enum: ["whatsapp", "call"], required: true },
        target: { type: String, required: true, maxlength: 40 }, // WhatsApp desk id or the hospital number dialled
        section: { type: String, default: "main", maxlength: 40 },
        count: { type: Number, default: 0 },
    },
    { versionKey: false },
);
tapStatSchema.index({ day: 1 });

export const TapStat = model("TapStat", tapStatSchema, "tapstats");
