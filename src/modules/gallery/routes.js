import { Router } from "express";
import { GalleryItem } from "./model.js";
import { listHandler } from "../../lib/public.js";

const router = Router();

router.get("/", listHandler(GalleryItem)); // GET /api/gallery

export default router;
