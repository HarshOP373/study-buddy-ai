/* sw.js — KinStudy Pro Service Worker */

const CACHE_NAME = "kinstudy-shell-v3";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./study-data.json",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Cache each file independently so one missing file doesn't
    // prevent the remaining app shell from being stored.
    await Promise.all(
      APP_FILES.map(async path => {
        try {
          const response = await fetch(path, { cache: "reload" });

          if (response.ok && response.type !== "opaque") {
            await cache.put(path, response);
          }
        } catch (error) {
          console.warn("Could not cache:", path, error);
        }
      })
    );

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key => key.startsWith("kinstudy-shell-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache API calls or external AI/model downloads in the
  // app-shell cache. WebLLM manages its own model storage.
  if (url.origin !== self.location.origin) return;

  // App navigation: use the network when possible, then fall back
  // to the cached app shell when offline.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);

        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("./index.html", response.clone());
        }

        return response;
      } catch {
        return (
          await caches.match(request) ||
          await caches.match("./index.html") ||
          new Response("KinStudy is unavailable offline. Open it online once first.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })
        );
      }
    })());

    return;
  }

  // For local app assets, prefer the cache and refresh in the
  // background when online.
  event.respondWith((async () => {
    const cached = await caches.match(request);

    const networkRequest = fetch(request)
      .then(async response => {
        if (response.ok && response.type !== "opaque") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }

        return response;
      });

    if (cached) {
      event.waitUntil(networkRequest.catch(() => {}));
      return cached;
    }

    try {
      return await networkRequest;
    } catch {
      return new Response("This resource is not available offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
