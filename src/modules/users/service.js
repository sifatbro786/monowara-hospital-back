import { AppError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { User, toPublicUser } from "./model.js";
import { revokeAllSessions } from "../auth/service.js";
import { logActivity } from "../activity/service.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const notFound = () => new AppError(404, "NOT_FOUND", "User not found");

export async function listUsers({ q, role, active, page, limit }) {
    const filter = {};
    if (role) filter.role = role;
    if (active !== undefined) filter.isActive = active;
    if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ name: rx }, { email: rx }];
    }
    const [items, total] = await Promise.all([
        User.find(filter).sort({ isActive: -1, name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        User.countDocuments(filter),
    ]);
    return { items: items.map(toPublicUser), total, page, limit };
}

export async function createUser({ name, email, role, password }, req) {
    if (await User.exists({ email })) throw new AppError(409, "DUPLICATE", "A user with this email already exists.");
    const user = await User.create({
        name,
        email,
        role,
        passwordHash: await hashPassword(password),
        mustChangePassword: true, // the temporary password is known to the creator
        createdBy: req.user._id,
    });
    await logActivity(req, {
        action: "users.create",
        entity: "users",
        entityId: user._id,
        summary: `${email} as ${role}`,
    });
    return toPublicUser(user.toObject());
}

/** Never leave the system without an active super admin. */
async function assertNotLastSuperAdmin(user) {
    if (user.role !== "super_admin" || !user.isActive) return;
    const others = await User.countDocuments({ _id: { $ne: user._id }, role: "super_admin", isActive: true });
    if (others === 0) {
        throw new AppError(409, "LAST_SUPER_ADMIN", "At least one active super admin must remain.");
    }
}

export async function updateUser(id, patch, req) {
    const user = await User.findById(id);
    if (!user) throw notFound();
    const self = user._id === req.user._id;

    const changes = {};
    if (patch.name !== undefined && patch.name !== user.name) changes.name = [user.name, patch.name];
    if (patch.role !== undefined && patch.role !== user.role) changes.role = [user.role, patch.role];
    if (patch.isActive !== undefined && patch.isActive !== user.isActive) {
        changes.isActive = [user.isActive, patch.isActive];
    }
    if (!Object.keys(changes).length) return toPublicUser(user.toObject());

    if (self && (changes.role || changes.isActive)) {
        throw new AppError(409, "SELF_CHANGE", "You can't change your own role or disable yourself.");
    }
    if (changes.role || changes.isActive?.[1] === false) await assertNotLastSuperAdmin(user);

    for (const [k, [, v]] of Object.entries(changes)) user[k] = v;
    await user.save();

    // Access level changed → kill existing sessions so the new rights apply on next sign-in.
    if (changes.role || changes.isActive) await revokeAllSessions(user._id, "access_changed");

    await logActivity(req, {
        action: "users.update",
        entity: "users",
        entityId: user._id,
        summary: user.email,
        changes,
    });
    return toPublicUser(user.toObject());
}

/** Super admin sets a temporary password → user must change it at next sign-in. */
export async function resetPassword(id, { password }, req) {
    const user = await User.findById(id);
    if (!user) throw notFound();
    user.passwordHash = await hashPassword(password);
    user.mustChangePassword = user._id !== req.user._id;
    user.passwordChangedAt = new Date();
    user.failedLogins = 0;
    user.lockUntil = null;
    await user.save();
    await revokeAllSessions(user._id, "password_reset");
    await logActivity(req, { action: "users.reset_password", entity: "users", entityId: user._id, summary: user.email });
    return toPublicUser(user.toObject());
}

export async function forceLogout(id, req) {
    if (!(await User.exists({ _id: id }))) throw notFound();
    await revokeAllSessions(id, "forced_logout");
    await logActivity(req, { action: "users.force_logout", entity: "users", entityId: id });
}
