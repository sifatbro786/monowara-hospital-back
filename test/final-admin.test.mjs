// B2.10–B2.13 end-to-end: Aesthetic/BHRPC, articles, gallery, management, pages (site + legal),
// SEO overrides, contact-tap beacons + overview tap stats.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BACK = path.resolve(__dir, "..");
const FRONT_DATA = path.resolve(BACK, process.env.MH_FRONT_DIR || "../mh-front", "data");
Object.assign(process.env, {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MONGODB_URI: "mongodb://x/y",
    JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123456",
    CORS_ORIGINS: "http://localhost:3000",
});
const req = createRequire(path.join(BACK, "package.json"));
const mongoose = req("mongoose");
const imp = (p) => import(pathToFileURL(path.join(BACK, p)).href);
const data = async (f) => import(pathToFileURL(path.join(FRONT_DATA, f)).href);

const M = await imp("src/models.js");
const { installFakeDb } = await import("./fake-db.mjs");
const fakes = installFakeDb(mongoose);
const { createApp } = await imp("src/app.js");
const { hashPassword } = await imp("src/lib/password.js");

await M.Settings.create((await data("settings.js")).settings);
for (const d of (await data("departments.js")).departments) await M.Department.create(d);
for (const d of (await data("doctors.js")).doctors) await M.Doctor.create(d);
for (const d of (await data("articles.js")).articles) await M.Article.create(d);
for (const d of (await data("gallery.js")).gallery) await M.GalleryItem.create(d);
await M.Aesthetic.create((await data("aesthetic.js")).aesthetic);
await M.Bhrpc.create((await data("bhrpc.js")).bhrpc);
for (const p of (await data("legal.js")).legalPages) await M.Page.create({ ...p, type: "legal" });
for (const p of (await data("site-pages.js")).sitePages) await M.Page.create({ ...p, type: "site" });
const PW = "Monowara2026";
for (const [email, role, name] of [["sa@mh.test", "super_admin", "Sifat"], ["opd@mh.test", "opd_incharge", "Rahima"], ["gfx@mh.test", "graphics_design", "Tanvir"], ["mkt@mh.test", "marketer", "Mitu"]]) {
    await M.User.create({ name, email, role, passwordHash: await hashPassword(PW) });
}

