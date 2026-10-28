/**
 * Seed MongoDB from mh-front's static data (data/*.js) — the same documents the demo renders.
 *
 *   npm run seed -- --drop                    # wipe the seeded collections, then insert
 *   npm run seed -- --front ../mh-front       # path to the frontend repo (default: ../mh-front)
 *   npm run seed -- --dry-run                 # validate data/*.js against the models, no DB needed
 *   npm run seed -- --only seo --add-missing  # = npm run seed:seo — add entries the DB doesn't have yet
 *
 * --only <a,b>    limit to these collections (names as in Mongo: seo, faqs, departments…)
 * --add-missing   insert only documents whose key (_id; for seo also `path`) isn't in the DB yet —
 *                 existing documents (admin edits) are never touched, nothing is deleted.
 * After writing, the site is told to drop its cache for those collections (SITE_REVALIDATE_URL).
 *
 * Safety:
 *  - Refuses to touch non-empty collections unless --drop (admin edits are never overwritten by accident).
 *  - Refuses NODE_ENV=production unless --production as well (first go-live seed only).
 *  - Strict: any field in data/*.js that the Mongoose schema doesn't know aborts the seed, so the
 *    models can never silently drift from what the frontend renders.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import mongoose from "mongoose";
import * as M from "../src/models.js";

const { values: args } = parseArgs({
    options: {
        drop: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        production: { type: "boolean", default: false },
        front: { type: "string", default: process.env.MH_FRONT_DIR || "../mh-front" },
        only: { type: "string" },
        "add-missing": { type: "boolean", default: false },
    },
});

const uri = process.env.MONGODB_URI;
if (!uri && !args["dry-run"]) fail("MONGODB_URI is not set (copy .env.example → .env).");
if (process.env.NODE_ENV === "production" && !args.production) fail("NODE_ENV=production — add --production to confirm.");

const dataDir = path.resolve(args.front, "data");
const load = async (file) => import(pathToFileURL(path.join(dataDir, file)).href);

// [Model, () => docs[]] — one entry per collection.
const plan = [
    [M.Settings, async () => [(await load("settings.js")).settings]],
    [M.HeroSlide, async () => (await load("hero.js")).heroSlides],
    [M.Faq, async () => (await load("faqs.js")).faqs],
    [M.KeyNumber, async () => (await load("home.js")).keyNumbers],
    [M.Centre, async () => (await load("home.js")).centres],
    [M.Talk, async () => (await load("home.js")).talks],
    [M.Story, async () => (await load("home.js")).stories],
    [M.Department, async () => (await load("departments.js")).departments],
    [M.Facility, async () => (await load("facilities.js")).facilities],
    [M.Diagnostic, async () => (await load("diagnostics.js")).diagnostics],
    [M.Doctor, async () => (await load("doctors.js")).doctors],
    [M.Package, async () => (await load("packages.js")).packages],
    [M.Article, async () => (await load("articles.js")).articles],
    [M.GalleryItem, async () => (await load("gallery.js")).gallery],
    [
        M.Page,
        async () => [
            ...(await load("legal.js")).legalPages.map((p) => ({ ...p, type: "legal" })),
            ...(await load("site-pages.js")).sitePages.map((p) => ({ ...p, type: "site" })),
        ],
    ],
    [M.Management, async () => (await load("site-pages.js")).management],
    [M.Job, async () => (await load("careers.js")).jobs],
    [M.Aesthetic, async () => [(await load("aesthetic.js")).aesthetic]],
    [M.Bhrpc, async () => [(await load("bhrpc.js")).bhrpc]],
    [M.MediaSlot, async () => (await load("media.js")).media],
    [M.SeoOverride, async () => (await load("seo.js")).seo],
];

/** Mongo collection → mh-front cache tag (lib/api/*). Seeding writes straight to Mongo, bypassing the
 *  admin routes, so the site has to be told here. Best effort: a stopped site just refreshes later. */
const TAG = { heroslides: "hero", keynumbers: "home", centres: "home", talks: "home", stories: "home" };
async function revalidateSite(collections) {
    const url = process.env.SITE_REVALIDATE_URL;
    const secret = process.env.REVALIDATE_SECRET;
    if (!url || !secret) return console.log("ℹ SITE_REVALIDATE_URL not set — restart the site (or wait ≤ 1 h) to see the seeded data.");
    const tags = [...new Set(collections.map((c) => TAG[c] ?? c))];
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", "x-revalidate-secret": secret },
            body: JSON.stringify({ tags }),
            signal: AbortSignal.timeout(5000),
        });
        console.log(res.ok ? `✔ Site cache refreshed: ${tags.join(", ")}` : `⚠ Site refused the refresh (HTTP ${res.status}) — check REVALIDATE_SECRET.`);
    } catch {
        console.log("ℹ Site not reachable — it will show the seeded data after a restart (or within ≤ 1 h).");
    }
}

function fail(msg) {
    console.error(`✖ ${msg}`);
    process.exit(1);
}

/** Paths present in the data file but missing after casting = fields the schema silently dropped
 *  (nested sub-schemas don't honour strict:"throw"). */
function droppedPaths(input, cast, prefix = "") {
    const out = [];
    if (Array.isArray(input)) {
        input.forEach((v, i) => out.push(...droppedPaths(v, cast?.[i], `${prefix}[${i}]`)));
    } else if (input && typeof input === "object" && !(input instanceof Date)) {
        for (const [k, v] of Object.entries(input)) {
            if (v === undefined) continue;
            const p = prefix ? `${prefix}.${k}` : k;
            if (cast == null || typeof cast !== "object" || !(k in cast)) out.push(p);
            else out.push(...droppedPaths(v, cast[k], p));
        }
    }
    return out;
}

