import { Router } from "express";
import { z } from "zod";
import { Article } from "./model.js";
import { categoryKey, listHandler, slugHandler, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

// GET /api/articles?category=  — newest first
router.get(
    "/",
    validate({ query: z.object({ category: categoryKey }) }),
    listHandler(Article, {
        filter: ({ category }) => (category ? { category: category.toLowerCase() } : {}),
        sort: { publishedAt: -1, order: 1, _id: 1 },
    }),
);

// GET /api/articles/:slug
router.get("/:slug", validate({ params: slugParams }), slugHandler(Article, { what: "Article" }));

export default router;
