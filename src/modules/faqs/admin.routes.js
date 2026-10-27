import { z } from "zod";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zLRequired, zOrder } from "../../lib/admin.js";
import { Faq } from "./model.js";

// /api/admin/faqs — chatbot question → answer (faqs.manage)
export default crudRouter({
    Model: Faq,
    entity: "faqs",
    permission: "faqs.manage",
    what: "FAQ",
    sluggable: false,
    required: ["question", "answer"],
    label: (d) => d.question?.en,
    search: ["question.en", "question.bn", "answer.en", "answer.bn", "category"],
    fields: {
        question: zLRequired(160),
        answer: zLRequired(800),
        category: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9_-]+$/, "one word, e.g. appointment"),
        isActive: zBool,
        order: zOrder,
    },
    query: { category: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9_-]+$/).optional() },
    filter: ({ category }) => (category ? { category } : {}),
});
