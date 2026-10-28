import { Router } from "express";
import { z } from "zod";
import { AppError, notFound } from "./errors.js";
import { ok } from "./public.js";
import { applyPatch, idParams, searchRx, setSlug, slugify, zId, zSlug } from "./admin.js";
import { requirePermission } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { logActivity } from "../modules/activity/service.js";

/**
 * Admin CRUD router for "listable" collections (departments, facilities, diagnostics, packages,
 * hero slides, home blocks, stories, FAQs, jobs…). Doctors has its own router (schedule/leave) but the
 * same contract:
 *
 *   GET    /            ?q&status=active|hidden&page&limit (+ `query` extras) — hidden included, order asc
 *   GET    /:id
 *   POST   /            `required` fields; sluggable → slug optional (from `slugFrom`, -2 on clash); appended last
 *   PATCH  /:id         partial + strict; slug rename → previousSlugs
 *   PUT    /order       { ids: [...] } → order = position (drag/arrow reordering), one activity entry
 *   DELETE /:id         `inUse(doc)` → reasons → 409 IN_USE
 *
 * @param {object} o
 * @param {import("mongoose").Model} o.Model
 * @param {string} o.entity            activity entity / action prefix ("departments")
 * @param {string} o.permission
 * @param {string} o.what              "Department" (messages)
 * @param {Record<string, z.ZodTypeAny>} o.fields   editable fields (slug excluded)
 * @param {string[]} [o.required]      required on create (default ["name"])
 * @param {boolean} [o.sluggable]      collection has slug + previousSlugs (default true)
 * @param {(b: object) => string} [o.slugFrom]      default b.name.en
 * @param {(d: object) => string} [o.label]         activity summary (default name.en)
 * @param {string[]} [o.search]        regex search paths (default name.en/bn, slug, summary.en)
 * @param {Record<string, z.ZodTypeAny>} [o.query]  extra list query params
 * @param {(q: object) => object} [o.filter]        extra list filter from those params
 * @param {(doc: object) => Promise<string[]>} [o.inUse]
 * @param {(body: object, req, doc?) => Promise<void>} [o.check]   cross-collection checks (create + patch)
 * @param {(doc, body: object, req) => void} [o.beforeSave]       server-owned fields (e.g. consent.recordedBy)
 * @param {object} [o.sort]           list order (default { order: 1, _id: 1 })
 */
export function crudRouter({
    Model,
    entity,
    permission,
    what,
    fields,
    required = ["name"],
    sluggable = true,
    slugFrom = (b) => b.name?.en ?? "",
    label = (d) => d.name?.en ?? d._id,
    search = ["name.en", "name.bn", "slug", "summary.en"],
    query = {},
    filter = () => ({}),
    inUse,
    check,
    beforeSave,
    sort = { order: 1, _id: 1 },
}) {
    const router = Router();
    router.use(requirePermission(permission));

    const editable = sluggable ? { ...fields, slug: zSlug } : fields;
    const createBody = z
        .object(sluggable ? { ...fields, slug: zSlug.optional() } : fields)
        .partial()
        .required(Object.fromEntries(required.map((k) => [k, true])))
        .strict();
    const patchBody = z
        .object(editable)
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
                and.push({ $or: search.map((p) => ({ [p]: rx })) });
            }
            const f = { $and: and };
            const [items, total] = await Promise.all([
                Model.find(f).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
                Model.countDocuments(f),
            ]);
            ok(res, { items, total, page, limit });
        },
    );

    // PUT /order { ids } — before /:id routes. Ids not listed keep their order after the listed ones.
    router.put("/order", validate({ body: z.object({ ids: z.array(zId).min(1).max(500) }).strict() }), async (req, res) => {
        const { ids } = req.valid.body;
        if (new Set(ids).size !== ids.length) throw new AppError(400, "DUPLICATE_IDS", "Each entry may appear only once.");
        const found = await Model.countDocuments({ _id: { $in: ids } });
        if (found !== ids.length) throw new AppError(400, "UNKNOWN_ID", "Some entries no longer exist — reload and try again.");
        await Promise.all(ids.map((id, i) => Model.updateOne({ _id: id }, { $set: { order: i + 1 } })));
        await logActivity(req, { action: `${entity}.reorder`, entity, summary: `${ids.length} entries reordered` });
        ok(res, { reordered: ids.length });
    });

    router.get("/:id", validate({ params: idParams }), async (req, res) => {
        const doc = await Model.findById(req.valid.params.id).lean();
        if (!doc) throw notFound(what);
        ok(res, doc);
    });

    router.post("/", validate({ body: createBody }), async (req, res) => {
        const body = req.valid.body;
        await check?.(body, req);
        const extra = {};
        if (sluggable) {
            if (body.slug) {
                if (await Model.exists({ slug: body.slug })) {
                    throw new AppError(409, "DUPLICATE_SLUG", "This web address is already in use.", [{ path: ["slug"], message: "already in use" }]);
                }
                extra.slug = body.slug;
            } else {
                const base = slugify(slugFrom(body)) || entity.replace(/s$/, "");
                let slug = base;
                for (let n = 2; await Model.exists({ slug }); n++) slug = `${base}-${n}`;
                extra.slug = slug;
            }
        }
        const last = await Model.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
        const doc = new Model({ order: (last?.order ?? 0) + 1, ...body, ...extra });
        beforeSave?.(doc, body, req);
        await doc.save();
        await logActivity(req, { action: `${entity}.create`, entity, entityId: doc._id, summary: label(doc) });
        res.status(201).json({ data: doc.toObject() });
    });

    router.patch("/:id", validate({ params: idParams, body: patchBody }), async (req, res) => {
        const doc = await Model.findById(req.valid.params.id);
        if (!doc) throw notFound(what);
        const { slug, ...rest } = req.valid.body;
        await check?.(rest, req, doc);
        const oldSlug = doc.slug;
        const changes = applyPatch(doc, rest);
        if (sluggable && slug && slug !== oldSlug) {
            await setSlug(Model, doc, slug);
            changes.slug = [oldSlug, slug];
        }
        if (Object.keys(changes).length) {
            beforeSave?.(doc, rest, req);
            await doc.save();
            await logActivity(req, { action: `${entity}.update`, entity, entityId: doc._id, summary: label(doc), changes });
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
        await logActivity(req, { action: `${entity}.delete`, entity, entityId: doc._id, summary: label(doc) });
        ok(res, { deleted: true });
    });

    return router;
}
