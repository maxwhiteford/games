const CACHE_VERSION = "2026-01-04-01"; // bump this every deploy (or inject at build-time)
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

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
    await self.clients.claim();
  })());
});

function isNetworkFirstAsset(url) {
  // Make the "app shell" update immediately when online
  if (url.pathname.endsWith(".js")) return true;
  if (url.pathname.endsWith(".css")) return true;

  // Optional: force HTML to be network-first too (helps refresh pick up new markup)
  if (url.pathname.endsWith(".html")) return true;

  // Optional: treat webmanifest as network-first so install metadata updates quickly
  if (url.pathname.endsWith(".webmanifest")) return true;

  return false;
}

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(req, { cache: "no-store" }); // avoid browser HTTP cache
    if (res && res.ok && res.type === "basic") {
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response("", { status: 504, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const cache = await caches.open(RUNTIME);

  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === "basic") {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, fallback to cached page
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const net = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(RUNTIME);
        cache.put(req, net.clone());
        return net;
      } catch {
        const cachedExact = await caches.match(req);
        if (cachedExact) return cachedExact;

        const cachedRoot = await caches.match("./index.html");
        return cachedRoot || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // Assets: network-first for JS/CSS/HTML/manifest, SWR for everything else
  if (isNetworkFirstAsset(url)) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});
