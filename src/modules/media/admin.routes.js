import { Router } from "express";
import { z } from "zod";
import { notFound } from "../../lib/errors.js";
import { ok } from "../../lib/public.js";
import { applyPatch, idParams, zImage, zL, zPosition } from "../../lib/admin.js";
import { requirePermission } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { logActivity } from "../activity/service.js";
import { MediaSlot } from "./model.js";

// /api/admin/media — fixed image slots (page headers etc.), media.manage. Slots are defined by the
// site's code (keys), so there is no create/delete here — only the picture, alt text and framing.
const router = Router();
router.use(requirePermission("media.manage"));

router.get("/", async (_req, res) => {
    ok(res, await MediaSlot.find({}).sort({ order: 1, _id: 1 }).lean());
});

router.patch(
    "/:id",
    validate({
        params: idParams,
        body: z
            .object({
                src: zImage("media").refine((v) => v !== null, "a slot always needs an image"),
                alt: zL(200),
                position: zPosition,
                overlay: z.number().min(0).max(1).nullable(),
            })
            .partial()
            .strict()
            .refine((b) => Object.keys(b).length > 0, "nothing to update"),
    }),
    async (req, res) => {
        const doc = await MediaSlot.findById(req.valid.params.id);
        if (!doc) throw notFound("Image slot");
        const changes = applyPatch(doc, req.valid.body);
        if (changes.src) doc.source = { type: "own" }; // replaced → no longer the stock placeholder
        if (Object.keys(changes).length) {
            await doc.save();
            await logActivity(req, { action: "media.update", entity: "media", entityId: doc._id, summary: doc.key, changes });
            // B3: revalidateTag("media")
        }
        ok(res, doc.toObject());
    },
);

export default router;
