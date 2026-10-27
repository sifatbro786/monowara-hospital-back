// B2.5–B2.9 end-to-end: packages, settings + notice bar, hero, image slots, homepage blocks,
// patient stories (consent), FAQs, jobs, and PUT /order.
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
for (const d of (await data("packages.js")).packages) await M.Package.create(d);
for (const d of (await data("hero.js")).heroSlides) await M.HeroSlide.create(d);
for (const d of (await data("media.js")).media) await M.MediaSlot.create(d);
const home = await data("home.js");
for (const d of home.keyNumbers) await M.KeyNumber.create(d);
for (const d of home.centres) await M.Centre.create(d);
for (const d of home.talks) await M.Talk.create(d);
for (const d of (await data("faqs.js")).faqs) await M.Faq.create(d);
for (const d of (await data("careers.js")).jobs) await M.Job.create(d);
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

// ── B2.5 packages ──
r = await opd.call("GET", "/api/admin/packages?category=maternity");
check("packages list by category", r.status === 200 && r.body.data.items.length > 0 && r.body.data.items.every((p) => p.category === "maternity"), S(r));
r = await gfx.call("GET", "/api/admin/packages");
check("graphics → packages 403", r.status === 403, S(r));
const dept = fakes.departments.rows[0]._id;
r = await opd.call("POST", "/api/admin/packages", { name: { en: "Laparoscopic Hysterectomy" }, category: "surgical", departments: [dept, dept], inclusions: [{ en: "Surgeon fee", bn: "সার্জন ফি" }] });
const pkg = r.body.data;
check("create package: slug, deduped departments, priceMode call", r.status === 201 && pkg.slug === "laparoscopic-hysterectomy" && pkg.departments.length === 1 && pkg.priceMode === "call", S(r));
r = await opd.call("POST", "/api/admin/packages", { name: { en: "No category" } });
check("category required", r.status === 400, S(r));
r = await opd.call("PATCH", `/api/admin/packages/${pkg._id}`, { price: 5000 });
check("price can't be set (Call for Price only)", r.status === 400, S(r));
r = await opd.call("PATCH", `/api/admin/packages/${pkg._id}`, { departments: ["dept_nope"] });
check("unknown department → 400", r.status === 400 && r.body.error.code === "UNKNOWN_DEPARTMENT", S(r));
r = await pub.call("GET", `/api/packages?department=${dept}`);
check("public packages by department include the new one", r.body.data.some((p) => p._id === pkg._id), S(r));
await M.Centre.create({ title: { en: "Hysterectomy" }, href: `/packages/${pkg.slug}` });
r = await opd.call("DELETE", `/api/admin/packages/${pkg._id}`);
check("package linked from a homepage centre → 409", r.status === 409, S(r));

