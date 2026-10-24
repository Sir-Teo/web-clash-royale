import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { serviceWorkerSource } from "./lib/service-worker.mjs";
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? walk(`${path}/${e.name}`) : `${path}/${e.name}`,
      ),
    )
  ).flat();
}
const files = (await walk("dist")).filter((p) => !p.endsWith("/sw.js")).sort();
const hash = createHash("sha256");
for (const p of files) {
  hash.update(p);
  hash.update(await readFile(p));
}
const version = hash.digest("hex").slice(0, 12);
const base = process.env.VITE_BASE_PATH || "/";
const urls = files.map((p) => base + p.slice(5));
const source = serviceWorkerSource({ base, version, files: urls });
await writeFile("dist/sw.js", source);
console.log(`Offline cache: ${files.length} files, version ${version}.`);
