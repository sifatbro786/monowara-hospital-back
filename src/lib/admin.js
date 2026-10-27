import { z } from "zod";
import { AppError } from "./errors.js";
import { SLUG_RE } from "./schema.js";

/**
 * Building blocks for the admin CRUD modules (B2.3+): one zod vocabulary that mirrors lib/schema.js,
 * a before/after diff for the activity log, and slug-rename bookkeeping.
 */

const text = (max) => z.string().trim().max(max);

/** `{ en, bn }` — either may be empty (frontend falls back to en). */
export const zL = (max = 300) => z.object({ en: text(max).default(""), bn: text(max).default("") }).strict();
/** `{ en, bn }` with English required. */
export const zLRequired = (max = 300) =>
    z.object({ en: text(max).min(2, "English is required"), bn: text(max).default("") }).strict();
/** Optional translatable field: null, or `{ en, bn }`; two empty strings collapse to null. */
export const zLOptional = (max = 300) =>
    zL(max)
        .nullable()
        .transform((v) => (v && (v.en || v.bn) ? v : null));

export const zSlug = z.string().trim().toLowerCase().max(160).regex(SLUG_RE, "lowercase letters, numbers and dashes");
/** Admin ids: seeded readable ids ("doc_dr-x") or ObjectId hex. */
export const zId = z.string().trim().max(160).regex(/^[\w-]+$/, "invalid id");
export const idParams = z.object({ id: zId });

/** Image path in a given upload folder (what POST /api/admin/uploads/:folder returned). */
export const zImage = (folder) =>
    z
        .string()
        .trim()
        .regex(new RegExp(`^/uploads/${folder}/[\\w\\-.]+$`), `upload the image first (/uploads/${folder}/…)`)
        .nullable();

export const zBool = z.boolean();
export const zOrder = z.number().int().min(0).max(9999);

/** "Prof. Dr. Nasima Begum" → "prof-dr-nasima-begum" (ASCII only; Bangla names need a typed slug). */
export function slugify(s = "") {
    return s
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 160);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v);

/**
 * Apply a validated patch to a mongoose doc; returns `{ field: [before, after] }` for changed fields
 * only (top level — sub-objects are compared whole, which is what the log viewer shows).
 */
export function applyPatch(doc, patch) {
    const changes = {};
    for (const [k, v] of Object.entries(patch)) {
        const before = plain(doc.get(k));
        if (same(before, v)) continue;
        changes[k] = [before ?? null, v ?? null];
        doc.set(k, v);
    }
    return changes;
}

/**
 * Slug rename: the old slug goes into previousSlugs (public URLs keep working via 308), the new slug
 * leaves it. Uniqueness is checked against current slugs of OTHER docs.
 */
export async function setSlug(Model, doc, slug) {
    if (!slug || slug === doc.slug) return;
    if (await Model.exists({ slug, _id: { $ne: doc._id } })) {
        throw new AppError(409, "DUPLICATE_SLUG", "This web address is already used by another entry.", [
            { path: ["slug"], message: "already in use" },
        ]);
    }
    const prev = new Set(doc.previousSlugs ?? []);
    if (doc.slug) prev.add(doc.slug);
    prev.delete(slug);
    doc.previousSlugs = [...prev];
    doc.slug = slug;
}

/** Escaped case-insensitive regex for admin search boxes. */
export const searchRx = (q) => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/** Start of today in Dhaka. Leave dates are stored at Dhaka midnight of the day, so "on leave today"
 *  = until >= today's midnight (a leave ending today still counts all day). */
export const dhakaTodayStart = () =>
    new Date(`${new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+06:00`);

/** Mongo filter: doctor on leave today (Dhaka). */
export const onLeaveToday = () => {
    const today = dhakaTodayStart();
    return { "leave.until": { $gte: today }, $or: [{ "leave.from": null }, { "leave.from": { $lte: today } }] };
};
