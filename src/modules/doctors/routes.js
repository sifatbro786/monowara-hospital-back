import { Router } from "express";
import { z } from "zod";
import { DAYS } from "./model.js";
import { listDoctors, getDoctorBySlug } from "./service.js";
import { flag, ok, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

export const DOCTORS_PAGE_MAX = 100; // mh-front getAllDoctors() pages through with this size

const listQuery = z.object({
    department: z.string().trim().max(160).regex(/^[\w-]+$/).optional(), // id or slug
    day: z.enum(DAYS).optional(),
    q: z.string().trim().max(80).optional().transform((v) => v || undefined),
    featured: flag,
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(DOCTORS_PAGE_MAX).default(DOCTORS_PAGE_MAX),
});

// GET /api/doctors?department=&day=&q=&featured=&page=&limit=  → { items, total, page, limit }
router.get("/", validate({ query: listQuery }), async (req, res) => {
    ok(res, await listDoctors(req.valid.query));
});

// GET /api/doctors/:slug
router.get("/:slug", validate({ params: slugParams }), async (req, res) => {
    ok(res, await getDoctorBySlug(req.valid.params.slug));
});

export default router;
