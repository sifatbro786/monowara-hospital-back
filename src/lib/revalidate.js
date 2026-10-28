import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Admin save → the public site drops its cached copy (B3).
 *
 * mh-front caches every lib/api/* read with "use cache" + cacheTag(<tag>). After a successful admin
 * write we POST the affected tags to the Next server (`SITE_REVALIDATE_URL`, secret in
 * `x-revalidate-secret`), which calls revalidateTag(tag, { expire: 0 }) → the next visit renders fresh.
 *
 * One map, keyed by the admin mount (/api/admin/<module>/…). Collection-level tags are enough: every
 * per-document reader in mh-front also carries its collection tag (e.g. getDoctorBySlug → "doctors").
 * Cross-collection reads are tagged on the reader side (doctor cards carry "departments", the
 * Aesthetic/BHRPC teams and article bylines carry "doctors").
 */
export const TAGS_BY_MODULE = Object.freeze({
    doctors: ["doctors"],
    departments: ["departments"],
    facilities: ["facilities"],
    diagnostics: ["diagnostics"],
    packages: ["packages"],
    settings: ["settings"], // incl. PATCH /settings/notice
    hero: ["hero"],
    media: ["media"],
    keynumbers: ["home"],
    centres: ["home"],
    talks: ["home"],
    stories: ["home"],
    faqs: ["faqs"],
    jobs: ["jobs"],
    programs: ["aesthetic", "bhrpc"],
    articles: ["articles"],
    gallery: ["gallery"],
    management: ["management"],
    pages: ["pages"],
    seo: ["seo"],
});

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const DEBOUNCE_MS = 250; // a reorder or a burst of saves → one call
const TIMEOUT_MS = 5000;

let pending = new Set();
let timer = null;

/** Mounted on the admin router: after a 2xx write to a mapped module, queue that module's tags. */
export function revalidateOnSave(req, res, next) {
    if (SAFE.has(req.method)) return next();
    const tags = TAGS_BY_MODULE[req.path.split("/")[1]];
    if (tags) {
        res.on("finish", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) queueRevalidate(tags);
        });
    }
    next();
}

export function queueRevalidate(tags) {
    if (!env.SITE_REVALIDATE_URL) return; // local API without a Next server, tests
    for (const t of tags) pending.add(t);
    if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
}

async function flush() {
    timer = null;
    const tags = [...pending];
    pending = new Set();
    if (!tags.length) return;
    // Never throws: a site that is down must not fail or slow down the admin save (it already returned).
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetch(env.SITE_REVALIDATE_URL, {
                method: "POST",
                headers: { "content-type": "application/json", "x-revalidate-secret": env.REVALIDATE_SECRET },
                body: JSON.stringify({ tags }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (res.ok) {
                logger.debug({ tags }, "Site cache revalidated");
                return;
            }
            logger.warn({ tags, status: res.status, attempt }, "Site revalidate rejected");
            if (res.status < 500) return; // bad secret / bad tag → retrying won't help
        } catch (err) {
            logger.warn({ tags, attempt, err: err.message }, "Site revalidate failed");
        }
        if (attempt === 1) await new Promise((r) => setTimeout(r, 2000));
    }
    logger.error({ tags }, "Site still shows the old content until its cache expires (≤ 1 h) — check SITE_REVALIDATE_URL / REVALIDATE_SECRET");
}

/** Tests: wait for the debounce + request. */
export const _flushNow = async () => {
    if (timer) {
        clearTimeout(timer);
        await flush();
    }
};
