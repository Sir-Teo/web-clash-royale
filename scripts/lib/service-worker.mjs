export function serviceWorkerSource({ base, version, files }) {
  const prefix = `browser-royale-${base}-`;
  return `const CACHE = ${JSON.stringify(prefix + version)};
const PREFIX = ${JSON.stringify(prefix)};
const FILES = ${JSON.stringify(files)};
const SHELL = ${JSON.stringify(base + "index.html")};

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))))
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
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(cache => {
    // Keep the shell and its assets on the same release until the waiting
    // worker activates. Fetching new HTML here mixes it with old public JSON.
    const key = event.request.mode === 'navigate' ? SHELL : event.request;
    return cache.match(key, { ignoreVary: true }).then(hit => hit || fetch(event.request));
  }));
});
`;
}
