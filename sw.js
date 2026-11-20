// Offline support. App files are served from the cache at once.
//
// Bump VERSION with every change to the app files. The browser then installs
// this worker again with the new files, and the page reloads into them
// (see the controllerchange handler in js/app.js).
const VERSION = 'v4';
const PREFIX = 'doczytania-app-';
const APP_CACHE = `${PREFIX}${VERSION}`;
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'js/app.js',
  'js/reader.js',
  'js/store.js',
  'js/sync.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      // 'reload' skips the HTTP cache, which could still hold the old files.
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// Other apps on the same site (gchrupala.github.io) share the cache
// storage, so only old caches of this app go. The caches of PDF files and
// texts (doczytania-files, -texts, -share, see js/app.js) stay.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pages opened with parameters (?url=… from sharing) are all the same page:
// they are served and stored as './', so the cache does not grow per link.
async function staleWhileRevalidate(request, key) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  return (await network) || Response.error();
}

// Sharing from other apps (share_target in the manifest) posts the form
// here. A file is kept in the cache and the page opens with ?file=<key>; a
// link goes on as ?url=&title=&text=, as from the bookmarklet.
const SHARE_CACHE = 'doczytania-share';

async function receiveShare(request) {
  const scope = self.registration.scope;
  try {
    const form = await request.formData();
    const file = form.getAll('file').find((f) => typeof f === 'object' && f.size > 0);
    if (file) {
      const key = `${Date.now()}`;
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        new URL(`shared/${key}`, scope).href,
        new Response(file, {
          headers: { 'Content-Type': file.type || 'application/pdf', 'X-File-Name': encodeURIComponent(file.name || '') },
        }),
      );
      return Response.redirect(`${scope}?file=${key}`, 303);
    }
    const params = new URLSearchParams();
    for (const k of ['url', 'title', 'text']) {
      const v = form.get(k);
      if (typeof v === 'string' && v) params.set(k, v);
    }
    return Response.redirect(`${scope}?${params}`, 303);
  } catch {
    return Response.redirect(scope, 303);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method === 'POST' && new URL(request.url).href === new URL('share', self.registration.scope).href) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const key = request.mode === 'navigate' ? new URL('./', self.registration.scope).href : request;
  event.respondWith(staleWhileRevalidate(request, key));
});
