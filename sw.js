// Service Worker — network-first avec cache fallback
const CACHE = 'finances-nc-v133';
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' → on contourne le cache HTTP du navigateur (GitHub Pages en garde ~10 min)
  // pour installer les fichiers frais, pas une copie périmée.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('accounts.google.com')) return;
  // Réseau d'abord. 'no-cache' = on revalide toujours auprès du serveur (réponse 304 légère si rien n'a changé) :
  // sans cela le navigateur peut resservir pendant ~10 min une ancienne version des fichiers après une mise à jour.
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  const network = sameOrigin ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request);
  e.respondWith(
    network
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
