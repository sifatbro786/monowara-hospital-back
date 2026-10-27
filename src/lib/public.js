import { z } from "zod";
import { SLUG_RE } from "./schema.js";
import { notFound } from "./errors.js";

/** Public routes only ever see active documents (drafts/hidden never leak). */
export const ACTIVE = Object.freeze({ isActive: { $ne: false } });
export const BY_ORDER = Object.freeze({ order: 1, _id: 1 });

export const slugParams = z.object({ slug: z.string().max(160).regex(SLUG_RE, "invalid slug") });

/** `?featured=true` → true; absent/anything else → undefined (no filter). */
export const flag = z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === "true" || v === "1" ? true : undefined));

/** Free-form category keys set by the admin ("pregnancy", "appointment"…). */
export const categoryKey = z.string().trim().max(40).regex(/^[a-z0-9_-]+$/i).optional();

export const ok = (res, data) => res.json({ data });

/**
 * Current slug first, then a renamed one (previousSlugs). Two queries instead of one `$or` so a slug
 * that is live on one doc always wins over the same string sitting in another doc's history.
 */
export async function findActiveBySlug(Model, slug, { what, populate, filter = {} } = {}) {
    const run = (q) => {
        let query = Model.findOne({ ...ACTIVE, ...filter, ...q });
        if (populate) query = query.populate(populate);
        return query.lean();
    };
    const doc = (await run({ slug })) ?? (await run({ previousSlugs: slug }));
    if (!doc) throw notFound(what ?? Model.modelName);
    return doc;
}

/** GET list + GET :slug handlers for the plain collections (no custom filters). */
export const listHandler = (Model, { filter = () => ({}), sort = BY_ORDER } = {}) =>
    async function list(req, res) {
        ok(res, await Model.find({ ...ACTIVE, ...filter(req.valid?.query ?? {}) }).sort(sort).lean());
    };

export const slugHandler = (Model, opts) =>
    async function bySlug(req, res) {
        ok(res, await findActiveBySlug(Model, req.valid.params.slug, opts));
    };
