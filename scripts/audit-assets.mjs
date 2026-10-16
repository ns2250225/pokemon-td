/**
 * 素材审计 —— 缺失检测 + 授权合规检查（PRD 3.4 / 13.1）。
 *
 * 输出：
 *   .assets-cache/logs/asset-audit.json    完整报告
 *   .assets-cache/logs/missing-assets.json 缺失清单（按类型分组）
 *   docs/ASSET_LICENSES.md                 授权清单（供人工复核）
 *
 * 退出码：仅当"可商用素材缺失导致无法发布"或"含未确认可商用素材但被标记为可发布"时非零。
 * 当前的宝可梦素材本身就是未确认可商用的，因此这个检查默认只报告不阻断，
 * 除非显式传入 --strict。
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ROOT, ASSETS_DIR, DATA_DIR, LOG_DIR, LICENSE_NOTES,
  readJson, writeJson, writeText, ensureDir, log, probeImageDimensions,
} from './lib.mjs';

const STRICT = process.argv.includes('--strict');

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


/** 每个素材种类对应的期望文件路径生成器 */
const KINDS = [
  { key: 'sprite', label: '静态精灵图', dir: 'pokemon/sprites', ext: 'webp' },
  { key: 'portrait', label: '官方立绘', dir: 'pokemon/portraits', ext: 'webp' },
  { key: 'shiny', label: '异色精灵图', dir: 'pokemon/shiny', ext: 'webp' },
  { key: 'icon', label: '队伍图标', dir: 'pokemon/icons', ext: 'webp' },
  { key: 'atlas', label: '动态图集', dir: 'pokemon/atlases', ext: 'webp', optional: true },
];

