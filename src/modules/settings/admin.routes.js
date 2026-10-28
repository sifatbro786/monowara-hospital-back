import { Router } from "express";
import { z } from "zod";
import { AppError, notFound } from "../../lib/errors.js";
import { can } from "../../lib/permissions.js";
import { ok } from "../../lib/public.js";
import { applyPatch, slugify, zBool, zL, zPath, zPhone, zUrl } from "../../lib/admin.js";
import { requirePermission } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { logActivity } from "../activity/service.js";
import { Settings, SETTINGS_ID } from "./model.js";

// /api/admin/settings — the public settings singleton.
//   GET  /         settings.manage or notice.manage
//   PATCH /        settings.manage (super admin): numbers, WhatsApp desks, booking mode, hours, socials…
//   PATCH /notice  notice.manage (graphics_design + super admin): the notice bar only
const router = Router();

const required = (v, msg) => v.refine((x) => x !== null, msg);

const whatsapp = z
    .array(
        z
            .object({
                _id: z.string().trim().max(60).regex(/^[\w-]+$/).optional(), // new desks get one from the label
                label: zL(60),
                number: required(zPhone, "number is required"),
                isPrimary: zBool.default(false),
                isActive: zBool.default(true),
            })
            .strict(),
    )
    .max(12)
    .superRefine((list, ctx) => {
        const active = list.filter((w) => w.isActive);
        if (active.length && active.filter((w) => w.isPrimary).length !== 1) {
            ctx.addIssue({ code: "custom", path: [], message: "exactly one active WhatsApp desk must be primary" });
        }
        list.forEach((w, i) => {
            if (w.isPrimary && !w.isActive) ctx.addIssue({ code: "custom", path: [i, "isPrimary"], message: "the primary desk must be active" });
            if (!w.label.en) ctx.addIssue({ code: "custom", path: [i, "label", "en"], message: "label is required" });
        });
    })
    // stable ids (tap analytics reference them) + order = position in the list
    .transform((list) => {
        const used = new Set();
        return list.map((w, i) => {
            let id = w._id || `wa_${slugify(w.label.en).replace(/-/g, "_") || "desk"}`;
            while (used.has(id)) id = `${id}_${i + 1}`;
            used.add(id);
            return { ...w, _id: id, order: i + 1 };
        });
    });

const phones = z
    .array(z.object({ label: zL(60), number: required(zPhone, "number is required"), isActive: zBool.default(true) }).strict())
    .max(12)
    .transform((list) => list.map((p, i) => ({ ...p, order: i + 1 })));

const MAP_HOSTS = ["google.com", "maps.google.com", "goo.gl", "maps.app.goo.gl"];

const settingsBody = z
    .object({
        siteName: zL(80),
        legalName: zL(120),
        hotline: zPhone,
        emergency: zPhone,
        ambulance: zPhone,
        landline: zPhone,
        phones,
        whatsappNumbers: whatsapp,
        bookingMode: z.enum(["numbers", "form", "both"]),
        heroSlider: z.object({ intervalSec: z.number().int().min(2).max(15) }).strict(),
        email: z
            .string()
            .trim()
            .toLowerCase()
            .max(120)
            .transform((v) => v || null)
            .nullable()
            .refine((v) => v === null || z.string().email().safeParse(v).success, "a valid email"),
        address: zL(200),
        hours: z.object({ emergency: zL(120), opd: zL(120) }).strict(),
        dghsLicence: z
            .string()
            .trim()
            .max(60)
            .transform((v) => v || null)
            .nullable(),
        yearsServing: z.number().int().min(0).max(200).nullable(),
        socials: z
            .object({
                facebook: zUrl(["facebook.com", "fb.com"]),
                instagram: zUrl(["instagram.com"]),
                youtube: zUrl(["youtube.com", "youtu.be"]),
                linkedin: zUrl(["linkedin.com"]),
            })
            .strict(),
        map: z.object({ embed: zUrl(MAP_HOSTS), directions: zUrl(MAP_HOSTS) }).strict(),
    })
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, "nothing to update");

const noticeBody = z
    .object({
        isActive: zBool,
        text: zL(160),
        href: z.union([zPath, zUrl()]).nullable().or(z.literal("").transform(() => null)),
    })
    .strict()
    .refine((n) => !n.isActive || n.text.en, { message: "write the notice text before switching it on", path: ["text", "en"] });

async function load() {
    const doc = await Settings.findById(SETTINGS_ID);
    if (!doc) throw notFound("Settings");
    return doc;
}

router.get("/", (req, _res, next) => {
    if (!can(req.user.role, "settings.manage") && !can(req.user.role, "notice.manage")) {
        throw new AppError(403, "FORBIDDEN", "You don't have access to this.");
    }
    next();
}, async (_req, res) => ok(res, (await load()).toObject()));

router.patch("/", requirePermission("settings.manage"), validate({ body: settingsBody }), async (req, res) => {
    const doc = await load();
    const changes = applyPatch(doc, req.valid.body);
    if (Object.keys(changes).length) {
        await doc.save();
        await logActivity(req, { action: "settings.update", entity: "settings", entityId: doc._id, summary: Object.keys(changes).join(", "), changes });
    }
    ok(res, doc.toObject());
});

router.patch("/notice", requirePermission("notice.manage"), validate({ body: noticeBody }), async (req, res) => {
    const doc = await load();
    const changes = applyPatch(doc, { noticeBar: req.valid.body });
    if (Object.keys(changes).length) {
        await doc.save();
        await logActivity(req, {
            action: "settings.notice",
            entity: "settings",
            entityId: doc._id,
            summary: req.valid.body.isActive ? `on: ${req.valid.body.text.en}` : "off",
            changes,
        });
    }
    ok(res, doc.toObject());
});

export default router;
