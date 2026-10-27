import path from "node:path";
import { AppError } from "../../lib/errors.js";
import { alertStaff } from "../../lib/mailer.js";
import { atomicWrite, PRIVATE_ROOT, randomTag, within } from "../../lib/files.js";
import { Message, Application, Booking } from "../inbox/models.js";
import { Doctor } from "../doctors/model.js";
import { Department } from "../departments/model.js";
import { Job } from "../jobs/model.js";
import { Settings, SETTINGS_ID } from "../settings/model.js";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const BOOKING_WINDOW_DAYS = 60;

const clientMeta = (req, source) => ({
    ip: req.ip ?? null,
    userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
    source: source ?? null,
});

/** Today in Asia/Dhaka as YYYY-MM-DD (UTC+6, no DST). */
export const dhakaToday = (now = Date.now()) => new Date(now + 6 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayKey = (iso) => DAY_KEYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const toDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// ── Contact ──────────────────────────────────────────────────────────────────
export async function submitContact(input, req) {
    const doc = await Message.create({
        name: input.name,
        phone: input.phone,
        email: input.email,
        subject: input.subject,
        message: input.message,
        ...clientMeta(req, input.source),
    });
    alertStaff(
        `New website message${doc.subject ? `: ${doc.subject}` : ""} — ${doc.name}`,
        [`Name: ${doc.name}`, `Phone: ${doc.phone}`, doc.email && `Email: ${doc.email}`, doc.subject && `Subject: ${doc.subject}`, "", doc.message],
        { replyTo: doc.email, path: `/admin/messages/${doc._id}` },
    );
    return { id: doc._id };
}

// ── Appointment request (only when settings.bookingMode is "form" or "both") ──
export async function submitAppointment(input, req) {
    const settings = await Settings.findById(SETTINGS_ID, { bookingMode: 1 }).lean();
    if (!["form", "both"].includes(settings?.bookingMode)) {
        throw new AppError(403, "BOOKING_DISABLED", "Online booking is off — please call or WhatsApp us.");
    }

    let doctor = null;
    let department = null;
    if (input.doctor) {
        doctor = await Doctor.findOne({ isActive: { $ne: false }, $or: [{ slug: input.doctor }, { previousSlugs: input.doctor }] }).lean();
        if (!doctor) throw new AppError(400, "UNKNOWN_DOCTOR", "Please choose a doctor from the list.");
        if (doctor.department) department = await Department.findById(doctor.department, { name: 1 }).lean();
    } else if (input.department) {
        department = await Department.findOne({ isActive: { $ne: false }, slug: input.department }, { name: 1 }).lean();
        if (!department) throw new AppError(400, "UNKNOWN_DEPARTMENT", "Please choose a department from the list.");
    }

    let slot = null;
    if (input.date) {
        const today = dhakaToday();
        if (input.date < today) throw new AppError(400, "DATE_PAST", "Please pick today or a later date.");
        if (input.date > addDays(today, BOOKING_WINDOW_DAYS)) {
            throw new AppError(400, "DATE_TOO_FAR", `Bookings open up to ${BOOKING_WINDOW_DAYS} days ahead.`);
        }
        if (doctor) {
            const { leave } = doctor;
            if (leave?.until && input.date <= toDay(leave.until) && (!leave.from || input.date >= toDay(leave.from))) {
                throw new AppError(409, "DOCTOR_ON_LEAVE", `The doctor is on leave until ${toDay(leave.until)}.`);
            }
            if (doctor.schedule?.length) {
                const s = doctor.schedule.find((x) => x.day === weekdayKey(input.date));
                if (!s) throw new AppError(409, "NO_CHAMBER", "The doctor has no chamber on that day.");
                slot = { from: s.from, to: s.to };
            }
        }
    }

    // Same phone + doctor + day still open → no duplicate request (double taps, impatient retries).
    const open = await Booking.exists({
        phone: input.phone,
        doctor: doctor?._id ?? null,
        date: input.date ?? null,
        status: { $in: ["new", "confirmed"] },
    });
    if (open) throw new AppError(409, "DUPLICATE_BOOKING", "We already have this request — our team will call you.");

    const doc = await Booking.create({
        name: input.name,
        phone: input.phone,
        doctor: doctor?._id ?? null,
        doctorName: doctor?.name?.en || null,
        department: department?._id ?? null,
        departmentName: department?.name?.en || null,
        date: input.date ?? null,
        slot,
        note: input.note,
        ...clientMeta(req, input.source),
    });
    alertStaff(
        `New appointment request — ${doc.doctorName || doc.departmentName || "General"}${doc.date ? ` · ${doc.date}` : ""}`,
        [
            `Patient: ${doc.name}`,
            `Phone: ${doc.phone}`,
            doc.doctorName && `Doctor: ${doc.doctorName}`,
            doc.departmentName && `Department: ${doc.departmentName}`,
            doc.date && `Preferred date: ${doc.date}${slot ? ` (${slot.from}–${slot.to})` : ""}`,
            doc.note && `Note: ${doc.note}`,
        ],
        { path: `/admin/bookings/${doc._id}` },
    );
    return { id: doc._id, status: doc.status };
}

// ── Job application with CV ──────────────────────────────────────────────────
const CV_TYPES = {
    pdf: { mime: "application/pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
    doc: {
        mime: "application/msword",
        test: (b) => b.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")),
    },
    docx: {
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        test: (b) => b.subarray(0, 4).equals(Buffer.from("504b0304", "hex")) && b.includes("word/"),
    },
};

/** Type from the file's bytes, never from its name or the browser's claim. */
export function detectCvType(buffer) {
    return Object.entries(CV_TYPES).find(([, t]) => t.test(buffer))?.[0] ?? null;
}

export async function submitApplication(input, file, req) {
    if (!file) throw new AppError(400, "CV_REQUIRED", "Please attach your CV.");
    const ext = detectCvType(file.buffer);
    if (!ext) throw new AppError(415, "CV_TYPE", "CV must be a PDF or Word (DOC/DOCX) file.");

    let job = null;
    if (input.job) {
        job = await Job.findOne({ isActive: { $ne: false }, $or: [{ slug: input.job }, { previousSlugs: input.job }] }, { title: 1 }).lean();
        if (!job) throw new AppError(400, "UNKNOWN_JOB", "This opening is no longer available.");
    }

    // Private storage: PRIVATE_DIR/cv/YYYY-MM/<random>.<ext> — random name, never served by Nginx.
    const rel = path.posix.join("cv", dhakaToday().slice(0, 7), `${randomTag(12)}.${ext}`);
    await atomicWrite(within(PRIVATE_ROOT, rel), file.buffer);

    const doc = await Application.create({
        job: job?._id ?? null,
        jobTitle: job?.title?.en || "General application",
        name: input.name,
        phone: input.phone,
        email: input.email,
        note: input.note,
        cv: {
            file: rel,
            originalName: String(file.originalname || `cv.${ext}`).slice(0, 160),
            mime: CV_TYPES[ext].mime,
            size: file.size,
        },
        ...clientMeta(req, input.source),
    });
    alertStaff(
        `New job application: ${doc.jobTitle} — ${doc.name}`,
        [`Name: ${doc.name}`, `Phone: ${doc.phone}`, `Email: ${doc.email}`, `Position: ${doc.jobTitle}`, doc.note && `Note: ${doc.note}`, "", "The CV can be downloaded from the dashboard."],
        { replyTo: doc.email, path: `/admin/applications/${doc._id}` },
    );
    return { id: doc._id };
}
