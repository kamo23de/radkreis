// Radrouten-Radar – Service Worker: App-Gerüst offline verfügbar machen.
// Routing (bikerouter.de), Wetter (Open-Meteo), Suche und Kartenkacheln laufen immer übers Netz.
// VERSION bei jeder Veröffentlichung erhöhen, damit alte Caches entfernt werden.
const VERSION = 'rr-v2';
const LOCAL = [
  './', './index.html', './core.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];
// Bibliotheken mit fester Version: ändern sich nie → Cache zuerst
const CDN = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled([...LOCAL, ...CDN].map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Nur vollständige, eigene Antworten speichern – keine 404-/Fehlerseiten
const cacheable = r => r && r.ok && r.type === 'basic';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // App-Seite: erst Netz (damit Updates ankommen), sonst Cache
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      if (cacheable(r)) { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); }
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  // Eigene Dateien (core.js, Manifest, Icons): erst Netz, offline aus dem Cache
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(r => {
      if (cacheable(r)) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req).then(hit => hit || Response.error())));
    return;
  }
  // Versionierte Bibliotheken: Cache zuerst
  if (CDN.includes(req.url)) e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  // alles andere (APIs, Kacheln) nicht anfassen
});
