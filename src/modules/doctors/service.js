import { Doctor } from "./model.js";
import { Department } from "../departments/model.js";
import { ACTIVE, BY_ORDER, findActiveBySlug } from "../../lib/public.js";

/** Doctors carry `department: { _id, slug, name }` (the static layer "populates" the same fields). */
export const DEPARTMENT_POPULATE = { path: "department", select: "slug name" };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `department` may be an id, a slug or a renamed slug → department _id, or null if unknown. */
async function resolveDepartmentId(value) {
    const dept = await Department.findOne(
        { $or: [{ _id: value }, { slug: value }, { previousSlugs: value }] },
        { _id: 1 },
    ).lean();
    return dept?._id ?? null;
}

/**
 * GET /doctors — same semantics as mh-front's static getDoctors():
 * department (id|slug), day (sat…fri), q (name en/bn, degrees, specialty en/bn, department name), featured.
 */
export async function listDoctors({ department, day, q, featured, page, limit }) {
    const filter = { ...ACTIVE };
    const empty = { items: [], total: 0, page, limit };

    if (featured) filter.isFeatured = true;
    if (day) filter["schedule.day"] = day;
    if (department) {
        const id = await resolveDepartmentId(department);
        if (!id) return empty; // unknown department → no doctors (static behaviour), not a 400
        filter.department = id;
    }
    if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        const deptIds = await Department.find({ $or: [{ "name.en": rx }, { "name.bn": rx }] }, { _id: 1 }).lean();
        filter.$or = [
            { "name.en": rx },
            { "name.bn": rx },
            { degrees: rx },
            { "specialty.en": rx },
            { "specialty.bn": rx },
            ...(deptIds.length ? [{ department: { $in: deptIds.map((d) => d._id) } }] : []),
        ];
    }

    const [items, total] = await Promise.all([
        Doctor.find(filter)
            .sort(BY_ORDER)
            .skip((page - 1) * limit)
            .limit(limit)
            .populate(DEPARTMENT_POPULATE)
            .lean(),
        Doctor.countDocuments(filter),
    ]);
    return { items, total, page, limit };
}

export const getDoctorBySlug = (slug) => findActiveBySlug(Doctor, slug, { what: "Doctor", populate: DEPARTMENT_POPULATE });

/** Active doctors for a list of ids, populated, in the given order (aesthetic / BHRPC teams). */
export async function getDoctorsByIds(ids = []) {
    if (!ids.length) return [];
    const docs = await Doctor.find({ ...ACTIVE, _id: { $in: ids } }).populate(DEPARTMENT_POPULATE).lean();
    const byId = new Map(docs.map((d) => [d._id, d]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
}
