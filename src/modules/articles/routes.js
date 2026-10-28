import { Router } from "express";
import { z } from "zod";
import { Article } from "./model.js";
import { ACTIVE, categoryKey, findActiveBySlug, ok, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

/**
 * Public articles = active AND already published: a future `publishedAt` is "Scheduled" in the
 * dashboard and must not leak (list, detail, BHRPC reading list, sitemap).
 * Byline: `author` / `reviewedBy` → { _id, slug, name, designation, photo } of an active doctor, else null
 * (mh-front lib/api/content.js does the same in static mode).
 */
export const BYLINE_FIELDS = "slug name designation photo";
const byline = (path) => ({ path, select: BYLINE_FIELDS, match: ACTIVE });
const published = () => ({ publishedAt: { $lte: new Date() } });

// GET /api/articles?category=  — newest first
router.get("/", validate({ query: z.object({ category: categoryKey }) }), async (req, res) => {
    const { category } = req.valid.query;
    const items = await Article.find({ ...ACTIVE, ...published(), ...(category ? { category: category.toLowerCase() } : {}) })
        .sort({ publishedAt: -1, order: 1, _id: 1 })
        .populate([byline("author"), byline("reviewedBy")])
        .lean();
    ok(res, items);
});

// GET /api/articles/:slug
router.get("/:slug", validate({ params: slugParams }), async (req, res) => {
    ok(
        res,
        await findActiveBySlug(Article, req.valid.params.slug, {
            what: "Article",
            filter: published(),
            populate: [byline("author"), byline("reviewedBy")],
        }),
    );
});

export default router;
