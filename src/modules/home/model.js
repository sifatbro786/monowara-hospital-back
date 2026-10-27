import mongoose from "mongoose";
import { L, baseOptions, imagePath, listable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// Admin-editable homepage blocks — one small collection each, combined by GET /api/home.

const keyNumberSchema = new Schema(
    { _id: stringId, value: { type: L, required: true }, label: { type: L, required: true } },
    baseOptions,
);
listable(keyNumberSchema);

const centreSchema = new Schema(
    {
        _id: stringId,
        title: { type: L, required: true },
        summary: { type: L, default: () => ({}) },
        href: { type: String, trim: true, required: true, match: /^\/[\w\-/?=&#]*$/ }, // internal path
        image: imagePath,
    },
    baseOptions,
);
listable(centreSchema);

const talkSchema = new Schema(
    {
        _id: stringId,
        youtubeId: { type: String, required: true, trim: true, match: /^[\w-]{11}$/ },
        title: { type: L, required: true },
        speaker: { type: L, default: () => ({}) },
    },
    baseOptions,
);
listable(talkSchema);

// Patient stories: shown ONLY with recorded written consent (proposal §3, §13).
const storySchema = new Schema(
    {
        _id: stringId,
        quote: { type: L, required: true },
        name: { type: L, required: true },
        context: { type: L, default: null },
        consent: {
            confirmed: { type: Boolean, default: false },
            date: { type: Date, default: null },
            recordedBy: { type: String, trim: true, default: null }, // staff name — never public
        },
    },
    baseOptions,
);
listable(storySchema);

export const KeyNumber = model("KeyNumber", keyNumberSchema, "keynumbers");
export const Centre = model("Centre", centreSchema, "centres");
export const Talk = model("Talk", talkSchema, "talks");
export const Story = model("Story", storySchema, "stories");
