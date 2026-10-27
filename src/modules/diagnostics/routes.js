import { Router } from "express";
import { Diagnostic } from "./model.js";
import { listHandler, slugHandler, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

router.get("/", listHandler(Diagnostic)); // GET /api/diagnostics
router.get("/:slug", validate({ params: slugParams }), slugHandler(Diagnostic, { what: "Diagnostic" }));

export default router;
