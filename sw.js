// Service worker: permite abrir la app sin conexión (la pantalla, no el guardado).
// Si publicás cambios grandes, subí el número de CACHE para limpiar lo viejo.
const CACHE = 'minimarket-v1';
const ARCHIVOS = ['./', 'index.html', 'app.js', 'productos.js', 'manifest.json', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (así siempre ves la última versión); si no hay internet, lo guardado.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const propio = url.origin === location.origin;
  const tailwind = url.hostname === 'cdn.tailwindcss.com';
  if (!propio && !tailwind) return;          // Apps Script y demás van directo a la red

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
