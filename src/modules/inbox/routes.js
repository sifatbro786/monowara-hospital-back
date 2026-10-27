import { Router } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { validate } from "../../middlewares/validate.js";
import { requirePermission } from "../../middlewares/auth.js";
import { notFound } from "../../lib/errors.js";
import { ok } from "../../lib/public.js";
import { PRIVATE_ROOT, safeCell, within } from "../../lib/files.js";
import { logActivity } from "../activity/service.js";
import { User } from "../users/model.js";
import {
    Application,
    APPLICATION_STATUSES,
    Booking,
    BOOKING_STATUSES,
    Message,
    MESSAGE_STATUSES,
} from "./models.js";

const EXPORT_MAX = 5000;
const idParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/, "invalid id") });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dhaka = (d) =>
    d ? new Date(new Date(d).getTime() + 6 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "";

/** Adds `handledByName` (staff name) so the OPD desk sees who touched an entry — ids stay as stored. */
async function withHandlerNames(docs) {
    const ids = [...new Set(docs.map((d) => d.handledBy).filter(Boolean))];
    if (!ids.length) return docs;
    const users = await User.find({ _id: { $in: ids } }, { name: 1 }).lean();
    const names = new Map(users.map((u) => [u._id, u.name]));
    return docs.map((d) => (d.handledBy ? { ...d, handledByName: names.get(d.handledBy) ?? null } : d));
}

/**
 * One factory for the three staff inboxes (messages, applications, bookings):
 *   GET    /             list   ?status&q&from&to&page&limit (+ extra filters)
 *   GET    /export.xlsx  same filters, ≤ 5000 rows, logged (personal data leaving the system)
 *   GET    /:id          one
 *   PATCH  /:id          status / staffNote (+ extra fields) → handledBy/handledAt, logged with before/after
 */
function inboxRouter({ Model, entity, permission, statuses, searchFields, extraQuery = {}, extraFilter = () => ({}), patchExtra = {}, columns }) {
    const router = Router();
    router.use(requirePermission(permission));

    const listQuery = z.object({
        status: z.enum(statuses).optional(),
        q: z.string().trim().max(80).optional().transform((v) => v || undefined),
        from: z.coerce.date().optional(), // createdAt range
        to: z.coerce.date().optional(),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        ...extraQuery,
    });

    const buildFilter = (q) => {
        const filter = { ...extraFilter(q) };
        if (q.status) filter.status = q.status;
        if (q.from || q.to) filter.createdAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
        if (q.q) {
            const rx = new RegExp(escapeRegex(q.q), "i");
            filter.$or = searchFields.map((f) => ({ [f]: rx }));
        }
        return filter;
    };

    router.get("/", validate({ query: listQuery }), async (req, res) => {
        const q = req.valid.query;
        const filter = buildFilter(q);
        const [items, total, counts] = await Promise.all([
            Model.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
            Model.countDocuments(filter),
            // badge counts for the dashboard tabs
            Promise.all(statuses.map(async (s) => [s, await Model.countDocuments({ status: s })])),
        ]);
        ok(res, { items: await withHandlerNames(items), total, page: q.page, limit: q.limit, counts: Object.fromEntries(counts) });
    });

    router.get("/export.xlsx", validate({ query: listQuery.omit({ page: true, limit: true }) }), async (req, res) => {
        const rows = await Model.find(buildFilter(req.valid.query)).sort({ createdAt: -1 }).limit(EXPORT_MAX).lean();

        const wb = new ExcelJS.Workbook();
        wb.creator = "Monowara Hospital website";
        const ws = wb.addWorksheet(entity, { views: [{ state: "frozen", ySplit: 1 }] });
        ws.columns = columns.map(([header, , width = 18]) => ({ header, width }));
        ws.getRow(1).font = { bold: true };
        for (const r of rows) ws.addRow(columns.map(([, get]) => safeCell(get(r))));

        await logActivity(req, { action: `${entity}.export`, entity, summary: `${rows.length} rows` });
        const day = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
        res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.attachment(`${entity}-${day}.xlsx`);
        await wb.xlsx.write(res);
        res.end();
    });

    router.get("/:id", validate({ params: idParams }), async (req, res) => {
        const doc = await Model.findById(req.valid.params.id).lean();
        if (!doc) throw notFound();
        ok(res, (await withHandlerNames([doc]))[0]);
    });

    router.patch(
        "/:id",
        validate({
            params: idParams,
            body: z
                .object({
                    status: z.enum(statuses).optional(),
                    staffNote: z.string().trim().max(1000).nullable().optional(),
                    ...patchExtra,
                })
                .strict()
                .refine((b) => Object.keys(b).length > 0, "nothing to update"),
        }),
        async (req, res) => {
            const doc = await Model.findById(req.valid.params.id);
            if (!doc) throw notFound();
            const changes = {};
            for (const [k, v] of Object.entries(req.valid.body)) {
                if (doc[k] !== v) {
                    changes[k] = [doc[k] ?? null, v];
                    doc[k] = v;
                }
            }
            if (Object.keys(changes).length) {
                doc.handledBy = req.user._id;
                doc.handledAt = new Date();
                await doc.save();
                await logActivity(req, { action: `${entity}.update`, entity, entityId: doc._id, summary: doc.name, changes });
            }
            ok(res, (await withHandlerNames([doc.toObject()]))[0]);
        },
    );

    return router;
}

export const messagesRouter = inboxRouter({
    Model: Message,
    entity: "messages",
    permission: "messages.manage",
    statuses: MESSAGE_STATUSES,
    searchFields: ["name", "phone", "email", "subject", "message"],
    columns: [
        ["Received", (r) => dhaka(r.createdAt), 18],
        ["Status", (r) => r.status, 10],
        ["Name", (r) => r.name, 24],
        ["Phone", (r) => r.phone, 14],
        ["Email", (r) => r.email, 26],
        ["Subject", (r) => r.subject, 28],
        ["Message", (r) => r.message, 60],
        ["Staff note", (r) => r.staffNote, 30],
    ],
});

export const bookingsRouter = inboxRouter({
    Model: Booking,
    entity: "bookings",
    permission: "bookings.manage",
    statuses: BOOKING_STATUSES,
    searchFields: ["name", "phone", "doctorName", "departmentName", "note"],
    extraQuery: {
        doctor: z.string().max(160).regex(/^[\w-]+$/).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // preferred day
    },
    extraFilter: (q) => ({ ...(q.doctor && { doctor: q.doctor }), ...(q.date && { date: q.date }) }),
    patchExtra: { serial: z.number().int().min(1).max(999).nullable().optional() },
    columns: [
        ["Received", (r) => dhaka(r.createdAt), 18],
        ["Status", (r) => r.status, 11],
        ["Preferred date", (r) => r.date, 14],
        ["Chamber", (r) => (r.slot ? `${r.slot.from}–${r.slot.to}` : ""), 12],
        ["Serial", (r) => r.serial, 8],
        ["Patient", (r) => r.name, 24],
        ["Phone", (r) => r.phone, 14],
        ["Doctor", (r) => r.doctorName, 30],
        ["Department", (r) => r.departmentName, 24],
        ["Note", (r) => r.note, 40],
        ["Staff note", (r) => r.staffNote, 30],
    ],
});

const applications = inboxRouter({
    Model: Application,
    entity: "applications",
    permission: "careers.manage",
    statuses: APPLICATION_STATUSES,
    searchFields: ["name", "phone", "email", "jobTitle", "note"],
    extraQuery: { job: z.string().max(160).regex(/^[\w-]+$/).optional() },
    extraFilter: (q) => (q.job ? { job: q.job } : {}),
    columns: [
        ["Received", (r) => dhaka(r.createdAt), 18],
        ["Status", (r) => r.status, 12],
        ["Position", (r) => r.jobTitle, 30],
        ["Name", (r) => r.name, 24],
        ["Phone", (r) => r.phone, 14],
        ["Email", (r) => r.email, 26],
        ["Note", (r) => r.note, 40],
        ["CV file", (r) => r.cv?.originalName, 30],
        ["Staff note", (r) => r.staffNote, 30],
    ],
});

// GET /api/admin/applications/:id/cv — streamed from PRIVATE_DIR, always as a download, logged.
applications.get("/:id/cv", validate({ params: idParams }), async (req, res) => {
    const doc = await Application.findById(req.valid.params.id, { cv: 1, name: 1 }).lean();
    if (!doc?.cv?.file) throw notFound("CV");
    const full = within(PRIVATE_ROOT, doc.cv.file);
    await logActivity(req, { action: "applications.cv_download", entity: "applications", entityId: doc._id, summary: doc.name });
    res.set("X-Content-Type-Options", "nosniff");
    res.attachment(doc.cv.originalName || "cv");
    res.type(doc.cv.mime || "application/octet-stream");
    res.sendFile(full, { dotfiles: "deny" }, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: { code: "NOT_FOUND", message: "CV file missing" } });
    });
});

export const applicationsRouter = applications;
