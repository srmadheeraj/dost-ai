// Simple service worker for PWA support
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Let browser handle everything normally, we just need the SW to exist for installation
  event.respondWith(fetch(event.request));
});