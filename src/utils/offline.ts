/**
 * 离线能力 —— 注册 Service Worker（若存在）并做资源预热。
 *
 * PRD 14.1 要求"无网络时，已缓存的关卡可以继续游玩"。
 * 这里采用两步：
 *   1. 若部署了 sw.js 则注册它（构建时可生成）
 *   2. 无论是否支持 SW，都用 Cache Storage 预缓存已访问过的关卡资源，
 *      使二次进入不依赖网络
 */
const CACHE_NAME = 'ptd-runtime-v1';
/** 运行时缓存上限：避免无限增长占满用户磁盘 */
const MAX_ENTRIES = 600;

export function registerPwaLikeCache() {
  if (typeof window === 'undefined') return;

  // 1. Service Worker
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        // 没有 sw.js 时静默忽略，功能不受影响
      });
    });
  }

  // 2. 运行时预缓存：拦截已访问资源的 fetch，写入 Cache Storage
  if (!('caches' in window)) return;

  window.addEventListener('ptd:precache', ((e: CustomEvent<{ urls: string[] }>) => {
    void precache(e.detail?.urls ?? []);
  }) as EventListener);
}

export async function precache(urls: string[]): Promise<number> {
  if (!('caches' in window) || !urls.length) return 0;
  try {
    const cache = await caches.open(CACHE_NAME);
    const existing = await cache.keys();
    // 超过上限时清掉最早的一半
    if (existing.length + urls.length > MAX_ENTRIES) {
      const drop = existing.slice(0, Math.floor(existing.length / 2));
      await Promise.all(drop.map((r) => cache.delete(r)));
    }
    let ok = 0;
    // 分批并发，避免一次性打出上百个请求
    const batch = 8;
    for (let i = 0; i < urls.length; i += batch) {
      const slice = urls.slice(i, i + batch);
      const results = await Promise.all(slice.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'force-cache' });
          if (res.ok) {
            await cache.put(url, res.clone());
            return 1;
          }
        } catch {
          /* 单个失败不影响其他 */
        }
        return 0;
      }));
      ok += results.reduce<number>((a, b) => a + b, 0);
    }
    return ok;
  } catch {
    return 0;
  }
}

/** 某一关需要预缓存的资源清单 */
export function levelAssetUrls(levelId: string, pokemonIds: number[]): string[] {
  const base = import.meta.env.BASE_URL || './';
  const urls: string[] = [];
  for (const id of pokemonIds) {
    urls.push(`${base}assets/pokemon/sprites/${id}.webp`);
    urls.push(`${base}assets/pokemon/atlases/${id}.webp`);
  }
  void levelId;
  return urls;
}

/** 查询当前缓存了哪些资源 */
export async function cacheStats(): Promise<{ entries: number; approximateBytes: number }> {
  if (!('caches' in window)) return { entries: 0, approximateBytes: 0 };
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    let bytes = 0;
    for (const req of keys.slice(0, 200)) {
      const res = await cache.match(req);
      if (res) {
        const blob = await res.clone().blob();
        bytes += blob.size;
      }
    }
    return { entries: keys.length, approximateBytes: bytes };
  } catch {
    return { entries: 0, approximateBytes: 0 };
  }
}

export async function clearCache(): Promise<void> {
  if (!('caches' in window)) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    /* 忽略 */
  }
}