// ── B2.6 settings + notice ──
r = await gfx.call("GET", "/api/admin/settings");
check("graphics can read settings (for the notice)", r.status === 200, S(r));
r = await mkt.call("GET", "/api/admin/settings");
check("marketer → settings 403", r.status === 403, S(r));
r = await gfx.call("PATCH", "/api/admin/settings", { hotline: "0961100000" });
check("graphics can't change numbers", r.status === 403, S(r));
const wa = fakes.settings.rows[0].whatsappNumbers;
r = await sa.call("PATCH", "/api/admin/settings", {
    whatsappNumbers: [
        { _id: wa[1]._id, label: wa[1].label, number: wa[1].number, isPrimary: true, isActive: true },
        { _id: wa[0]._id, label: wa[0].label, number: wa[0].number, isPrimary: false, isActive: true },
        { label: { en: "Diagnostics reports", bn: "রিপোর্ট" }, number: "01700-000000", isPrimary: false, isActive: true },
    ],
    bookingMode: "both",
    heroSlider: { intervalSec: 7 },
});
const st = r.body.data;
check("WhatsApp desks reordered, new desk id from label, order = position", r.status === 200 && st.whatsappNumbers[0]._id === wa[1]._id && st.whatsappNumbers[2]._id === "wa_diagnostics_reports" && st.whatsappNumbers[2].order === 3, S(r));
check("booking mode + hero interval saved", st.bookingMode === "both" && st.heroSlider.intervalSec === 7, S(r));
r = await sa.call("PATCH", "/api/admin/settings", { whatsappNumbers: [{ label: { en: "A" }, number: "01700000000", isPrimary: false, isActive: true }] });
check("no primary desk → 400", r.status === 400, S(r));
r = await sa.call("PATCH", "/api/admin/settings", { whatsappNumbers: [{ label: { en: "A" }, number: "01700000000", isPrimary: true }, { label: { en: "B" }, number: "01800000000", isPrimary: true }] });
check("two primary desks → 400", r.status === 400, S(r));
r = await sa.call("PATCH", "/api/admin/settings", { socials: { facebook: "https://evil.example/fb", instagram: "", youtube: "", linkedin: "" } });
check("social link must be on its own domain", r.status === 400, S(r));
r = await sa.call("PATCH", "/api/admin/settings", { map: { embed: "javascript:alert(1)", directions: "" } });
check("map embed must be https google maps", r.status === 400, S(r));
r = await sa.call("PATCH", "/api/admin/settings", { hotline: "abc" });
check("bad phone → 400", r.status === 400, S(r));
r = await sa.call("PATCH", "/api/admin/settings", { dghsLicence: "HSM/41/2026", yearsServing: 34, email: "INFO@monowarahospital.com" });
check("licence, years, email lowercased", r.status === 200 && r.body.data.email === "info@monowarahospital.com" && r.body.data.yearsServing === 34, S(r));
r = await gfx.call("PATCH", "/api/admin/settings/notice", { isActive: true, text: { en: "", bn: "" }, href: null });
check("notice on without text → 400", r.status === 400, S(r));
r = await gfx.call("PATCH", "/api/admin/settings/notice", { isActive: true, text: { en: "Eid holiday OPD hours", bn: "ঈদের ছুটিতে ওপিডি সময়" }, href: "/patients-visitors#visiting-hours" });
check("graphics turns the notice bar on", r.status === 200 && r.body.data.noticeBar.isActive && r.body.data.noticeBar.href.startsWith("/patients"), S(r));
r = await gfx.call("PATCH", "/api/admin/settings/notice", { isActive: false, text: { en: "x", bn: "" }, href: "javascript:alert(1)" });
check("notice href must be internal or https", r.status === 400, S(r));
r = await opd.call("PATCH", "/api/admin/settings/notice", { isActive: false, text: { en: "", bn: "" }, href: null });
check("opd can't edit the notice", r.status === 403, S(r));
r = await pub.call("GET", "/api/settings");
check("public settings reflect the changes", r.body.data.bookingMode === "both" && r.body.data.noticeBar.isActive && r.body.data.whatsappNumbers.length === 3, S(r));

// ── B2.7 hero + media ──
r = await gfx.call("GET", "/api/admin/hero");
const slides = r.body.data.items;
check("hero list", r.status === 200 && slides.length >= 2, S(r));
r = await gfx.call("PUT", "/api/admin/hero/order", { ids: [...slides].reverse().map((s) => s._id) });
check("reorder slides", r.status === 200, S(r));
r = await pub.call("GET", "/api/hero");
check("public hero follows the new order", r.body.data[0]._id === slides.at(-1)._id, S(r));
r = await gfx.call("PUT", "/api/admin/hero/order", { ids: [slides[0]._id, slides[0]._id] });
check("duplicate ids in reorder → 400", r.status === 400, S(r));
r = await gfx.call("POST", "/api/admin/hero", { label: { en: "Dialysis" }, image: { src: "/uploads/hero/dialysis.webp", alt: { en: "Dialysis unit", bn: "" } } });
check("create slide (slug from label, default position)", r.status === 201 && r.body.data.slug === "dialysis" && r.body.data.image.position === "center", S(r));
r = await gfx.call("POST", "/api/admin/hero", { label: { en: "No image" }, image: { src: null, alt: { en: "", bn: "" } } });
check("slide without image → 400", r.status === 400, S(r));
for (const s of slides.slice(1)) await M.HeroSlide.updateOne({ _id: s._id }, { $set: { isActive: false } });
await M.HeroSlide.updateOne({ slug: "dialysis" }, { $set: { isActive: false } });
r = await gfx.call("DELETE", `/api/admin/hero/${slides[0]._id}`);
check("deleting the only visible slide → 409", r.status === 409, S(r));
r = await gfx.call("GET", "/api/admin/media");
const slot = r.body.data.find((m) => m.key === "header.doctors");
check("media slots list", r.status === 200 && r.body.data.length === 18, S(r));
r = await gfx.call("PATCH", `/api/admin/media/${slot._id}`, { src: "/uploads/media/doctors-desk-ab12.webp", position: "50% 30%", overlay: 0.7 });
check("replace slot image → source becomes own", r.status === 200 && r.body.data.source.type === "own" && r.body.data.overlay === 0.7, S(r));
r = await gfx.call("PATCH", `/api/admin/media/${slot._id}`, { key: "x" });
check("slot key not editable", r.status === 400, S(r));
r = await opd.call("GET", "/api/admin/media");
check("opd → media 403", r.status === 403, S(r));

