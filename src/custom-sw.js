// Service Worker para Notificaciones Web Push de FashionStore PWA

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'FashionStore', body: event.data.text() };
    }
  }

  const title = payload.title || 'FashionStore';
  const options = {
    body: payload.body || 'Tienes una nueva notificación de tu compra o pedido.',
    icon: payload.icon || '/assets/icons/icon-192x192.png',
    badge: payload.badge || '/assets/icons/badge-72x72.png',
    data: payload.data || { url: '/' },
    tag: payload.tag || 'fashionstore-notificacion',
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
