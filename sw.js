/**
 * KinStudy - Production Service Worker
 * Precaches index.html, style.css, app.js, and study-data.json
 * Enables 100% offline functionality on iPad under Airplane Mode.
 */

const CACHE_NAME = 'kinstudy-offline-v2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './study-data.json',
  './manifest.json',
  './icon.svg'
];

// External library assets to cache for offline WebLLM and typography
const EXTERNAL_ASSETS = [
  'https://esm.run/@mlc-ai/web-llm',
  'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Precaching static assets for offline use...');
      
      // Cache core assets
      try {
        await cache.addAll(STATIC_ASSETS);
      } catch (err) {
        console.warn('[SW] Could not precache all static assets directly:', err);
      }

      // Precache external fonts and libraries if online
      for (const url of EXTERNAL_ASSETS) {
        try {
          const req = new Request(url, { mode: 'cors' });
          const res = await fetch(req);
          if (res && res.ok) {
            await cache.put(req, res);
          }
        } catch (e) {
          // Ignore network errors during install phase
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith('kinstudy-')) {
            console.log('[SW] Cleaning old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. NEVER cache live Gemini API queries
  if (url.hostname.includes('generativelanguage.googleapis.com')) {
    return;
  }

  // 2. Cache WebLLM weights if downloaded
  if (url.hostname.includes('huggingface.co') || url.hostname.includes('raw.githubusercontent.com')) {
    event.respondWith(
      caches.open('kinstudy-weights-v2').then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const netRes = await fetch(event.request);
          if (netRes && netRes.ok) {
            cache.put(event.request, netRes.clone());
          }
          return netRes;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }

  // 3. Cache-first strategy for app shell assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Revalidate in background if online
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {
            // App is offline, silent ignore
          });
        return cachedResponse;
      }

      // If not in cache, fetch from network
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return networkResponse;
        })
        .catch(() => {
          // If offline and request is for navigation, return cached index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./') || caches.match('/');
          }
        });
    })
  );
});
