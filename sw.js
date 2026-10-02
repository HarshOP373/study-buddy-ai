/**
 * KinStudy Service Worker
 * Ensures offline shell caching while bypassing large WebGPU ONNX weights & CDNs
 */

const CACHE_NAME = 'kinstudy-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CRITICAL: Bypass caching for large ONNX weights, WebGPU binaries, and external pipelines
  if (
    url.hostname.includes('huggingface.co') ||
    url.hostname.includes('hf.co') ||
    url.hostname.includes('jsdelivr.net') ||
    url.pathname.endsWith('.onnx') ||
    url.pathname.endsWith('.bin') ||
    url.pathname.endsWith('.wasm') ||
    url.hostname.includes('googleapis.com')
  ) {
    return; // Pass through directly to native network
  }

  // Cache-first fallback for local static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request);
    })
  );
});
