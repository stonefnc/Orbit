/*
 * Orbit's service worker: the APP SHELL only, so the installed app opens fast and the page frame still shows without a
 * connection. It never touches live data: /api/*, other websites (map tiles, TLE feeds, cameras, ...), non-GET requests and
 * websockets all go straight to the network, so a layer can never show stale data from here.
 *
 *  - page (navigation): network first, the saved copy only when the network fails;
 *  - /assets/* (hashed build files): saved on first use, served from the saved copy (the name changes with the content);
 *  - /cesium/* (the globe library and its workers): saved on first use, served at once and refreshed in the background;
 *  - the manifest and icons: saved at install.
 * Bump CACHE when this file's rules change; older caches are deleted on activate.
 */
const CACHE = "orbit-shell-v1";
const PRECACHE = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("orbit-shell-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/** Path of `url` below this worker's own folder ("assets/index-abc.js"), or null for another website. */
function ownPath(url) {
  const base = new URL(self.registration.scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
  return url.pathname.slice(base.pathname.length);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    const saved = (await cache.match(request)) || (await cache.match("./"));
    if (saved) return saved;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const fresh = await fetch(request);
  if (fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  const refresh = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => undefined);
  return saved || (await refresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const path = ownPath(url);
  if (path === null || path.startsWith("api/")) return; // other websites and the live-data API: never handled here
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  } else if (path.startsWith("assets/")) {
    event.respondWith(cacheFirst(request));
  } else if (path.startsWith("cesium/")) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (PRECACHE.includes(path)) {
    event.respondWith(cacheFirst(request));
  }
  // everything else (data files, proxies, the dev server's modules) goes to the network untouched
});
