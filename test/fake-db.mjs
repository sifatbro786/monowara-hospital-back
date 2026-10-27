// In-memory MongoDB driver stand-in for tests (sift filters, $set/$inc/$unset, unique keys).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const req = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const sift = req("sift").default ?? req("sift");
export function installFakeDb(mongoose) {

const UNIQUE = { users: ["email"], departments: ["slug"], doctors: ["slug"] };
const get = (o, p) => p.split(".").reduce((v, k) => v?.[k], o);
function setPath(o, p, v) {
    const ks = p.split(".");
    const last = ks.pop();
    const t = ks.reduce((x, k) => (x[k] ??= {}), o);
    t[last] = v;
}
function unsetPath(o, p) {
    const ks = p.split(".");
    const last = ks.pop();
    const t = ks.reduce((x, k) => x?.[k], o);
    if (t) delete t[last];
}
function project(doc, proj) {
    if (!proj || !Object.keys(proj).length) return structuredClone(doc);
    const vals = Object.values(proj);
    if (vals.every((v) => !v)) {
        const out = structuredClone(doc);
        for (const p of Object.keys(proj)) unsetPath(out, p);
        return out;
    }
    const out = { _id: doc._id };
    for (const [p, v] of Object.entries(proj)) if (v && get(doc, p) !== undefined) setPath(out, p, structuredClone(get(doc, p)));
    if (proj._id === 0) delete out._id;
    return out;
}
const cmp = (sort) => (a, b) => {
    for (const [k, d] of Object.entries(sort || {})) {
        const x = get(a, k), y = get(b, k);
        if (x < y) return -d;
        if (x > y) return d;
    }
    return 0;
};
function applyUpdate(doc, upd) {
    const ops = Object.keys(upd).some((k) => k.startsWith("$")) ? upd : { $set: upd };
    for (const [op, fields] of Object.entries(ops)) {
        for (const [p, v] of Object.entries(fields)) {
            if (op === "$set") setPath(doc, p, structuredClone(v));
            else if (op === "$inc") setPath(doc, p, (get(doc, p) ?? 0) + v);
            else if (op === "$unset") unsetPath(doc, p);
            else if (op === "$setOnInsert") {
            } else throw new Error(`fake: unsupported ${op}`);
        }
    }
}
class FakeCollection {
    constructor(name) {
        this.name = name;
        this.rows = [];
    }
    checkUnique(doc, selfId) {
        for (const f of UNIQUE[this.name] || []) {
            if (this.rows.some((r) => r._id !== selfId && get(r, f) === get(doc, f))) {
                const e = new Error(`E11000 duplicate key ${f}`);
                e.code = 11000;
                e.keyValue = { [f]: get(doc, f) };
                throw e;
            }
        }
    }
    match(filter) {
        return this.rows.filter(sift(filter || {}));
    }
    async insertOne(doc) {
        this.checkUnique(doc);
        this.rows.push(structuredClone(doc));
        return { acknowledged: true, insertedId: doc._id };
    }
    async insertMany(docs) {
        for (const d of docs) await this.insertOne(d);
        return { acknowledged: true, insertedCount: docs.length };
    }
    async findOne(filter, opts = {}) {
        let r = this.match(filter);
        if (opts.sort) r = r.sort(cmp(opts.sort));
        return r[0] ? project(r[0], opts.projection) : null;
    }
    find(filter, opts = {}) {
        const self = this;
        return {
            async toArray() {
                let r = self.match(filter).sort(cmp(opts.sort));
                if (opts.skip) r = r.slice(opts.skip);
                if (opts.limit) r = r.slice(0, opts.limit);
                return r.map((d) => project(d, opts.projection));
            },
        };
    }
    async countDocuments(filter) {
        return this.match(filter).length;
    }
    async estimatedDocumentCount() {
        return this.rows.length;
    }
    async updateOne(filter, upd, opts = {}) {
        const d = this.match(filter)[0];
        if (!d && opts.upsert) {
            // upsert: equality fields of the filter + $setOnInsert + the update itself
            const doc = Object.fromEntries(Object.entries(filter).filter(([k, v]) => !k.startsWith("$") && (v === null || typeof v !== "object")));
            Object.assign(doc, upd.$setOnInsert ?? {});
            applyUpdate(doc, upd);
            await this.insertOne(doc);
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        if (!d) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        const copy = structuredClone(d);
        applyUpdate(copy, upd);
        this.checkUnique(copy, d._id);
        Object.assign(d, copy);
        for (const k of Object.keys(d)) if (!(k in copy)) delete d[k];
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    }
    async updateMany(filter, upd) {
        const ds = this.match(filter);
        for (const d of ds) applyUpdate(d, upd);
        return { acknowledged: true, matchedCount: ds.length, modifiedCount: ds.length };
    }
    async findOneAndUpdate(filter, upd, opts = {}) {
        const d = this.match(filter)[0];
        if (!d) return opts.includeResultMetadata ? { value: null, ok: 1 } : null;
        const before = structuredClone(d);
        applyUpdate(d, upd);
        const out = project(opts.returnDocument === "after" ? d : before, opts.projection);
        return opts.includeResultMetadata ? { value: out, ok: 1, lastErrorObject: { updatedExisting: true } } : out;
    }
    async deleteOne(filter) {
        const d = this.match(filter)[0];
        if (!d) return { acknowledged: true, deletedCount: 0 };
        this.rows = this.rows.filter((r) => r !== d);
        return { acknowledged: true, deletedCount: 1 };
    }
    async deleteMany(filter) {
        const keep = this.rows.filter((r) => !sift(filter || {})(r));
        const n = this.rows.length - keep.length;
        this.rows = keep;
        return { acknowledged: true, deletedCount: n };
    }
}
const fakes = {};
for (const name of mongoose.modelNames()) {
    const Model = mongoose.model(name);
    const fc = (fakes[Model.collection.name] ??= new FakeCollection(Model.collection.name));
    Model.collection.collection = new Proxy(fc, {
        get(t, k) {
            if (k in t) return typeof t[k] === "function" ? t[k].bind(t) : t[k];
            return () => {
                throw new Error(`fake: ${String(k)} not implemented (${t.name})`);
            };
        },
    });
    Model.collection.buffer = false;
    Model.collection._shouldBufferCommands = () => false;
}


return fakes;
}
