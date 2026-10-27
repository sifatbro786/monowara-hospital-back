import { Router } from "express";
import { z } from "zod";
import { Faq } from "./model.js";
import { categoryKey, listHandler } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

// GET /api/faqs?category=
router.get(
    "/",
    validate({ query: z.object({ category: categoryKey }) }),
    listHandler(Faq, { filter: ({ category }) => (category ? { category: category.toLowerCase() } : {}) }),
);

export default router;
