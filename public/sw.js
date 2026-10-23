const CACHE = "comik-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("comik-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/")) || Response.error()));
    return;
  }

  if (!["script", "style", "font"].includes(request.destination)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    } catch {
      return cached || Response.error();
    }
  })());
});