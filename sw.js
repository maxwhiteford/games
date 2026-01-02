const CACHE_VERSION = "v1";
const PRECACHE = `games-precache-${CACHE_VERSION}`;
const RUNTIME  = `games-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./common.css",
  "./common.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",

  // Sudoku
  "./sudoku/",
  "./sudoku/index.html",
  "./sudoku/styles.css",
  "./sudoku/app.js",

  // Nonogram
  "./nonogram/",
  "./nonogram/index.html",
  "./nonogram/styles.css",
  "./nonogram/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await cache.addAll(PRECACHE_URLS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => ![PRECACHE, RUNTIME].includes(k))
        .map(k => caches.delete(k))
    );
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: try network, fallback to cached page, then to cached root
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put(req, net.clone());
        return net;
      } catch {
        // Try exact match first (e.g. /sudoku/), else fallback to root
        const cachedExact = await caches.match(req);
        if (cachedExact) return cachedExact;

        const cachedRoot = await caches.match("./index.html");
        return cachedRoot || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // Asset: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") {
        const cache = await caches.open(RUNTIME);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
