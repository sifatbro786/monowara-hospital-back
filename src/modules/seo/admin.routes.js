import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { crudRouter } from "../../lib/crud.js";
import { zBool, zImage, zL } from "../../lib/admin.js";
import { ok } from "../../lib/public.js";
import { SeoOverride } from "./model.js";
import { Doctor } from "../doctors/model.js";
import { Department } from "../departments/model.js";
import { Facility } from "../facilities/model.js";
import { Diagnostic } from "../diagnostics/model.js";
import { Package } from "../packages/model.js";
import { Article } from "../articles/model.js";
import { Job } from "../jobs/model.js";
import { Page } from "../pages/model.js";

// /api/admin/seo — per-page Google title/description/share image (seo.manage = marketer + super admin).
// `path` is the locale-less site path ("/doctors/dr-x"); BN pages use the same override's bn text.
const PATH = z.string().trim().toLowerCase().max(200).regex(/^\/[a-z0-9\-/]*$/, "a site path like /doctors or /departments/cardiology");

const STATIC = [
    "/", "/doctors", "/departments", "/diagnostics", "/packages", "/appointment", "/bhrpc", "/mh-aesthetic", "/about",
    "/about/management", "/patients-visitors", "/health-tips", "/gallery", "/expert-talks", "/careers", "/contact", "/emergency",
];

const router = crudRouter({
    Model: SeoOverride,
    entity: "seo",
    permission: "seo.manage",
    what: "SEO entry",
    sluggable: false,
    required: ["path"],
    label: (d) => d.path,
    search: ["path", "title.en", "title.bn"],
    sort: { path: 1 },
    fields: {
        path: PATH,
        title: zL(70),
        description: zL(170),
        image: zImage("seo"),
        isActive: zBool,
    },
    async check(body, _req, doc) {
        if (body.path && (await SeoOverride.exists({ path: body.path, ...(doc && { _id: { $ne: doc._id } }) }))) {
            throw new AppError(409, "DUPLICATE_PATH", "That page already has SEO settings — edit that entry instead.", [{ path: ["path"], message: "already has an entry" }]);
        }
    },
});

// GET /api/admin/seo/paths — every public page, for the picker. Mounted in routes.js BEFORE the CRUD
// router (otherwise "/paths" would be taken as an :id).
export async function seoPaths(_req, res) {
    const slugs = async (Model, base, filter = {}) => (await Model.find(filter, { slug: 1, name: 1, title: 1 }).lean()).map((d) => ({ path: `${base}/${d.slug}`, label: d.name?.en ?? d.title?.en ?? d.slug }));
    const groups = await Promise.all([
        slugs(Doctor, "/doctors"),
        slugs(Department, "/departments"),
        slugs(Facility, "/facilities"),
        slugs(Diagnostic, "/diagnostics"),
        slugs(Package, "/packages"),
        slugs(Article, "/health-tips"),
        slugs(Job, "/careers"),
        slugs(Page, "/legal", { type: "legal" }),
    ]);
    ok(res, [...STATIC.map((p) => ({ path: p, label: p === "/" ? "Homepage" : p })), ...groups.flat()]);
}

export default router;
