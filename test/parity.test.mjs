// Parity harness: runs the real Express app with Mongoose queries answered in-memory (sift = the
// matcher Mongoose itself ships), then compares every endpoint with mh-front's static service logic.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const BACK = path.resolve(__dir, "..");
const FRONT_DATA = path.resolve(BACK, process.env.MH_FRONT_DIR || "../mh-front", "data");
Object.assign(process.env, { NODE_ENV: "test", LOG_LEVEL: "silent", MONGODB_URI: "mongodb://x/y", JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123456", UPLOAD_DIR: "./.test-uploads", PRIVATE_DIR: "./.test-private" });

const req = createRequire(path.join(BACK, "package.json"));
const mongoose = req("mongoose");
const sift = req("sift").default ?? req("sift");
const imp = (p) => import(pathToFileURL(path.join(BACK, p)).href);
const data = async (f) => import(pathToFileURL(path.join(FRONT_DATA, f)).href);

const M = await imp("src/models.js");
const { createApp } = await imp("src/app.js");

// ── build store exactly like the seed does ───────────────────────────────────────────────
const D = {
    settings: (await data("settings.js")).settings,
    hero: (await data("hero.js")).heroSlides,
    faqs: (await data("faqs.js")).faqs,
    home: await data("home.js"),
    departments: (await data("departments.js")).departments,
    facilities: (await data("facilities.js")).facilities,
    diagnostics: (await data("diagnostics.js")).diagnostics,
    doctors: (await data("doctors.js")).doctors,
    packages: (await data("packages.js")).packages,
    articles: (await data("articles.js")).articles,
    gallery: (await data("gallery.js")).gallery,
    legal: (await data("legal.js")).legalPages,
    site: await data("site-pages.js"),
    jobs: (await data("careers.js")).jobs,
    aesthetic: (await data("aesthetic.js")).aesthetic,
    bhrpc: (await data("bhrpc.js")).bhrpc,
    media: (await data("media.js")).media,
    seo: (await data("seo.js")).seo,
};
const store = new Map();
const put = (Model, docs) =>
    store.set(
        Model.collection.name,
        docs.map((r, i) => {
            const hasOrder = Boolean(Model.schema.path("order"));
            return new Model({ ...r, ...(hasOrder && r.order == null && { order: i + 1 }) }).toObject();
        }),
    );
put(M.Settings, [D.settings]);
put(M.HeroSlide, D.hero);
put(M.Faq, D.faqs);
put(M.KeyNumber, D.home.keyNumbers);
put(M.Centre, D.home.centres);
put(M.Talk, D.home.talks);
put(M.Story, [
    // two fake stories to prove the consent filter
    { _id: "st_ok", quote: { en: "Great" }, name: { en: "A" }, consent: { confirmed: true, recordedBy: "staff" }, order: 1 },
    { _id: "st_no", quote: { en: "Nope" }, name: { en: "B" }, consent: { confirmed: false }, order: 2 },
]);
put(M.Department, D.departments);
put(M.Facility, D.facilities);
put(M.Diagnostic, D.diagnostics);
put(M.Doctor, D.doctors);
put(M.Package, D.packages);
put(M.Article, D.articles);
put(M.GalleryItem, D.gallery);
put(M.Page, [...D.legal.map((p) => ({ ...p, type: "legal" })), ...D.site.sitePages.map((p) => ({ ...p, type: "site" }))]);
put(M.Management, D.site.management);
put(M.Job, D.jobs);
put(M.Aesthetic, [D.aesthetic]);
put(M.Bhrpc, [D.bhrpc]);
put(M.MediaSlot, D.media);
put(M.SeoOverride, D.seo);

// ── in-memory Query.exec ─────────────────────────────────────────────────────────────────
const get = (o, p) => p.split(".").reduce((v, k) => v?.[k], o);
function project(doc, fields) {
    if (!fields || !Object.keys(fields).length) return doc;
    const vals = Object.values(fields);
    const out = structuredClone(doc);
    if (vals.every((v) => v === 0)) {
        for (const p of Object.keys(fields)) {
            const parts = p.split(".");
            const last = parts.pop();
            const parent = parts.reduce((v, k) => v?.[k], out);
            if (parent) delete parent[last];
        }
        return out;
    }
    const inc = { _id: doc._id };
    for (const p of Object.keys(fields)) if (fields[p]) inc[p] = get(doc, p);
    return inc;
}
const cmp = (sort) => (a, b) => {
    for (const [k, dir] of Object.entries(sort || {})) {
        const x = get(a, k), y = get(b, k);
        if (x < y) return -1 * dir;
        if (x > y) return 1 * dir;
    }
    return 0;
};
const parseSelect = (s) => (typeof s === "string" ? Object.fromEntries(s.split(/\s+/).filter(Boolean).map((f) => (f.startsWith("-") ? [f.slice(1), 0] : [f, 1]))) : s);

mongoose.Query.prototype.exec = async function exec() {
    const rows = store.get(this.model.collection.name) || [];
    let res = rows.filter(sift(this.getFilter()));
    if (this.op === "countDocuments") return res.length;
    if (this.op === "estimatedDocumentCount") return rows.length;
    res = res.sort(cmp(this.options.sort));
    if (this.options.skip) res = res.slice(this.options.skip);
    if (this.options.limit) res = res.slice(0, this.options.limit);
    res = res.map((d) => project(d, this._fields));
    for (const pop of Object.values(this._mongooseOptions.populate || {})) {
        const refModel = mongoose.model(this.model.schema.path(pop.path).options.ref);
        const pool = store.get(refModel.collection.name);
        const sel = parseSelect(pop.select);
        res = res.map((d) => {
            const id = d[pop.path];
            const found = id ? pool.find((x) => x._id === id) : null;
            return { ...d, [pop.path]: found ? project(found, sel) : null };
        });
    }
    res = JSON.parse(JSON.stringify(res));
    return this.op === "findOne" ? (res[0] ?? null) : res;
};

// ── static services (copied logic from mh-front/lib/api/*) ───────────────────────────────
const active = (docs) => docs.filter((d) => d.isActive !== false);
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const deptById = new Map(D.departments.map((d) => [d._id, d]));
const populate = (d) => {
    const dept = deptById.get(d.department);
    return { ...d, department: dept ? { _id: dept._id, slug: dept.slug, name: dept.name } : null };
};
function staticDoctors({ department, day, q, featured, page = 1, limit = 100 } = {}) {
    const needle = q?.trim().toLowerCase();
    let items = active(D.doctors)
        .filter((d) => (featured ? d.isFeatured : true))
        .filter((d) => (department ? d.department === department || deptById.get(d.department)?.slug === department : true))
        .filter((d) => (day ? d.schedule.some((s) => s.day === day) : true))
        .filter((d) =>
            needle
                ? [d.name.en, d.name.bn, d.degrees, d.specialty?.en, d.specialty?.bn, deptById.get(d.department)?.name.en, deptById.get(d.department)?.name.bn]
                      .join(" ")
                      .toLowerCase()
                      .includes(needle)
                : true,
        )
        .sort(byOrder);
    const total = items.length;
    items = items.slice((page - 1) * limit, page * limit).map(populate);
    return { items, total, page, limit };
}
const allDocs = staticDoctors({ limit: 1000 }).items;
const docById = new Map(allDocs.map((d) => [d._id, d]));
const bySlug = (arr, slug) => active(arr).find((x) => x.slug === slug) ?? null;
const sorted = (arr) => active(arr).sort(byOrder);

const cases = [
    ["/settings", D.settings],
    ["/hero", sorted(D.hero)],
    ["/faqs", sorted(D.faqs)],
    ["/faqs?category=appointment", sorted(D.faqs).filter((f) => f.category === "appointment")],
    ["/home", { keyNumbers: sorted(D.home.keyNumbers), centres: sorted(D.home.centres), talks: sorted(D.home.talks), stories: [{ _id: "st_ok", quote: { en: "Great", bn: "" }, name: { en: "A", bn: "" }, consent: { confirmed: true } }] }],
    ["/departments", sorted(D.departments)],
    ["/departments?featured=true", sorted(D.departments).filter((d) => d.isFeatured)],
    ["/facilities", sorted(D.facilities)],
    ["/diagnostics", sorted(D.diagnostics)],
    ["/doctors", staticDoctors()],
    ["/doctors?featured=true&limit=8", staticDoctors({ featured: true, limit: 8 })],
    ["/doctors?page=2&limit=30", staticDoctors({ page: 2, limit: 30 })],
    ["/doctors?day=fri", staticDoctors({ day: "fri" })],
    ["/doctors?department=cardiology", staticDoctors({ department: "cardiology" })],
    ["/doctors?department=dept_cardiology", staticDoctors({ department: "dept_cardiology" })],
    ["/doctors?department=nope", { items: [], total: 0, page: 1, limit: 100 }],
    ["/doctors?q=FCPS", staticDoctors({ q: "FCPS" })],
    ["/doctors?q=" + encodeURIComponent("গাইনি"), staticDoctors({ q: "গাইনি" })],
    ["/doctors?q=cardio", staticDoctors({ q: "cardio" })],
    ["/doctors?q=" + encodeURIComponent("Gynaecology"), staticDoctors({ q: "Gynaecology" })],
    ["/doctors?day=sat&department=gynaecology-obstetrics&q=prof", staticDoctors({ day: "sat", department: "gynaecology-obstetrics", q: "prof" })],
    ["/packages", sorted(D.packages)],
    ["/packages?category=maternity", sorted(D.packages).filter((p) => p.category === "maternity")],
    ["/packages?featured=true", sorted(D.packages).filter((p) => p.isFeatured)],
    ["/packages?department=dept_gynaecology-obstetrics", sorted(D.packages).filter((p) => p.departments?.includes("dept_gynaecology-obstetrics"))],
    ["/articles", active(D.articles).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : byOrder(a, b)))],
    ["/gallery", sorted(D.gallery)],
    ["/pages?type=legal", active(D.legal)],
    ["/management", sorted(D.site.management)],
    ["/jobs", sorted(D.jobs)],
    ["/aesthetic", { ...D.aesthetic, treatments: sorted(D.aesthetic.treatments), doctors: D.aesthetic.doctors.map((id) => docById.get(id)).filter(Boolean) }],
    ["/bhrpc", { ...D.bhrpc, doctors: D.bhrpc.doctors.map((id) => docById.get(id)).filter(Boolean) }],
    ["/media", active(D.media)],
    ["/seo", [...active(D.seo)].sort((a, b) => (a.path < b.path ? -1 : 1))], // API sorts by path
];
for (const d of D.departments) cases.push([`/departments/${d.slug}`, bySlug(D.departments, d.slug)]);
for (const d of D.facilities) cases.push([`/facilities/${d.slug}`, bySlug(D.facilities, d.slug)]);
for (const d of D.diagnostics) cases.push([`/diagnostics/${d.slug}`, bySlug(D.diagnostics, d.slug)]);
for (const d of active(D.doctors)) cases.push([`/doctors/${d.slug}`, populate(d)]);
for (const d of D.packages) cases.push([`/packages/${d.slug}`, bySlug(D.packages, d.slug)]);
for (const d of D.articles) cases.push([`/articles/${d.slug}`, bySlug(D.articles, d.slug)]);
for (const d of [...D.legal, ...D.site.sitePages]) cases.push([`/pages/${d.slug}`, d]);
for (const d of D.jobs) cases.push([`/jobs/${d.slug}`, bySlug(D.jobs, d.slug)]);

