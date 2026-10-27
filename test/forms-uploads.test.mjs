// B1.4 end-to-end: forms, mail, uploads, inbox, exports, CV download, roles.
import { createRequire } from "node:module";
import path from "node:path";
import net from "node:net";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const BACK = path.resolve(__dir, "..");
const FRONT_DATA = path.resolve(BACK, process.env.MH_FRONT_DIR || "../mh-front", "data");
const TMP = mkdtempSync(path.join(tmpdir(), "mhb14-"));

// ── tiny fake SMTP server (captures mails) ──
const mails = [];
const smtp = net.createServer((sock) => {
    let data = false;
    let buf = "";
    let cur = { rcpt: [], body: "" };
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let i;
        while ((i = buf.indexOf("\r\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (data) {
                if (line === ".") {
                    data = false;
                    mails.push(cur);
                    cur = { rcpt: [], body: "" };
                    sock.write("250 OK queued\r\n");
                } else cur.body += `${line.startsWith("..") ? line.slice(1) : line}\n`;
                continue;
            }
            const cmd = line.slice(0, 4).toUpperCase();
            if (cmd === "EHLO" || cmd === "HELO") sock.write("250-fake\r\n250 8BITMIME\r\n");
            else if (cmd === "MAIL") sock.write("250 OK\r\n");
            else if (cmd === "RCPT") (cur.rcpt.push(line), sock.write("250 OK\r\n"));
            else if (cmd === "DATA") ((data = true), sock.write("354 go\r\n"));
            else if (cmd === "QUIT") (sock.write("221 bye\r\n"), sock.end());
            else if (cmd === "RSET" || cmd === "NOOP") sock.write("250 OK\r\n");
            else sock.write("250 OK\r\n");
        }
    });
});
await new Promise((r) => smtp.listen(0, "127.0.0.1", r));

Object.assign(process.env, {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MONGODB_URI: "mongodb://x/y",
    JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123456",
    CORS_ORIGINS: "http://localhost:3000",
    UPLOAD_DIR: path.join(TMP, "uploads"),
    PRIVATE_DIR: path.join(TMP, "private"),
    SERVE_UPLOADS: "true",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.address().port),
    SMTP_SECURE: "false",
    SMTP_USER: "site@mh.test",
    ADMIN_EMAIL: "desk@mh.test, hr@mh.test",
    ADMIN_URL: "https://monowarahospital.com",
});

const req = createRequire(path.join(BACK, "package.json"));
const mongoose = req("mongoose");
const sharp = req("sharp");
const ExcelJS = req("exceljs");
const imp = (p) => import(pathToFileURL(path.join(BACK, p)).href);
const data = async (f) => import(pathToFileURL(path.join(FRONT_DATA, f)).href);

const M = await imp("src/models.js");
const { installFakeDb } = await import("./fake-db.mjs");
const fakes = installFakeDb(mongoose);
const { createApp } = await imp("src/app.js");
const { hashPassword } = await imp("src/lib/password.js");

// seed: settings, departments, doctors, jobs (real data) + staff
await M.Settings.create((await data("settings.js")).settings);
for (const d of (await data("departments.js")).departments) await M.Department.create(d);
for (const d of (await data("doctors.js")).doctors) await M.Doctor.create(d);
for (const j of (await data("careers.js")).jobs) await M.Job.create(j);
const PW = "Monowara2026";
for (const [email, role] of [["sa@mh.test", "super_admin"], ["opd@mh.test", "opd_incharge"], ["gfx@mh.test", "graphics_design"], ["mkt@mh.test", "marketer"]]) {
    await M.User.create({ name: role, email, role, passwordHash: await hashPassword(PW) });
}

const server = createApp().listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

