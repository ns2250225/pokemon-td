/**
 * assets:download-pokemon
 * 按全国图鉴编号批量下载精灵素材：
 *   1. 官方插画 (official-artwork)  → 图鉴头像 / 立绘
 *   2. 正面像素图                   → 战斗静态回退
 *   3. 动态 GIF (Showdown → 第五世代) → 战斗动画
 *   4. 异色正面图                   → 异色展示
 *   5. 第八世代图标                 → UI 小图
 * 内容按 SHA-256 去重，失败重试并写日志。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fsp from 'node:fs/promises';
import {
  ASSETS_DIR,
  VAR_DIR,
  SOURCES,
  RunLog,
  ensureDir,
  exists,
  fetchBinary,
  probeImageDimensions,
  log,
  mapLimit,
  readJson,
  sha256,
  writeJson,
  LICENSE_NOTES,
} from './lib.mjs';

const CACHE = VAR_DIR;

/** 下载种类：key 决定落盘目录和索引字段；urls 返回候选地址，按顺序回退 */
const KINDS = [
  { key: 'portrait', dir: 'pokemon/portraits', ext: '.png', urls: (e) => [e.assets.portraitSource] },
  { key: 'front', dir: 'pokemon/sprites', ext: '.png', urls: (e) => [e.assets.frontSource] },
  { key: 'shiny', dir: 'pokemon/shiny', ext: '.png', urls: (e) => [e.assets.shinySource] },
  {
    key: 'icon',
    dir: 'pokemon/icons',
    ext: '.png',
    // 第八世代图标只覆盖到 #898，之后用 HOME 立绘降采样作为 UI 小图
    urls: (e) => [
      e.assets.iconSource,
      `${SOURCES.spritesRaw}/other/home/${e.spriteId}.png`,
      `${SOURCES.spritesRaw}/${e.spriteId}.png`,
    ],
  },
  {
    key: 'animated',
    dir: 'pokemon/animated',
    ext: '.gif',
    // 第九世代没有 Showdown GIF，回退到第五世代动画（无则最终用静态图 + Tween）
    urls: (e) => [e.assets.animatedSource, e.assets.animatedFallbackSource],
  },];

