import { Router } from "express";
import { Settings, SETTINGS_ID } from "./model.js";
import { ok } from "../../lib/public.js";
import { notFound } from "../../lib/errors.js";

const router = Router();

// GET /api/settings — public singleton (hotline, WhatsApp desks, hours, socials, hero interval…)
router.get("/", async (req, res) => {
    const doc = await Settings.findById(SETTINGS_ID).lean();
    if (!doc) throw notFound("Settings");
    ok(res, doc);
});

export default router;
