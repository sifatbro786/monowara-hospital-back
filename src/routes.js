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
import { requireAuth } from "./middlewares/auth.js";
import { csrfGuard, noStore } from "./middlewares/csrf.js";
import forms from "./modules/forms/routes.js";
import adminUploads from "./modules/uploads/routes.js";
import { applicationsRouter, bookingsRouter, messagesRouter } from "./modules/inbox/routes.js";
import adminStats from "./modules/stats/routes.js";
import adminDoctors from "./modules/doctors/admin.routes.js";
import adminDepartments from "./modules/departments/admin.routes.js";
import adminFacilities from "./modules/facilities/admin.routes.js";
import adminDiagnostics from "./modules/diagnostics/admin.routes.js";

const api = Router();

// Liveness + DB check for PM2 / uptime monitors (not rate-limited).
api.get("/health", (req, res) => {
    const db = isDbUp();
    res.status(db ? 200 : 503).json({ data: { status: db ? "ok" : "degraded", db, uptime: Math.round(process.uptime()) } });
});

// ── Public forms (POST, no auth): /contact, /appointments, /careers/apply ─────────────────────────
api.use(noStore, forms);

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
api.use("/admin", noStore, csrfGuard, admin);

// B2.3+: admin CRUD per content module — doctors, departments/facilities/diagnostics done; packages, settings… next

export default api;
