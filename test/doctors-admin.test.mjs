// B2.3 end-to-end: admin doctors CRUD + overview stats (real Express + Mongoose, in-memory driver,
// real seeded departments/doctors/programs).
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
for (const d of (await data("doctors.js")).doctors) await M.Doctor.create(d);
await M.Aesthetic.create((await data("aesthetic.js")).aesthetic);
await M.Bhrpc.create((await data("bhrpc.js")).bhrpc);
const PW = "Monowara2026";
for (const [email, role] of [["sa@mh.test", "super_admin"], ["opd@mh.test", "opd_incharge"], ["gfx@mh.test", "graphics_design"], ["mkt@mh.test", "marketer"]]) {
    await M.User.create({ name: role, email, role, passwordHash: await hashPassword(PW) });
}
const ago = (h) => new Date(Date.now() - h * 3_600_000);
const someDoc = fakes.doctors.rows.find((d) => d.schedule.length);
for (let i = 0; i < 7; i++) {
    await M.Booking.create({ name: `P${i}`, phone: "01711000000", doctor: someDoc._id, doctorName: someDoc.name.en, status: i < 3 ? "new" : "confirmed", createdAt: ago(i * 20) });
}
await M.Booking.create({ name: "Old", phone: "01711000000", status: "new", createdAt: ago(24 * 60) }); // outside 30 days
await M.Message.create({ name: "M", phone: "01811000000", message: "hello there", createdAt: ago(1) });

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
    login(email) {
        return this.call("POST", "/api/auth/login", { email, password: PW });
    }
}
let fails = 0;
const check = (label, cond, extra = "") => {
    if (!cond) fails++;
    console.log(`${cond ? "✔" : "✖"} ${label}${!cond && extra ? `  → ${extra}` : ""}`);
};
const S = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

const sa = new Client(), opd = new Client(), gfx = new Client(), mkt = new Client();
for (const [c, e] of [[sa, "sa@mh.test"], [opd, "opd@mh.test"], [gfx, "gfx@mh.test"], [mkt, "mkt@mh.test"]]) await c.login(e);
const total = fakes.doctors.rows.length;

// ── list ──
let r = await opd.call("GET", "/api/admin/doctors?limit=100");
check("opd → list incl. department populated", r.status === 200 && r.body.data.total === total && r.body.data.items[0].department?.name?.en, S(r));
await M.Doctor.updateOne({ _id: someDoc._id }, { $set: { isActive: false } });
r = await opd.call("GET", "/api/admin/doctors?status=hidden");
check("hidden doctors listed for admin (status=hidden)", r.body.data.total === 1 && r.body.data.items[0]._id === someDoc._id, S(r));
r = await new Client().call("GET", `/api/doctors/${someDoc.slug}`);
check("…and gone from the public API", r.status === 404, S(r));
await M.Doctor.updateOne({ _id: someDoc._id }, { $set: { isActive: true } });
r = await opd.call("GET", "/api/admin/doctors?q=nasima");
check("search by name", r.body.data.items.some((d) => d.slug === "dr-nasima-begum"), S(r));
r = await opd.call("GET", "/api/admin/doctors?missing=bmdc");
check("missing=bmdc filter", r.status === 200 && r.body.data.items.every((d) => !d.bmdc), S(r));
r = await gfx.call("GET", "/api/admin/doctors");
check("graphics_design → 403", r.status === 403, S(r));
r = await mkt.call("GET", "/api/admin/doctors/options");
check("marketer → options 403", r.status === 403, S(r));
r = await opd.call("GET", "/api/admin/doctors/options");
check("options: departments + days", r.body.data.departments.length > 10 && r.body.data.days[0] === "sat", S(r));

