const CACHE_NAME = "jp-study-cards-lite";
const APP_ASSETS = [
  "/",
  "/index.html",
  "/src/main.js",
  "/src/styles.css",
  "/manifest.webmanifest",
  "/data/index.json"
];

async function loadDeckPaths() {
  const response = await fetch("/data/index.json", { cache: "reload" });
  if (!response.ok) throw new Error("Failed to load data index: " + response.status);
  const index = await response.json();
  return Array.isArray(index.decks) ? index.decks.map((deck) => deck.path).filter(Boolean) : [];
}

async function resyncCache() {
  const cache = await caches.open(CACHE_NAME);
  const deckPaths = await loadDeckPaths();
  const urls = [...new Set([...APP_ASSETS, ...deckPaths])];
  await cache.addAll(urls.map((url) => new Request(url, { cache: "reload" })));
  return urls.length;
}

async function postResyncResult(event, payload) {
  const client = event.source?.id ? await self.clients.get(event.source.id) : null;
  client?.postMessage({ type: "RESYNC_CACHE_RESULT", ...payload });
}

self.addEventListener("install", (event) => {
  event.waitUntil(resyncCache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "RESYNC_CACHE") return;
  event.waitUntil(
    resyncCache()
      .then((count) => postResyncResult(event, { ok: true, count }))
      .catch((error) => postResyncResult(event, { ok: false, error: error.message }))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
