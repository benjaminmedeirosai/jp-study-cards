const DATA_CACHE_NAME = "jp-study-cards-data";

function isDataRequest(request) {
  const url = new URL(request.url);
  // Match the /data/ segment anywhere so it works whether the app is served
  // from the domain root or a project subpath (e.g. /jp-study-cards/).
  return url.origin === self.location.origin && url.pathname.includes("/data/");
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

// Cache-first for the card data so it stays available offline once visited.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !isDataRequest(event.request)) return;
  event.respondWith(
    caches.open(DATA_CACHE_NAME)
      .then((cache) => cache.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => {
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      })))
      .catch(() => caches.match(event.request))
  );
});
