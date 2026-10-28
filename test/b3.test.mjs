// B3: admin saves → site cache revalidation (tags, secret, only on 2xx writes), scheduled articles hidden
// from the public API, article bylines populated (active doctors only).
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BACK = path.resolve(__dir, "..");
const FRONT_DATA = path.resolve(BACK, process.env.MH_FRONT_DIR || "../mh-front", "data");

// Fake Next server: records every POST /api/revalidate.
const calls = [];
const site = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
        calls.push({ url: req.url, secret: req.headers["x-revalidate-secret"], tags: JSON.parse(body || "{}").tags });
        res.writeHead(200, { "content-type": "application/json" }).end('{"data":{}}');
    });
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SECRET = "b3-secret-b3-secret-b3-secret-b3-secret-1";

Object.assign(process.env, {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MONGODB_URI: "mongodb://x/y",
    JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123456",
    CORS_ORIGINS: "http://localhost:3000",
    SITE_REVALIDATE_URL: `http://127.0.0.1:${site.address().port}/api/revalidate`,
    REVALIDATE_SECRET: SECRET,
});
const req = createRequire(path.join(BACK, "package.json"));
const mongoose = req("mongoose");
const imp = (p) => import(pathToFileURL(path.join(BACK, p)).href);
const data = async (f) => import(pathToFileURL(path.join(FRONT_DATA, f)).href);

const M = await imp("src/models.js");
const { installFakeDb } = await import("./fake-db.mjs");
installFakeDb(mongoose);
const { createApp } = await imp("src/app.js");
const { hashPassword } = await imp("src/lib/password.js");
const { _flushNow, TAGS_BY_MODULE } = await imp("src/lib/revalidate.js");

