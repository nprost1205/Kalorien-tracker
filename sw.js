'use strict';

// Service Worker: macht die App offline nutzbar, wenn sie über http(s) läuft (z. B. GitHub Pages).
// Strategie „Netzwerk zuerst“: Online kommt immer die neueste Version, offline die zwischengespeicherte.
// Bei neuen oder umbenannten Dateien ASSETS anpassen und CACHE hochzählen.

const CACHE = 'kalorien-tracker-v1';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  // Nur eigene Dateien; Anfragen an Open Food Facts gehen unverändert ans Netz
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(event));
});

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);

  // „no-cache“ umgeht den HTTP-Cache des Browsers, damit Updates sofort ankommen
  const fromNetwork = fetch(request.url, { cache: 'no-cache' }).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  event.waitUntil(fromNetwork.catch(() => {})); // Cache auch aktualisieren, wenn das Timeout gewinnt

  try {
    return await Promise.race([
      fromNetwork,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./');
      if (shell) return shell;
    }
    return Response.error();
  }
}
