import { Router } from "express";
import { z } from "zod";
import { AppError, notFound } from "../../lib/errors.js";
import { ok } from "../../lib/public.js";
import {
    applyPatch,
    idParams,
    onLeaveToday,
    searchRx,
    setSlug,
    slugify,
    zBool,
    zId,
    zImage,
    zL,
    zLOptional,
    zLRequired,
    zOrder,
    zSlug,
} from "../../lib/admin.js";
import { requirePermission } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { logActivity } from "../activity/service.js";
import { Department } from "../departments/model.js";
import { Article } from "../articles/model.js";
import { Aesthetic, Bhrpc } from "../programs/model.js";
import { DAYS, Doctor } from "./model.js";
import { DEPARTMENT_POPULATE } from "./service.js";

// Mounted at /api/admin/doctors (requireAuth already applied). OPD in-charge + super admin.
const router = Router();
router.use(requirePermission("doctors.manage"));

// ── validation (mirrors doctors/model.js) ───────────────────────────────────────────────────────────
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** "2026-11-02" (Dhaka calendar day) → Date at Dhaka midnight (what DoctorStatus normalises back). */
const dhakaDay = (ymd) => new Date(`${ymd}T00:00:00+06:00`);

const slot = z
    .object({ day: z.enum(DAYS), from: z.string().regex(HHMM, "HH:MM"), to: z.string().regex(HHMM, "HH:MM") })
    .strict()
    .refine((s) => s.from < s.to, { message: "end time must be after start time", path: ["to"] });

const schedule = z
    .array(slot)
    .max(28)
    .superRefine((slots, ctx) => {
        // same-day overlaps are typos (17:00–19:00 and 18:00–20:00)
        for (const day of DAYS) {
            const s = slots.map((x, i) => ({ ...x, i })).filter((x) => x.day === day).sort((a, b) => (a.from < b.from ? -1 : 1));
            for (let k = 1; k < s.length; k++) {
                if (s[k].from < s[k - 1].to) {
                    ctx.addIssue({ code: "custom", path: [s[k].i, "from"], message: `overlaps another ${day} chamber` });
                }
            }
        }
    })
    // stored in week order → the public timetable reads naturally
    .transform((slots) => [...slots].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || (a.from < b.from ? -1 : 1)));

const leave = z
    .object({
        from: z.string().regex(DAY_RE).nullable().default(null),
        until: z.string().regex(DAY_RE, "pick the last day of leave"),
        note: zLOptional(160).default(null),
    })
    .strict()
    .refine((l) => !l.from || l.from <= l.until, { message: "must be on or after the first day", path: ["until"] })
    .transform((l) => ({ from: l.from ? dhakaDay(l.from) : null, until: dhakaDay(l.until), note: l.note }))
    .nullable();

const fields = {
    name: zLRequired(160),
    slug: zSlug,
    designation: zL(200),
    degrees: z.string().trim().max(300),
    specialty: zL(400),
    affiliation: zLOptional(200),
    department: zId.nullable(),
    bmdc: z
        .string()
        .trim()
        .max(20)
        .regex(/^[A-Za-z0-9/ -]*$/, "letters, numbers, - and / only")
        .transform((v) => v || null)
        .nullable(),
    phone: z
        .string()
        .trim()
        .max(20)
        .regex(/^[0-9+ -]*$/, "digits only")
        .transform((v) => v || null)
        .nullable(),
    photo: zImage("doctors"),
    schedule,
    scheduleNote: zLOptional(200),
    leave,
    isFeatured: zBool,
    isActive: zBool,
    order: zOrder,
};

const createBody = z
    .object({ ...fields, slug: fields.slug.optional() })
    .partial()
    .required({ name: true })
    .strict();
const patchBody = z
    .object(fields)
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, "nothing to update");

async function assertDepartment(id) {
    if (id && !(await Department.exists({ _id: id }))) {
        throw new AppError(400, "UNKNOWN_DEPARTMENT", "That department doesn't exist.", [{ path: ["department"], message: "unknown department" }]);
    }
}

const TITLE = /^(?:(?:assoc(?:iate)?\.?|asst\.?|assistant)\s+)?(?:prof(?:essor)?\.?\s+)/i;
/** "Prof. Dr. Nasima Begum" → "dr-nasima-begum" (same pattern as the migrated slugs). */
const doctorSlug = (nameEn) => slugify(nameEn.replace(TITLE, "")) || "doctor";


// ── routes ───────────────────────────────────────────────────────────────────────────────────────────

// GET /api/admin/doctors/options — departments for the form select (hidden ones too, marked)
router.get("/options", async (_req, res) => {
    const departments = await Department.find({}, { name: 1, slug: 1, isActive: 1, order: 1 }).sort({ order: 1, _id: 1 }).lean();
    ok(res, { departments, days: DAYS });
});

