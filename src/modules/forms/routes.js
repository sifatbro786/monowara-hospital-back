import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { validate } from "../../middlewares/validate.js";
import { strictLimiter } from "../../middlewares/rateLimit.js";
import { allowedOrigins } from "../../middlewares/security.js";
import { bdPhone, honeypot, line, optEmail, optLine, optText, slugish, source, text } from "../../lib/formFields.js";
import { submitAppointment, submitApplication, submitContact } from "./service.js";

/**
 * Public form endpoints (no auth, no cookies). Called from the browser on monowarahospital.com.
 * Defences: allow-listed Origin, per-IP limits, honeypot `website`, zod, size caps, magic-byte
 * checks on files. A honeypot hit gets a fake 202 so bots don't learn anything.
 */
const router = Router();

function sameSiteOrigin(req, _res, next) {
    const origin = req.get("origin");
    if (origin && !allowedOrigins.has(origin.replace(/\/$/, ""))) {
        throw new AppError(403, "BAD_ORIGIN", "Request origin not allowed.");
    }
    next();
}
router.use(sameSiteOrigin);

const trap = (req, res, next) => {
    if (req.valid.body.website) {
        logger.info({ form: req.path }, "Honeypot hit — dropped");
        return res.status(202).json({ data: { received: true } });
    }
    next();
};

const accepted = (res, data) => res.status(201).json({ data: { received: true, ...data } });

// POST /api/contact { name, phone, email?, subject?, message, website, source? }
router.post(
    "/contact",
    strictLimiter({ windowMs: 10 * 60_000, limit: 5 }),
    validate({
        body: z.object({
            name: line(2, 80),
            phone: bdPhone,
            email: optEmail,
            subject: optLine(120),
            message: text(5, 800),
            website: honeypot,
            source,
        }),
    }),
    trap,
    async (req, res) => accepted(res, await submitContact(req.valid.body, req)),
);

// POST /api/appointments { name, phone, department?, doctor?, date?, note?, website, source? }
router.post(
    "/appointments",
    strictLimiter({ windowMs: 10 * 60_000, limit: 5 }),
    validate({
        body: z.object({
            name: line(2, 80),
            phone: bdPhone,
            department: slugish,
            doctor: slugish,
            date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "invalid date")
                .optional()
                .or(z.literal("").transform(() => undefined)),
            note: optText(300),
            website: honeypot,
            source,
        }),
    }),
    trap,
    async (req, res) => accepted(res, await submitAppointment(req.valid.body, req)),
);

// POST /api/careers/apply  multipart: name, phone, email, job?, note?, website, source?, cv (file)
const cvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.CV_MAX_MB * 1024 * 1024, files: 1, fields: 10, fieldSize: 4096, parts: 12 },
}).single("cv");

router.post(
    "/careers/apply",
    strictLimiter({ windowMs: 30 * 60_000, limit: 3 }),
    cvUpload,
    validate({
        body: z.object({
            name: line(2, 80),
            phone: bdPhone,
            email: z.string().trim().toLowerCase().email().max(120),
            job: slugish,
            note: optText(1000),
            website: honeypot,
            source,
        }),
    }),
    trap,
    async (req, res) => accepted(res, await submitApplication(req.valid.body, req.file, req)),
);

export default router;
