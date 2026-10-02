const CACHE_NAME = 'study-buddy-cache-v3';

// Pre-cache all local assets so offline mode works with Airplane Mode enabled
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './study-data.json',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Let model weights, huggingface, and WebLLM CDN bypass the service worker directly
  if (
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('cdn-lfs') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('esm.run') ||
    url.hostname.includes('jsdelivr.net')
  ) {
    return; // Let browser fetch natively without service worker interception
  }

  // Cache-first strategy with safe fallback to prevent "TypeError: Load failed"
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Return offline fallback or empty response instead of crashing
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Network error occurred', {
          status: 408,
          headers: { 'Content-Type': 'text/plain' },
        });
      });
    })
  );
});
