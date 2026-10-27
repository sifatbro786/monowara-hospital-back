import mongoose from "mongoose";
import { L, ImageSource, baseOptions, imagePath, listable, sluggable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// Homepage hero slider. Buttons are global (settings), the interval is settings.heroSlider.intervalSec.
const heroSlideSchema = new Schema(
    {
        _id: stringId,
        label: { type: L, default: () => ({}) }, // admin/nav name
        eyebrow: { type: L, default: () => ({}) },
        title: { type: L, default: () => ({}) }, // `*phrase*` = italic accent
        subtitle: { type: L, default: () => ({}) },
        image: {
            src: { ...imagePath, required: true }, // landscape ≥ 2000px
            alt: { type: L, default: () => ({}) },
            position: { type: String, trim: true, default: "center" }, // CSS object-position
            source: { type: ImageSource, default: null },
        },
    },
    baseOptions,
);
listable(heroSlideSchema);
sluggable(heroSlideSchema);

export const HeroSlide = model("HeroSlide", heroSlideSchema, "heroslides");
