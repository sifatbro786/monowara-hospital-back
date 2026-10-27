import mongoose from "mongoose";
import { baseOptions, stringId } from "../../lib/schema.js";
import { ROLES } from "../../lib/permissions.js";

const { Schema, model } = mongoose;

// Staff accounts for the admin dashboard. No public signup — created by a super admin or the CLI.
const userSchema = new Schema(
    {
        _id: stringId,
        name: { type: String, required: true, trim: true, maxlength: 80 },
        email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
        passwordHash: { type: String, required: true, select: false },
        role: { type: String, enum: ROLES, required: true },
        isActive: { type: Boolean, default: true },
        // Set when a super admin creates the account / resets the password → forced change at first login.
        mustChangePassword: { type: Boolean, default: false },
        // Bumped on password change / "log out everywhere" / deactivation → every access token dies.
        tokenVersion: { type: Number, default: 0, select: false },
        failedLogins: { type: Number, default: 0, select: false },
        lockUntil: { type: Date, default: null, select: false },
        lastLoginAt: { type: Date, default: null },
        passwordChangedAt: { type: Date, default: null },
        createdBy: { type: String, ref: "User", default: null },
    },
    baseOptions,
);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, isActive: 1 });

/** Safe public shape (never hash / counters). */
export const toPublicUser = (u) => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    passwordChangedAt: u.passwordChangedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
});

export const User = model("User", userSchema, "users");
