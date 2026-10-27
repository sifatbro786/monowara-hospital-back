import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate.js";
import { requirePermission } from "../../middlewares/auth.js";
import { passwordSchema } from "../../lib/password.js";
import { ROLES } from "../../lib/permissions.js";
import { ok } from "../../lib/public.js";
import { createUser, forceLogout, listUsers, resetPassword, updateUser } from "./service.js";

// Mounted at /api/admin/users (requireAuth already applied). Super admin only.
const router = Router();
router.use(requirePermission("users.manage"));

const idParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/, "invalid id") });
const name = z.string().trim().min(2).max(80);

// GET /api/admin/users?q=&role=&active=&page=&limit=
router.get(
    "/",
    validate({
        query: z.object({
            q: z.string().trim().max(80).optional().transform((v) => v || undefined),
            role: z.enum(ROLES).optional(),
            active: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
            page: z.coerce.number().int().min(1).max(1000).default(1),
            limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
    }),
    async (req, res) => ok(res, await listUsers(req.valid.query)),
);

// POST /api/admin/users { name, email, role, password }  (password = temporary, forced change)
router.post(
    "/",
    validate({
        body: z.object({
            name,
            email: z.string().trim().toLowerCase().email().max(254),
            role: z.enum(ROLES),
            password: passwordSchema,
        }),
    }),
    async (req, res) => res.status(201).json({ data: await createUser(req.valid.body, req) }),
);

// PATCH /api/admin/users/:id { name?, role?, isActive? }
router.patch(
    "/:id",
    validate({
        params: idParams,
        body: z
            .object({ name: name.optional(), role: z.enum(ROLES).optional(), isActive: z.boolean().optional() })
            .strict()
            .refine((b) => Object.keys(b).length > 0, "nothing to update"),
    }),
    async (req, res) => ok(res, await updateUser(req.valid.params.id, req.valid.body, req)),
);

// POST /api/admin/users/:id/reset-password { password }
router.post(
    "/:id/reset-password",
    validate({ params: idParams, body: z.object({ password: passwordSchema }) }),
    async (req, res) => ok(res, await resetPassword(req.valid.params.id, req.valid.body, req)),
);

// POST /api/admin/users/:id/logout-all
router.post("/:id/logout-all", validate({ params: idParams }), async (req, res) => {
    await forceLogout(req.valid.params.id, req);
    ok(res, { loggedOut: true });
});

// No DELETE: accounts are deactivated (isActive=false) so the activity log keeps its references.
export default router;
