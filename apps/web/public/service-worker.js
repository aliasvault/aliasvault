/*
 * NOTE: the previous Blazor WASM client registered a service worker at this path. The current React client does not
 * support this anymore, however we keep this file here to properly deregister the old service worker to avoid update
 * conflicts.
 * 
 * TODO: remove this service worker declaration a while after version 0.31.0 is released.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.filter((key) => key.startsWith('offline-cache-')).map((key) => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((client) => client.navigate(client.url)));
  })());
});
