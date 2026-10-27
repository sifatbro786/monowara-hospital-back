// B2.4 end-to-end: admin departments / facilities / diagnostics (shared crudRouter).
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

for (const d of (await data("departments.js")).departments) await M.Department.create(d);
for (const d of (await data("facilities.js")).facilities) await M.Facility.create(d);
for (const d of (await data("diagnostics.js")).diagnostics) await M.Diagnostic.create(d);
for (const d of (await data("doctors.js")).doctors) await M.Doctor.create(d);
for (const p of (await data("packages.js")).packages) await M.Package.create(p);
const PW = "Monowara2026";
for (const [email, role] of [["opd@mh.test", "opd_incharge"], ["gfx@mh.test", "graphics_design"], ["sa@mh.test", "super_admin"]]) {
    await M.User.create({ name: role, email, role, passwordHash: await hashPassword(PW) });
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
const opd = new Client(), gfx = new Client(), sa = new Client();
await opd.call("POST", "/api/auth/login", { email: "opd@mh.test", password: PW });
await gfx.call("POST", "/api/auth/login", { email: "gfx@mh.test", password: PW });
await sa.call("POST", "/api/auth/login", { email: "sa@mh.test", password: PW });

// ── departments ──
let r = await opd.call("GET", "/api/admin/departments");
check("opd → departments list (all 22)", r.status === 200 && r.body.data.total === 22, S(r));
r = await gfx.call("GET", "/api/admin/departments");
check("graphics_design → 403", r.status === 403, S(r));
r = await opd.call("GET", "/api/admin/departments?featured=true");
check("featured filter", r.body.data.items.every((d) => d.isFeatured), S(r));
const gyn = fakes.departments.rows.find((d) => d.slug === "gynaecology-obstetrics");
r = await opd.call("PATCH", `/api/admin/departments/${gyn._id}`, {
    services: [{ en: "Normal delivery", bn: "নরমাল ডেলিভারি" }, { en: "C-section", bn: "" }],
    seo: { title: { en: "Gynae & Obs in Dhaka", bn: "" }, description: { en: "", bn: "" } },
    slug: "obs-gynae",
});
check("patch services/seo + rename", r.status === 200 && r.body.data.services.length === 2 && r.body.data.seo.title.en === "Gynae & Obs in Dhaka" && r.body.data.previousSlugs.includes("gynaecology-obstetrics"), S(r));
check("legacySlugs untouched", JSON.stringify(r.body.data.legacySlugs) === JSON.stringify(gyn.legacySlugs ?? []), JSON.stringify(r.body.data.legacySlugs));
r = await new Client().call("GET", "/api/departments/gynaecology-obstetrics");
check("public: old department slug resolves", r.status === 200 && r.body.data.slug === "obs-gynae", S(r));
r = await new Client().call("GET", "/api/doctors?department=gynaecology-obstetrics&limit=5");
check("public: doctors filter by old department slug still works", r.status === 200 && r.body.data.total > 0, S(r));
r = await opd.call("PATCH", `/api/admin/departments/${gyn._id}`, { legacySlugs: ["x"] });
check("legacySlugs not writable", r.status === 400, S(r));
r = await opd.call("PATCH", `/api/admin/departments/${gyn._id}`, { image: "/uploads/doctors/a.webp" });
check("image must be in /uploads/departments", r.status === 400, S(r));
r = await opd.call("PATCH", `/api/admin/departments/${gyn._id}`, { services: Array.from({ length: 41 }, () => ({ en: "x", bn: "" })) });
check("services capped at 40", r.status === 400, S(r));
r = await opd.call("DELETE", `/api/admin/departments/${gyn._id}`);
check("delete department with doctors → 409 IN_USE", r.status === 409 && r.body.error.message.includes("doctor"), S(r));
r = await opd.call("POST", "/api/admin/departments", { name: { en: "Pain Management & Palliative Care", bn: "" }, isActive: false });
const dep = r.body.data;
check("create hidden department → slug from name", r.status === 201 && dep.slug === "pain-management-palliative-care" && dep.isActive === false, S(r));
r = await new Client().call("GET", `/api/departments/${dep.slug}`);
check("hidden department not public", r.status === 404, S(r));
r = await opd.call("GET", "/api/admin/departments?status=hidden");
check("status=hidden lists it", r.body.data.items.some((d) => d._id === dep._id), S(r));
r = await opd.call("DELETE", `/api/admin/departments/${dep._id}`);
check("delete unused department → 200", r.status === 200, S(r));

// ── facilities ──
r = await opd.call("GET", "/api/admin/facilities");
check("facilities list (10)", r.body.data.total === 10, S(r));
const icu = fakes.facilities.rows.find((f) => f.slug === "icu") ?? fakes.facilities.rows[0];
r = await opd.call("PATCH", `/api/admin/facilities/${icu._id}`, { is24x7: true, whenTo: { en: "", bn: "" }, features: [{ en: "10 beds", bn: "১০টি বেড" }] });
check("facility patch; empty whenTo → null", r.status === 200 && r.body.data.is24x7 === true && r.body.data.whenTo === null && r.body.data.features[0].bn === "১০টি বেড", S(r));
r = await opd.call("POST", "/api/admin/facilities", { name: { en: "Physiotherapy Unit" }, slug: "emergency" });
check("facility duplicate slug → 409", r.status === 409, S(r));

// ── diagnostics ──
const diag = fakes.diagnostics.rows[0];
r = await opd.call("PATCH", `/api/admin/diagnostics/${diag._id}`, { timing: { en: "8 am – 10 pm daily", bn: "প্রতিদিন সকাল ৮টা – রাত ১০টা" }, tests: [{ en: "CBC", bn: "সিবিসি" }] });
check("diagnostic timing + tests", r.status === 200 && r.body.data.timing.en.startsWith("8 am") && r.body.data.tests.length === 1, S(r));
r = await opd.call("PATCH", `/api/admin/diagnostics/${diag._id}`, { name: { en: "", bn: "x" } });
check("empty English name → 400", r.status === 400, S(r));
r = await opd.call("POST", "/api/admin/diagnostics", { name: { en: "Sleep Study" } });
check("create diagnostic appended last", r.status === 201 && r.body.data.order > Math.max(...fakes.diagnostics.rows.filter((d) => d._id !== r.body.data._id).map((d) => d.order ?? 0)), S(r));
r = await opd.call("DELETE", `/api/admin/diagnostics/${r.body.data._id}`);
check("delete diagnostic → 200", r.status === 200, S(r));

// ── activity ──
r = await sa.call("GET", "/api/admin/activity?limit=100");
const acts = new Set(r.body.data.items.map((a) => a.action));
check("create/update/delete logged for all three", ["departments.update", "departments.create", "departments.delete", "facilities.update", "diagnostics.update", "diagnostics.create"].every((a) => acts.has(a)), [...acts].join());

server.close();
console.log(fails ? `\n✖ ${fails} failed` : "\n✔ all B2.4 department/facility/diagnostic checks passed");
process.exit(fails ? 1 : 0);
