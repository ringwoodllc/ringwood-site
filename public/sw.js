/* Ringwood service worker.
   Priority: "push to main = instantly live." So EVERYTHING same-origin is
   network-first — pages and scripts always come fresh when you're online, and
   the cache is only a fallback when you're offline. /api is network-only.
   Bump VERSION to force every client to drop old caches. */
const VERSION = "rw-v187";
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

  // Everything else (pages, scripts, styles, icons): network-first so a deploy
  // shows immediately; fall back to cache only when the network fails (offline).
  // cache:"no-store" bypasses the browser's HTTP cache so a freshly deployed
  // page/script always wins (the installed app was serving stale HTML otherwise).
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((m) => m || (req.mode === "navigate" ? caches.match("/app") : undefined))
      )
  );
});
