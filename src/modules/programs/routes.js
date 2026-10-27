import { Router } from "express";
import { Aesthetic, Bhrpc, AESTHETIC_ID, BHRPC_ID } from "./model.js";
import { getDoctorsByIds } from "../doctors/service.js";
import { ok } from "../../lib/public.js";
import { notFound } from "../../lib/errors.js";

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export const aestheticRouter = Router();
export const bhrpcRouter = Router();

// GET /api/aesthetic — treatments active + sorted, team populated (active doctors only, admin order)
aestheticRouter.get("/", async (req, res) => {
    const doc = await Aesthetic.findById(AESTHETIC_ID).lean();
    if (!doc) throw notFound("Aesthetic clinic");
    ok(res, {
        ...doc,
        treatments: doc.treatments.filter((t) => t.isActive !== false).sort(byOrder),
        doctors: await getDoctorsByIds(doc.doctors),
    });
});

// GET /api/bhrpc — team populated
bhrpcRouter.get("/", async (req, res) => {
    const doc = await Bhrpc.findById(BHRPC_ID).lean();
    if (!doc) throw notFound("BHRPC");
    ok(res, { ...doc, doctors: await getDoctorsByIds(doc.doctors) });
});
