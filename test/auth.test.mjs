// End-to-end auth test: real Express app + real Mongoose, with an in-memory driver collection
// (sift for filters, $set/$inc/$unset for updates, unique indexes enforced).
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
const BACK = path.resolve(__dir, "..");
const FRONT_DATA = path.resolve(BACK, process.env.MH_FRONT_DIR || "../mh-front", "data");
Object.assign(process.env, {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MONGODB_URI: "mongodb://x/y",
    JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123456",
    CORS_ORIGINS: "http://localhost:3000",
});
const req = createRequire(path.join(BACK, "package.json"));
const mongoose = req("mongoose");
const jwt = req("jsonwebtoken");
const imp = (p) => import(pathToFileURL(path.join(BACK, p)).href);

const M = await imp("src/models.js");
const { createApp } = await imp("src/app.js");
const { hashPassword } = await imp("src/lib/password.js");

const { installFakeDb } = await import("./fake-db.mjs");
const fakes = installFakeDb(mongoose);

// ── seed staff ──────────────────────────────────────────────────────────────
const PW = "Monowara2026";
await M.User.create({ name: "Sifat", email: "sa@mh.test", role: "super_admin", passwordHash: await hashPassword(PW) });
await M.User.create({ name: "Locky", email: "lock@mh.test", role: "opd_incharge", passwordHash: await hashPassword(PW) });

// ── http client with cookie jar ─────────────────────────────────────────────
const server = createApp().listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

