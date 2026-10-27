import { Router } from "express";
import { z } from "zod";
import { Package, PACKAGE_CATEGORIES } from "./model.js";
import { flag, listHandler, slugHandler, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

const listQuery = z.object({
    category: z.enum(PACKAGE_CATEGORIES).optional(),
    featured: flag,
    department: z.string().trim().max(160).regex(/^[\w-]+$/).optional(), // department _id
});

// GET /api/packages?category=&featured=&department=
router.get(
    "/",
    validate({ query: listQuery }),
    listHandler(Package, {
        filter: ({ category, featured, department }) => ({
            ...(category && { category }),
            ...(featured && { isFeatured: true }),
            ...(department && { departments: department }),
        }),
    }),
);

// GET /api/packages/:slug
router.get("/:slug", validate({ params: slugParams }), slugHandler(Package, { what: "Package" }));

export default router;
