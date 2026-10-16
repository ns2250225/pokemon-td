/**
 * 设备能力探测 —— 用于画质推荐、缩放系数、性能降级。
 */
import { isMobileDevice, type QualityLevel } from '../game/config';

export interface DeviceProfile {
  isMobile: boolean;
  cores: number;
  memoryGb: number | null;
  isLowEnd: boolean;
  /** 建议的 Phaser zoom */
  zoom: number;
  quality: QualityLevel;
  /** 是否有 WebGL（无则走 Canvas 渲染，特效需要降级） */
  hasWebGL: boolean;
  devicePixelRatio: number;
}

let cached: DeviceProfile | null = null;

export function detectDevice(): DeviceProfile {
  if (cached) return cached;

  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = navigator.hardwareConcurrency ?? 4;
  const memoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  const mobile = isMobileDevice();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  let hasWebGL = false;
  try {
    const canvas = document.createElement('canvas');
    hasWebGL = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    hasWebGL = false;
  }

  const isLowEnd = mobile
    ? cores <= 4 || (memoryGb !== null && memoryGb <= 3)
    : cores <= 2;

  let quality: QualityLevel = 'high';
  if (isLowEnd) quality = 'low';
  else if (mobile || cores <= 4) quality = 'medium';
  if (!hasWebGL) quality = 'low';

  // 移动端缩放到 1 以内，减少填充率压力
  const zoom = mobile ? Math.min(1, 0.85) : 1;

  cached = { isMobile: mobile, cores, memoryGb, isLowEnd, zoom, quality, hasWebGL, devicePixelRatio: dpr };
  return cached;
}

export function getRecommendedScale(): number {
  return detectDevice().zoom;
}

export function getRecommendedQuality(): QualityLevel {
  return detectDevice().quality;
}

/** 依据当前帧率动态降级（连续低帧则降一档） */
export class PerformanceGuard {
  private samples: number[] = [];
  private downgraded = false;
  private upgradeBlocked = false;

  constructor(private fps: () => number) {}

  /** 每帧调用；返回建议的画质档位（null 表示维持现状） */
  sample(): QualityLevel | null {
    const fps = this.fps();
    if (fps <= 0) return null;
    this.samples.push(fps);
    if (this.samples.length < 180) return null; // 采样 3 秒
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];
    if (avg < 42 && !this.downgraded) {
      this.downgraded = true;
      this.upgradeBlocked = true;
      return 'low';
    }
    return null;
  }

  get hasDowngraded() {
    return this.downgraded;
  }
}