// ── B2.8 home blocks + stories ──
r = await gfx.call("PATCH", `/api/admin/keynumbers/${fakes.keynumbers.rows[0]._id}`, { value: { en: "34+", bn: "৩৪+" } });
check("key number edit", r.status === 200 && r.body.data.value.en === "34+", S(r));
r = await gfx.call("POST", "/api/admin/centres", { title: { en: "Dialysis" }, href: "https://evil.example" });
check("centre link must be internal", r.status === 400, S(r));
r = await gfx.call("POST", "/api/admin/centres", { title: { en: "Dialysis" }, href: "/facilities/dialysis", image: "/uploads/facilities/dialysis.webp" });
check("centre with facility photo", r.status === 201, S(r));
r = await gfx.call("POST", "/api/admin/talks", { youtubeId: "https://youtu.be/BriBQgWl28Y", title: { en: "X" } });
check("talk needs the bare 11-char id (UI extracts it)", r.status === 400, S(r));
r = await gfx.call("POST", "/api/admin/talks", { youtubeId: "dQw4w9WgXcQ", title: { en: "Heart health after 40" } });
check("talk created", r.status === 201, S(r));
r = await gfx.call("POST", "/api/admin/stories", { quote: { en: "The NICU team saved my baby.", bn: "" }, name: { en: "Nusrat, Mirpur", bn: "" }, consent: { confirmed: false } });
const story = r.body.data;
check("story without consent saved", r.status === 201 && story.consent.confirmed === false, S(r));
r = await pub.call("GET", "/api/home");
check("…but not public", !r.body.data.stories.some((s) => s._id === story._id), S(r));
r = await gfx.call("PATCH", `/api/admin/stories/${story._id}`, { consent: { confirmed: true, date: "2026-10-20" }, recordedBy: "Someone else" });
check("recordedBy can't be sent by the client", r.status === 400, S(r));
r = await gfx.call("PATCH", `/api/admin/stories/${story._id}`, { consent: { confirmed: true, date: "2026-10-20" } });
check("consent confirmed → recordedBy = signed-in staff", r.status === 200 && r.body.data.consent.recordedBy === "Tanvir" && r.body.data.consent.date.startsWith("2026-10-19T18"), S(r));
r = await pub.call("GET", "/api/home");
const pubStory = r.body.data.stories.find((s) => s._id === story._id);
check("public now, without recordedBy", pubStory && pubStory.consent.recordedBy === undefined, JSON.stringify(pubStory));
r = await gfx.call("PATCH", `/api/admin/stories/${story._id}`, { consent: { confirmed: false } });
check("withdraw consent clears the stamp", r.body.data.consent.recordedBy === null && r.body.data.consent.date === null, S(r));
r = await opd.call("GET", "/api/admin/stories");
check("opd → stories 403", r.status === 403, S(r));

// ── B2.9 FAQs + jobs ──
r = await opd.call("GET", "/api/admin/faqs?category=appointment");
check("faqs by category", r.status === 200 && r.body.data.items.every((f) => f.category === "appointment"), S(r));
r = await opd.call("POST", "/api/admin/faqs", { question: { en: "Is there parking?" }, answer: { en: "Limited parking in front of the building." }, category: "Visit" });
check("faq created, category lowercased", r.status === 201 && r.body.data.category === "visit", S(r));
r = await opd.call("POST", "/api/admin/faqs", { question: { en: "Only a question" } });
check("faq needs an answer", r.status === 400, S(r));
r = await opd.call("POST", "/api/admin/jobs", { title: { en: "Staff Nurse (ICU)" }, deadline: "2026-11-30", requirements: [{ en: "B.Sc. Nursing", bn: "" }], department: fakes.departments.rows[0]._id });
const job = r.body.data;
check("job created: slug + deadline Dhaka day", r.status === 201 && job.slug === "staff-nurse-icu" && job.deadline === "2026-11-29T18:00:00.000Z", S(r));
await M.Application.create({ name: "A", phone: "01700000000", email: "a@b.co", job: job._id, jobTitle: "Staff Nurse (ICU)", cv: { file: "cv/x.pdf" } });
r = await opd.call("DELETE", `/api/admin/jobs/${job._id}`);
check("job with applications → 409 (hide instead)", r.status === 409, S(r));
r = await opd.call("PATCH", `/api/admin/jobs/${job._id}`, { isActive: false });
r = await pub.call("GET", "/api/jobs");
check("hidden job not public", !r.body.data.some((j) => j._id === job._id), S(r));

// ── activity ──
r = await sa.call("GET", "/api/admin/activity?limit=100");
const acts = new Set(r.body.data.items.map((a) => a.action));
check("activity for all modules", ["packages.create", "settings.update", "settings.notice", "hero.reorder", "hero.create", "media.update", "keynumbers.update", "talks.create", "stories.update", "faqs.create", "jobs.create"].every((a) => acts.has(a)), [...acts].join());

server.close();
console.log(fails ? `\n✖ ${fails} failed` : "\n✔ all B2.5–B2.9 checks passed");
process.exit(fails ? 1 : 0);
