import mongoose from "mongoose";
import { L, baseOptions, listable, stringId } from "../../lib/schema.js";

const { Schema, model } = mongoose;

// FAQ chatbot: fixed question → fixed answer, managed in the admin.
const faqSchema = new Schema(
    {
        _id: stringId,
        question: { type: L, required: true },
        answer: { type: L, required: true },
        category: { type: String, trim: true, lowercase: true, default: "general", index: true },
    },
    baseOptions,
);
listable(faqSchema);

export const Faq = model("Faq", faqSchema, "faqs");
