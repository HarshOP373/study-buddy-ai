const CACHE_NAME = 'kinstudy-offline-v20';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './study-data.json',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.78/+esm'
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

  // Hugging Face weights and API keys are fetched directly without service worker interception
  if (
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('cdn-lfs') ||
    url.hostname.includes('googleapis.com')
  ) {
    return;
  }

  // Auto-cache all WebLLM CDN sub-chunks dynamically so offline never fails
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('esm.run')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (e) {
          return cached || new Response('Offline script missing', { status: 404 });
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Network offline', {
          status: 408,
          headers: { 'Content-Type': 'text/plain' },
        });
      });
    })
  );
});