// GET /api/admin/doctors?q&department&status&featured&missing&onLeave&page&limit — hidden doctors included
router.get(
    "/",
    validate({
        query: z.object({
            q: z.string().trim().max(80).optional().transform((v) => v || undefined),
            department: zId.optional(),
            status: z.enum(["active", "hidden"]).optional(),
            featured: z.enum(["true"]).optional(),
            onLeave: z.enum(["true"]).optional(),
            missing: z.enum(["photo", "bmdc", "schedule"]).optional(), // data-quality shortcuts (overview tiles)
            page: z.coerce.number().int().min(1).max(1000).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
    }),
    async (req, res) => {
        const { q, department, status, featured, onLeave, missing, page, limit } = req.valid.query;
        const and = [];
        if (department) and.push({ department });
        if (status) and.push({ isActive: status === "active" ? { $ne: false } : false });
        if (featured) and.push({ isFeatured: true });
        if (onLeave) and.push(onLeaveToday());
        if (missing === "photo") and.push({ photo: { $in: [null, ""] } });
        if (missing === "bmdc") and.push({ bmdc: { $in: [null, ""] } });
        if (missing === "schedule") and.push({ schedule: { $size: 0 }, scheduleNote: null });
        if (q) {
            const rx = searchRx(q);
            and.push({ $or: [{ "name.en": rx }, { "name.bn": rx }, { slug: rx }, { degrees: rx }, { bmdc: rx }, { "specialty.en": rx }] });
        }
        const filter = and.length ? { $and: and } : {};
        const [items, total] = await Promise.all([
            Doctor.find(filter).sort({ order: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).populate(DEPARTMENT_POPULATE).lean(),
            Doctor.countDocuments(filter),
        ]);
        ok(res, { items, total, page, limit });
    },
);

// GET /api/admin/doctors/:id
router.get("/:id", validate({ params: idParams }), async (req, res) => {
    const doc = await Doctor.findById(req.valid.params.id).lean();
    if (!doc) throw notFound("Doctor");
    ok(res, doc);
});

// POST /api/admin/doctors — slug from the English name when not given (unique suffix on clash)
router.post("/", validate({ body: createBody }), async (req, res) => {
    const body = req.valid.body;
    await assertDepartment(body.department);

    let slug = body.slug;
    if (slug) {
        if (await Doctor.exists({ slug })) {
            throw new AppError(409, "DUPLICATE_SLUG", "This web address is already used by another doctor.", [{ path: ["slug"], message: "already in use" }]);
        }
    } else {
        const base = doctorSlug(body.name.en);
        slug = base;
        for (let n = 2; await Doctor.exists({ slug }); n++) slug = `${base}-${n}`;
    }
    const last = await Doctor.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
    const doc = await Doctor.create({ order: (last?.order ?? 0) + 1, ...body, slug });

    await logActivity(req, { action: "doctors.create", entity: "doctors", entityId: doc._id, summary: doc.name.en });
    // B3: revalidateTag("doctors") here
    res.status(201).json({ data: doc.toObject() });
});

// PATCH /api/admin/doctors/:id — partial; slug rename keeps the old URL in previousSlugs
router.patch("/:id", validate({ params: idParams, body: patchBody }), async (req, res) => {
    const doc = await Doctor.findById(req.valid.params.id);
    if (!doc) throw notFound("Doctor");
    const { slug, ...rest } = req.valid.body;
    if ("department" in rest) await assertDepartment(rest.department);

    const oldSlug = doc.slug;
    const changes = applyPatch(doc, rest);
    if (slug && slug !== oldSlug) {
        await setSlug(Doctor, doc, slug);
        changes.slug = [oldSlug, slug];
    }
    if (Object.keys(changes).length) {
        await doc.save();
        await logActivity(req, { action: "doctors.update", entity: "doctors", entityId: doc._id, summary: doc.name.en, changes });
        // B3: revalidateTag("doctors"), revalidateTag(`doctor:${doc.slug}`)
    }
    ok(res, doc.toObject());
});

// DELETE /api/admin/doctors/:id — only when nothing points at the doctor; otherwise hide it (isActive=false)
router.delete("/:id", validate({ params: idParams }), async (req, res) => {
    const doc = await Doctor.findById(req.valid.params.id).lean();
    if (!doc) throw notFound("Doctor");
    const [aesthetic, bhrpc, articles] = await Promise.all([
        Aesthetic.exists({ doctors: doc._id }),
        Bhrpc.exists({ doctors: doc._id }),
        Article.countDocuments({ $or: [{ author: doc._id }, { reviewedBy: doc._id }] }),
    ]);
    const usedBy = [aesthetic && "MH Aesthetic team", bhrpc && "BHRPC team", articles && `${articles} health article(s)`].filter(Boolean);
    if (usedBy.length) {
        throw new AppError(409, "IN_USE", `Still listed in: ${usedBy.join(", ")}. Remove it there first, or hide the doctor instead.`);
    }
    await Doctor.deleteOne({ _id: doc._id });
    await logActivity(req, { action: "doctors.delete", entity: "doctors", entityId: doc._id, summary: doc.name.en });
    ok(res, { deleted: true });
});

export default router;