// ── compare: every value the static layer returns must be identical in the API response ──
const iso = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v);
function subset(exp, act, p = "") {
    exp = iso(exp);
    if (exp === undefined) return [];
    if (Array.isArray(exp)) {
        if (!Array.isArray(act)) return [`${p}: expected array`];
        if (exp.length !== act.length) return [`${p}: length ${exp.length} vs ${act.length}`];
        return exp.flatMap((v, i) => subset(v, act[i], `${p}[${i}]`));
    }
    if (exp && typeof exp === "object") {
        if (!act || typeof act !== "object") return [`${p}: expected object, got ${JSON.stringify(act)}`];
        return Object.entries(exp).flatMap(([k, v]) => subset(v, act[k], p ? `${p}.${k}` : k));
    }
    return exp === act ? [] : [`${p}: ${JSON.stringify(exp)} vs ${JSON.stringify(act)}`];
}

const server = createApp().listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;

let fails = 0;
for (const [url, expected] of cases) {
    const res = await fetch(base + url);
    const body = await res.json();
    const diffs = res.status !== 200 ? [`HTTP ${res.status} ${JSON.stringify(body)}`] : subset(JSON.parse(JSON.stringify(expected)), body.data);
    if (diffs.length) {
        fails++;
        console.log(`✖ ${url}\n   ${diffs.slice(0, 5).join("\n   ")}`);
    }
}
console.log(`parity: ${cases.length - fails}/${cases.length} endpoints match the static layer`);

