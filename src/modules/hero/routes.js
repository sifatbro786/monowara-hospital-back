import { Router } from "express";
import { HeroSlide } from "./model.js";
import { listHandler } from "../../lib/public.js";

const router = Router();

router.get("/", listHandler(HeroSlide)); // GET /api/hero

export default router;
