import { Router } from "express";
import { z } from "zod";
import { can } from "../../lib/permissions.js";
import { onLeaveToday } from "../../lib/admin.js";
import { ok } from "../../lib/public.js";
import { validate } from "../../middlewares/validate.js";
import { Booking, Message, Application, BOOKING_STATUSES, APPLICATION_STATUSES } from "../inbox/models.js";
import { Doctor } from "../doctors/model.js";
import { TapStat } from "../events/model.js";
import { Settings, SETTINGS_ID } from "../settings/model.js";

// Mounted at /api/admin/stats (requireAuth applied). Each block only for roles that hold the matching
// permission — a marketer gets `{}`. Small windows, plain finds with projections (no aggregation
// pipeline needed at this volume; also keeps the in-memory test driver honest).
const router = Router();

const DAY_MS = 86_400_000;
const dhakaDay = (d) => new Date(new Date(d).getTime() + 6 * 3_600_000).toISOString().slice(0, 10);

/** Last `days` Dhaka calendar days, oldest first → [{ day: "YYYY-MM-DD", count }] */
function series(rows, days) {
    const today = dhakaDay(Date.now());
    const keys = Array.from({ length: days }, (_, i) => dhakaDay(Date.parse(`${today}T12:00:00+06:00`) - (days - 1 - i) * DAY_MS));
    const counts = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const r of rows) {
        const k = dhakaDay(r.createdAt);
        if (k in counts) counts[k]++;
    }
    return keys.map((day) => ({ day, count: counts[day] }));
}
const windowStart = (days) => new Date(Date.parse(`${dhakaDay(Date.now())}T00:00:00+06:00`) - (days - 1) * DAY_MS);

// GET /api/admin/stats/overview?days=30
router.get(
    "/overview",
    validate({ query: z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }) }),
    async (req, res) => {
        const { days } = req.valid.query;
        const since = windowStart(days);
        const role = req.user.role;
        const out = { days };

        if (can(role, "bookings.manage")) {
            const rows = await Booking.find({ createdAt: { $gte: since } }, { createdAt: 1, status: 1, doctor: 1, doctorName: 1 }).lean();
            const byStatus = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0]));
            const byDoctor = new Map();
            for (const r of rows) {
                byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
                if (r.doctor) {
                    const d = byDoctor.get(r.doctor) ?? { doctor: r.doctor, name: r.doctorName, count: 0 };
                    d.count++;
                    byDoctor.set(r.doctor, d);
                }
            }
            out.bookings = {
                total: rows.length,
                daily: series(rows, days),
                byStatus,
                topDoctors: [...byDoctor.values()].sort((a, b) => b.count - a.count).slice(0, 5),
            };
        }
        if (can(role, "messages.manage")) {
            const rows = await Message.find({ createdAt: { $gte: since } }, { createdAt: 1 }).lean();
            out.messages = { total: rows.length, daily: series(rows, days) };
        }
        if (can(role, "careers.manage")) {
            const rows = await Application.find({ createdAt: { $gte: since } }, { status: 1 }).lean();
            const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0]));
            for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
            out.applications = { total: rows.length, byStatus };
        }
        if (can(role, "doctors.manage")) {
            const [active, hidden, onLeave, noPhoto, noBmdc, noSchedule] = await Promise.all([
                Doctor.countDocuments({ isActive: { $ne: false } }),
                Doctor.countDocuments({ isActive: false }),
                Doctor.countDocuments({ isActive: { $ne: false }, ...onLeaveToday() }),
                Doctor.countDocuments({ isActive: { $ne: false }, photo: { $in: [null, ""] } }),
                Doctor.countDocuments({ isActive: { $ne: false }, bmdc: { $in: [null, ""] } }),
                Doctor.countDocuments({ isActive: { $ne: false }, schedule: { $size: 0 }, scheduleNote: null }),
            ]);
            out.doctors = { active, hidden, onLeave, noPhoto, noBmdc, noSchedule };
        }
        // Contact taps (WhatsApp / call buttons) — marketing + super admin
        if (can(role, "seo.manage") || can(role, "settings.manage")) {
            const first = dhakaDay(since);
            const [rows, settings] = await Promise.all([
                TapStat.find({ day: { $gte: first } }).lean(),
                Settings.findById(SETTINGS_ID, { whatsappNumbers: 1 }).lean(),
            ]);
            const desks = new Map((settings?.whatsappNumbers ?? []).map((w) => [w._id, w.label?.en || w._id]));
            const sum = (m, k, n) => m.set(k, (m.get(k) ?? 0) + n);
            const perDay = new Map(), wa = new Map(), call = new Map(), sections = new Map();
            let whatsapp = 0, calls = 0;
            for (const r of rows) {
                sum(perDay, r.day, r.count);
                sum(sections, r.section, r.count);
                if (r.channel === "whatsapp") (whatsapp += r.count), sum(wa, r.target, r.count);
                else (calls += r.count), sum(call, r.target, r.count);
            }
            const top = (m, label = (k) => k) =>
                [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, count]) => ({ key: k, label: label(k), count }));
            const daily = series([], days).map((d) => ({ ...d, count: perDay.get(d.day) ?? 0 }));
            out.taps = {
                total: whatsapp + calls,
                whatsapp,
                calls,
                daily,
                byDesk: top(wa, (k) => desks.get(k) ?? (/^\d+$/.test(k) ? `WhatsApp ${k}` : k)),
                byNumber: top(call, (k) => (k.startsWith("880") ? `0${k.slice(3)}` : k)),
                bySection: top(sections),
            };
        }
        ok(res, out);
    },
);

export default router;
