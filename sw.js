const CACHE_NAME = 'kinstudy-offline-v2';

// The basic UI files needed to load the app offline
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// 1. Install Phase: Cache the UI files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 2. Activate Phase: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// 3. Fetch Phase: Serve UI from cache, bypass models
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CRITICAL BYPASS: Do not let the Service Worker cache large AI weights.
  // Transformers.js and WebLLM handle their own storage via IndexedDB.
  if (
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('hf.co') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('esm.run') ||
    url.pathname.endsWith('.onnx') ||
    url.pathname.endsWith('.wasm') ||
    url.pathname.endsWith('.bin') ||
    url.hostname.includes('googleapis.com')
  ) {
    return; // Let the browser handle these natively
  }

  // Serve static UI files from the cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    }).catch(() => {
      // If offline and file isn't cached, do nothing (prevents crashes)
    })
  );
});
