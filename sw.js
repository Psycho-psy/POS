const CACHE_NAME = "pos-v1";

// All resources to pre-cache on install
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./app.js",
  "./style.css",
  // Chart.js
  "https://cdn.jsdelivr.net/npm/chart.js",
  // Firebase SDKs
  "https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js",
  // Google Fonts CSS
  "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Space+Mono:wght@400;700&display=swap"
];

// ── Install: cache everything ──────────────────────────────
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cache local files with regular cache mode
      const local = PRECACHE_URLS.filter(u => u.startsWith("."));
      await cache.addAll(local);

      // Cache external CDN files with no-cors (opaque responses)
      const external = PRECACHE_URLS.filter(u => u.startsWith("http"));
      await Promise.allSettled(
        external.map(url =>
          fetch(url, { mode: "no-cors" })
            .then(res => cache.put(url, res))
            .catch(() => {}) // ignore if already offline during install
        )
      );
    })
  );
});

// ── Activate: remove old caches ───────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for app shell, network-first for Firestore ──
self.addEventListener("fetch", event => {
  const url = event.request.url;

  // Let Firestore API calls go straight to network (they handle their own offline queue)
  if (url.includes("firestore.googleapis.com") || url.includes("firebase.googleapis.com")) {
    return; // fall through to normal network fetch
  }

  // For Google Fonts actual font files — cache on first use
  if (url.includes("fonts.gstatic.com")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request, { mode: "no-cors" }).then(res => {
            cache.put(event.request, res.clone());
            return res;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Cache-first strategy for everything else (app shell + CDN scripts)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      // Not in cache — try network and cache the response
      return fetch(event.request).then(res => {
        if (!res || res.status !== 200) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      }).catch(() => {
        // Network failed and nothing cached — return offline page for HTML
        if (event.request.destination === "document") {
          return caches.match("./index.html");
        }
      });
    })
  );
});