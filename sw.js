const CACHE_NAME = 'kinstudy-pwa-v1';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Do NOT cache model weights or API requests
  if (url.hostname.includes('huggingface.co') || url.hostname.includes('googleapis.com') || url.hostname.includes('esm.run')) return;
  
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