export async function downloadPokemon({ maxId = 0, kinds = null, concurrency = 16, force = false } = {}) {
  const runLog = new RunLog('download-pokemon');
  const pokedex = await readJson(path.join(process.cwd(), 'src', 'data', 'pokemon', 'pokedex.json'));
  if (!pokedex) throw new Error('缺少 pokedex.json，请先运行 npm run assets:sync-pokemon');

  const ids = Object.keys(pokedex)
    .map(Number)
    .filter((id) => (maxId ? id <= maxId : true))
    .sort((a, b) => a - b);

  const activeKinds = KINDS.filter((k) => !kinds || kinds.includes(k.key));
  const hashIndexPath = path.join(CACHE, 'hashes.json');
  const hashIndex = (await readJson(hashIndexPath, {})) || {};
  const seen = new Map(); // sha -> 路径，用于跨文件查重

  for (const [file, sha] of Object.entries(hashIndex)) seen.set(sha, file);

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: LICENSE_NOTES['PokeAPI/sprites'].upstream,
    license: LICENSE_NOTES['PokeAPI/sprites'],
    items: {},
    failures: [],
    duplicates: [],
    summary: {},
  };

  const tasks = [];
  for (const id of ids) {
    const entry = pokedex[id];
    for (const kind of activeKinds) {
      const urls = (kind.urls(entry) || []).filter(Boolean);
      if (!urls.length) continue;
      tasks.push({ id, kind, urls, entry });
    }
  }

  log(`待下载 ${tasks.length} 个文件（${ids.length} 只 × ${activeKinds.length} 类）`);

  const results = await mapLimit(tasks, concurrency, async (task) => {
    const outDir = path.join(ASSETS_DIR, task.kind.dir);
    ensureDir(outDir);
    // 统一命名：全国图鉴编号 + 扩展名
    const name = `${task.id}${task.kind.ext}`;
    const outFile = path.join(outDir, name);
    const relPath = `${task.kind.dir}/${name}`;

    // 断点续传：已存在的有效文件直接跳过，避免中断后重下 5 GB
    if (!force && exists(outFile)) {
      const stat = await fsp.stat(outFile);
      if (stat.size > 64) {
        const dims = probeImageDimensions(await fsp.readFile(outFile), task.kind.ext);
        if (dims) {
          return {
            ok: true, task, relPath, sha256: hashIndex[relPath] ?? null,
            bytes: stat.size, dims, duplicated: false, url: hashIndex[`${relPath}:url`] ?? null, resumed: true,
          };
        }
      }
    }

    // 按候选地址依次回退；记录实际命中的 URL，便于授权追溯
    const ext = task.kind.ext;
    let buffer = null;
    let usedUrl = null;
    const attempted = [];
    for (const url of task.urls) {
      attempted.push(url);
      // eslint-disable-next-line no-await-in-loop
      const candidate = await fetchBinary(url);
      if (candidate && candidate.length >= 64 && probeImageDimensions(candidate, ext)) {
        buffer = candidate;
        usedUrl = url;
        break;
      }
    }
    if (!buffer) {
      runLog.warn('素材全部候选地址均失败', { id: task.id, kind: task.kind.key, attempted });
      return { ok: false, task, reason: 'all-sources-failed', attempted };
    }

    const dims = probeImageDimensions(buffer, ext);
    const sha = sha256(buffer);
    let duplicated = false;
    if (seen.has(sha) && seen.get(sha) !== relPath) {
      duplicated = true;
      manifest.duplicates.push({ path: relPath, duplicateOf: seen.get(sha), sha256: sha, id: task.id, kind: task.kind.key });
      runLog.info('检测到重复素材', { path: relPath, of: seen.get(sha) });
    } else {
      seen.set(sha, relPath);
    }

    await fsp.writeFile(outFile, buffer);
    hashIndex[relPath] = sha;
    hashIndex[`${relPath}:url`] = usedUrl;

    return {
      ok: true,
      task,
      relPath,
      sha256: sha,
      bytes: buffer.length,
      dims,
      duplicated,
      url: task.url,
    };
  });

  for (const r of results) {
    if (!r || r.__error) {
      manifest.failures.push({ reason: r?.__error ?? 'unknown' });
      runLog.error('下载异常', { reason: r?.__error });
      continue;
    }
    if (!r.ok) {
      manifest.failures.push({ id: r.task.id, kind: r.task.kind.key, reason: r.reason, url: r.task.url });
      continue;
    }
    const id = r.task.id;
    manifest.items[id] = manifest.items[id] || { id, nameZh: pokedex[id].nameZh, files: {} };
    manifest.items[id].files[r.task.kind.key] = {
      path: r.relPath,
      bytes: r.bytes,
      width: r.dims?.width ?? null,
      height: r.dims?.height ?? null,
      frames: r.dims?.frames ?? 1,
      sha256: r.sha256,
      source: r.url,
      license: 'UNVERIFIED',
    };
  }

  manifest.summary = {
    requested: tasks.length,
    downloaded: results.filter((r) => r && r.ok).length,
    failed: manifest.failures.length,
    duplicates: manifest.duplicates.length,
    perKind: Object.fromEntries(
      activeKinds.map((k) => [
        k.key,
        {
          requested: tasks.filter((t) => t.kind.key === k.key).length,
          ok: results.filter((r) => r && r.ok && r.task.kind.key === k.key).length,
        },
      ])
    ),
    pokemonWithStatic: Object.values(manifest.items).filter((i) => i.files.front).length,
    pokemonWithAnimated: Object.values(manifest.items).filter((i) => i.files.animated).length,
    pokemonWithPortrait: Object.values(manifest.items).filter((i) => i.files.portrait).length,
    pokemonWithShiny: Object.values(manifest.items).filter((i) => i.files.shiny).length,
  };

  ensureDir(CACHE);
  await writeJson(hashIndexPath, hashIndex);
  await writeJson(path.join(ASSETS_DIR, 'manifest-pokemon.json'), manifest);
  const logFile = await runLog.flush();

  log('✔ 精灵素材下载完成');
  for (const [k, v] of Object.entries(manifest.summary.perKind)) {
    log(`  ${k}: ${v.ok}/${v.requested}`);
  }
  log(`  失败 ${manifest.summary.failed} / 重复 ${manifest.summary.duplicates}`);
  log(`  → ${path.join(ASSETS_DIR, 'manifest-pokemon.json')}`);
  log(`  → 日志 ${logFile}`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const maxId = Number(process.env.MAX_ID || 0);
  const kinds = process.env.KINDS ? process.env.KINDS.split(',') : null;
  const force = process.env.FORCE === '1';
  downloadPokemon({ maxId, kinds, force }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
