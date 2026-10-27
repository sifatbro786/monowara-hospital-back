import { Router } from "express";
import { SeoOverride } from "./model.js";
import { listHandler } from "../../lib/public.js";

const router = Router();

router.get("/", listHandler(SeoOverride, { sort: { path: 1 } })); // GET /api/seo

export default router;
