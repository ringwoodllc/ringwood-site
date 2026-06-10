/* Ringwood service worker.
   Goal: make the app installable and resilient offline WITHOUT breaking the
   "push to main = instantly live" workflow. So:
   - HTML page loads: network-first (you always get the freshest deploy), with a
     cached copy as the offline fallback.
   - /api/* calls: network-only, with a clean offline JSON response on failure
     (never serve stale data).
   - Static assets (js, css, fonts, icons): stale-while-revalidate (fast, and
     they refresh themselves in the background).
   Bump VERSION to force every client to drop old caches. */
const VERSION = "rw-v1";
const STATIC = "rw-static-" + VERSION;
const PAGES = "rw-pages-" + VERSION;

// A small shell so the app opens even with no connection.
const PRECACHE = [
  "/app",
  "/manifest.json",
  "/client-color.js",
  "/whoami-badge.js",
  "/lightbox.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  // Cache each item on its own so one failure (e.g. an auth redirect) doesn't
  // abort the whole install.
  event.waitUntil(
    caches.open(STATIC).then((c) =>
      Promise.all(PRECACHE.map((u) => c.add(u).catch(function () {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never touch other origins (Supabase storage, Anthropic, fonts CDN handle
  // their own caching).
  if (url.origin !== self.location.origin) return;

  // Live data: network only. If offline, hand back a tidy JSON so the app's own
  // error handling shows a friendly message instead of breaking.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ ok: false, offline: true, error: "You appear to be offline." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        })
      )
    );
    return;
  }

  // Page loads: freshest deploy first, cached page if offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match("/app")))
    );
    return;
  }

  // Static assets: serve cached immediately, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(STATIC).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
