/**
 * 素材构建工具共享库
 * 仅开发阶段使用，游戏运行时不需要 Node 服务端。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS_DIR = path.join(ROOT, 'public', 'assets');
export const DATA_DIR = path.join(ROOT, 'src', 'data');
export const VAR_DIR = path.join(ROOT, '.assets-cache');
export const LOG_DIR = path.join(VAR_DIR, 'logs');

export const SOURCES = {
  pokeapi: 'https://pokeapi.co/api/v2',
  spritesRaw: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon',
  spritesRepo: 'https://github.com/PokeAPI/sprites',
  smogonRepo: 'https://github.com/smogon/sprites',
  showdownRepo: 'https://github.com/smogon/pokemon-showdown',
  kenneyParticle: 'https://kenney.nl/assets/particle-pack',
};

export const LICENSE_NOTES = {
  'PokeAPI/sprites': {
    upstream: SOURCES.spritesRepo,
    license: 'UNVERIFIED',
    commercial: false,
    note: '仓库代码为 BSD-3，但宝可梦精灵图像版权归 Nintendo / Creatures Inc. / GAME FREAK inc. 所有，仓库本身不授予素材授权。',
  },
  'PokeAPI/api-data': {
    upstream: 'https://pokeapi.co/',
    license: 'UNVERIFIED',
    commercial: false,
    note: '元数据（编号/属性/进化链）为事实性数据，此处仍标记为未确认授权以便追溯。',
  },
  'Kenney/particle-pack': {
    upstream: SOURCES.kenneyParticle,
    license: 'CC0-1.0',
    commercial: true,
    note: 'Kenney 官方声明 CC0，可商用，需保留来源记录。',
  },
  procedural: {
    upstream: 'local://tools/vfx_pipeline.py',
    license: 'CC0-1.0',
    commercial: true,
    note: '本项目用代码程序化生成的粒子与光效纹理，释放至公共领域。',
  },
};

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function log(...args) {
  console.log('[assets]', ...args);
}

/* ------------------------------------------------------------------ */
/* 网络                                                                */
/* ------------------------------------------------------------------ */

const UA = 'pokemon-tower-defense-asset-builder/1.0 (+dev-only)';

export async function fetchJson(url, { retries = 4, timeout = 30000 } = {}) {
  const text = await fetchText(url, { retries, timeout });
  return JSON.parse(text);
}

export async function fetchText(url, { retries = 4, timeout = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA } });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw new Error(`fetchText failed: ${url} :: ${lastErr?.message}`);
}

export async function fetchBinary(url, { retries = 4, timeout = 45000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA } });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }
  throw new Error(`fetchBinary failed: ${url} :: ${lastErr?.message}`);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 受限并发映射 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        results[index] = { __error: err.message };
      }
      done++;
      if (done % 250 === 0) log(`进度 ${done}/${items.length}`);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------------ */
/* 文件 / 校验                                                          */
/* ------------------------------------------------------------------ */

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, data) {
  ensureDir(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export async function writeText(file, text) {
  ensureDir(path.dirname(file));
  await fsp.writeFile(file, text, 'utf8');
}

export function exists(file) {
  return fs.existsSync(file);
}

/** 读取 PNG/GIF/WebP 头部得到尺寸，无需第三方依赖 */
export function probeImageDimensions(buffer, ext) {
  try {
    if (ext === '.png') {
      if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
    }
    if (ext === '.gif') {
      if (buffer.toString('ascii', 0, 3) !== 'GIF') return null;
      return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
        format: 'gif',
        frames: countGifFrames(buffer),
      };
    }
    if (ext === '.webp') {
      if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8X') {
        const w = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
        const h = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
        return { width: w, height: h, format: 'webp' };
      }
      if (chunk === 'VP8 ') {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
          format: 'webp',
        };
      }
      if (chunk === 'VP8L') {
        const bits = buffer.readUInt32LE(21);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1,
          format: 'webp',
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** 轻量 GIF 帧计数（解析图像描述符块） */
export function countGifFrames(buffer) {
  if (buffer.toString('ascii', 0, 3) !== 'GIF') return 1;
  let i = 13;
  const flags = buffer[10];
  if (flags & 0x80) i += 3 * 2 ** ((flags & 0x07) + 1); // 全局色表
  let frames = 0;
  const MAX = buffer.length - 1;
  while (i < MAX) {
    const b = buffer[i];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      // 扩展块
      i += 2;
      while (i < MAX && buffer[i] !== 0) i += buffer[i] + 1;
      i += 1;
    } else if (b === 0x2c) {
      // 图像描述符
      frames++;
      const localFlags = buffer[i + 9];
      i += 10;
      if (localFlags & 0x80) i += 3 * 2 ** ((localFlags & 0x07) + 1);
      i += 1; // LZW 最小码长
      while (i < MAX && buffer[i] !== 0) i += buffer[i] + 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return Math.max(frames, 1);
}

/* ------------------------------------------------------------------ */
/* 日志系统                                                             */
/* ------------------------------------------------------------------ */

export class RunLog {
  constructor(name) {
    this.name = name;
    this.started = new Date().toISOString();
    this.entries = [];
    this.errors = [];
  }
  info(message, meta) {
    this.entries.push({ level: 'info', message, meta, at: new Date().toISOString() });
  }
  warn(message, meta) {
    this.entries.push({ level: 'warn', message, meta, at: new Date().toISOString() });
  }
  error(message, meta) {
    this.errors.push({ message, meta });
    this.entries.push({ level: 'error', message, meta, at: new Date().toISOString() });
  }
  async flush() {
    ensureDir(LOG_DIR);
    const file = path.join(LOG_DIR, `${this.name}-${this.started.replace(/[:.]/g, '-')}.json`);
    await writeJson(file, {
      task: this.name,
      startedAt: this.started,
      finishedAt: new Date().toISOString(),
      errorCount: this.errors.length,
      entries: this.entries,
    });
    return file;
  }
}

/** 统一的精灵资源 URL 生成 */
export const spriteUrl = {
  front: (id) => `${SOURCES.spritesRaw}/${id}.png`,
  back: (id) => `${SOURCES.spritesRaw}/back/${id}.png`,
  frontShiny: (id) => `${SOURCES.spritesRaw}/shiny/${id}.png`,
  backShiny: (id) => `${SOURCES.spritesRaw}/back/shiny/${id}.png`,
  artwork: (id) => `${SOURCES.spritesRaw}/other/official-artwork/${id}.png`,
  artworkShiny: (id) => `${SOURCES.spritesRaw}/other/official-artwork/shiny/${id}.png`,
  home: (id) => `${SOURCES.spritesRaw}/other/home/${id}.png`,
  homeShiny: (id) => `${SOURCES.spritesRaw}/other/home/shiny/${id}.png`,
  showdown: (id) => `${SOURCES.spritesRaw}/other/showdown/${id}.gif`,
  showdownShiny: (id) => `${SOURCES.spritesRaw}/other/showdown/shiny/${id}.gif`,
  genVAnimated: (id) => `${SOURCES.spritesRaw}/versions/generation-v/black-white/animated/${id}.gif`,
  genVAnimatedShiny: (id) => `${SOURCES.spritesRaw}/versions/generation-v/black-white/animated/shiny/${id}.gif`,
  genVIcon: (id) => `${SOURCES.spritesRaw}/versions/generation-viii/icons/${id}.png`,
  genVIIcon: (id) => `${SOURCES.spritesRaw}/versions/generation-vii/icons/${id}.png`,
};
