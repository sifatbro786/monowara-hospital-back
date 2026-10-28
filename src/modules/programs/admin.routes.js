import { Router } from "express";
import { z } from "zod";
import { AppError, notFound } from "../../lib/errors.js";
import { ok } from "../../lib/public.js";
import { applyPatch, slugify, zBool, zId, zImage, zL, zLRequired, zPhone, zSlug } from "../../lib/admin.js";
import { requirePermission } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { logActivity } from "../activity/service.js";
import { Doctor } from "../doctors/model.js";
import { Article } from "../articles/model.js";
import { Aesthetic, AESTHETIC_ID, Bhrpc, BHRPC_ID } from "./model.js";

// /api/admin/programs — the two sub-brand singletons (programs.manage = OPD in-charge + super admin):
//   GET /options                 doctors + articles for the pickers
//   GET|PATCH /aesthetic         MH Aesthetic & Wellness (numbers, team, treatments)
//   GET|PATCH /bhrpc             BHRPC high-risk pregnancy programme (team, topics)
const router = Router();
router.use(requirePermission("programs.manage"));

/** Ordered doctor ids: must exist, duplicates dropped (first wins). */
const team = z
    .array(zId)
    .max(40)
    .transform((ids) => [...new Set(ids)]);

async function assertDoctors(ids) {
    if (!ids?.length) return;
    if ((await Doctor.countDocuments({ _id: { $in: ids } })) !== ids.length) {
        throw new AppError(400, "UNKNOWN_DOCTOR", "One of the doctors doesn't exist.", [{ path: ["doctors"], message: "unknown doctor" }]);
    }
}

const treatments = z
    .array(
        z
            .object({
                _id: zId.optional(),
                slug: zSlug.optional(),
                name: zLRequired(80),
                summary: zL(300),
                image: zImage("aesthetic"),
                isActive: zBool.default(true),
            })
            .strict(),
    )
    .max(40)
    .transform((list) => {
        const used = new Set();
        return list.map((t, i) => {
            let slug = t.slug || slugify(t.name.en) || `treatment-${i + 1}`;
            while (used.has(slug)) slug = `${slug}-${i + 1}`;
            used.add(slug);
            return { ...t, ...(t._id ? {} : { _id: `aes_${slug}` }), slug, order: i + 1 };
        });
    });

const aestheticBody = z
    .object({
        name: zLRequired(120),
        tagline: zL(200),
        about: zL(4000),
        mission: zL(400),
        vision: zL(400),
        phone: zPhone,
        whatsapp: zPhone,
        email: z
            .string()
            .trim()
            .toLowerCase()
            .max(120)
            .transform((v) => v || null)
            .nullable()
            .refine((v) => v === null || z.string().email().safeParse(v).success, "a valid email"),
        hours: zL(120),
        location: zL(200),
        heroImage: zImage("aesthetic"),
        doctors: team,
        treatments,
    })
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, "nothing to update");

const bhrpcBody = z
    .object({
        short: z.string().trim().min(2).max(20),
        name: zLRequired(160),
        tagline: zL(200),
        about: zL(4000),
        whoFor: z.array(zL(200)).max(20),
        services: z.array(zL(200)).max(30),
        doctors: team,
        topics: z
            .array(zSlug)
            .max(20)
            .transform((s) => [...new Set(s)]),
    })
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, "nothing to update");

router.get("/options", async (_req, res) => {
    const [doctors, articles] = await Promise.all([
        Doctor.find({}, { name: 1, designation: 1, department: 1, photo: 1, isActive: 1 }).sort({ order: 1, _id: 1 }).lean(),
        Article.find({}, { title: 1, slug: 1, category: 1, isActive: 1 }).sort({ publishedAt: -1 }).lean(),
    ]);
    ok(res, { doctors, articles });
});

function singleton(path, Model, id, body, entity, check) {
    router.get(`/${path}`, async (_req, res) => {
        const doc = await Model.findById(id).lean();
        if (!doc) throw notFound(entity);
        ok(res, doc);
    });
    router.patch(`/${path}`, validate({ body }), async (req, res) => {
        const doc = await Model.findById(id);
        if (!doc) throw notFound(entity);
        await assertDoctors(req.valid.body.doctors);
        await check?.(req.valid.body);
        const changes = applyPatch(doc, req.valid.body);
        if (Object.keys(changes).length) {
            await doc.save();
            await logActivity(req, { action: `${path}.update`, entity: path, entityId: id, summary: Object.keys(changes).join(", "), changes });
        }
        ok(res, doc.toObject());
    });
}

singleton("aesthetic", Aesthetic, AESTHETIC_ID, aestheticBody, "Aesthetic clinic");
singleton("bhrpc", Bhrpc, BHRPC_ID, bhrpcBody, "BHRPC", async (b) => {
    if (!b.topics?.length) return;
    if ((await Article.countDocuments({ slug: { $in: b.topics } })) !== b.topics.length) {
        throw new AppError(400, "UNKNOWN_ARTICLE", "One of the topics isn't an article.", [{ path: ["topics"], message: "unknown article" }]);
    }
});

export default router;
