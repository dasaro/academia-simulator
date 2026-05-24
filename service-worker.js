// Simple service worker for offline-capable PWA.
//
// Strategy:
//   - App shell (HTML/CSS/JS) → cache-first. The cache name is versioned, so
//     updating CACHE_VERSION invalidates the old shell on next load.
//   - Game data (JSON under /data/game/) → network-first with cache fallback.
//     This lets the player still play offline while ensuring version bumps to
//     the data are picked up while online.
//   - Everything else → network with passive cache fill.

const CACHE_VERSION = "academiasim-v9.17-anchorfix";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/main.css",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin GETs
  if (event.request.method !== "GET" || url.origin !== location.origin) return;

  // Game data: network-first so updates land while online.
  if (url.pathname.includes("/data/game/")) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(event.request, copy));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell + everything else: cache-first.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (!resp || resp.status !== 200) return resp;
        const copy = resp.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(event.request, copy));
        return resp;
      });
    })
  );
});
