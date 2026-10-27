import { Router } from "express";
import { Facility } from "./model.js";
import { listHandler, slugHandler, slugParams } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

router.get("/", listHandler(Facility)); // GET /api/facilities
router.get("/:slug", validate({ params: slugParams }), slugHandler(Facility, { what: "Facility" }));

export default router;
