import express, { Router } from "express";
import { z } from "zod";
import { strictLimiter } from "../../middlewares/rateLimit.js";
import { allowedOrigins } from "../../middlewares/security.js";
import { TapStat } from "./model.js";

/**
 * POST /api/events/tap — fired by the site's TapTracker via navigator.sendBeacon when a visitor taps
 * a WhatsApp or call link. Body is JSON sent as text/plain (a CORS-"simple" request, so the beacon
 * needs no preflight). Always 204 — analytics must never break or slow the page; junk is dropped.
 */
const router = Router();
const dhakaDay = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const key = z.string().trim().max(40).regex(/^[\w.-]+$/);

const body = z
    .object({
        channel: z.enum(["whatsapp", "call"]),
        desk: key.optional(), // WhatsApp desk id (data-wa-tap)
        number: z.string().regex(/^\d{5,15}$/), // the HOSPITAL number tapped (digits)
        section: key.optional(),
    })
    .strip();

router.post(
    "/tap",
    strictLimiter({ windowMs: 10 * 60_000, limit: 60 }),
    express.text({ type: ["text/plain", "application/json"], limit: "1kb" }),
    async (req, res) => {
        res.status(204).end();
        const origin = req.get("origin");
        if (origin && !allowedOrigins.has(origin)) return; // only beacons from our own pages
        let parsed;
        try {
            parsed = body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
        } catch {
            return;
        }
        if (!parsed.success) return;
        const { channel, desk, number, section = "main" } = parsed.data;
        const target = channel === "whatsapp" && desk ? desk : number;
        const day = dhakaDay();
        try {
            await TapStat.updateOne(
                { _id: `${day}|${channel}|${target}|${section}` },
                { $inc: { count: 1 }, $setOnInsert: { day, channel, target, section } },
                { upsert: true },
            );
        } catch {
            /* counting is best-effort */
        }
    },
);

export default router;
