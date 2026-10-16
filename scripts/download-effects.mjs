/**
 * assets:download-vfx
 * 下载已配置来源的技能特效素材（Kenney Particle Pack，CC0）并记录授权信息。
 * 通用 VFX 素材不是宝可梦招式原版动画，运行时通过参数配置、粒子组合、时序编排
 * 加工成具有招式辨识度的游戏特效（PRD 6.3）。
 *
 * 下载失败不阻塞构建：缺失的粒子纹理由 tools/vfx_pipeline.py 程序化补齐。
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import {
  ASSETS_DIR,
  VAR_DIR,
  RunLog,
  ensureDir,
  fetchBinary,
  log,
  writeJson,
  LICENSE_NOTES,
  SOURCES,
} from './lib.mjs';

/** 已核实为 CC0 / 公共领域的通用特效来源 */
const VFX_SOURCES = [
  {
    id: 'kenney-particle-pack',
    name: 'Kenney Particle Pack',
    homepage: SOURCES.kenneyParticle,
    license: 'CC0-1.0',
    commercial: true,
    credit: 'Kenney (kenney.nl)',
    /** 从素材页解析出的 zip 直链；页面改版时需要更新 */
    resolve: async () => {
      const html = await (await fetch(SOURCES.kenneyParticle, {
        headers: { 'user-agent': 'pokemon-tower-defense-asset-builder/1.0' },
      })).text();
      const urls = [...html.matchAll(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"']+\.zip/g)].map((m) => m[0]);
      return [...new Set(urls)];
    },
  },
];

export async function downloadVfx() {
  const runLog = new RunLog('download-vfx');
  const outDir = path.join(VAR_DIR, 'vfx-downloads');
  ensureDir(outDir);

  const report = {
    generatedAt: new Date().toISOString(),
    sources: [],
    downloaded: [],
    failures: [],
    note: '通用粒子素材。宝可梦招式特效由 src/data/effects 的参数化配置组合而成，不使用原版动画素材。',
  };

  for (const src of VFX_SOURCES) {
    const record = {
      id: src.id,
      name: src.name,
      homepage: src.homepage,
      license: src.license,
      commercial: src.commercial,
      credit: src.credit,
      status: 'pending',
      files: [],
    };
    try {
      const candidates = await src.resolve();
      log(`${src.name}: 发现 ${candidates.length} 个压缩包候选`);
      let saved = false;
      for (const url of candidates) {
        const buf = await fetchBinary(url, { retries: 2 });
        if (!buf || buf.length < 1024) {
          runLog.warn('压缩包下载失败或过小', { url, bytes: buf?.length ?? 0 });
          continue;
        }
        if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
          runLog.warn('不是有效 zip', { url });
          continue;
        }
        const file = path.join(outDir, `${src.id}.zip`);
        await fsp.writeFile(file, buf);
        record.status = 'downloaded';
        record.files.push({ url, path: path.relative(process.cwd(), file), bytes: buf.length });
        report.downloaded.push({ id: src.id, url, bytes: buf.length });
        log(`${src.name}: 已保存 ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
        saved = true;
        break;
      }
      if (!saved) {
        record.status = 'unavailable';
        runLog.warn(`${src.name}: 未能获取，将使用程序化生成的粒子纹理`);
      }
    } catch (err) {
      record.status = 'error';
      record.error = String(err.message || err);
      runLog.error(`${src.name} 下载异常`, { error: record.error });
      report.failures.push({ id: src.id, reason: record.error });
    }
    report.sources.push(record);
  }

  report.summary = {
    total: report.sources.length,
    downloaded: report.sources.filter((s) => s.status === 'downloaded').length,
    fallback: report.sources.filter((s) => s.status !== 'downloaded').length,
  };

  await writeJson(path.join(ASSETS_DIR, 'manifest-vfx-sources.json'), report);
  await writeJson(path.join(ASSETS_DIR, '..', '..', '..', 'docs', 'vfx-sources.json'), report);
  const logFile = await runLog.flush();
  log(`✔ 特效来源处理完成：${report.summary.downloaded}/${report.summary.total} 可下载`);
  log(`  → public/assets/manifest-vfx-sources.json`);
  log(`  → 日志 ${logFile}`);
  return report;
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  downloadVfx().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