// ── create ──
const dept = fakes.departments.rows[0];
r = await opd.call("POST", "/api/admin/doctors", {
    name: { en: "Prof. Dr. Test Rahman", bn: "অধ্যাপক ডা. টেস্ট রহমান" },
    department: dept._id,
    schedule: [{ day: "mon", from: "17:00", to: "19:00" }, { day: "sat", from: "10:00", to: "12:00" }],
    bmdc: "A-12345",
});
const created = r.body.data;
check("create → 201, slug from name without the title", r.status === 201 && created.slug === "dr-test-rahman", S(r));
check("schedule stored in week order (sat first)", created.schedule[0].day === "sat", JSON.stringify(created.schedule));
check("new doctor goes to the end of the order", created.order > Math.max(...fakes.doctors.rows.filter((d) => d._id !== created._id).map((d) => d.order ?? 0)) - 1, `${created.order}`);
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "Dr. Test Rahman" } });
check("same name again → unique slug dr-test-rahman-2", r.status === 201 && r.body.data.slug === "dr-test-rahman-2", S(r));
const second = r.body.data;
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "X" } });
check("name too short → 400 VALIDATION", r.status === 400 && r.body.error.code === "VALIDATION", S(r));
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "Dr. Someone" }, slug: "dr-nasima-begum" });
check("explicit duplicate slug → 409 DUPLICATE_SLUG", r.status === 409 && r.body.error.code === "DUPLICATE_SLUG", S(r));
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "Dr. Someone" }, department: "dept_nope" });
check("unknown department → 400", r.status === 400 && r.body.error.code === "UNKNOWN_DEPARTMENT", S(r));
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "Dr. Someone" }, schedule: [{ day: "mon", from: "19:00", to: "17:00" }] });
check("end before start → 400", r.status === 400, S(r));
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "Dr. Someone" }, schedule: [{ day: "mon", from: "17:00", to: "19:00" }, { day: "mon", from: "18:30", to: "20:00" }] });
check("overlapping same-day chambers → 400", r.status === 400 && JSON.stringify(r.body).includes("overlaps"), S(r));
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "Dr. Someone" }, photo: "https://evil.example/x.jpg" });
check("external photo URL rejected (no Cloudinary/hotlinks)", r.status === 400, S(r));
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "Dr. Someone" }, isActive: true, passwordHash: "x" });
check("unknown field → 400 (strict)", r.status === 400, S(r));
r = await opd.call("POST", "/api/admin/doctors", { name: { en: "Dr. Someone" }, legacyUrl: "/x" });
check("legacyUrl not writable from admin", r.status === 400, S(r));

// ── patch ──
r = await opd.call("PATCH", `/api/admin/doctors/${created._id}`, { slug: "dr-test-rahman-cardio", designation: { en: "Consultant", bn: "কনসালট্যান্ট" } });
check("rename slug → old slug kept in previousSlugs", r.status === 200 && r.body.data.slug === "dr-test-rahman-cardio" && r.body.data.previousSlugs.includes("dr-test-rahman"), S(r));
r = await new Client().call("GET", "/api/doctors/dr-test-rahman");
check("public API resolves the old slug", r.status === 200 && r.body.data.slug === "dr-test-rahman-cardio", S(r));
r = await opd.call("PATCH", `/api/admin/doctors/${created._id}`, { slug: "dr-test-rahman" });
check("rename back: slug leaves previousSlugs", r.body.data.slug === "dr-test-rahman" && !r.body.data.previousSlugs.includes("dr-test-rahman") && r.body.data.previousSlugs.includes("dr-test-rahman-cardio"), S(r));
r = await opd.call("PATCH", `/api/admin/doctors/${second._id}`, { slug: "dr-test-rahman" });
check("rename onto another doctor's slug → 409", r.status === 409, S(r));
r = await opd.call("PATCH", `/api/admin/doctors/${created._id}`, { leave: { from: "2026-11-01", until: "2026-11-10", note: { en: "Abroad", bn: "" } } });
const lv = r.body.data.leave;
check("leave stored as Dhaka-midnight dates", r.status === 200 && lv.from === "2026-10-31T18:00:00.000Z" && lv.until === "2026-11-09T18:00:00.000Z" && lv.note.en === "Abroad", S(r));
r = await opd.call("PATCH", `/api/admin/doctors/${created._id}`, { leave: { from: "2026-11-10", until: "2026-11-01" } });
check("leave until before from → 400", r.status === 400, S(r));
const today = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
await opd.call("PATCH", `/api/admin/doctors/${created._id}`, { leave: { from: null, until: today } });
r = await opd.call("GET", "/api/admin/doctors?onLeave=true");
check("onLeave filter includes a leave ending today", r.body.data.items.some((d) => d._id === created._id), S(r));
r = await opd.call("PATCH", `/api/admin/doctors/${created._id}`, { leave: null, scheduleNote: { en: "", bn: "" } });
check("clear leave; empty scheduleNote collapses to null", r.body.data.leave === null && r.body.data.scheduleNote === null, S(r));
r = await opd.call("PATCH", `/api/admin/doctors/${created._id}`, {});
check("empty PATCH → 400", r.status === 400, S(r));
r = await opd.call("PATCH", `/api/admin/doctors/${created._id}`, { photo: "/uploads/doctors/new-photo-ab12.webp", isFeatured: true });
check("photo from /uploads/doctors accepted", r.status === 200 && r.body.data.photo === "/uploads/doctors/new-photo-ab12.webp", S(r));
r = await opd.call("PATCH", `/api/admin/doctors/${created._id}`, { photo: "/uploads/hero/x.webp" });
check("photo from another folder rejected", r.status === 400, S(r));
r = await opd.call("PATCH", "/api/admin/doctors/doc_nope", { isFeatured: true });
check("unknown id → 404", r.status === 404, S(r));

