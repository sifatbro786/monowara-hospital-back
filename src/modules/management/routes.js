import { Router } from "express";
import { Management } from "./model.js";
import { listHandler } from "../../lib/public.js";

const router = Router();

router.get("/", listHandler(Management)); // GET /api/management

export default router;
