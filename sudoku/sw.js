/* PWA Service Worker for Sudoku
   - Precache app shell
   - Offline-first for navigation (serve index.html)
   - Cache-first for static assets
*/

const CACHE_VERSION = "v1";
const PRECACHE_NAME = `sudoku-precache-${CACHE_VERSION}`;
const RUNTIME_NAME  = `sudoku-runtime-${CACHE_VERSION}`;

// Add every file needed for the app to run offline.
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Clean old caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![PRECACHE_NAME, RUNTIME_NAME].includes(k))
        .map((k) => caches.delete(k))
    );
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Ignore non-GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigations: offline-first => index.html fallback
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // Try network first to keep updates fast when online
        const network = await fetch(req);
        const cache = await caches.open(RUNTIME_NAME);
        cache.put(req, network.clone());
        return network;
      } catch {
        // Offline => return cached index.html (app shell)
        const cached = await caches.match("./index.html");
        return cached || new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  // Static assets: cache-first, then network
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // Cache successful basic responses
      if (res && res.ok && res.type === "basic") {
        const cache = await caches.open(RUNTIME_NAME);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      // If it's an asset and we're offline, fail gracefully
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
