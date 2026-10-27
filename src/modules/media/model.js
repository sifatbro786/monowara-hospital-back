import mongoose from "mongoose";
import { L, ImageSource, baseOptions, imagePath, listable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

/**
 * Media slots — every fixed image on the site ("header.doctors", "home.visit"…). The admin's
 * Media management page replaces `src` per key; code never hard-codes these images.
 */
const mediaSlotSchema = new Schema(
    {
        _id: stringId,
        key: { type: String, required: true, trim: true, match: /^[a-z0-9]+(?:[.-][a-zA-Z0-9]+)*$/ },
        page: { type: String, trim: true, default: null }, // where it shows (admin hint)
        src: { ...imagePath, required: true },
        alt: { type: L, default: () => ({}) },
        position: { type: String, trim: true, default: "center" },
        overlay: { type: Number, min: 0, max: 1, default: null },
        source: { type: ImageSource, default: null },
    },
    baseOptions,
);
listable(mediaSlotSchema);
mediaSlotSchema.index({ key: 1 }, { unique: true });

export const MediaSlot = model("MediaSlot", mediaSlotSchema, "media");
