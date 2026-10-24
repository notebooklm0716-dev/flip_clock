const CACHE_NAME = "flip_clock-pwa-v1";
const CORE_ASSETS = ["./", "./index.html", "./manifest.json"];
const OPTIONAL_ASSETS = ["./icon.svg", "./icon-192x192.png", "./icon-512x512.png", "./apple-touch-icon.png", "./maskable-512x512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    for (const asset of OPTIONAL_ASSETS) {
      try { await cache.add(asset); } catch (error) { console.warn("Optional PWA asset not cached:", asset); }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("flip_clock-pwa-") && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(request)) ||
               (await caches.match("./index.html")) ||
               new Response("オフラインです。初回にオンラインでアプリを開いてキャッシュしてください。", {
                 status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
               });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return new Response("このファイルはオフラインキャッシュにありません。", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});