let ipSeq = 10;
class Client {
    constructor({ ip } = {}) {
        this.jar = new Map();
        this.ip = ip ?? `198.51.100.${ipSeq++}`;
    }
    async call(method, url, body, headers = {}) {
        const isForm = body instanceof FormData;
        const res = await fetch(base + url, {
            method,
            headers: {
                ...(!isForm && body ? { "content-type": "application/json" } : {}),
                "x-requested-with": "mh-admin",
                "x-forwarded-for": this.ip,
                cookie: [...this.jar].filter(([, c]) => new URL(base + url).pathname.startsWith(c.path)).map(([n, c]) => `${n}=${c.value}`).join("; "),
                ...headers,
            },
            body: isForm ? body : body ? JSON.stringify(body) : undefined,
        });
        for (const sc of res.headers.getSetCookie()) {
            const [nv, ...attrs] = sc.split(";").map((s) => s.trim());
            const n = nv.slice(0, nv.indexOf("=")), v = nv.slice(nv.indexOf("=") + 1);
            const p = attrs.find((a) => /^path=/i.test(a))?.slice(5) || "/";
            if (!v) this.jar.delete(n);
            else this.jar.set(n, { value: decodeURIComponent(v), path: p });
        }
        const ct = res.headers.get("content-type") || "";
        const bodyOut = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
        return { status: res.status, body: bodyOut, headers: res.headers };
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
const S = (r) => `${r.status} ${Buffer.isBuffer(r.body) ? `<${r.body.length} bytes>` : JSON.stringify(r.body).slice(0, 300)}`;
const waitMail = async (n) => {
    for (let i = 0; i < 50 && mails.length < n; i++) await new Promise((r) => setTimeout(r, 40));
};

// ───────────────────────── Contact ─────────────────────────
const pub = new Client();
let r = await pub.call("POST", "/api/contact", {
    name: "Rahima Khatun",
    phone: "+880 1711-234567",
    email: "Rahima@Example.com",
    subject: "Visiting\r\nBcc: spam@evil.test",
    message: "=HYPERLINK(\"http://evil\",\"click\") — জরুরি প্রশ্ন",
    website: "",
    source: "/contact",
});
check("contact → 201", r.status === 201, S(r));
const msg = fakes.messages.rows[0];
check("phone normalised to 01711234567, email lowercased", msg?.phone === "01711234567" && msg.email === "rahima@example.com", JSON.stringify(msg));
await waitMail(1);
const m1 = mails[0];
check("staff alert sent to both ADMIN_EMAIL recipients", m1 && m1.rcpt.length === 2, JSON.stringify(m1?.rcpt));
check("CR/LF in subject can't inject a Bcc header", m1 && !/^Bcc:/im.test(m1.body) && m1.rcpt.length === 2 && msg.subject === "Visiting Bcc: spam@evil.test" && !m1.rcpt.join().includes("evil"), m1?.body.slice(0, 400));
check("alert has Reply-To = sender + dashboard link", m1 && /Reply-To: rahima@example.com/i.test(m1.body) && m1.body.includes("/admin/messages/"), "");
r = await pub.call("POST", "/api/contact", { name: "Bot", phone: "01711234567", message: "buy now buy now", website: "http://spam" });
check("honeypot → 202, nothing stored", r.status === 202 && fakes.messages.rows.length === 1, S(r));
r = await pub.call("POST", "/api/contact", { name: "A", phone: "12345", message: "hi" });
check("bad name/phone/short message → 400 with field details", r.status === 400 && r.body.error.details.length === 3, S(r));
r = await pub.call("POST", "/api/contact", { name: "Rahim", phone: "01711234567", message: "hello there" }, { origin: "https://evil.example" });
check("foreign Origin → 403", r.status === 403, S(r));
const flood = new Client();
let codes = [];
for (let i = 0; i < 6; i++) codes.push((await flood.call("POST", "/api/contact", { name: "Flood", phone: "01711234567", message: "hello there" })).status);
check("6th contact from one IP in 10 min → 429", codes.join() === "201,201,201,201,201,429", codes.join());

// ───────────────────────── Appointments ─────────────────────────
const doc = (await data("doctors.js")).doctors.find((d) => d.isActive !== false && d.schedule?.length);
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const today = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
const nextDay = (key) => {
    for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000);
        if (DAYS[d.getUTCDay()] === key) return d.toISOString().slice(0, 10);
    }
};
const chamberDay = nextDay(doc.schedule[0].day);
const offDay = DAYS.map(nextDay).find((d) => !doc.schedule.some((s) => s.day === DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]));

