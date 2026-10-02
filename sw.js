/* Mis Sellos — service worker. "Red primero": con internet carga siempre la versión
   publicada; sin internet usa la última copia del armazón.
   ⚠️ NUNCA toca IndexedDB: ahí viven los sellos y las fotos. Borrar estas cachés
   no borra ni un sello. */
const VERSION = '1.0.0';
const CACHE = 'missellos-' + VERSION;
const ARMAZON = ['./', './index.html', './app.js', './ia_textos.js', './jszip.min.js',
  './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARMAZON)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k !== CACHE && k.startsWith('missellos-')).map(k => caches.delete(k)))),
    self.clients.claim()]));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // la IA (api.anthropic.com) va directa
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const red = fetch(req, { cache: 'no-cache' })
        .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
      const lento = new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 6000));
      return await Promise.race([red, lento])
        .catch(async () => (await cache.match(req, { ignoreSearch: true })) || red);
    } catch (_) {
      const copia = await cache.match(req, { ignoreSearch: true });
      if (copia) return copia;
      if (req.mode === 'navigate') { const s = await cache.match('./index.html'); if (s) return s; }
      return Response.error();
    }
  })());
});
