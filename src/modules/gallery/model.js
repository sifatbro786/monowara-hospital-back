import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

const galleryItemSchema = new Schema(
    {
        _id: stringId,
        src: { ...imagePath, required: true },
        category: { type: String, trim: true, lowercase: true, default: "hospital" },
        caption: { type: L, default: () => ({}) },
    },
    baseOptions,
);
listable(galleryItemSchema);

export const GalleryItem = model("GalleryItem", galleryItemSchema, "gallery");
