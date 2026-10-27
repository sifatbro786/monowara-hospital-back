import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";

export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);
export const PRIVATE_ROOT = path.resolve(env.PRIVATE_DIR);

/** "Dr. Nasima Begum (1).JPG" → "dr-nasima-begum-1" (ascii, ≤ 50 chars, never empty). */
export function safeBase(original) {
    const base = path
        .parse(String(original || ""))
        .name.normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50);
    return base || "file";
}

export const randomTag = (bytes = 4) => randomBytes(bytes).toString("hex");

/** Resolve a stored relative name inside a root; throws on anything that escapes it. */
export function within(root, ...parts) {
    const full = path.resolve(root, ...parts);
    if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Path escapes storage root");
    return full;
}

/** Write via a temp file + rename, so a half-written file is never served. */
export async function atomicWrite(fullPath, buffer) {
    await mkdir(path.dirname(fullPath), { recursive: true });
    const tmp = `${fullPath}.${randomTag()}.tmp`;
    await writeFile(tmp, buffer, { flag: "wx" });
    await rename(tmp, fullPath);
}

/** Excel/CSV formula injection guard: a cell starting with = + - @ (or tab/CR) is shown as text. */
export const safeCell = (v) => {
    if (v == null) return "";
    if (v instanceof Date || typeof v === "number" || typeof v === "boolean") return v;
    const s = String(v);
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
