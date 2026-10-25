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
// Worker behavior changes need a new cache even when application files do not.
hash.update(await readFile(new URL(import.meta.url)));
hash.update(
  await readFile(new URL("./lib/service-worker.mjs", import.meta.url)),
);
const base = process.env.VITE_BASE_PATH || "/";
const assets = [];
const contentHashes = new Map();
const contentGroups = new Set();
let duplicateBytes = 0;
for (const p of files) {
  const bytes = await readFile(p);
  hash.update(p);
  hash.update(bytes);
  const fullHash = createHash("sha256").update(bytes).digest("hex");
  const shortHash = fullHash.slice(0, 12);
  const priorHash = contentHashes.get(shortHash);
  if (priorHash && priorHash !== fullHash)
    throw new Error(`Offline cache hash collision for ${p}`);
  contentHashes.set(shortHash, fullHash);
  const contentGroup = `${shortHash}:${p.slice(p.lastIndexOf("."))}`;
  if (contentGroups.has(contentGroup)) duplicateBytes += bytes.length;
  else contentGroups.add(contentGroup);
  assets.push([base + p.slice(5), shortHash]);
}
const version = hash.digest("hex").slice(0, 12);
const source = serviceWorkerSource({ base, version, files: assets });
await writeFile("dist/sw.js", source);
console.log(
  `Offline cache: ${files.length} URLs, ${contentGroups.size} unique files, ${(duplicateBytes / 1e6).toFixed(1)} MB of duplicate bytes omitted, version ${version}.`,
);
