import { Router } from "express";
import { Job } from "./model.js";
import { listHandler, slugHandler, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

router.get("/", listHandler(Job)); // GET /api/jobs
router.get("/:slug", validate({ params: slugParams }), slugHandler(Job, { what: "Job" }));

export default router;
