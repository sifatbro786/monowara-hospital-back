import { Router } from "express";
import { z } from "zod";
import { AppError, notFound } from "./errors.js";
import { ok } from "./public.js";
import { applyPatch, idParams, searchRx, setSlug, slugify, zSlug } from "./admin.js";
import { requirePermission } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { logActivity } from "../modules/activity/service.js";

/**
 * Admin CRUD router for the plain "named + sluggable + listable" collections
 * (departments, facilities, diagnostics; later packages, articles…). Doctors has its own router
 * because of schedule/leave filters, but follows the same contract:
 *
 *   GET    /            ?q&status=active|hidden&page&limit   (hidden included, order asc)
 *   GET    /:id
 *   POST   /            name.en required, slug optional (from name.en, -2 on clash), appended last
 *   PATCH  /:id         partial + strict; slug rename → previousSlugs
 *   DELETE /:id         `inUse(doc)` → list of reasons → 409 IN_USE
 *
 * @param {object} o
 * @param {import("mongoose").Model} o.Model
 * @param {string} o.entity        activity entity / action prefix ("departments")
 * @param {string} o.permission
 * @param {string} o.what          "Department" (messages)
 * @param {Record<string, z.ZodTypeAny>} o.fields  editable fields except slug (name required)
 * @param {(q: object) => object} [o.filter]       extra list filters from the query
 * @param {Record<string, z.ZodTypeAny>} [o.query] extra list query params
 * @param {(doc: object) => Promise<string[]>} [o.inUse]
 * @param {(body: object) => Promise<void>} [o.check]  cross-collection checks on create/patch
 */
export function crudRouter({ Model, entity, permission, what, fields, filter = () => ({}), query = {}, inUse, check }) {
    const router = Router();
    router.use(requirePermission(permission));

    const createBody = z.object({ ...fields, slug: zSlug.optional() }).partial().required({ name: true }).strict();
    const patchBody = z
        .object({ ...fields, slug: zSlug })
        .partial()
        .strict()
        .refine((b) => Object.keys(b).length > 0, "nothing to update");

    router.get(
        "/",
        validate({
            query: z.object({
                q: z.string().trim().max(80).optional().transform((v) => v || undefined),
                status: z.enum(["active", "hidden"]).optional(),
                page: z.coerce.number().int().min(1).max(1000).default(1),
                limit: z.coerce.number().int().min(1).max(100).default(100),
                ...query,
            }),
        }),
        async (req, res) => {
            const { q, status, page, limit, ...rest } = req.valid.query;
            const and = [filter(rest)];
            if (status) and.push({ isActive: status === "active" ? { $ne: false } : false });
            if (q) {
                const rx = searchRx(q);
                and.push({ $or: [{ "name.en": rx }, { "name.bn": rx }, { slug: rx }, { "summary.en": rx }] });
            }
            const f = { $and: and };
            const [items, total] = await Promise.all([
                Model.find(f).sort({ order: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
                Model.countDocuments(f),
            ]);
            ok(res, { items, total, page, limit });
        },
    );

    router.get("/:id", validate({ params: idParams }), async (req, res) => {
        const doc = await Model.findById(req.valid.params.id).lean();
        if (!doc) throw notFound(what);
        ok(res, doc);
    });

    router.post("/", validate({ body: createBody }), async (req, res) => {
        const body = req.valid.body;
        await check?.(body);
        let slug = body.slug;
        if (slug) {
            if (await Model.exists({ slug })) {
                throw new AppError(409, "DUPLICATE_SLUG", "This web address is already in use.", [{ path: ["slug"], message: "already in use" }]);
            }
        } else {
            const base = slugify(body.name.en) || entity.slice(0, -1);
            slug = base;
            for (let n = 2; await Model.exists({ slug }); n++) slug = `${base}-${n}`;
        }
        const last = await Model.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
        const doc = await Model.create({ order: (last?.order ?? 0) + 1, ...body, slug });
        await logActivity(req, { action: `${entity}.create`, entity, entityId: doc._id, summary: doc.name.en });
        // B3: revalidateTag(entity)
        res.status(201).json({ data: doc.toObject() });
    });

    router.patch("/:id", validate({ params: idParams, body: patchBody }), async (req, res) => {
        const doc = await Model.findById(req.valid.params.id);
        if (!doc) throw notFound(what);
        const { slug, ...rest } = req.valid.body;
        await check?.(rest);
        const oldSlug = doc.slug;
        const changes = applyPatch(doc, rest);
        if (slug && slug !== oldSlug) {
            await setSlug(Model, doc, slug);
            changes.slug = [oldSlug, slug];
        }
        if (Object.keys(changes).length) {
            await doc.save();
            await logActivity(req, { action: `${entity}.update`, entity, entityId: doc._id, summary: doc.name.en, changes });
            // B3: revalidateTag(entity), revalidateTag(`<singular>:${doc.slug}`)
        }
        ok(res, doc.toObject());
    });

    router.delete("/:id", validate({ params: idParams }), async (req, res) => {
        const doc = await Model.findById(req.valid.params.id).lean();
        if (!doc) throw notFound(what);
        const reasons = (await inUse?.(doc)) ?? [];
        if (reasons.length) {
            throw new AppError(409, "IN_USE", `Still used by: ${reasons.join(", ")}. Move or remove those first, or hide it instead.`);
        }
        await Model.deleteOne({ _id: doc._id });
        await logActivity(req, { action: `${entity}.delete`, entity, entityId: doc._id, summary: doc.name.en });
        ok(res, { deleted: true });
    });

    return router;
}
