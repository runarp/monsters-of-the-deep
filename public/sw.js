// Precaches the full app shell so Monsters of the Deep loads and plays with no
// network at all. Bump CACHE_VERSION whenever the cached asset list changes.
const CACHE_VERSION = "motd-v1";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/styles.css",
  "/client.js",
  "/localGame.js",
  "/manifest.webmanifest",
  "/assets/icon.svg",
  "/assets/creatures/scary-creature-atlas.png",
  "/assets/creatures/el-gram-maga-frames.png",
  "/shared/creatureCatalog.js",
  "/shared/gameWorld.js",
  "/shared/math.js",
  "/shared/random.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Stale-while-revalidate: serve the cached copy instantly (works offline),
  // and refresh it in the background when the network is available.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetchAndCache(request).catch(() => cached ?? caches.match("/index.html"));
      return cached ?? networkFetch;
    })
  );
});

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}