await M.Settings.create((await data("settings.js")).settings);
for (const d of (await data("departments.js")).departments) await M.Department.create(d);
for (const d of (await data("doctors.js")).doctors) await M.Doctor.create(d);
for (const d of (await data("articles.js")).articles) await M.Article.create(d);
for (const d of (await data("home.js")).keyNumbers) await M.KeyNumber.create(d);
await M.Bhrpc.create((await data("bhrpc.js")).bhrpc);
const PW = "Monowara2026";
for (const [email, role, name] of [["opd@mh.test", "opd_incharge", "Rahima"], ["gfx@mh.test", "graphics_design", "Tanvir"]]) {
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
                cookie: [...this.jar].map(([n, v]) => `${n}=${v}`).join("; "),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        for (const sc of res.headers.getSetCookie()) {
            const [nv] = sc.split(";");
            const i = nv.indexOf("=");
            const v = nv.slice(i + 1);
            if (v) this.jar.set(nv.slice(0, i), v);
            else this.jar.delete(nv.slice(0, i));
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
/** Run fn, flush the debounce, return the tags sent to the site (sorted, deduped). */
const sent = async (fn) => {
    calls.length = 0;
    const r = await fn();
    await _flushNow();
    await new Promise((x) => setTimeout(x, 30));
    return { r, tags: [...new Set(calls.flatMap((c) => c.tags))].sort(), calls: [...calls] };
};
const opd = new Client(), gfx = new Client(), pub = new Client();
await opd.call("POST", "/api/auth/login", { email: "opd@mh.test", password: PW });
await gfx.call("POST", "/api/auth/login", { email: "gfx@mh.test", password: PW });
const [doc] = (await opd.call("GET", "/api/admin/doctors?limit=1")).body.data.items;

// ── revalidation ──
let x = await sent(() => opd.call("PATCH", `/api/admin/doctors/${doc._id}`, { designation: { en: "Senior Consultant", bn: "সিনিয়র কনসালট্যান্ট" } }));
check("doctor save → one call, tags [doctors], secret header", x.r.status === 200 && x.calls.length === 1 && x.tags.join() === "doctors" && x.calls[0].secret === SECRET && x.calls[0].url === "/api/revalidate", JSON.stringify(x.calls));
x = await sent(() => opd.call("PATCH", `/api/admin/doctors/${doc._id}`, { schedule: [{ day: "sat", from: "18:00", to: "17:00" }] }));
check("rejected save (400) → no call", x.r.status === 400 && x.calls.length === 0, JSON.stringify(x.calls));
x = await sent(() => opd.call("GET", `/api/admin/doctors/${doc._id}`));
check("GET → no call", x.calls.length === 0);
const deptIds = (await opd.call("GET", "/api/admin/departments?limit=100")).body.data.items.map((d) => d._id);
x = await sent(() => opd.call("PUT", "/api/admin/departments/order", { ids: [...deptIds].reverse() }));
check("department reorder → [departments]", x.r.status === 200 && x.tags.join() === "departments", S(x.r));
x = await sent(() => gfx.call("PATCH", "/api/admin/settings/notice", { isActive: true, text: { en: "Eid hours", bn: "ঈদের সময়সূচি" }, href: "/emergency" }));
check("notice bar → [settings]", x.r.status === 200 && x.tags.join() === "settings", S(x.r));
x = await sent(() => opd.call("PATCH", "/api/admin/programs/bhrpc", { topics: ["thalassaemia"] }));
check("BHRPC → [aesthetic, bhrpc]", x.r.status === 200 && x.tags.join() === "aesthetic,bhrpc", S(x.r));
const kn = (await gfx.call("GET", "/api/admin/keynumbers")).body.data.items[0];
x = await sent(async () => {
    await gfx.call("PATCH", `/api/admin/keynumbers/${kn._id}`, { label: { en: "Years", bn: "বছর" } });
    return opd.call("PATCH", `/api/admin/doctors/${doc._id}`, { isFeatured: true });
});
check("two saves within the debounce → one call with both tags", x.calls.length === 1 && x.tags.join() === "doctors,home", JSON.stringify(x.calls));
x = await sent(() => gfx.call("PATCH", `/api/admin/doctors/${doc._id}`, { isFeatured: false }));
check("permission-denied write (graphics → doctors 403) → no call", x.r.status === 403 && x.calls.length === 0, S(x.r));
x = await sent(() => opd.call("PATCH", "/api/admin/bookings/nope", { status: "confirmed" }));
check("inbox / non-content modules → no call", x.calls.length === 0);
check("every admin content module has tags", ["doctors", "departments", "facilities", "diagnostics", "packages", "settings", "hero", "media", "keynumbers", "centres", "talks", "stories", "faqs", "jobs", "programs", "articles", "gallery", "management", "pages", "seo"].every((m) => TAGS_BY_MODULE[m]?.length));

// ── articles: scheduled + byline ──
const arts = (await gfx.call("GET", "/api/admin/articles?limit=50")).body.data.items;
const a = arts.find((r) => r.slug === "thalassaemia");
const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
x = await sent(() => gfx.call("PATCH", `/api/admin/articles/${a._id}`, { publishedAt: future, author: doc._id, reviewedBy: doc._id }));
check("article save → [articles]", x.r.status === 200 && x.tags.join() === "articles", S(x.r));
let r = await pub.call("GET", "/api/articles");
check("scheduled article hidden from the public list", r.status === 200 && !r.body.data.some((d) => d.slug === "thalassaemia") && r.body.data.length === arts.length - 1, S(r));
r = await pub.call("GET", "/api/articles/thalassaemia");
check("scheduled article → 404", r.status === 404, S(r));
await gfx.call("PATCH", `/api/admin/articles/${a._id}`, { publishedAt: "2026-10-01" });
r = await pub.call("GET", "/api/articles/thalassaemia");
const by = r.body.data?.author;
check("byline populated: slug/name/designation/photo only", r.status === 200 && by?.slug === doc.slug && by.designation?.en === "Senior Consultant" && !("phone" in by) && !("schedule" in by) && r.body.data.reviewedBy?._id === doc._id, S(r));
r = await pub.call("GET", "/api/articles?category=pregnancy");
check("list carries the byline too", r.body.data.find((d) => d.slug === "thalassaemia")?.author?._id === doc._id, S(r));
await opd.call("PATCH", `/api/admin/doctors/${doc._id}`, { isActive: false });
r = await pub.call("GET", "/api/articles/thalassaemia");
check("hidden doctor → byline null (article still public)", r.status === 200 && r.body.data.author === null && r.body.data.reviewedBy === null, S(r));

server.close();
site.close();
console.log(fails ? `\n${fails} B3 check(s) FAILED` : "✔ all B3 checks passed");
process.exit(fails ? 1 : 0);
