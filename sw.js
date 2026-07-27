/* Service Worker — Controle de Rotina
   Estratégia:
   - App shell (HTML/CSS/JS/ícones): cache-first com revalidação em background.
   - Google APIs (accounts.google.com / sheets.googleapis.com): NUNCA cacheia (network-only).
   Bump CACHE_VERSION a cada deploy para forçar atualização.
*/
const CACHE_VERSION = "v1.0.1";
const CACHE_NAME = `controle-rotina-${CACHE_VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/util.js",
  "./js/templates.js",
  "./js/db.js",
  "./js/sheets.js",
  "./js/charts.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn("[SW] install:", err))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Chamadas de rede do Google jamais entram em cache.
  if (url.hostname.endsWith("googleapis.com") ||
      url.hostname.endsWith("google.com") ||
      url.hostname.endsWith("gstatic.com")) {
    return; // deixa passar direto para a rede
  }

  // Apenas mesma origem no cache do shell.
  if (url.origin !== self.location.origin) return;

  // Navegações: rede primeiro (pega deploy novo), cai para o shell offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html", { ignoreSearch: true }))
    );
    return;
  }

  // Demais assets: cache primeiro + revalidação silenciosa.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
