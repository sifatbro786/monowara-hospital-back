/**
 * Create the first super admin (there is no public signup), or reset a locked-out admin.
 *
 *   npm run create-admin -- --email you@example.com --name "Your Name"
 *   npm run create-admin -- --email you@example.com --reset     # new password, unlock, kill sessions
 *
 * The password is asked interactively (hidden) so it never lands in shell history.
 * For non-interactive use (CI/VPS provisioning) set ADMIN_PASSWORD in the environment instead.
 */
import { parseArgs } from "node:util";
import readline from "node:readline";
import mongoose from "mongoose";
import { z } from "zod";
import { User, Session } from "../src/models.js";
import { hashPassword, passwordSchema } from "../src/lib/password.js";
import { ROLES } from "../src/lib/permissions.js";

const { values: args } = parseArgs({
    options: {
        email: { type: "string" },
        name: { type: "string" },
        role: { type: "string", default: "super_admin" },
        reset: { type: "boolean", default: false },
    },
});

function fail(msg) {
    console.error(`✖ ${msg}`);
    process.exit(1);
}

const email = z.string().trim().toLowerCase().email().safeParse(args.email ?? "");
if (!email.success) fail("--email is required and must be valid");
if (!ROLES.includes(args.role)) fail(`--role must be one of: ${ROLES.join(", ")}`);
if (!process.env.MONGODB_URI) fail("MONGODB_URI is not set (.env)");

function askHidden(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        rl._writeToOutput = (s) => {
            if (s.includes(question)) rl.output.write(s);
        };
        rl.question(question, (answer) => {
            rl.close();
            process.stdout.write("\n");
            resolve(answer);
        });
    });
}

async function getPassword() {
    if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
    if (!process.stdin.isTTY) fail("No terminal — set ADMIN_PASSWORD instead");
    const p1 = await askHidden("Password (min 10, letters + numbers): ");
    const p2 = await askHidden("Repeat password: ");
    if (p1 !== p2) fail("Passwords don't match");
    return p1;
}

const password = await getPassword();
const check = passwordSchema.safeParse(password);
if (!check.success) fail(`Weak password: ${check.error.issues.map((i) => i.message).join(", ")}`);

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
try {
    await User.syncIndexes();
    const existing = await User.findOne({ email: email.data });
    const passwordHash = await hashPassword(password);

    if (existing) {
        if (!args.reset) fail(`${email.data} already exists — use --reset to set a new password`);
        await User.updateOne(
            { _id: existing._id },
            {
                $set: { passwordHash, isActive: true, failedLogins: 0, lockUntil: null, passwordChangedAt: new Date(), mustChangePassword: false },
                $inc: { tokenVersion: 1 },
            },
        );
        await Session.updateMany({ user: existing._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: "cli_reset" } });
        console.log(`✔ Password reset for ${email.data} (${existing.role}); all sessions signed out`);
    } else {
        if (!args.name || args.name.trim().length < 2) fail("--name is required for a new user");
        const user = await User.create({ name: args.name.trim(), email: email.data, role: args.role, passwordHash });
        console.log(`✔ Created ${user.role} ${user.email}`);
    }
} finally {
    await mongoose.disconnect();
}
