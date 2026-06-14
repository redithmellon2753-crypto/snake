// ============================================================
// 贪吃蛇 Plus – Service Worker (v1.9.0 优化版)
// 优化点：
//   - 缓存实例复用，避免每次 fetch 都 open
//   - 缓存条目上限，防止无限膨胀
//   - 更完整的资源预缓存清单
//   - 独立的网络超时兜底
// ============================================================

const CACHE_NAME = 'snake-plus-v1.9.0';
const CACHE_MAX_ITEMS = 60; // 最大缓存条目数

// 预缓存：基础 PWA 壳 + 外部 CDN 关键脚本
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ★ 模块级缓存实例引用（避免每次 fetch 都 caches.open）
let cacheInstance = null;

// ---- 辅助函数：清理超出上限的缓存条目 ----
async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > CACHE_MAX_ITEMS) {
    const toDelete = keys.slice(0, keys.length - CACHE_MAX_ITEMS);
    await Promise.all(toDelete.map(req => cache.delete(req)));
  }
}

// ---- Install：预缓存核心资源 + 立即接管 ----
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      cacheInstance = cache; // ★ 保存引用
      await Promise.all(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            console.warn('[SW] 预缓存失败:', url);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ---- Activate：清理旧版本缓存 + 接管所有页面 ----
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---- Message：监听 skipWaiting 指令 ----
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ---- Fetch：智能缓存策略 ----
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  // 只处理同源请求和可信 CDN
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isTrustedCDN = url.hostname === 'cdn.jsdelivr.net';
  if (!isSameOrigin && !isTrustedCDN) return;

  e.respondWith(handleFetch(request));
});

async function handleFetch(request) {
  // ★ 复用模块级缓存实例
  if (!cacheInstance) {
    cacheInstance = await caches.open(CACHE_NAME);
  }
  const cache = cacheInstance;

  const url = new URL(request.url);
  const acceptHeader = request.headers.get('accept') || '';

  // ── HTML：网络优先 + 缓存兜底 ──
  if (
    acceptHeader.includes('text/html') ||
    url.pathname.endsWith('.html')
  ) {
    try {
      const response = await fetchWithTimeout(request, 8000);
      if (response && response.ok) {
        cache.put(request, response.clone());
        trimCache(cache);
      }
      return response;
    } catch {
      const cached = await cache.match(request);
      return cached || new Response('离线 — 请连接网络', { status: 503 });
    }
  }

  // ── 静态资源：缓存优先 + 后台更新 (Stale-While-Revalidate) ──
  const cached = await cache.match(request);

  const networkFetch = fetchWithTimeout(request, 6000)
    .then((res) => {
      if (res && res.status === 200) {
        cache.put(request, res.clone());
        trimCache(cache);
      }
      return res;
    })
    .catch(() => cached);

  return cached || networkFetch;
}

// ---- 带超时的 fetch（避免长时间挂起）----
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
