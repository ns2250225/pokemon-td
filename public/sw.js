/**
 * Service Worker —— 静态外壳预缓存 + 运行时素材缓存。
 *
 * 策略：
 *   HTML / JS / CSS 外壳 → stale-while-revalidate（先给出缓存版本，后台更新）
 *   素材（assets/**）→ cache-first（素材带内容哈希或编号命名，几乎不变）
 *   其他同源请求 → 网络优先，失败时回退缓存
 *
 * 这样首次访问后，断网仍可进入已玩过的关卡（PRD 14.1）。
 */
const VERSION = 'ptd-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const ASSET_LIMIT = 900;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 预缓存入口，让离线时能启动应用外壳
    await cache.addAll(['./', './index.html']).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 清理旧版本缓存
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

function isAsset(url) {
  return url.pathname.includes('/assets/');
}

/** 素材缓存超过上限时按插入顺序淘汰最早的一半 */
async function pruneAssetCache() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  if (keys.length <= ASSET_LIMIT) return;
  const drop = keys.slice(0, Math.floor(keys.length / 2));
  await Promise.all(drop.map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200) {
          // 克隆后写入缓存；不 await 落盘以免阻塞响应
          cache.put(req, res.clone()).then(pruneAssetCache).catch(() => {});
        }
        return res;
      } catch (err) {
        const fallback = await cache.match(req);
        if (fallback) return fallback;
        throw err;
      }
    })());
    return;
  }

  // 外壳：stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => null);

    if (hit) {
      void network;
      return hit;
    }
    const res = await network;
    if (res) return res;
    // 离线且未缓存：导航请求回退到外壳入口
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html') ?? await cache.match('./');
      if (shell) return shell;
    }
    return new Response('离线且无缓存', { status: 503, statusText: 'Offline' });
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting();
});
