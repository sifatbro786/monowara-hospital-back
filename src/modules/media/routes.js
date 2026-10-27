import { Router } from "express";
import { MediaSlot } from "./model.js";
import { listHandler } from "../../lib/public.js";

const router = Router();

router.get("/", listHandler(MediaSlot)); // GET /api/media

export default router;
