/**
 * Phaser 游戏配置与常量。
 */
export const GAME_WIDTH = 1536;
export const GAME_HEIGHT = 896;

/** 逻辑分辨率下的战场区域 */
export const LAYOUT = {
  hudHeight: 84,
  buildBarHeight: 132,
  get battlefieldTop() { return this.hudHeight; },
  get battlefieldHeight() { return GAME_HEIGHT - this.hudHeight - this.buildBarHeight; },
};

/** 战斗模拟的固定时间步长（PRD 9.3：速度变化不能改变伤害与冷却） */
export const SIM_STEP_MS = 1000 / 60;

/** 支持的游戏速度 */
export const SPEED_OPTIONS = [1, 2, 3] as const;
export type GameSpeed = (typeof SPEED_OPTIONS)[number];

/** 画质档位（PRD 5.4 特效质量选项） */
export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_CONFIG: Record<QualityLevel, {
  particles: number;
  screenShake: number;
  flash: number;
  maxConcurrentEffects: number;
  hitStop: boolean;
  trails: boolean;
  glow: boolean;
}> = {
  low: { particles: 0.35, screenShake: 0.4, flash: 0.5, maxConcurrentEffects: 18, hitStop: false, trails: false, glow: false },
  medium: { particles: 0.7, screenShake: 0.75, flash: 0.8, maxConcurrentEffects: 40, hitStop: true, trails: true, glow: false },
  high: { particles: 1, screenShake: 1, flash: 1, maxConcurrentEffects: 90, hitStop: true, trails: true, glow: true },
};

export const SCENE_KEYS = {
  BOOT: 'BootScene',
  PRELOAD: 'PreloadScene',
  MAIN_MENU: 'MainMenuScene',
  LEVEL_SELECT: 'LevelSelectScene',
  BATTLE: 'BattleScene',
  POKEDEX: 'PokedexScene',
} as const;

/** 图层深度，避免元素互相遮挡 */
export const DEPTH = {
  background: 0,
  path: 10,
  obstacles: 20,
  buildSlots: 25,
  towers: 40,
  enemies: 45,
  projectiles: 60,
  effectsLower: 55,
  effectsUpper: 70,
  damageText: 80,
  weather: 85,
  ui: 100,
  overlay: 110,
  tooltip: 120,
} as const;

/** 网格尺寸 */
export const TILE = 64;

/** 移动端检测 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

/** 依据设备能力推荐画质 */
export function recommendQuality(): QualityLevel {
  if (typeof window === 'undefined') return 'high';
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (isMobileDevice()) {
    if (cores <= 4 || (mem !== undefined && mem <= 3)) return 'low';
    return 'medium';
  }
  if (cores <= 2) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}
