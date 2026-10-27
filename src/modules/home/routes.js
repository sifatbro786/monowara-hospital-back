import { Router } from "express";
import { KeyNumber, Centre, Talk, Story } from "./model.js";
import { ACTIVE, BY_ORDER, ok } from "../../lib/public.js";

const router = Router();

const list = (Model, filter = {}, projection) => Model.find({ ...ACTIVE, ...filter }, projection).sort(BY_ORDER).lean();

// GET /api/home — { keyNumbers, centres, talks, stories }
router.get("/", async (req, res) => {
    const [keyNumbers, centres, talks, stories] = await Promise.all([
        list(KeyNumber),
        list(Centre),
        list(Talk),
        // Consent is enforced here too (the frontend also checks): unconsented stories never leave the DB.
        list(Story, { "consent.confirmed": true }, { "consent.recordedBy": 0 }),
    ]);
    ok(res, { keyNumbers, centres, talks, stories });
});

export default router;
