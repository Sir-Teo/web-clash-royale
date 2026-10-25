export function serviceWorkerSource({ base, version, files }) {
  const prefix = `browser-royale-${base}-`;
  return `const CACHE = ${JSON.stringify(prefix + version)};
const PREFIX = ${JSON.stringify(prefix)};
const FILES = ${JSON.stringify(files)};
// Identical art can be present under several source names. Keep every URL
// available offline while fetching and storing its bytes just once.
const group = (path, hash) => hash ? hash + ':' + path.slice(path.lastIndexOf('.')) : path;
const GROUPS = new Map();
for (const entry of FILES) {
  const [path, hash] = Array.isArray(entry) ? entry : [entry, null];
  const id = group(path, hash);
  if (!GROUPS.has(id)) GROUPS.set(id, []);
  GROUPS.get(id).push(path);
}
const LOOKUP = new Map();
for (const [id, paths] of GROUPS) {
  const first = FILES.find((entry) => Array.isArray(entry) && entry[0] === paths[0]);
  const hash = first?.[1];
  const key = paths[0] + (hash ? '?v=' + hash : '');
  for (const path of paths) LOOKUP.set(path, key);
}
const UNIQUE = FILES.map((entry) => Array.isArray(entry) ? entry : [entry, null])
  .filter(([path, hash]) => LOOKUP.get(path) === path + (hash ? '?v=' + hash : ''));

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
      // Unhashed callers must fetch fresh bytes; path equality cannot prove content.
      for (let i = 0; hash && i < older.length; i++) {
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
          if (legacy && hash && await matchesLegacy(legacy, hash)) {
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
  event.waitUntil(precache());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names
      .filter((name) => name.startsWith(PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'ACTIVATE_UPDATE' || !event.source?.id) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const windows = clients.filter(client => client.url.startsWith(self.registration.scope));
    if (windows.length === 1 && windows[0].id === event.source.id) return self.skipWaiting();
    event.source.postMessage({ type: 'UPDATE_BLOCKED' });
  }));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // The cached shell belongs to this worker's release, including late workers
  // and public JSON. Keep it until the user deliberately activates an update.
  const path = event.request.mode === 'navigate' ? ${JSON.stringify(base + "index.html")} : url.pathname;
  const key = LOOKUP.get(path);
  if (!key) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const saved = await cache.match(key, { ignoreVary: true });
    if (saved) return saved;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  }));
});
`;
}