const pat = new Client();
r = await pat.call("POST", "/api/appointments", { name: "Karim", phone: "01811223344", doctor: doc.slug, date: chamberDay });
check("bookingMode=numbers → 403 BOOKING_DISABLED", r.status === 403 && r.body.error.code === "BOOKING_DISABLED", S(r));
fakes.settings.rows[0].bookingMode = "both";
r = await pat.call("POST", "/api/appointments", { name: "Karim", phone: "01811223344", doctor: doc.slug, date: chamberDay, note: "first visit", website: "" });
const bk = fakes.bookings.rows[0];
check("bookingMode=both → 201, slot taken from the chamber schedule", r.status === 201 && bk?.slot?.from === doc.schedule[0].from && bk.doctorName === doc.name.en && bk.department === doc.department, S(r));
r = await pat.call("POST", "/api/appointments", { name: "Karim", phone: "01811223344", doctor: doc.slug, date: chamberDay });
check("same phone + doctor + day again → 409 DUPLICATE_BOOKING", r.status === 409 && r.body.error.code === "DUPLICATE_BOOKING", S(r));
if (offDay) {
    r = await pat.call("POST", "/api/appointments", { name: "Karim", phone: "01811223344", doctor: doc.slug, date: offDay });
    check("day without a chamber → 409 NO_CHAMBER", r.status === 409 && r.body.error.code === "NO_CHAMBER", S(r));
}
r = await pat.call("POST", "/api/appointments", { name: "Karim", phone: "01811223344", doctor: doc.slug, date: "2020-01-01" });
check("past date → 400 DATE_PAST", r.status === 400 && r.body.error.code === "DATE_PAST", S(r));
r = await new Client().call("POST", "/api/appointments", { name: "Karim", phone: "01811223344", doctor: "dr-nobody", date: chamberDay });
check("unknown doctor → 400", r.status === 400 && r.body.error.code === "UNKNOWN_DOCTOR", S(r));
const leaveDoc = fakes.doctors.rows.find((d) => d.slug === doc.slug);
leaveDoc.leave = { from: new Date(`${today}T00:00:00Z`), until: new Date(`${nextDay(doc.schedule[0].day)}T00:00:00Z`) };
r = await new Client().call("POST", "/api/appointments", { name: "Salma", phone: "01911223344", doctor: doc.slug, date: chamberDay });
check("doctor on leave that day → 409 DOCTOR_ON_LEAVE", r.status === 409 && r.body.error.code === "DOCTOR_ON_LEAVE", S(r));
leaveDoc.leave = null;
r = await new Client().call("POST", "/api/appointments", { name: "Salma", phone: "01911223344", department: "cardiology" });
check("department only, no date → 201 (general request)", r.status === 201 && fakes.bookings.rows.at(-1).departmentName === "Cardiology", S(r));

// ───────────────────────── Careers ─────────────────────────
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const form = (fields, file, name = "cv.pdf", type = "application/pdf") => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append("cv", new Blob([file], { type }), name);
    return fd;
};
const job = (await data("careers.js")).jobs[0];
const ap = new Client();
r = await ap.call("POST", "/api/careers/apply", form({ name: "Nusrat Jahan", phone: "01611223344", email: "nusrat@example.com", job: job.slug, note: "ICU nurse, 4 yrs" }, pdf, "Nusrat CV.pdf"));
const app = fakes.applications.rows[0];
check("apply with PDF → 201, stored in PRIVATE_DIR (not uploads)", r.status === 201 && app && existsSync(path.join(TMP, "private", app.cv.file)) && !app.cv.file.includes(".."), S(r));
check("random stored name, original kept for download", app && /^cv\/\d{4}-\d{2}\/[a-f0-9]{24}\.pdf$/.test(app.cv.file) && app.cv.originalName === "Nusrat CV.pdf", JSON.stringify(app?.cv));
r = await new Client().call("POST", "/api/careers/apply", form({ name: "Evil", phone: "01611223344", email: "e@example.com" }, Buffer.from("MZ\x90\x00 this is an exe"), "cv.pdf"));
check("exe renamed .pdf → 415 CV_TYPE", r.status === 415, S(r));
r = await new Client().call("POST", "/api/careers/apply", form({ name: "Big", phone: "01611223344", email: "b@example.com" }, Buffer.concat([pdf, Buffer.alloc(6 * 1024 * 1024)])));
check("6 MB CV → 413", r.status === 413, S(r));
r = await new Client().call("POST", "/api/careers/apply", form({ name: "NoCv", phone: "01611223344", email: "n@example.com" }, null));
check("no CV → 400", r.status === 400 && r.body.error.code === "CV_REQUIRED", S(r));
const docx = Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.from("....word/document.xml....")]);
r = await new Client().call("POST", "/api/careers/apply", form({ name: "Docx Person", phone: "01611223344", email: "d@example.com" }, docx, "cv.docx"));
check("DOCX accepted (general application)", r.status === 201 && fakes.applications.rows.at(-1).jobTitle === "General application", S(r));
await waitMail(4);

