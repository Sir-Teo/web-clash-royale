import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  assets.push([
    base + p.slice(5),
    shortHash,
  ]);
}
const version = hash.digest("hex").slice(0, 12);
const source = `const CACHE = ${JSON.stringify(`browser-royale-${base}-${version}`)};
const PREFIX = ${JSON.stringify(`browser-royale-${base}-`)};
const FILES = ${JSON.stringify(assets)};
// Identical art can be present under several source names. Keep every URL
// available offline while fetching and storing its bytes just once.
const group = (path, hash) => hash + ':' + path.slice(path.lastIndexOf('.'));
const GROUPS = new Map();
for (const [path, hash] of FILES) {
  const id = group(path, hash);
  if (!GROUPS.has(id)) GROUPS.set(id, []);
  GROUPS.get(id).push(path);
}
const LOOKUP = new Map();
for (const [id, paths] of GROUPS) {
  const hash = id.slice(0, 12);
  const key = paths[0] + '?v=' + hash;
  for (const path of paths) LOOKUP.set(path, key);
}
const UNIQUE = FILES.filter(([path, hash]) => LOOKUP.get(path) === path + '?v=' + hash);

async function matchesLegacy(response, hash) {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    'SHA-256', await response.clone().arrayBuffer()));
  return Array.from(bytes.slice(0, 6), (byte) =>
    byte.toString(16).padStart(2, '0')).join('') === hash;
}

async function precache() {
  const cache = await caches.open(CACHE);
  const older = await Promise.all((await caches.keys())
    .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
    .map((name) => caches.open(name)));
  const oldByGroup = await Promise.all(older.map(async (previous) => {
    const entries = new Map();
    for (const request of await previous.keys()) {
      const url = new URL(request.url);
      const hash = url.searchParams.get('v');
      if (hash) entries.set(group(url.pathname, hash), request);
    }
    return entries;
  }));
  let cursor = 0;
  async function fill() {
    while (cursor < UNIQUE.length) {
      const [path, hash] = UNIQUE[cursor++];
      const key = LOOKUP.get(path);
      const id = group(path, hash);
      let saved;
      for (let i = 0; i < older.length; i++) {
        const previous = older[i];
        saved = await previous.match(key);
        if (saved) break;
        const versioned = oldByGroup[i].get(id);
        if (versioned) {
          saved = await previous.match(versioned);
          if (saved) break;
        }
        for (const alias of GROUPS.get(id)) {
          const legacy = await previous.match(alias);
          if (legacy && await matchesLegacy(legacy, hash)) {
            saved = legacy;
            break;
          }
        }
        if (saved) break;
      }
      if (saved) {
        await cache.put(key, saved);
      } else {
        const response = await fetch(key);
        if (!response.ok) throw new Error('Offline asset ' + path + ': ' + response.status);
        await cache.put(key, response);
      }
    }
  }
  try {
    await Promise.all(Array.from({length: 24}, fill));
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names
      .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() =>
      caches.open(CACHE).then((cache) => cache.match(LOOKUP.get(${JSON.stringify(base + "index.html")})))));
    return;
  }
  const key = LOOKUP.get(url.pathname);
  if (!key) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const saved = await cache.match(key);
    if (saved) return saved;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  }));
});
`;
await writeFile("dist/sw.js", source);
console.log(`Offline cache: ${files.length} URLs, ${contentGroups.size} unique files, ${(duplicateBytes / 1e6).toFixed(1)} MB of duplicate bytes omitted, version ${version}.`);