/** Build + validate every document first; insert nothing unless all of them pass. */
async function prepare() {
    const now = new Date();
    const errors = [];
    const batches = [];
    for (const [Model, read] of plan) {
        const raw = await read();
        const hasOrder = Boolean(Model.schema.path("order"));
        const docs = raw.map((r, i) => {
            const input = {
                ...r,
                ...(hasOrder && r.order == null && { order: i + 1 }), // keep the array order
                createdAt: r.createdAt ?? now,
                updatedAt: r.updatedAt ?? r.createdAt ?? now,
            };
            try {
                const doc = new Model(input, null, { strict: "throw" });
                const err = doc.validateSync();
                if (err) for (const e of Object.values(err.errors)) errors.push(`${Model.modelName} ${r._id}: ${e.path} — ${e.message}`);
                for (const p of droppedPaths(input, doc.toObject({ depopulate: true })))
                    errors.push(`${Model.modelName} ${r._id}: field "${p}" is not in the schema`);
                return doc;
            } catch (e) {
                errors.push(`${Model.modelName} ${r._id}: ${e.message}`);
                return null;
            }
        });
        batches.push([Model, docs]);
    }
    if (errors.length) fail(`Data does not match the models:\n  ${errors.join("\n  ")}`);
    return batches;
}

/** Dangling references the admin would otherwise trip over later. */
function checkRefs(batches) {
    const ids = (Model) => new Set(batches.find(([m]) => m === Model)[1].map((d) => d._id));
    const docs = (Model) => batches.find(([m]) => m === Model)[1];
    const depts = ids(M.Department);
    const doctors = ids(M.Doctor);
    const articleSlugs = new Set(docs(M.Article).map((a) => a.slug));
    const warn = [];
    for (const d of docs(M.Doctor)) if (d.department && !depts.has(d.department)) warn.push(`doctor ${d._id} → department ${d.department}`);
    for (const p of docs(M.Package)) for (const id of p.departments) if (!depts.has(id)) warn.push(`package ${p._id} → department ${id}`);
    for (const Model of [M.Aesthetic, M.Bhrpc])
        for (const s of docs(Model)) for (const id of s.doctors) if (!doctors.has(id)) warn.push(`${s._id} → doctor ${id}`);
    for (const b of docs(M.Bhrpc)) for (const slug of b.topics) if (!articleSlugs.has(slug)) warn.push(`bhrpc topic → article ${slug}`);
    if (warn.length) console.warn(`⚠ Unresolved references (not fatal):\n  ${warn.join("\n  ")}`);
}

const only = args.only ? new Set(args.only.split(",").map((s) => s.trim()).filter(Boolean)) : null;
if (only) {
    const known = new Set(plan.map(([Model]) => Model.collection.name));
    const unknown = [...only].filter((n) => !known.has(n));
    if (unknown.length) fail(`Unknown collection(s) for --only: ${unknown.join(", ")}. Known: ${[...known].join(", ")}`);
    plan.splice(0, plan.length, ...plan.filter(([Model]) => only.has(Model.collection.name)));
}
if (args["add-missing"] && args.drop) fail("--add-missing and --drop can't be combined.");

const batches = await prepare();
if (!only) checkRefs(batches); // cross-collection refs need the whole data set
if (args["dry-run"]) {
    for (const [Model, docs] of batches) console.log(`  ${Model.collection.name.padEnd(12)} ${docs.length}`);
    console.log("✔ Dry run: every document matches its model (nothing written)");
    process.exit(0);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
console.log(`Connected to ${mongoose.connection.name} · data from ${dataDir}`);

try {
    const nonEmpty = [];
    for (const [Model] of batches) if (await Model.estimatedDocumentCount()) nonEmpty.push(Model.collection.name);
    if (nonEmpty.length && !args.drop && !args["add-missing"])
        fail(`Collections already have data: ${nonEmpty.join(", ")}. Re-run with --drop to replace them, or --add-missing to add only new entries.`);

    for (const [Model, docs] of batches) {
        if (args.drop) await Model.deleteMany({});
        await Model.syncIndexes();
        let toInsert = docs;
        if (args["add-missing"]) {
            // the unique business key too (seo.path), so a path the marketer already created by hand is kept
            const keys = Model === M.SeoOverride ? ["_id", "path"] : ["_id"];
            const existing = await Model.find({ $or: keys.map((k) => ({ [k]: { $in: docs.map((d) => d[k]) } })) }, Object.fromEntries(keys.map((k) => [k, 1]))).lean();
            const taken = new Set(existing.flatMap((e) => keys.map((k) => `${k}:${e[k]}`)));
            toInsert = docs.filter((d) => !keys.some((k) => taken.has(`${k}:${d[k]}`)));
        }
        // timestamps:false → keep the createdAt/updatedAt from the data files.
        if (toInsert.length) await Model.insertMany(toInsert, { timestamps: false });
        const skipped = docs.length - toInsert.length;
        console.log(`  ${Model.collection.name.padEnd(12)} ${toInsert.length}${skipped ? ` added, ${skipped} already there (kept)` : ""}`);
    }
    console.log("✔ Seed complete");
    await revalidateSite(batches.map(([Model]) => Model.collection.name));
} finally {
    await mongoose.disconnect();
}
