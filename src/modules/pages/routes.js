import { Router } from "express";
import { z } from "zod";
import { Page, PAGE_TYPES } from "./model.js";
import { listHandler, slugHandler, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

// GET /api/pages?type=legal
router.get(
    "/",
    validate({ query: z.object({ type: z.enum(PAGE_TYPES).optional() }) }),
    listHandler(Page, { filter: ({ type }) => (type ? { type } : {}) }),
);

// GET /api/pages/:slug  (legal or site page)
router.get("/:slug", validate({ params: slugParams }), slugHandler(Page, { what: "Page" }));

export default router;
