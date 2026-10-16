/**
 * 把素材清单回写到图鉴数据（assetStatus 字段）。
 *
 * 为什么需要这一步：图鉴同步发生在素材下载之前，因此 pokemon.ts 里生成的数据
 * 只有候选来源 URL。覆盖率报告必须基于"文件真的在磁盘上"来判断，
 * 否则会把"有来源"误报成"已具备"。
 *
 * 运行：node scripts/apply-asset-status.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { DATA_DIR, ASSETS_DIR, readJson, writeJson, log, LICENSE_NOTES } from './lib.mjs';

const KIND_TO_STATUS = {
  front: 'static',
  animated: 'animated',
  portrait: 'portrait',
  shiny: 'shiny',
};

export async function applyAssetStatus() {
  const dexPath = path.join(DATA_DIR, 'pokemon', 'pokedex.json');
  const pokedex = await readJson(dexPath);
  if (!pokedex) throw new Error('缺少 pokedex.json，请先运行 npm run assets:sync-pokemon');

  const manifest = await readJson(path.join(ASSETS_DIR, 'manifest-pokemon.json'), { items: {} });
  const items = manifest.items ?? {};

  let staticOk = 0, animOk = 0, portraitOk = 0, shinyOk = 0, missing = 0;

  for (const id of Object.keys(pokedex)) {
    const entry = pokedex[id];
    const record = items[id];
    const status = { static: 'missing', animated: 'missing', portrait: 'missing', shiny: 'missing' };

    if (record?.files) {
      for (const [fileKind, statusKey] of Object.entries(KIND_TO_STATUS)) {
        const file = record.files[fileKind];
        if (!file) continue;
        // 文件必须真实存在，且尺寸通过校验
        const abs = path.join(ASSETS_DIR, file.path);
        const sourceOk = fileKind === 'animated'
          ? path.join(ASSETS_DIR, 'pokemon', 'atlases', `${id}.webp`)
          : abs.replace(/\.png$/, '.webp');
        if (fs.existsSync(sourceOk) && fs.statSync(sourceOk).size > 0 && file.width > 0 && file.height > 0) {
          status[statusKey] = 'ok';
        }
      }
      // 动态素材优先使用图集产物
      const atlas = path.join(ASSETS_DIR, 'pokemon', 'atlases', `${id}.webp`);
      const atlasMeta = path.join(ASSETS_DIR, 'pokemon', 'atlases', `${id}.json`);
      status.animated = fs.existsSync(atlas) && fs.existsSync(atlasMeta) ? 'ok' : 'missing';
    }

    entry.assetStatus = status;
    entry.assetLicense = LICENSE_NOTES['PokeAPI/sprites'];

    if (status.static === 'ok') staticOk++;
    if (status.animated === 'ok') animOk++;
    if (status.portrait === 'ok') portraitOk++;
    if (status.shiny === 'ok') shinyOk++;
    if (status.static !== 'ok') missing++;
  }

  await writeJson(dexPath, pokedex);

  const summary = {
    updatedAt: new Date().toISOString(),
    static: { ok: staticOk, missing: Object.keys(pokedex).length - staticOk },
    animated: { ok: animOk, missing: Object.keys(pokedex).length - animOk },
    portrait: { ok: portraitOk },
    shiny: { ok: shinyOk },
    fullyMissing: missing,
  };
  await writeJson(path.join(DATA_DIR, 'pokemon', 'asset-status.json'), summary);

  log(`✔ 素材状态回写完成`);
  log(`  静态 ${staticOk}/${Object.keys(pokedex).length} · 动态 ${animOk}/${Object.keys(pokedex).length} · 立绘 ${portraitOk} · 异色 ${shinyOk}`);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyAssetStatus().catch((err) => { console.error(err); process.exit(1); });
}
