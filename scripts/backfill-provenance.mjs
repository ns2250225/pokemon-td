/**
 * 回填素材溯源信息（PRD 3.4「记录每个资源的来源 URL / 作者 / 许可证 / 下载时间」）。
 *
 * 背景：素材下载脚本在早期版本里没有在清单中写入 source/url 字段，
 * 导致审计时"来源 URL 记录 0/1025"。真实来源其实完整保存在 pokedex.json 的
 * assets.*Source 字段里（由 assets:sync-pokemon 从 PokeAPI 生成），
 * 这里按下载时使用的同一套候选顺序回填，并补上许可证与下载时间。
 *
 * 运行：node scripts/backfill-provenance.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ASSETS_DIR, DATA_DIR, SOURCES, LICENSE_NOTES, readJson, writeJson, log } from './lib.mjs';

/** 与 scripts/download-sprites.mjs 的 KINDS 顺序保持一致 */
const KIND_SOURCES = {
  portrait: (e) => [e.assets.portraitSource],
  front: (e) => [e.assets.frontSource],
  shiny: (e) => [e.assets.shinySource],
  icon: (e) => [
    e.assets.iconSource,
    `${SOURCES.spritesRaw}/other/home/${e.spriteId}.png`,
    `${SOURCES.spritesRaw}/${e.spriteId}.png`,
  ],
  animated: (e) => [e.assets.animatedSource, e.assets.animatedFallbackSource],
};

/** 下载用的输出扩展名（与原脚本一致） */
const KIND_EXT = {
  portrait: '.png', front: '.png', shiny: '.png', icon: '.png', animated: '.gif',
};

export async function backfillProvenance() {
  const dex = await readJson(path.join(DATA_DIR, 'pokemon', 'pokedex.json'));
  if (!dex) throw new Error('缺少 pokedex.json');

  const manifestPath = path.join(ASSETS_DIR, 'manifest-pokemon.json');
  const manifest = await readJson(manifestPath, { items: {} });
  manifest.items = manifest.items ?? {};

  const hashIndex = await readJson(path.join(process.cwd(), '.assets-cache', 'hashes.json'), {});

  let filled = 0;
  let alreadyHad = 0;
  let noCandidate = [];

  for (const [idStr, entry] of Object.entries(dex)) {
    const id = Number(idStr);
    const item = manifest.items[id];
    if (!item?.files) continue;

    for (const [kind, file] of Object.entries(item.files)) {
      if (!file) continue;
      if (file.source) { alreadyHad++; continue; }

      const candidates = (KIND_SOURCES[kind]?.(entry) ?? []).filter(Boolean);
      if (!candidates.length) { noCandidate.push({ id, kind }); continue; }

      // 若下载时记录了实际使用的 URL（hashes.json 的 :url 键），优先采用
      const relKey = `${file.path}:url`;
      const recorded = hashIndex[relKey];
      const chosen = recorded && candidates.includes(recorded) ? recorded : candidates[0];

      // 判定是否用了回退来源（icon 的 HOME 立绘、animated 的第 5 世代回退）
      const usedFallback = candidates.indexOf(chosen) > 0;

      file.source = chosen;
      file.sourceCandidates = candidates;
      file.usedFallbackSource = usedFallback;
      file.license = LICENSE_NOTES['PokeAPI/sprites'].license;
      file.commercial = LICENSE_NOTES['PokeAPI/sprites'].commercial;
      file.author = 'Nintendo / Creatures Inc. / GAME FREAK inc.（经 PokeAPI/sprites 分发）';
      filled++;
    }
  }

  // 下载时间：以磁盘上文件的 mtime 作为下载时间（近似，但可追溯）
  for (const item of Object.values(manifest.items)) {
    for (const file of Object.values(item.files ?? {})) {
      if (file.downloadedAt) continue;
      if (!file.path) continue;
      // 源文件（PNG/GIF）已被 image_pipeline 归档到 .assets-cache/source，
      // public/ 下留下的是 WebP 产物，因此两种路径都要探测。
      const candidates = [
        path.join(ASSETS_DIR, file.path),
        path.join(ASSETS_DIR, file.path.replace(/\.(png|gif)$/i, '.webp')),
        path.join(ASSETS_DIR, '.assets-cache', 'source', file.path),
        path.join(process.cwd(), '.assets-cache', 'source', file.path),
      ];
      let stamp = null;
      for (const abs of candidates) {
        try {
          stamp = fs.statSync(abs).mtime.toISOString();
          break;
        } catch { /* 继续尝试下一个 */ }
      }
      file.downloadedAt = stamp;
    }
  }

  manifest.provenance = {
    backfilledAt: new Date().toISOString(),
    note: 'source 字段为下载时使用的候选 URL（首选来源失败时记录回退来源）',
    license: LICENSE_NOTES['PokeAPI/sprites'].license,
    commercial: LICENSE_NOTES['PokeAPI/sprites'].commercial,
    upstream: LICENSE_NOTES['PokeAPI/sprites'].upstream,
  };

  await writeJson(manifestPath, manifest);

  log('✔ 溯源信息回填完成');
  log(`  新填充 ${filled} 条 · 原有 ${alreadyHad} 条 · 无候选来源 ${noCandidate.length} 条`);
  if (noCandidate.length) {
    log(`  无候选来源示例：${JSON.stringify(noCandidate.slice(0, 5))}`);
  }
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillProvenance().catch((err) => { console.error(err); process.exit(1); });
}
