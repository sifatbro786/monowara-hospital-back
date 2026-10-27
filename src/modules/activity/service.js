import { Activity } from "./model.js";
import { logger } from "../../lib/logger.js";

const clientMeta = (req) => ({
    ip: req?.ip ?? null,
    userAgent: req?.get?.("user-agent")?.slice(0, 300) ?? null,
});

/**
 * Append an activity entry. Never throws: a logging failure must not break the action itself
 * (it is reported to the server log instead).
 *   logActivity(req, { action: "users.update", entity: "users", entityId, summary, changes })
 * `actor` defaults to req.user; pass it explicitly for login (no req.user yet).
 */
export async function logActivity(req, { action, entity = null, entityId = null, summary = null, changes, actor }) {
    const a = actor ?? req?.user ?? null;
    try {
        await Activity.create({
            action,
            entity,
            entityId,
            summary: summary?.slice(0, 300) ?? null,
            ...(changes && { changes }),
            actor: a ? { _id: a._id ?? null, name: a.name ?? null, email: a.email ?? null, role: a.role ?? null } : {},
            ...clientMeta(req),
        });
    } catch (err) {
        logger.error({ err, action }, "Activity log write failed");
    }
}
