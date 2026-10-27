import { z } from "zod";

/** Same rule as mh-front's BD_MOBILE; stored normalised as 01XXXXXXXXX. */
const BD_MOBILE = /^(?:\+?88)?(01[3-9]\d{8})$/;
export const bdPhone = z
    .string()
    .transform((v) => v.replace(/[\s\-()]/g, ""))
    .refine((v) => BD_MOBILE.test(v), "enter a Bangladeshi mobile number (01XXXXXXXXX)")
    .transform((v) => BD_MOBILE.exec(v)[1]);

// Drop control characters (keep \n and \t), trim, collapse 3+ blank lines.
const clean = (s) =>
    s
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/\r\n?/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

export const text = (min, max) =>
    z.string().transform(clean).pipe(z.string().min(min).max(max));

/** Single-line text (names, subjects): every whitespace run incl. newlines → one space. */
const oneLine = (s) => clean(s).replace(/\s+/g, " ");
export const line = (min, max) => z.string().transform(oneLine).pipe(z.string().min(min).max(max));
export const optLine = (max) =>
    z
        .string()
        .optional()
        .transform((v) => (v == null ? null : oneLine(v) || null))
        .pipe(z.string().max(max).nullable());

/** Optional text: "" / missing → null. */
export const optText = (max) =>
    z
        .string()
        .optional()
        .transform((v) => (v == null ? null : clean(v) || null))
        .pipe(z.string().max(max).nullable());

export const optEmail = z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() || null)
    .pipe(z.string().email().max(120).nullable());

export const slugish = z.string().trim().max(160).regex(/^[a-z0-9-]*$/).optional().transform((v) => v || null);

/** Honeypot: humans never see it; anything in it marks a bot. */
export const honeypot = z.string().max(500).optional();

/** Page the form was sent from (internal path only), for the staff's context. */
export const source = z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v && /^\/[\w\-/?=&#%.]*$/.test(v) ? v : null));