export async function auditAssets() {
  ensureDir(LOG_DIR);

  const pokedex = await readJson(path.join(DATA_DIR, 'pokemon', 'pokedex.json'));
  if (!pokedex) throw new Error('缺少 pokedex.json');

  const manifest = await readJson(path.join(ASSETS_DIR, 'manifest-pokemon.json'), { items: {} });
  const vfxSources = await readJson(path.join(ASSETS_DIR, 'manifest-vfx-sources.json'), {});
  const atlasRaw = await readJson(path.join(ASSETS_DIR, 'effects', 'atlas.json'), { groups: {} });
  const effectAtlas = flattenEffectAtlas(atlasRaw);

  const ids = Object.keys(pokedex).map(Number).sort((a, b) => a - b);
  const missing = {};
  const zeroByte = [];
  const total = {};
  const present = {};

  for (const kind of KINDS) {
    missing[kind.key] = [];
    total[kind.key] = 0;
    present[kind.key] = 0;

    for (const id of ids) {
      const file = path.join(ASSETS_DIR, kind.dir, `${id}.${kind.ext}`);
      total[kind.key]++;
      if (!fs.existsSync(file)) {
        missing[kind.key].push({ id, name: pokedex[id]?.nameZh, reason: '文件不存在' });
        continue;
      }
      const size = fs.statSync(file).size;
      if (size === 0) {
        zeroByte.push({ id, kind: kind.key, reason: '文件为 0 字节' });
        missing[kind.key].push({ id, name: pokedex[id]?.nameZh, reason: '0 字节' });
        continue;
      }
      if (kind.key === 'sprite' && size < 120) {
        // 过小的静态图通常是占位/损坏
        missing[kind.key].push({ id, name: pokedex[id]?.nameZh, reason: `文件过小 ${size}B` });
        continue;
      }
      present[kind.key]++;
    }
  }

  // 图集元数据一致性：atlas.json 存在时，帧数必须 > 0 且与 png/webp 尺寸匹配
  const atlasIssues = [];
  for (const id of ids) {
    const metaFile = path.join(ASSETS_DIR, 'pokemon', 'atlases', `${id}.json`);
    const imgFile = path.join(ASSETS_DIR, 'pokemon', 'atlases', `${id}.webp`);
    const hasMeta = fs.existsSync(metaFile);
    const hasImg = fs.existsSync(imgFile);
    if (hasMeta !== hasImg) {
      atlasIssues.push({ id, reason: hasMeta ? '有元数据无图集' : '有图集无元数据' });
      continue;
    }
    if (!hasMeta) continue;
    const meta = await readJson(metaFile);
    // 元数据形状：{ key, frameWidth, frameHeight, frameCount, durations[], columns, atlas }
    if (!meta || !(meta.frameCount > 0)) {
      atlasIssues.push({ id, reason: '帧数为 0' });
      continue;
    }
    if (!(meta.frameWidth > 0) || !(meta.frameHeight > 0)) {
      atlasIssues.push({ id, reason: '帧尺寸无效' });
      continue;
    }
    if (!Array.isArray(meta.durations) || meta.durations.length !== meta.frameCount) {
      atlasIssues.push({ id, reason: `时长数组与帧数不符 (${meta.durations?.length} vs ${meta.frameCount})` });
      continue;
    }
    // 图集实际像素宽度必须 ≥ 帧数 × 帧宽（横向排列）
    const probe = await probeImageDimensions(fs.readFileSync(imgFile), '.webp');
    if (!probe) {
      atlasIssues.push({ id, reason: '无法解析图集尺寸' });
    } else if (probe.width < meta.frameCount * meta.frameWidth - 1) {
      atlasIssues.push({
        id,
        reason: `图集宽度 ${probe.width} 小于 ${meta.frameCount}×${meta.frameWidth}`,
      });
    }
  }

  // 特效纹理完整性
  const effectKeys = Object.keys(effectAtlas);
  const missingEffects = effectKeys.filter((k) => {
    const rel = effectAtlas[k].file.replace(/^effects\//, '');
    return !fs.existsSync(path.join(ASSETS_DIR, 'effects', rel));
  });

  // 来源与授权
  const provenance = {
    totalItems: 0,
    withSourceUrl: 0,
    withHash: 0,
    withDownloadTime: 0,
    withoutSource: [],
  };
  for (const [id, record] of Object.entries(manifest.items ?? {})) {
    provenance.totalItems++;
    const files = record.files ?? {};
    const list = Object.values(files);
    if (list.some((f) => f?.source || f?.sourceUrl)) provenance.withSourceUrl++;
    else provenance.withoutSource.push(Number(id));
    if (list.some((f) => f?.sha256)) provenance.withHash++;
    if (list.some((f) => f?.downloadedAt)) provenance.withDownloadTime++;
  }

  // 授权汇总
  const licenses = {};
  for (const [name, note] of Object.entries(LICENSE_NOTES)) {
    licenses[name] = {
      upstream: note.upstream,
      license: note.license,
      commercial: note.commercial,
      note: note.note,
      usedFor: [],
    };
  }
  licenses['PokeAPI/sprites'].usedFor.push('精灵图 / 立绘 / 异色 / 图标（pokemon/**）');
  licenses['PokeAPI/api-data'].usedFor.push('图鉴元数据（编号 / 名称 / 属性 / 进化链 / 种族值）');
  if (Object.keys(vfxSources).length) licenses['Kenney/particle-pack'].usedFor.push('粒子纹理来源（如有）');
  licenses.procedural.usedFor.push(`程序化特效纹理（${effectKeys.length} 个）与 Web Audio 合成音效`);

  const unverifiedCommercial = Object.entries(licenses)
    .filter(([, v]) => !v.commercial)
    .map(([k, v]) => ({ source: k, license: v.license, usedFor: v.usedFor }));

  const report = {
    generatedAt: new Date().toISOString(),
    assetRoot: path.relative(ROOT, ASSETS_DIR).replace(/\\/g, '/'),
    species: ids.length,
    kinds: Object.fromEntries(KINDS.map((k) => [k.key, {
      label: k.label,
      present: present[k.key],
      total: total[k.key],
      missing: missing[k.key].length,
      ratio: +(present[k.key] / Math.max(1, total[k.key])).toFixed(4),
    }])),
    integrity: {
      zeroByteFiles: zeroByte.length,
      atlasIssues: atlasIssues.slice(0, 100),
      atlasIssueCount: atlasIssues.length,
      missingEffectTextures: missingEffects,
      effectTextureCount: effectKeys.length,
    },
    provenance: {
      items: provenance.totalItems,
      withSourceUrl: provenance.withSourceUrl,
      withSha256: provenance.withHash,
      withDownloadTime: provenance.withDownloadTime,
      missingSourceUrlCount: provenance.withoutSource.length,
      missingSourceUrlSample: provenance.withoutSource.slice(0, 20),
    },
    licenses,
    commercialWarning: {
      hasUnverifiedAssets: unverifiedCommercial.length > 0,
      items: unverifiedCommercial,
      statement:
        '宝可梦名称、角色形象与精灵图像版权归 Nintendo / Creatures Inc. / GAME FREAK inc. 所有。'
        + 'PokeAPI/sprites 仓库的代码许可（BSD-3）不构成对其中图像的授权。'
        + '本项目为技术原型，未取得商业发布授权，不得直接用于商业用途。'
        + '若需商业发布，必须取得授权或替换为原创素材。',
    },
  };

  await writeJson(path.join(LOG_DIR, 'asset-audit.json'), report);
  await writeJson(path.join(LOG_DIR, 'missing-assets.json'), {
    generatedAt: report.generatedAt,
    sprite: missing.sprite,
    portrait: missing.portrait,
    shiny: missing.shiny,
    icon: missing.icon,
    atlas: missing.atlas,
  });

  // 生成授权文档
  const lines = [];
  lines.push('# 素材来源与授权清单');
  lines.push('');
  lines.push(`> 由 \`npm run assets:audit\` 自动生成于 ${report.generatedAt}`);
  lines.push('');
  lines.push('## 重要声明');
  lines.push('');
  lines.push(report.commercialWarning.statement);
  lines.push('');
  lines.push('**所有宝可梦相关素材均标记为 `UNVERIFIED`（未确认为可商用），禁止直接用于商业发布。**');
  lines.push('');
  lines.push('## 素材来源');
  lines.push('');
  lines.push('| 来源 | 上游地址 | 授权 | 可商用 | 用途 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [name, v] of Object.entries(licenses)) {
    lines.push(`| ${name} | ${v.upstream} | \`${v.license}\` | ${v.commercial ? '是' : '**否**'} | ${v.usedFor.length ? v.usedFor.join('；') : '（备用，当前未使用）'} |`);
  }
  lines.push('');
  lines.push('## 覆盖情况');
  lines.push('');
  lines.push(`- 物种总数：${report.species}`);
  lines.push('');
  lines.push('| 素材类型 | 已有 | 总数 | 覆盖率 |');
  lines.push('| --- | --- | --- | --- |');
  for (const [k, v] of Object.entries(report.kinds)) {
    lines.push(`| ${v.label} | ${v.present} | ${v.total} | ${(v.ratio * 100).toFixed(1)}% |`);
  }
  lines.push('');
  lines.push('## 完整性');
  lines.push('');
  lines.push(`- 0 字节文件：${report.integrity.zeroByteFiles}`);
  lines.push(`- 图集元数据问题：${report.integrity.atlasIssueCount}`);
  lines.push(`- 特效纹理：${report.integrity.effectTextureCount} 个，缺失 ${report.integrity.missingEffectTextures.length} 个`);
  lines.push(`- 记录了来源 URL 的条目：${provenance.withSourceUrl}/${provenance.totalItems}`);
  lines.push(`- 记录了 SHA-256 的条目：${provenance.withHash}/${provenance.totalItems}`);
  lines.push(`- 记录了下载时间的条目：${provenance.withDownloadTime}/${provenance.totalItems}`);
  lines.push('');
  lines.push('## 音频');
  lines.push('');
  lines.push('全部音乐与音效由 Web Audio API 实时合成（振荡器 + 噪声 + 包络），');
  lines.push('不包含任何第三方音频素材，因此不存在音频授权问题。');
  lines.push('');
  lines.push('## 特效纹理');
  lines.push('');
  lines.push('由 `tools/vfx_pipeline.py` 使用 Pillow 程序化生成，本项目释放至公共领域（CC0-1.0），');
  lines.push('运行时按属性着色复用，一套纹理覆盖全部 18 种属性的技能表现。');
  lines.push('');

  const docsDir = path.join(ROOT, 'docs');
  ensureDir(docsDir);
  await writeText(path.join(docsDir, 'ASSET_LICENSES.md'), lines.join('\n'));

  // 控制台摘要
  log('素材审计完成');
  for (const [k, v] of Object.entries(report.kinds)) {
    const mark = v.ratio >= 0.99 ? '✔' : v.ratio >= 0.9 ? '~' : '✗';
    log(`  ${mark} ${v.label.padEnd(8)} ${v.present}/${v.total} (${(v.ratio * 100).toFixed(1)}%)`);
  }
  if (report.integrity.zeroByteFiles) log(`  ✗ 0 字节文件 ${report.integrity.zeroByteFiles} 个`);
  if (report.integrity.atlasIssueCount) log(`  ✗ 图集问题 ${report.integrity.atlasIssueCount} 个`);
  if (report.integrity.missingEffectTextures.length) log(`  ✗ 缺失特效纹理 ${report.integrity.missingEffectTextures.length} 个`);
  log(`  来源 URL 记录 ${provenance.withSourceUrl}/${provenance.totalItems}`);
  log(`  报告：.assets-cache/logs/asset-audit.json`);
  log(`  文档：docs/ASSET_LICENSES.md`);
  if (report.commercialWarning.hasUnverifiedAssets) {
    log('  ⚠ 存在未确认可商用的素材（宝可梦图像），仅限非商业原型使用');
  }

  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  auditAssets()
    .then((report) => {
      if (STRICT && report.commercialWarning.hasUnverifiedAssets) {
        console.error('[assets] --strict：存在未确认可商用的素材，审计不通过');
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
