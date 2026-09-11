// Minimal service worker: makes the site installable as an app. No caching,
// so an updated server always serves fresh pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