// ── delete ──
const aestheticDoc = fakes.aesthetic.rows[0].doctors[0];
r = await opd.call("DELETE", `/api/admin/doctors/${aestheticDoc}`);
check("delete a doctor on the Aesthetic team → 409 IN_USE", r.status === 409 && r.body.error.code === "IN_USE" && r.body.error.message.includes("Aesthetic"), S(r));
r = await opd.call("DELETE", `/api/admin/doctors/${second._id}`);
check("delete unused doctor → 200", r.status === 200 && !fakes.doctors.rows.some((d) => d._id === second._id), S(r));

// ── activity ──
r = await sa.call("GET", "/api/admin/activity?action=doctors.*&limit=100");
const acts = r.body.data.items;
check("doctors.create / update / delete logged", ["doctors.create", "doctors.update", "doctors.delete"].every((a) => acts.some((x) => x.action === a)), acts.map((a) => a.action).join());
const slugChange = acts.find((a) => a.changes?.slug);
check("slug rename logged with before/after", slugChange?.changes.slug[0] && slugChange.changes.slug[1], JSON.stringify(slugChange?.changes));

// ── stats ──
r = await opd.call("GET", "/api/admin/stats/overview");
const st = r.body.data;
check("opd stats: bookings 30-day series (7 in window, old one excluded)", r.status === 200 && st.bookings.daily.length === 30 && st.bookings.total === 7 && st.bookings.daily.reduce((a, b) => a + b.count, 0) === 7, S(r));
check("opd stats: status split + top doctor", st.bookings.byStatus.new === 3 && st.bookings.byStatus.confirmed === 4 && st.bookings.topDoctors[0].count === 7, JSON.stringify(st.bookings));
check("opd stats: doctors data-quality counts", st.doctors.active >= total && typeof st.doctors.noBmdc === "number", JSON.stringify(st.doctors));
check("series ends today (Dhaka)", st.bookings.daily.at(-1).day === today, st.bookings.daily.at(-1).day);
r = await mkt.call("GET", "/api/admin/stats/overview");
check("marketer stats → no front-desk/doctor blocks", r.status === 200 && !r.body.data.bookings && !r.body.data.doctors, S(r));
r = await gfx.call("GET", "/api/admin/stats/overview?days=7");
check("graphics stats → none of the OPD blocks", r.status === 200 && !r.body.data.messages, S(r));
r = await opd.call("GET", "/api/admin/stats/overview?days=400");
check("days > 90 → 400", r.status === 400, S(r));

server.close();
console.log(fails ? `\n✖ ${fails} failed` : "\n✔ all B2.3 doctor/stat checks passed");
process.exit(fails ? 1 : 0);
