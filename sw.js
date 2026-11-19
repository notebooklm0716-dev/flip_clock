const CACHE_NAME = "flip_clock-pwa-v3";
const CACHE_PREFIX = "flip_clock-pwa-";
const CORE_ASSETS = ["./", "./index.html", "./manifest.json"];
const OPTIONAL_ASSETS = ["./icon.svg", "./icon-192x192.png", "./icon-512x512.png", "./apple-touch-icon.png", "./maskable-512x512.png", "./favicon.ico"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    for (const asset of OPTIONAL_ASSETS) {
      try { await cache.add(asset); } catch (error) { console.warn("Optional PWA asset not cached:", asset); }
    }
    // index.html が参照しているファイル(CDNのJS/CSS・Webフォント・画像など)も
    // 初回のうちに保存しておく。これで「1回開けばオフラインでも起動できる」ようになる
    await precacheReferencedAssets(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// 1件だけキャッシュに保存する(失敗しても全体は止めない)
async function cacheOne(cache, url) {
  if (await cache.match(url)) return;
  try {
    await cache.add(url);
  } catch (_) {
    // CORSで取得できない場合は opaque 応答として保存を試みる
    try { await cache.add(new Request(url, { mode: "no-cors" })); } catch (error) { /* 保存できなくても続行 */ }
  }
}

// index.html 内の src / href をたどって、参照先を先読み保存する
async function precacheReferencedAssets(cache) {
  let html = "";
  try {
    const res = (await cache.match("./index.html")) || (await fetch("./index.html"));
    html = await res.text();
  } catch (_) {
    return;
  }
  const urls = new Set();
  const re = /(?:src|href)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const ref = m[1];
    if (/^(data:|blob:|#|mailto:|javascript:)/i.test(ref)) continue;
    try { urls.add(new URL(ref, self.registration.scope).href); } catch (_) { /* URLとして解釈できなければ無視 */ }
  }
  for (const url of urls) {
    await cacheOne(cache, url);
    // CSSファイルなら、中で参照しているフォント等の url(...) も保存する
    try {
      const cached = await cache.match(url);
      const type = cached ? (cached.headers.get("Content-Type") || "") : "";
      if (cached && (type.includes("text/css") || url.split("?")[0].endsWith(".css"))) {
        const css = await cached.clone().text();
        const urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
        let um;
        while ((um = urlRe.exec(css)) !== null) {
          const ref = um[1];
          if (/^(data:|#)/i.test(ref)) continue;
          try { await cacheOne(cache, new URL(ref, url).href); } catch (_) { /* 解釈できなければ無視 */ }
        }
      }
    } catch (_) { /* CSSとして読めなければ無視 */ }
  }
}

// キャッシュに入れてよい応答か(通常の200、またはCDN等のopaque応答)
function isCacheable(response) {
  return response && (response.status === 200 || response.type === "opaque");
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  // Chromeの仕様回避: only-if-cached かつ別オリジンの要求は扱わない
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  const url = new URL(request.url);

  // ページ遷移: ネットワーク優先、失敗したらキャッシュ(オフライン起動)
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

  // 同一オリジンのファイル: キャッシュ優先、無ければ取得して保存
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (isCacheable(response)) {
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
    return;
  }

  // 別オリジン(CDNライブラリ・Webフォント等): キャッシュ優先で返し、裏で最新化する
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const networkPromise = fetch(request).then(response => {
      if (isCacheable(response)) {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(networkPromise);
      return cached;
    }
    const response = await networkPromise;
    if (response) return response;
    return new Response("このファイルはオフラインキャッシュにありません。", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  })());
});
