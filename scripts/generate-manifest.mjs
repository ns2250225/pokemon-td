/**
 * 生成游戏运行时素材清单（PRD 3.4）。
 *
 * 与 manifest-pokemon.json 的区别：
 *   manifest-pokemon.json  下载过程的原始记录（来源 URL / 哈希 / 尺寸），供审计追溯
 *   manifest.json          游戏与部署用的汇总清单（版本、体积、分组索引、授权标记）
 *
 * 输出：public/assets/manifest.json
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ASSETS_DIR, DATA_DIR, ROOT, readJson, writeJson, log, LICENSE_NOTES } from './lib.mjs';

const MANIFEST_VERSION = 1;

/** 把 effects/atlas.json 的嵌套 groups 结构拍平成 { key: { group, file, size, bytes } } */
function flattenEffectAtlas(atlas) {
  const out = {};
  for (const [group, items] of Object.entries(atlas?.groups ?? {})) {
    for (const [name, meta] of Object.entries(items ?? {})) {
      const key = meta.key ?? `${group}_${name}`;
      out[key] = {
        group,
        name,
        file: meta.file ?? `effects/${group}/${name}.png`,
        width: Array.isArray(meta.size) ? meta.size[0] : meta.size ?? null,
        height: Array.isArray(meta.size) ? meta.size[1] : meta.size ?? null,
        bytes: meta.bytes ?? null,
      };
    }
  }
  return out;
}


function dirSize(dir) {
  let total = 0;
  let files = 0;
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
          files++;
        } catch { /* 忽略 */ }
      }
    }
  };
  walk(dir);
  return { bytes: total, files };
}

export async function generateManifest() {
  const dex = await readJson(path.join(DATA_DIR, 'pokemon', 'pokedex.json'), {});
  const atlasRaw = await readJson(path.join(ASSETS_DIR, 'effects', 'atlas.json'), { groups: {} });
  const effectAtlas = flattenEffectAtlas(atlasRaw);
  const vfxSources = await readJson(path.join(ASSETS_DIR, 'manifest-vfx-sources.json'), {});
  const assetStatus = await readJson(path.join(DATA_DIR, 'pokemon', 'asset-status.json'), {});

  const ids = Object.keys(dex).map(Number).sort((a, b) => a - b);

  /** 每个物种的素材清单：只记录实际存在的文件，避免运行时空请求 */
  const pokemon = {};
  let withAnimated = 0;
  for (const id of ids) {
    const base = `pokemon`;
    const entry = {};
    const candidates = {
      sprite: `${base}/sprites/${id}.webp`,
      portrait: `${base}/portraits/${id}.webp`,
      shiny: `${base}/shiny/${id}.webp`,
      icon: `${base}/icons/${id}.webp`,
      atlas: `${base}/atlases/${id}.webp`,
      atlasMeta: `${base}/atlases/${id}.json`,
    };
    for (const [key, rel] of Object.entries(candidates)) {
      if (fs.existsSync(path.join(ASSETS_DIR, rel))) entry[key] = rel;
    }
    if (entry.atlas && entry.atlasMeta) withAnimated++;
    pokemon[id] = entry;
  }

  const effects = {};
  for (const [key, meta] of Object.entries(effectAtlas)) {
    const rel = meta.file.replace(/^effects\//, '');
    const abs = path.join(ASSETS_DIR, 'effects', rel);
    if (fs.existsSync(abs)) {
      effects[key] = {
        key,
        path: `effects/${rel}`,
        group: meta.group,
        width: meta.width,
        height: meta.height,
      };
    }
  }

  const sizes = {
    pokemon: dirSize(path.join(ASSETS_DIR, 'pokemon')),
    effects: dirSize(path.join(ASSETS_DIR, 'effects')),
    total: dirSize(ASSETS_DIR),
  };

  const manifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    // 素材基路径：运行时用 import.meta.env.BASE_URL 拼上这个相对路径
    base: 'assets',
    counts: {
      species: ids.length,
      pokemonWithAnimated: withAnimated,
      pokemonStaticOnly: ids.length - withAnimated,
      effectTextures: Object.keys(effects).length,
    },
    sizes: {
      pokemonBytes: sizes.pokemon.bytes,
      effectBytes: sizes.effects.bytes,
      totalBytes: sizes.total.bytes,
      totalFiles: sizes.total.files,
      totalMegabytes: +(sizes.total.bytes / 1024 / 1024).toFixed(1),
    },
    // 授权边界（PRD 1.3）：运行时也会读取，用于在 UI 上显示合规提示
    license: {
      commercial: false,
      status: 'UNVERIFIED',
      statement: LICENSE_NOTES['PokeAPI/sprites'].note,
      sources: Object.fromEntries(
        Object.entries(LICENSE_NOTES).map(([k, v]) => [k, { license: v.license, commercial: v.commercial, upstream: v.upstream }]),
      ),
      warning:
        '本作使用宝可梦名称与形象，版权归 Nintendo / Creatures Inc. / GAME FREAK inc. 所有，'
        + '仅作为非商业技术原型。商业发布需取得授权或替换为原创素材。',
    },
    downloadStatus: {
      updatedAt: assetStatus.updatedAt ?? null,
      static: assetStatus.static ?? null,
      animated: assetStatus.animated ?? null,
    },
    vfxSourceGroups: Object.keys(vfxSources),
    pokemon,
    effects,
  };

  const outFile = path.join(ASSETS_DIR, 'manifest.json');
  await writeJson(outFile, manifest);

  log(`✔ 运行时清单已生成：public/assets/manifest.json`);
  log(`  物种 ${ids.length}（动态 ${withAnimated} / 静态回退 ${ids.length - withAnimated}）`);
  log(`  特效纹理 ${Object.keys(effects).length} 个`);
  log(`  素材总体积 ${manifest.sizes.totalMegabytes} MB / ${manifest.sizes.totalFiles} 个文件`);
  log(`  素材根目录：${path.relative(ROOT, ASSETS_DIR).replace(/\\/g, '/')}`);

  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateManifest().catch((err) => { console.error(err); process.exit(1); });
}
