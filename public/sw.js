// Precaches the full app shell so Monsters of the Deep loads and plays with no
// network at all. The game server replaces __BUILD_ID__ with a fingerprint of
// the served files, so every deploy installs a fresh worker and precache. Bump
// the v-number only when serving from a host that doesn't do that.
const CACHE_VERSION = "motd-v11-__BUILD_ID__";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/styles.css",
  "/client.js",
  "/client/creatures.js",
  "/client/dom.js",
  "/client/entities.js",
  "/client/globe.js",
  "/client/hover.js",
  "/client/hud.js",
  "/client/input.js",
  "/client/menu.js",
  "/client/network.js",
  "/client/render.js",
  "/client/speciesLog.js",
  "/client/state.js",
  "/client/util.js",
  "/localGame.js",
  "/manifest.webmanifest",
  "/assets/icon.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-512-maskable.png",
  "/assets/creatures/scary-creature-atlas.png",
  "/assets/creatures/el-gram-maga-frames.png",
  "/shared/creatureCatalog.js",
  "/shared/speciesCatalog.js",
  "/shared/geography.js",
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

  // Code and pages are network-first: online players always run the code the
  // server speaks, and the cache is the offline fallback (a slow network gets
  // NETWORK_TIMEOUT_MS before the cached copy is used). Cache-first used to
  // run the previous deploy's client against the new server for one load.
  // Big images barely change, so they stay stale-while-revalidate.
  if (request.destination === "image") {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetchAndCache(request).catch(() => cached);
        return cached ?? networkFetch;
      })
    );
    return;
  }
  event.respondWith(networkFirst(request));
});

const NETWORK_TIMEOUT_MS = 4000;

function networkFirst(request) {
  const network = fetchAndCache(request);
  const fallback = () =>
    caches.match(request).then((cached) => cached ?? (request.mode === "navigate" ? caches.match("/index.html") : undefined));
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS);
  });
  return Promise.race([network.catch(() => null), timeout]).then(
    (response) => response ?? fallback().then((cached) => cached ?? network)
  );
}

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}