// ── negative / security cases ──
const neg = [
    ["/doctors?limit=500", 400],
    ["/doctors?day=monday", 400],
    ["/doctors?department[$ne]=x", 200],
    ["/doctors/DR-NASIMA-BEGUM", 400],
    ["/doctors/does-not-exist", 404],
    ["/packages?category=cosmetic", 400],
    ["/pages?type=admin", 400],
    ["/nope", 404],
    ["/health", 503],
];
for (const [url, want] of neg) {
    const res = await fetch(base + url);
    const ok = res.status === want;
    if (!ok) fails++;
    console.log(`${ok ? "✔" : "✖"} ${url} → ${res.status} (want ${want})`);
}
const h = await fetch(base + "/settings", { headers: { Origin: "https://evil.example" } });
console.log(`CORS evil origin → ACAO=${h.headers.get("access-control-allow-origin")}`);
const g = await fetch(base + "/settings", { headers: { Origin: "http://localhost:3000" } });
console.log(`CORS allowed origin → ACAO=${g.headers.get("access-control-allow-origin")} cred=${g.headers.get("access-control-allow-credentials")}`);
console.log(`headers: csp=${g.headers.get("content-security-policy")} | xpb=${g.headers.get("x-powered-by")}`);
// rate limit: through "Nginx" (XFF set) → limited; loopback without XFF → exempt
let first429 = 0;
for (let i = 1; i <= 305; i++) {
    const r = await fetch(base + "/hero", { headers: { "X-Forwarded-For": "203.0.113.9" } });
    if (r.status === 429 && !first429) first429 = i;
}
console.log(`XFF client: first 429 at request #${first429} (limit 300)`);
const direct = await fetch(base + "/hero");
console.log(`direct loopback after that → ${direct.status}`);
const dep = store.get("departments").find((d) => d.slug === "cardiology");
dep.slug = "heart-care"; dep.previousSlugs = ["cardiology"];
const ren = await (await fetch(base + "/departments/cardiology")).json();
const viaDoc = await (await fetch(base + "/doctors?department=cardiology")).json();
console.log(`renamed slug → ${ren.data?.slug} · doctors via old slug: ${viaDoc.data.total}`);
server.close();
process.exit(fails ? 1 : 0);
