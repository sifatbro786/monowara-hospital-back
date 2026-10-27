/**
 * NoSQL-injection guard for request bodies and params: drops keys that start with "$" or contain ".",
 * at any depth (e.g. { "email": { "$ne": null } } → { "email": {} }, which zod then rejects).
 * `express-mongo-sanitize` can't be used: it reassigns req.query, a getter-only property in Express 5.
 * req.query needs no pass here: Express 5's "simple" parser never builds nested objects, and every
 * route validates its query with zod (strings only).
 */
const isUnsafeKey = (k) => k.startsWith("$") || k.includes(".");

function clean(value, depth = 0) {
    if (depth > 20) return undefined; // pathological nesting
    if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (isUnsafeKey(k) || k === "__proto__" || k === "constructor" || k === "prototype") continue;
            out[k] = clean(v, depth + 1);
        }
        return out;
    }
    return value;
}

export function sanitizeInput(req, _res, next) {
    if (req.body && typeof req.body === "object") req.body = clean(req.body);
    if (req.params) for (const k of Object.keys(req.params)) if (isUnsafeKey(k)) delete req.params[k];
    next();
}