class Client {
    constructor() {
        this.jar = new Map(); // name → {value, path}
        this.raw = [];
    }
    cookieHeader(url) {
        const p = new URL(url).pathname;
        return [...this.jar].filter(([, c]) => p.startsWith(c.path)).map(([n, c]) => `${n}=${c.value}`).join("; ");
    }
    async call(method, url, body, headers = {}) {
        const res = await fetch(base + url, {
            method,
            headers: {
                "content-type": "application/json",
                "x-requested-with": "mh-admin",
                cookie: this.cookieHeader(base + url),
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        this.raw = res.headers.getSetCookie();
        for (const sc of this.raw) {
            const [nv, ...attrs] = sc.split(";").map((s) => s.trim());
            const [n, v] = [nv.slice(0, nv.indexOf("=")), nv.slice(nv.indexOf("=") + 1)];
            const pathAttr = attrs.find((a) => a.toLowerCase().startsWith("path="))?.slice(5) || "/";
            const expired = attrs.some((a) => /^expires=/i.test(a) && new Date(a.slice(8)) < new Date());
            if (!v || expired) this.jar.delete(n);
            else this.jar.set(n, { value: decodeURIComponent(v), path: pathAttr });
        }
        let json = null;
        try {
            json = await res.json();
        } catch {}
        return { status: res.status, body: json, headers: res.headers };
    }
}

let fails = 0;
const check = (label, cond, extra = "") => {
    if (!cond) fails++;
    console.log(`${cond ? "✔" : "✖"} ${label}${!cond && extra ? `  → ${extra}` : ""}`);
};
const S = (r) => `${r.status} ${JSON.stringify(r.body)}`;

// CSRF / origin / injection
const anon = new Client();
let r = await anon.call("POST", "/api/auth/login", { email: "sa@mh.test", password: PW }, { "x-requested-with": "" });
check("login without X-Requested-With → 403 CSRF", r.status === 403 && r.body.error.code === "CSRF", S(r));
r = await anon.call("POST", "/api/auth/login", { email: "sa@mh.test", password: PW }, { origin: "https://evil.example" });
check("login from foreign Origin → 403", r.status === 403 && r.body.error.code === "BAD_ORIGIN", S(r));
r = await anon.call("POST", "/api/auth/login", { email: { $ne: null }, password: { $ne: null } });
check("NoSQL injection in login body → 400", r.status === 400, S(r));
r = await anon.call("GET", "/api/admin/users");
check("admin route without cookie → 401 AUTH_REQUIRED", r.status === 401 && r.body.error.code === "AUTH_REQUIRED", S(r));

// unknown email vs wrong password look identical
r = await anon.call("POST", "/api/auth/login", { email: "nobody@mh.test", password: PW });
const r2 = await anon.call("POST", "/api/auth/login", { email: "sa@mh.test", password: "wrongpass1" });
check("unknown email and wrong password → same 401", r.status === 401 && r2.status === 401 && r.body.error.message === r2.body.error.message, `${S(r)} | ${S(r2)}`);

// lockout
const lc = new Client();
for (let i = 1; i <= 5; i++) r = await lc.call("POST", "/api/auth/login", { email: "lock@mh.test", password: "wrongpass1" });
r = await lc.call("POST", "/api/auth/login", { email: "lock@mh.test", password: PW });
check("5 wrong passwords → account locked even with the right one (429)", r.status === 429 && r.body.error.code === "ACCOUNT_LOCKED", S(r));

// super admin login
const sa = new Client();
r = await sa.call("POST", "/api/auth/login", { email: "SA@mh.test ", password: PW });
check("super admin login (email trimmed/lowercased) → 200", r.status === 200 && r.body.data.user.role === "super_admin", S(r));
const atCookie = sa.raw.find((c) => c.startsWith("mh_at="));
const rtCookie = sa.raw.find((c) => c.startsWith("mh_rt="));
check("access cookie HttpOnly; SameSite=Strict; Path=/api", /HttpOnly/i.test(atCookie) && /SameSite=Strict/i.test(atCookie) && /Path=\/api(;|$)/.test(atCookie), atCookie);
{
    const exp = Date.parse(/Expires=([^;]+)/i.exec(atCookie)?.[1] ?? "");
    check("access cookie outlives the JWT (expired token still reaches the API → TOKEN_EXPIRED)", exp - Date.now() > 24 * 3600_000 && !/Max-Age=600\b/.test(atCookie), atCookie);
}
check("refresh cookie scoped to Path=/api/auth", /Path=\/api\/auth/.test(rtCookie) && /HttpOnly/i.test(rtCookie), rtCookie);
check("no password hash / counters in response", !JSON.stringify(r.body).match(/passwordHash|failedLogins|tokenVersion/));
check("Cache-Control: no-store on auth", r.headers.get("cache-control") === "no-store");
check("super admin gets every permission", r.body.data.permissions.includes("users.manage") && r.body.data.permissions.includes("seo.manage"));

r = await sa.call("GET", "/api/auth/me");
check("/auth/me → 200", r.status === 200 && r.body.data.user.email === "sa@mh.test", S(r));

// create users
r = await sa.call("POST", "/api/admin/users", { name: "Mita", email: "mkt@mh.test", role: "marketer", password: "short" });
check("weak temp password → 400", r.status === 400, S(r));
r = await sa.call("POST", "/api/admin/users", { name: "Mita", email: "mkt@mh.test", role: "marketer", password: "TempPass2026" });
check("create marketer → 201, mustChangePassword", r.status === 201 && r.body.data.mustChangePassword === true, S(r));
const mktId = r.body.data._id;
r = await sa.call("POST", "/api/admin/users", { name: "Dup", email: "mkt@mh.test", role: "opd_incharge", password: "TempPass2026" });
check("duplicate email → 409", r.status === 409, S(r));
r = await sa.call("POST", "/api/admin/users", { name: "Hack", email: "h@mh.test", role: "owner", password: "TempPass2026" });
check("unknown role → 400", r.status === 400, S(r));

// marketer: forced password change, then RBAC
const mk = new Client();
r = await mk.call("POST", "/api/auth/login", { email: "mkt@mh.test", password: "TempPass2026" });
check("marketer login → 200 (mustChangePassword flag)", r.status === 200 && r.body.data.user.mustChangePassword, S(r));
r = await mk.call("GET", "/api/admin/activity");
check("before password change → 403 PASSWORD_CHANGE_REQUIRED", r.status === 403 && r.body.error.code === "PASSWORD_CHANGE_REQUIRED", S(r));
r = await mk.call("POST", "/api/auth/password", { currentPassword: "TempPass2026", newPassword: "TempPass2026" });
check("same password again → 400", r.status === 400, S(r));
r = await mk.call("POST", "/api/auth/password", { currentPassword: "nope", newPassword: "MitaNew2026" });
check("wrong current password → 400", r.status === 400 && r.body.error.code === "WRONG_PASSWORD", S(r));
r = await mk.call("POST", "/api/auth/password", { currentPassword: "TempPass2026", newPassword: "MitaNew2026" });
check("change password → 200, new cookies", r.status === 200 && !r.body.data.user.mustChangePassword && mk.raw.length === 2, S(r));
r = await mk.call("GET", "/api/admin/users");
check("marketer → /admin/users 403 FORBIDDEN", r.status === 403 && r.body.error.code === "FORBIDDEN", S(r));
r = await mk.call("GET", "/api/admin/activity");
check("marketer → /admin/activity 403", r.status === 403, S(r));
check("marketer permissions = seo.manage only", (await mk.call("GET", "/api/auth/me")).body.data.permissions.join() === "seo.manage");

// refresh rotation, race, reuse detection
const oldRt = mk.jar.get("mh_rt").value;
r = await mk.call("POST", "/api/auth/refresh");
check("refresh → 200 rotates mh_rt", r.status === 200 && mk.jar.get("mh_rt").value !== oldRt, S(r));
const thief = new Client();
thief.jar.set("mh_rt", { value: oldRt, path: "/api/auth" });
r = await thief.call("POST", "/api/auth/refresh");
check("old token replayed within 30 s → 409 REFRESH_RACE (no revoke)", r.status === 409, S(r));
const sid = oldRt.split(".")[0];
fakes.sessions.rows.find((s) => s._id === sid).rotatedAt = new Date(Date.now() - 60_000);
r = await thief.call("POST", "/api/auth/refresh");
check("old token replayed later → 401 + session revoked", r.status === 401 && fakes.sessions.rows.find((s) => s._id === sid).revokedReason === "refresh_reuse", S(r));
r = await mk.call("GET", "/api/auth/me");
check("…and the legit user's access token dies too", r.status === 401 && r.body.error.code === "SESSION_REVOKED", S(r));

// idle timeout
await mk.call("POST", "/api/auth/login", { email: "mkt@mh.test", password: "MitaNew2026" });
const sid2 = mk.jar.get("mh_rt").value.split(".")[0];
fakes.sessions.rows.find((s) => s._id === sid2).lastUsedAt = new Date(Date.now() - 31 * 60_000);
r = await mk.call("POST", "/api/auth/refresh");
check("idle 31 min → refresh 401 SESSION_IDLE, cookies cleared", r.status === 401 && r.body.error.code === "SESSION_IDLE" && !mk.jar.has("mh_rt"), S(r));

// token tampering / expiry
const secret = process.env.JWT_ACCESS_SECRET;
const saUser = fakes.users.rows.find((u) => u.email === "sa@mh.test");
const saSid = sa.jar.get("mh_rt").value.split(".")[0];
const forge = new Client();
forge.jar.set("mh_at", { value: jwt.sign({ sid: saSid, tv: 0 }, secret, { subject: saUser._id, issuer: "mh-api", audience: "mh-admin", expiresIn: -10 }), path: "/api" });
r = await forge.call("GET", "/api/admin/users");
check("expired access token → 401 TOKEN_EXPIRED", r.body?.error?.code === "TOKEN_EXPIRED", S(r));
const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") + "." + Buffer.from(JSON.stringify({ sub: saUser._id, sid: saSid, tv: 0, iss: "mh-api", aud: "mh-admin" })).toString("base64url") + ".";
forge.jar.set("mh_at", { value: none, path: "/api" });
r = await forge.call("GET", "/api/admin/users");
check('"alg: none" token → 401 AUTH_INVALID', r.body?.error?.code === "AUTH_INVALID", S(r));
forge.jar.set("mh_at", { value: jwt.sign({ sid: saSid, tv: 0 }, "wrong-secret-wrong-secret-wrong-secret-xx", { subject: saUser._id, issuer: "mh-api", audience: "mh-admin", expiresIn: 600 }), path: "/api" });
r = await forge.call("GET", "/api/admin/users");
check("token signed with another secret → 401", r.status === 401, S(r));

// role change takes effect immediately
await mk.call("POST", "/api/auth/login", { email: "mkt@mh.test", password: "MitaNew2026" });
r = await sa.call("PATCH", `/api/admin/users/${mktId}`, { role: "opd_incharge" });
check("super admin changes marketer → opd_incharge", r.status === 200 && r.body.data.role === "opd_incharge", S(r));
r = await mk.call("GET", "/api/auth/me");
check("…their open session is revoked at once", r.status === 401 && r.body.error.code === "SESSION_REVOKED", S(r));
r = await sa.call("PATCH", `/api/admin/users/${saUser._id}`, { role: "opd_incharge" });
check("super admin can't demote self → 409", r.status === 409 && r.body.error.code === "SELF_CHANGE", S(r));
r = await sa.call("PATCH", `/api/admin/users/${mktId}`, { isActive: false, passwordHash: "x" });
check("unknown field in PATCH (passwordHash) → 400", r.status === 400, S(r));
r = await sa.call("PATCH", `/api/admin/users/${mktId}`, { isActive: false });
r = await mk.call("POST", "/api/auth/login", { email: "mkt@mh.test", password: "MitaNew2026" });
check("deactivated user can't sign in (generic 401)", r.status === 401 && r.body.error.code === "INVALID_CREDENTIALS", S(r));

// reset password by super admin unlocks locked account
const lockId = fakes.users.rows.find((u) => u.email === "lock@mh.test")._id;
r = await sa.call("POST", `/api/admin/users/${lockId}/reset-password`, { password: "Unlocked2026" });
check("reset password → 200, forced change", r.status === 200 && r.body.data.mustChangePassword, S(r));
r = await lc.call("POST", "/api/auth/login", { email: "lock@mh.test", password: "Unlocked2026" });
check("…locked user can sign in with the new temp password", r.status === 200, S(r));

// activity log
r = await sa.call("GET", "/api/admin/activity?action=auth.*&limit=100");
const actions = new Set(r.body.data.items.map((a) => a.action));
check("activity log has login / failed / locked / reuse / password change", ["auth.login", "auth.login_failed", "auth.login_locked", "auth.refresh_reuse", "auth.password_change"].every((a) => actions.has(a)), [...actions].join());
r = await sa.call("GET", "/api/admin/activity?entity=users&action=users.update");
check("role change logged with before/after", r.body.data.items.some((a) => a.changes?.role?.[0] === "marketer" && a.changes.role[1] === "opd_incharge"), S(r));
r = await sa.call("GET", "/api/admin/activity?action=$where");
check("activity filter injection → 400", r.status === 400, S(r));

// logout
r = await sa.call("POST", "/api/auth/logout");
check("logout → 200, cookies cleared", r.status === 200 && !sa.jar.has("mh_at") && !sa.jar.has("mh_rt"), S(r));
const replay = new Client();
replay.jar.set("mh_at", { value: atCookie.split(";")[0].slice(6), path: "/api" });
r = await replay.call("GET", "/api/auth/me");
check("stolen access cookie after logout → 401", r.status === 401 && r.body.error.code === "SESSION_REVOKED", S(r));

// public API still fine and unaffected by auth
r = await anon.call("GET", "/api/health");
check("public routes unaffected (health reachable)", r.status === 503 || r.status === 200, S(r));

server.close();
console.log(fails ? `\n✖ ${fails} failed` : "\n✔ all auth checks passed");
process.exit(fails ? 1 : 0);