// ───────────────────────── Staff inboxes + roles ─────────────────────────
const sa = new Client(), opd = new Client(), gfx = new Client(), mkt = new Client();
for (const [c, e] of [[sa, "sa@mh.test"], [opd, "opd@mh.test"], [gfx, "gfx@mh.test"], [mkt, "mkt@mh.test"]]) await c.login(e);

r = await opd.call("GET", "/api/admin/bookings?status=new");
check("opd_incharge → bookings list with tab counts", r.status === 200 && r.body.data.total === 2 && r.body.data.counts.new === 2, S(r));
r = await opd.call("PATCH", `/api/admin/bookings/${bk._id}`, { status: "confirmed", serial: 7, staffNote: "called patient" });
check("confirm booking + serial → 200, handledBy set", r.status === 200 && r.body.data.serial === 7 && r.body.data.handledBy, S(r));
check("PATCH response names the handler (handledByName)", typeof r.body.data.handledByName === "string" && r.body.data.handledByName.length > 0, S(r));
r = await opd.call("GET", "/api/admin/bookings?status=confirmed");
check("list carries handledByName, handledBy stays the id", r.body.data.items[0]?.handledByName === fakes.users.rows.find((u) => u._id === r.body.data.items[0].handledBy)?.name, S(r));
r = await opd.call("PATCH", `/api/admin/bookings/${bk._id}`, { status: "confirmed", phone: "01700000000" });
check("PATCH can't touch patient data (phone) → 400", r.status === 400, S(r));
r = await gfx.call("GET", "/api/admin/bookings");
check("graphics_design → bookings 403", r.status === 403, S(r));
r = await mkt.call("GET", "/api/admin/messages");
check("marketer → messages 403", r.status === 403, S(r));

r = await opd.call("GET", "/api/admin/messages/export.xlsx");
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(r.body);
const ws = wb.worksheets[0];
const cells = [];
ws.eachRow((row) => cells.push(row.values.slice(1)));
const formulaCells = [];
ws.eachRow((row) => row.eachCell((c) => c.type === ExcelJS.ValueType.Formula && formulaCells.push(c.address)));
check("messages export → xlsx with header + 6 rows", r.status === 200 && cells.length === 7 && cells[0][0] === "Received", `${r.status} rows=${cells.length}`);
check("formula injection neutralised (=HYPERLINK exported as text)", formulaCells.length === 0 && cells.some((row) => String(row[6]).startsWith("'=HYPERLINK")), JSON.stringify(cells[cells.length - 1]));
check("download name messages-YYYY-MM-DD.xlsx", /attachment; filename="?messages-\d{4}-\d{2}-\d{2}\.xlsx"?/.test(r.headers.get("content-disposition")), r.headers.get("content-disposition"));

r = await opd.call("GET", `/api/admin/applications/${app._id}/cv`);
check("CV download (opd) → exact bytes, attachment, nosniff", r.status === 200 && Buffer.compare(r.body, pdf) === 0 && /attachment/.test(r.headers.get("content-disposition")) && r.headers.get("x-content-type-options") === "nosniff", S(r));
r = await gfx.call("GET", `/api/admin/applications/${app._id}/cv`);
check("CV download (graphics_design) → 403", r.status === 403, S(r));
r = await new Client().call("GET", `/uploads/../private/${app.cv.file}`);
check("CV not reachable through /uploads", r.status === 404, `${r.status}`);

