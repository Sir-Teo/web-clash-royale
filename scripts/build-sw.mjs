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
for (const p of files) {
  hash.update(p);
  hash.update(await readFile(p));
}
const version = hash.digest("hex").slice(0, 12);
const urls = files.map((p) => "/" + p.slice(5));
const source = `const CACHE='browser-royale-${version}';const FILES=${JSON.stringify(urls)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('browser-royale-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));});
`;
await writeFile("dist/sw.js", source);
console.log(`Offline cache: ${files.length} files, version ${version}.`);
