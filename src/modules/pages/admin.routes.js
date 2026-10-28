import { Router } from "express";
import { z } from "zod";
import { AppError, notFound } from "../../lib/errors.js";
import { can } from "../../lib/permissions.js";
import { ok } from "../../lib/public.js";
import { applyPatch, idParams, slugify, zBool, zL, zLRequired, zPath } from "../../lib/admin.js";
import { validate } from "../../middlewares/validate.js";
import { logActivity } from "../activity/service.js";
import { Page } from "./model.js";

/**
 * /api/admin/pages — the fixed content pages. Pages map to fixed site routes (/about,
 * /patients-visitors, /legal/<slug>), so there is no create/delete and the slug can't change.
 *   site  pages → pages.manage (graphics_design)      legal pages → legal.manage (super admin only)
 * Section anchors (`id`) are kept — the menu links to them (/patients-visitors#visiting-hours).
 */
const router = Router();

const permFor = (type) => (type === "legal" ? "legal.manage" : "pages.manage");
const allowedTypes = (role) => ["site", "legal"].filter((t) => can(role, permFor(t)));

const anchor = z.string().trim().max(60).regex(/^[a-z0-9-]+$/).optional();
const paragraphs = z.array(z.string().trim().min(1).max(3000)).max(30);

/** Fill missing/duplicate anchors from the English heading. */
function withAnchors(sections) {
    const used = new Set();
    return sections.map((s, i) => {
        let id = s.id || slugify(s.heading.en) || `section-${i + 1}`;
        while (used.has(id)) id = `${id}-${i + 1}`;
        used.add(id);
        return { ...s, id };
    });
}

const siteBody = z
    .object({
        title: zLRequired(160),
        summary: zL(400),
        body: zL(6000),
        sections: z
            .array(
                z
                    .object({
                        id: anchor,
                        heading: zL(200),
                        body: zL(4000),
                        points: z.array(zL(240)).max(20).optional(),
                        confirm: zBool.optional(), // "awaiting the client's confirmation" marker
                        link: z.object({ href: zPath, label: zL(80) }).strict().optional(),
                    })
                    .strict(),
            )
            .max(30)
            .transform(withAnchors),
        pillars: z.array(z.object({ title: zL(120), body: zL(600) }).strict()).max(8),
        mission: zL(600),
        vision: zL(600),
        isActive: zBool,
    })
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, "nothing to update");

const legalBody = z
    .object({
        title: zLRequired(160),
        summary: zL(400),
        sections: z
            .array(z.object({ id: anchor, heading: zL(200), body: z.object({ en: paragraphs, bn: paragraphs }).strict() }).strict())
            .max(40)
            .transform(withAnchors),
        isDraft: zBool,
        isActive: zBool,
    })
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, "nothing to update");

router.get("/", async (req, res) => {
    const types = allowedTypes(req.user.role);
    if (!types.length) throw new AppError(403, "FORBIDDEN", "You don't have access to this.");
    ok(res, await Page.find({ type: { $in: types } }, { title: 1, slug: 1, type: 1, summary: 1, isDraft: 1, isActive: 1, updatedAt: 1 }).sort({ type: -1, slug: 1 }).lean());
});

async function load(req) {
    const doc = await Page.findById(req.valid.params.id);
    if (!doc) throw notFound("Page");
    if (!can(req.user.role, permFor(doc.type))) throw new AppError(403, "FORBIDDEN", "You don't have access to this page.");
    return doc;
}

router.get("/:id", validate({ params: idParams }), async (req, res) => ok(res, (await load(req)).toObject()));

router.patch("/:id", validate({ params: idParams }), async (req, res) => {
    const doc = await load(req);
    const body = (doc.type === "legal" ? legalBody : siteBody).parse(req.body ?? {});
    const changes = applyPatch(doc, body);
    if (Object.keys(changes).length) {
        doc.markModified("sections"); // Mixed section bodies
        await doc.save();
        await logActivity(req, { action: "pages.update", entity: "pages", entityId: doc._id, summary: doc.slug, changes });
    }
    ok(res, doc.toObject());
});

export default router;
