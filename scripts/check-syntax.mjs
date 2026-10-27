// esbuild syntax check of every source file (fast, no bundling) — run before every handoff.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";

const roots = ["src", "scripts"];
const files = [];
async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(m?js)$/.test(e.name)) files.push(p);
    }
}
for (const r of roots) await walk(r);

let failed = 0;
for (const f of files) {
    try {
        await transform(await readFile(f, "utf8"), { loader: "js", format: "esm", target: "node22", sourcefile: f });
    } catch (err) {
        failed++;
        console.error(err.message);
    }
}
console.log(failed ? `✖ ${failed}/${files.length} files failed` : `✔ ${files.length} files OK`);
process.exit(failed ? 1 : 0);