// ───────────────────────── Uploads ─────────────────────────
const jpeg = (w, h, opts = {}) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 15, g: 158, b: 138 } } }).jpeg().withMetadata(opts).toBuffer();
const up = (client, folder, buf, name = "Photo One.JPG", type = "image/jpeg", q = "") => {
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type }), name);
    return client.call("POST", `/api/admin/uploads/${folder}${q}`, fd);
};
r = await up(gfx, "hero", await jpeg(3200, 1800));
const heroOut = r.body.data;
check("graphics_design uploads hero → 201 webp ≤2560w + OG jpg", r.status === 201 && heroOut.width === 2560 && /^\/uploads\/hero\/photo-one-[a-f0-9]{8}\.webp$/.test(heroOut.src) && heroOut.og?.endsWith(".og.jpg"), S(r));
const og = await sharp(path.join(TMP, heroOut.og)).metadata();
check("OG rendition is 1200×630 JPEG", og.width === 1200 && og.height === 630 && og.format === "jpeg", JSON.stringify(og));
r = await up(gfx, "hero", await jpeg(1200, 700));
check("small hero → 201 with a sharpness warning", r.status === 201 && r.body.data.warnings.length === 1, S(r));
r = await up(gfx, "doctors", await jpeg(1000, 1200));
check("graphics_design → doctors folder 403", r.status === 403, S(r));
r = await up(opd, "doctors", await jpeg(3000, 4000, { orientation: 6 }));
check("opd doctor photo 3000×4000 (EXIF rotated) → 900w, rotated, metadata stripped", r.status === 201 && r.body.data.width === 900 && r.body.data.height === 675, S(r));
const outMeta = await sharp(path.join(TMP, r.body.data.src)).metadata();
check("…saved WebP has no EXIF", outMeta.format === "webp" && !outMeta.exif, JSON.stringify({ f: outMeta.format, exif: !!outMeta.exif }));
r = await up(gfx, "media", await jpeg(1600, 2400), "header.jpg", "image/jpeg", "?position=50%25%2020%25");
check("media slot portrait → cropped to 3:2", r.status === 201 && Math.abs(r.body.data.width / r.body.data.height - 1.5) < 0.01, S(r));
r = await up(gfx, "gallery", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'><rect width='10' height='10'/></svg>"), "x.svg", "image/svg+xml");
check("SVG (script-capable) → 415", r.status === 415, S(r));
r = await up(gfx, "gallery", Buffer.from("just text, named jpg"), "x.jpg");
check("text renamed .jpg → 415 NOT_AN_IMAGE", r.status === 415 && r.body.error.code === "NOT_AN_IMAGE", S(r));
r = await up(gfx, "../private", await jpeg(100, 100));
check("folder traversal → 400/404", r.status === 400 || r.status === 404, S(r));
r = await up(mkt, "seo", await jpeg(1300, 700));
check("marketer → seo folder 201", r.status === 201, S(r));
r = await up(mkt, "hero", await jpeg(2400, 1300));
check("marketer → hero 403", r.status === 403, S(r));
r = await up(new Client(), "hero", await jpeg(2400, 1300));
check("anonymous upload → 401", r.status === 401, S(r));
r = await up(gfx, "gallery", Buffer.alloc(11 * 1024 * 1024, 1));
check("11 MB upload → 413", r.status === 413, S(r));

r = await new Client().call("GET", heroOut.src);
check("dev static /uploads serves the webp", r.status === 200 && r.headers.get("content-type") === "image/webp", `${r.status} ${r.headers.get("content-type")}`);
r = await new Client().call("GET", "/uploads/hero/missing.webp");
check("missing upload → 404 (not 500)", r.status === 404, `${r.status}`);
check("no .tmp leftovers in uploads", !readdirSync(path.join(TMP, "uploads", "hero")).some((f) => f.endsWith(".tmp")));

// ───────────────────────── Activity ─────────────────────────
r = await sa.call("GET", "/api/admin/activity?limit=100");
const acts = new Set(r.body.data.items.map((a) => a.action));
check("activity: uploads / booking update / export / CV download logged", ["uploads.create", "bookings.update", "messages.export", "applications.cv_download"].every((a) => acts.has(a)), [...acts].join());
const bu = r.body.data.items.find((a) => a.action === "bookings.update");
check("booking update logged with before/after", bu?.changes?.status?.[0] === "new" && bu.changes.status[1] === "confirmed" && bu.changes.serial[1] === 7, JSON.stringify(bu?.changes));

check("total alerts sent: 1 contact + 5 flood + 2 bookings + 2 applications", mails.length === 10, `${mails.length}`);

server.close();
smtp.close();
console.log(fails ? `\n✖ ${fails} failed` : "\n✔ all B1.4 checks passed");
process.exit(fails ? 1 : 0);