const server = createApp().listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
class Client {
    jar = new Map();
    async call(method, url, body) {
        const res = await fetch(base + url, {
            method,
            headers: {
                ...(body ? { "content-type": "application/json" } : {}),
                "x-requested-with": "mh-admin",
                cookie: [...this.jar].filter(([, c]) => new URL(base + url).pathname.startsWith(c.path)).map(([n, c]) => `${n}=${c.value}`).join("; "),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        for (const sc of res.headers.getSetCookie()) {
            const [nv, ...attrs] = sc.split(";").map((s) => s.trim());
            const n = nv.slice(0, nv.indexOf("=")), v = nv.slice(nv.indexOf("=") + 1);
            const p = attrs.find((a) => /^path=/i.test(a))?.slice(5) || "/";
            if (!v) this.jar.delete(n);
            else this.jar.set(n, { value: decodeURIComponent(v), path: p });
        }
        return { status: res.status, body: await res.json() };
    }
}
let fails = 0;
const check = (label, cond, extra = "") => {
    if (!cond) fails++;
    console.log(`${cond ? "✔" : "✖"} ${label}${!cond && extra ? `  → ${extra}` : ""}`);
};
const S = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const sa = new Client(), opd = new Client(), gfx = new Client(), mkt = new Client(), pub = new Client();
for (const [c, e] of [[sa, "sa@mh.test"], [opd, "opd@mh.test"], [gfx, "gfx@mh.test"], [mkt, "mkt@mh.test"]]) await c.call("POST", "/api/auth/login", { email: e, password: PW });
let r;
const doctorIds = fakes.doctors.rows.map((d) => d._id);

// ── B2.10 programs ──
r = await opd.call("GET", "/api/admin/programs/options");
check("opd → programs options (doctors + articles)", r.status === 200 && r.body.data.doctors.length > 50 && r.body.data.articles.length > 0, S(r));
r = await gfx.call("GET", "/api/admin/programs/aesthetic");
check("graphics → programs 403", r.status === 403, S(r));
r = await opd.call("GET", "/api/admin/programs/aesthetic");
const aes = r.body.data;
r = await opd.call("PATCH", "/api/admin/programs/aesthetic", {
    doctors: [doctorIds[3], doctorIds[1], doctorIds[3]],
    treatments: [
        { _id: aes.treatments[1]._id, slug: aes.treatments[1].slug, name: aes.treatments[1].name, summary: aes.treatments[1].summary, image: aes.treatments[1].image, isActive: true },
        { name: { en: "Chemical peel", bn: "কেমিক্যাল পিল" }, summary: { en: "", bn: "" }, image: null },
    ],
    whatsapp: "01329-672807",
});
const a2 = r.body.data;
check("aesthetic: team ordered + deduped, treatment reorder, new treatment slug/id/order", r.status === 200 && a2.doctors.length === 2 && a2.doctors[0] === doctorIds[3] && a2.treatments[0]._id === aes.treatments[1]._id && a2.treatments[1].slug === "chemical-peel" && a2.treatments[1]._id === "aes_chemical-peel" && a2.treatments[1].order === 2, S(r));
r = await pub.call("GET", "/api/aesthetic");
check("public aesthetic: team populated in admin order", r.body.data.doctors[0]._id === doctorIds[3] && r.body.data.treatments.length === 2, S(r));
r = await opd.call("PATCH", "/api/admin/programs/aesthetic", { doctors: ["doc_nope"] });
check("unknown doctor → 400", r.status === 400 && r.body.error.code === "UNKNOWN_DOCTOR", S(r));
r = await opd.call("PATCH", "/api/admin/programs/aesthetic", { heroImage: "/uploads/hero/x.webp" });
check("aesthetic image must be in /uploads/aesthetic", r.status === 400, S(r));
r = await opd.call("PATCH", "/api/admin/programs/bhrpc", { topics: ["thalassaemia", "nope-article"] });
check("bhrpc topic must be an article", r.status === 400 && r.body.error.code === "UNKNOWN_ARTICLE", S(r));
r = await opd.call("PATCH", "/api/admin/programs/bhrpc", { topics: ["thalassaemia"], whoFor: [{ en: "Mothers over 35", bn: "৩৫ বছরের বেশি বয়সী মা" }] });
check("bhrpc topics + whoFor saved", r.status === 200 && r.body.data.topics.length === 1 && r.body.data.whoFor.length === 1, S(r));

// ── B2.11 articles + gallery ──
r = await gfx.call("GET", "/api/admin/articles/options");
check("graphics → article byline options (doctors)", r.status === 200 && r.body.data.doctors.length > 50 && !("phone" in r.body.data.doctors[0]), S(r));
r = await mkt.call("GET", "/api/admin/articles/options");
check("marketer → article options 403", r.status === 403, S(r));
r = await gfx.call("GET", "/api/admin/articles");
check("articles newest first", r.status === 200 && r.body.data.items[0].publishedAt >= r.body.data.items.at(-1).publishedAt, S(r));
r = await opd.call("GET", "/api/admin/articles");
check("opd → articles 403", r.status === 403, S(r));
r = await gfx.call("POST", "/api/admin/articles", {
    title: { en: "Heatstroke: what to do", bn: "হিটস্ট্রোক: কী করবেন" },
    category: "General",
    sections: [{ heading: { en: "When to come in", bn: "" }, body: { en: "Severe belly pain, bleeding gums…", bn: "" } }],
    author: doctorIds[0],
});
const art = r.body.data;
check("create article: slug, category lowercased, publishedAt defaults to today", r.status === 201 && art.slug === "heatstroke-what-to-do" && art.category === "general" && art.publishedAt, S(r));
r = await gfx.call("PATCH", `/api/admin/articles/${art._id}`, { author: "doc_nope" });
check("unknown author → 400", r.status === 400, S(r));
r = await gfx.call("PATCH", `/api/admin/articles/${art._id}`, { publishedAt: null });
check("publish date can't be cleared", r.status === 400, S(r));
r = await pub.call("GET", "/api/articles/heatstroke-what-to-do");
check("public article", r.status === 200 && r.body.data.sections.length === 1, S(r));
const thal = fakes.articles.rows.find((a) => a.slug === "thalassaemia");
r = await gfx.call("DELETE", `/api/admin/articles/${thal._id}`);
check("article on the BHRPC reading list → 409", r.status === 409, S(r));
r = await gfx.call("POST", "/api/admin/gallery", { src: "/uploads/gallery/ward-1.webp", category: "Hospital", caption: { en: "Cabin", bn: "কেবিন" } });
check("gallery item created", r.status === 201 && r.body.data.category === "hospital", S(r));
r = await gfx.call("POST", "/api/admin/gallery", { src: "https://evil.example/x.jpg", category: "hospital" });
check("external gallery image rejected", r.status === 400, S(r));
r = await gfx.call("GET", "/api/admin/gallery?category=diagnostic");
check("gallery category filter", r.body.data.items.every((g) => g.category === "diagnostic"), S(r));

// ── B2.12 pages + management ──
r = await gfx.call("GET", "/api/admin/pages");
check("graphics sees site pages only (no legal)", r.status === 200 && r.body.data.length === 2 && r.body.data.every((p) => p.type === "site"), S(r));
r = await sa.call("GET", "/api/admin/pages");
check("super admin sees site + legal", r.body.data.length === 5, S(r));
const pv = fakes.pages.rows.find((p) => p.slug === "patients-visitors");
const terms = fakes.pages.rows.find((p) => p.slug === "terms");
r = await gfx.call("GET", `/api/admin/pages/${terms._id}`);
check("graphics → legal page 403", r.status === 403, S(r));
const sections = pv.sections.map((s) => ({ ...s }));
sections[0] = { ...sections[0], body: { en: "Visiting hours: 4–7 pm daily.", bn: "দর্শনার্থীর সময়: প্রতিদিন বিকাল ৪–৭টা।" } };
sections.push({ heading: { en: "Parking", bn: "পার্কিং" }, body: { en: "Limited.", bn: "" } });
r = await gfx.call("PATCH", `/api/admin/pages/${pv._id}`, { sections });
const pv2 = r.body.data;
check("site page: anchor kept, new section anchor from heading", r.status === 200 && pv2.sections[0].id === "visiting-hours" && pv2.sections.at(-1).id === "parking" && pv2.sections[0].points?.length > 0, S(r));
r = await gfx.call("PATCH", `/api/admin/pages/${pv._id}`, { slug: "visitors" });
check("page slug can't change", r.status === 400, S(r));
r = await sa.call("PATCH", `/api/admin/pages/${terms._id}`, { isDraft: false, sections: [{ id: "about", heading: { en: "About", bn: "" }, body: { en: ["Para one.", "Para two."], bn: [] } }] });
check("legal page: paragraphs + draft flag (super admin)", r.status === 200 && r.body.data.sections[0].body.en.length === 2 && r.body.data.isDraft === false, S(r));
r = await sa.call("PATCH", `/api/admin/pages/${terms._id}`, { sections: [{ heading: { en: "x", bn: "" }, body: { en: "not paragraphs", bn: "" } }] });
check("legal body must be paragraph arrays", r.status === 400, S(r));
r = await pub.call("GET", "/api/pages/patients-visitors");
check("public page updated", r.body.data.sections[0].body.en.startsWith("Visiting hours: 4"), S(r));
r = await gfx.call("POST", "/api/admin/management", { name: { en: "Dr. A. Chairman" }, role: { en: "Chairman", bn: "চেয়ারম্যান" }, message: { en: "", bn: "" } });
check("management person (empty message → null)", r.status === 201 && r.body.data.message === null, S(r));

// ── B2.13 SEO + taps ──
r = await mkt.call("GET", "/api/admin/seo/paths");
check("marketer: page picker includes doctors + legal", r.status === 200 && r.body.data.some((p) => p.path.startsWith("/doctors/")) && r.body.data.some((p) => p.path === "/legal/terms"), S(r));
r = await gfx.call("GET", "/api/admin/seo/paths");
check("graphics → seo 403", r.status === 403, S(r));
r = await mkt.call("POST", "/api/admin/seo", { path: "/doctors", title: { en: "Find a doctor in Dhaka — Monowara Hospital", bn: "" }, description: { en: "68 specialists…", bn: "" } });
check("seo override created", r.status === 201, S(r));
r = await mkt.call("POST", "/api/admin/seo", { path: "/doctors" });
check("duplicate path → 409", r.status === 409, S(r));
r = await mkt.call("POST", "/api/admin/seo", { path: "https://evil.example" });
check("path must be a site path", r.status === 400, S(r));
r = await pub.call("GET", "/api/seo");
check("public seo list", r.body.data.some((s) => s.path === "/doctors"), S(r));

const beacon = (b, headers = {}) => fetch(`${base}/api/events/tap`, { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8", origin: "http://localhost:3000", ...headers }, body: typeof b === "string" ? b : JSON.stringify(b) });
let t = await beacon({ channel: "whatsapp", desk: "wa_appointment", number: "8801301435549", section: "dock" });
check("tap beacon → 204", t.status === 204, `${t.status}`);
await beacon({ channel: "whatsapp", desk: "wa_appointment", number: "8801301435549", section: "dock" });
await beacon({ channel: "call", number: "8809611622333", section: "header" });
await beacon("not json");
await beacon({ channel: "sms", number: "1" });
await beacon({ channel: "call", number: "8809611622333" }, { origin: "https://evil.example" });
await new Promise((res) => setTimeout(res, 50));
const rows = fakes.tapstats.rows;
check("taps aggregated per day/desk/section; junk + foreign origin ignored", rows.length === 2 && rows.find((x) => x.channel === "whatsapp").count === 2 && rows.find((x) => x.channel === "call").count === 1, JSON.stringify(rows));
check("no visitor data stored", !JSON.stringify(rows).match(/ip|agent|127\.0/i), JSON.stringify(rows));
r = await mkt.call("GET", "/api/admin/stats/overview");
check("marketer overview: taps block with desk label", r.status === 200 && r.body.data.taps.whatsapp === 2 && r.body.data.taps.calls === 1 && r.body.data.taps.byDesk[0].label === "Appointments & serial" && r.body.data.taps.daily.at(-1).count === 3, S(r));
r = await opd.call("GET", "/api/admin/stats/overview");
check("opd overview has no taps block", r.status === 200 && !r.body.data.taps, S(r));

// ── activity ──
r = await sa.call("GET", "/api/admin/activity?limit=100");
const acts = new Set(r.body.data.items.map((a) => a.action));
check("activity: programs, articles, gallery, pages, management, seo", ["aesthetic.update", "bhrpc.update", "articles.create", "gallery.create", "pages.update", "management.create", "seo.create"].every((a) => acts.has(a)), [...acts].join());

server.close();
console.log(fails ? `\n✖ ${fails} failed` : "\n✔ all B2.10–B2.13 checks passed");
process.exit(fails ? 1 : 0);
