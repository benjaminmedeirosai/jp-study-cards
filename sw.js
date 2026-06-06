const APP_VERSION = "app-v22";
const DATA_CACHE_NAME = "jp-study-cards-data";

function isDataRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname.startsWith("/data/");
}

async function loadDeckPaths() {
  const response = await fetch("/data/index.json", { cache: "reload" });
  if (!response.ok) throw new Error("Failed to load data index: " + response.status);
  const index = await response.json();
  return {
    version: String(index.version || index.generatedAt || "data-unknown"),
    paths: Array.isArray(index.decks) ? index.decks.map((deck) => deck.path).filter(Boolean) : []
  };
}

async function resyncDataCache() {
  const cache = await caches.open(DATA_CACHE_NAME);
  const data = await loadDeckPaths();
  const urls = [...new Set(["/data/index.json", ...data.paths])];
  await cache.addAll(urls.map((url) => new Request(url, { cache: "reload" })));
  return { count: urls.length, dataVersion: data.version };
}

async function postResyncResult(event, payload) {
  const client = event.source?.id ? await self.clients.get(event.source.id) : null;
  client?.postMessage({ type: "RESYNC_CACHE_RESULT", ...payload });
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("jp-study-cards-app-") || key.startsWith("jp-study-cards-lite")).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({
      type: "VERSION_RESULT",
      requestId: event.data.requestId,
      version: APP_VERSION,
      dataCacheName: DATA_CACHE_NAME
    });
    return;
  }
  if (event.data?.type !== "RESYNC_CACHE") return;
  event.waitUntil(
    resyncDataCache()
      .then((result) => postResyncResult(event, { ok: true, ...result }))
      .catch((error) => postResyncResult(event, { ok: false, error: error.message }))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (isDataRequest(event.request)) {
    event.respondWith(
      caches.open(DATA_CACHE_NAME)
        .then((cache) => {
          if (event.request.cache === "reload") {
            return fetch(event.request).then(async (response) => {
              if (response.ok) await cache.put(event.request, response.clone());
              return response;
            });
          }
          return cache.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => {
            if (response.ok) await cache.put(event.request, response.clone());
            return response;
          }));
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});
