import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate.js";
import { requirePermission } from "../../middlewares/auth.js";
import { ok } from "../../lib/public.js";
import { Activity } from "./model.js";

// Mounted at /api/admin/activity (requireAuth already applied). Read-only.
const router = Router();

const key = z.string().trim().max(60).regex(/^[\w.-]+$/).optional();

// GET /api/admin/activity?actor=&action=&entity=&entityId=&from=&to=&page=&limit=
router.get(
    "/",
    requirePermission("activity.read"),
    validate({
        query: z.object({
            actor: z.string().regex(/^[a-f0-9]{24}$/).optional(),
            action: z.string().trim().max(60).regex(/^[\w.-]+\*?$/).optional(), // exact ("users.update") or prefix with * ("auth.*")
            entity: key,
            entityId: z.string().trim().max(160).regex(/^[\w-]+$/).optional(),
            from: z.coerce.date().optional(),
            to: z.coerce.date().optional(),
            page: z.coerce.number().int().min(1).max(10_000).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
    }),
    async (req, res) => {
        const { actor, action, entity, entityId, from, to, page, limit } = req.valid.query;
        const filter = {};
        if (actor) filter["actor._id"] = actor;
        if (action) {
            filter.action = action.endsWith("*")
                ? { $regex: `^${action.slice(0, -1).replace(/\./g, "\\.")}` }
                : action;
        }
        if (entity) filter.entity = entity;
        if (entityId) filter.entityId = entityId;
        if (from || to) filter.at = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

        const [items, total] = await Promise.all([
            Activity.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Activity.countDocuments(filter),
        ]);
        ok(res, { items, total, page, limit });
    },
);

export default router;
