import { Router } from "express";
import { z } from "zod";
import { Department } from "./model.js";
import { flag, listHandler, slugHandler, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

// GET /api/departments?featured=true
router.get(
    "/",
    validate({ query: z.object({ featured: flag }) }),
    listHandler(Department, { filter: ({ featured }) => (featured ? { isFeatured: true } : {}) }),
);

// GET /api/departments/:slug
router.get("/:slug", validate({ params: slugParams }), slugHandler(Department, { what: "Department" }));

export default router;
