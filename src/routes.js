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
import auth from "./modules/auth/routes.js";
import adminUsers from "./modules/users/routes.js";
import adminActivity from "./modules/activity/routes.js";
import { requireAuth, requirePermission } from "./middlewares/auth.js";
import { csrfGuard, noStore } from "./middlewares/csrf.js";
import forms from "./modules/forms/routes.js";
import adminUploads from "./modules/uploads/routes.js";
import { applicationsRouter, bookingsRouter, messagesRouter } from "./modules/inbox/routes.js";
import adminStats from "./modules/stats/routes.js";
import adminDoctors from "./modules/doctors/admin.routes.js";
import adminDepartments from "./modules/departments/admin.routes.js";
import adminFacilities from "./modules/facilities/admin.routes.js";
import adminDiagnostics from "./modules/diagnostics/admin.routes.js";
import adminPackages from "./modules/packages/admin.routes.js";
import adminSettings from "./modules/settings/admin.routes.js";
import adminHero from "./modules/hero/admin.routes.js";
import adminMedia from "./modules/media/admin.routes.js";
import { centresRouter, keyNumbersRouter, storiesRouter, talksRouter } from "./modules/home/admin.routes.js";
import adminFaqs from "./modules/faqs/admin.routes.js";
import adminJobs from "./modules/jobs/admin.routes.js";
import adminPrograms from "./modules/programs/admin.routes.js";
import adminArticles, { articleOptions } from "./modules/articles/admin.routes.js";
import adminGallery from "./modules/gallery/admin.routes.js";
import adminManagement from "./modules/management/admin.routes.js";
import adminPages from "./modules/pages/admin.routes.js";
import adminSeo, { seoPaths } from "./modules/seo/admin.routes.js";
import events from "./modules/events/routes.js";
import { revalidateOnSave } from "./lib/revalidate.js";

const api = Router();

// Liveness + DB check for PM2 / uptime monitors (not rate-limited).
api.get("/health", (req, res) => {
    const db = isDbUp();
    res.status(db ? 200 : 503).json({ data: { status: db ? "ok" : "degraded", db, uptime: Math.round(process.uptime()) } });
});

// ── Public forms (POST, no auth): /contact, /appointments, /careers/apply ─────────────────────────
api.use(noStore, forms);

// ── Contact-tap beacons from the site (no personal data, always 204) ─────────────────────────────
api.use("/events", noStore, events);

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

// ── Staff auth + admin (cookie sessions, CSRF guard, never cached) ──────────────────────────────
api.use("/auth", noStore, csrfGuard, auth);

const admin = Router();
admin.use(requireAuth()); // every /api/admin route needs a signed-in staff user; permission per router
admin.use(revalidateOnSave); // 2xx writes → public site cache tags (src/lib/revalidate.js)
admin.use("/users", adminUsers);
admin.use("/activity", adminActivity);
admin.use("/uploads", adminUploads);
admin.use("/messages", messagesRouter);
admin.use("/bookings", bookingsRouter);
admin.use("/applications", applicationsRouter);
admin.use("/stats", adminStats);
admin.use("/doctors", adminDoctors);
admin.use("/departments", adminDepartments);
admin.use("/facilities", adminFacilities);
admin.use("/diagnostics", adminDiagnostics);
admin.use("/packages", adminPackages);
admin.use("/settings", adminSettings);
admin.use("/hero", adminHero);
admin.use("/media", adminMedia);
admin.use("/keynumbers", keyNumbersRouter);
admin.use("/centres", centresRouter);
admin.use("/talks", talksRouter);
admin.use("/stories", storiesRouter);
admin.use("/faqs", adminFaqs);
admin.use("/jobs", adminJobs);
admin.use("/programs", adminPrograms);
admin.get("/articles/options", requirePermission("articles.manage"), articleOptions); // before /:id
admin.use("/articles", adminArticles);
admin.use("/gallery", adminGallery);
admin.use("/management", adminManagement);
admin.use("/pages", adminPages);
admin.get("/seo/paths", requirePermission("seo.manage"), seoPaths); // before the CRUD router's /:id
admin.use("/seo", adminSeo);
api.use("/admin", noStore, csrfGuard, admin);


export default api;
