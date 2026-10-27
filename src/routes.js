import { Router } from "express";
import { isDbUp } from "./config/db.js";
import { publicLimiter } from "./middlewares/rateLimit.js";

import settings from "./modules/settings/routes.js";
import hero from "./modules/hero/routes.js";
import faqs from "./modules/faqs/routes.js";
import home from "./modules/home/routes.js";
import departments from "./modules/departments/routes.js";
import facilities from "./modules/facilities/routes.js";
import diagnostics from "./modules/diagnostics/routes.js";
import doctors from "./modules/doctors/routes.js";
import packages from "./modules/packages/routes.js";
import articles from "./modules/articles/routes.js";
import gallery from "./modules/gallery/routes.js";
import pages from "./modules/pages/routes.js";
import management from "./modules/management/routes.js";
import jobs from "./modules/jobs/routes.js";
import media from "./modules/media/routes.js";
import seo from "./modules/seo/routes.js";
import { aestheticRouter, bhrpcRouter } from "./modules/programs/routes.js";

const api = Router();

// Liveness + DB check for PM2 / uptime monitors (not rate-limited).
api.get("/health", (req, res) => {
    const db = isDbUp();
    res.status(db ? 200 : 503).json({ data: { status: db ? "ok" : "degraded", db, uptime: Math.round(process.uptime()) } });
});

// ── Public read API (GET only) — contract: mh-front/docs/API_CONTRACT.md ─────────────────────────
const pub = Router();
pub.use(publicLimiter);
pub.use("/settings", settings);
pub.use("/hero", hero);
pub.use("/faqs", faqs);
pub.use("/home", home);
pub.use("/departments", departments);
pub.use("/facilities", facilities);
pub.use("/diagnostics", diagnostics);
pub.use("/doctors", doctors);
pub.use("/packages", packages);
pub.use("/articles", articles);
pub.use("/gallery", gallery);
pub.use("/pages", pages);
pub.use("/management", management);
pub.use("/jobs", jobs);
pub.use("/aesthetic", aestheticRouter);
pub.use("/bhrpc", bhrpcRouter);
pub.use("/media", media);
pub.use("/seo", seo);
api.use(pub);

// B1.3: /auth, /admin/* (RBAC) · B1.4: /uploads, /forms/*

export default api;
