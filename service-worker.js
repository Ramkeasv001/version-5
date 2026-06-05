/* SnapAudit Service Worker v5
   Strategy:
   - Navigations: Network-first → cache fallback (never trapped on stale page)
   - CDN assets: Stale-while-revalidate (fast, always refreshes in background)
   - App shell + icons: Cache-first with background refresh
   Bumping CACHE version auto-evicts all older caches on activate. */

const CACHE = 'snapaudit-v5';
const CDN_CACHE = 'snapaudit-cdn-v5';

const APP_SHELL = [
  './',
  './index.html',
  './stage1.html',
  './stage2.html',
  './stage3.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      caches.open(CACHE).then(c => c.addAll(APP_SHELL)).catch(() => {}),
      caches.open(CDN_CACHE).then(c =>
        Promise.allSettled(CDN_URLS.map(url =>
          fetch(url, { mode: 'cors' }).then(r => r.ok ? c.put(url, r) : null).catch(() => {})
        ))
      )
    ])
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // CDN requests: stale-while-revalidate
  const isCDN = CDN_URLS.includes(request.url) || url.hostname.includes('jsdelivr') ||
    url.hostname.includes('cdnjs') || url.hostname.includes('sheetjs') ||
    url.hostname.includes('googleapis') || url.hostname.includes('gstatic');

  if (isCDN) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async cache => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then(res => {
          if (res.ok) cache.put(request, res.clone()).catch(() => {});
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // App pages (navigations): network-first
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(request, res.clone())).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // App shell assets: cache-first, background refresh
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(request, res.clone())).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: CACHE });
  }
});
