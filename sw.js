/* 香港急症室輪候時間地圖 — Service Worker
 * 策略:
 *  - 靜態資源(首頁、本地 json、icons): install 時預快取, 網絡優先 fallback 快取 (stale-while-revalidate)
 *  - 遠端 OSM tile / 外部 CDN: 只快取成功回應作為離線 fallback
 *  - HA 即時 API: 永不快取(即時數據不應被快取誤導)
 */
const CACHE = 'ae-waiting-map-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './hospitals.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 需要即時更新、永不快取的 URL
const LIVE_URLS = [
  'www.ha.org.hk/opendata/aed/'
];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = req.url;

  // 只處理 GET
  if (req.method !== 'GET') return;

  // 永不快取即時 API — 但離線時明確回 503 (唔好俾 200+空陣列 靜默清空頁面)
  if (LIVE_URLS.some((u) => url.includes(u))) {
    e.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ waitTime: [], updateTime: '離線', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  // 外部資源(OSM tiles / CDN 等) — 快取成功回應做離線 fallback
  // FIX (P0-3): no-cors 請求回 opaque response (type:"opaque", ok:false),
  // 用 res.ok 判斷會 100% 漏 cache。改為快取所有 type 唔係 "error" 嘅回應
  if (url.startsWith('http') && !url.includes(location.origin)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.type !== 'error' && (res.ok || res.type === 'opaque')) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 本地資源 — stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
