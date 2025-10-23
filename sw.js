/* ============ Royal Point SW ============ */
const STATIC_CACHE = 'rp-static-v1';
const RUNTIME_CACHE = 'rp-runtime-v1';
const STATIC_ASSETS = [
  '/', '/index.html',
  '/app.css', '/app.js',
  '/images/logo.svg'
];

// ติดตั้ง: แคชของคงที่
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC_CACHE).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

// กำจัดแคชเก่า
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// กลยุทธ์หลัก: Stale-While-Revalidate
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // ข้าม non-GET
  if (e.request.method !== 'GET') return;

  // API คะแนน/รางวัล: stale-while-revalidate
  if (url.pathname.startsWith('/api/get-score') || url.pathname.startsWith('/api/rewards')) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request).then(resp => {
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      }).catch(() => cached || Response.error());
      return cached || fetchPromise;
    })());
    return;
  }

  // ไฟล์คงที่: Cache-first (fallback เครือข่าย)
  if (STATIC_ASSETS.some(p => url.pathname === p)) {
    e.respondWith(
      caches.match(e.request).then(c => c || fetch(e.request))
    );
    return;
  }

  // อื่น ๆ: network-first → fallback cache
  e.respondWith((async () => {
    try {
      const resp = await fetch(e.request);
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(e.request, resp.clone());
      return resp;
    } catch {
      return caches.match(e.request);
    }
  })());
});
