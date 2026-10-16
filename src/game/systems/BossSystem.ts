/**
 * BOSS 技能与阶段转换（PRD 7.4）。
 *
 * 设计要点：
 *   - 每个 BOSS 有一个专属技能 ID（来自 units.ts 的 bossAbilityFor），这里把
 *     ID 映射成可执行的行为。此前这些 ID 只是字符串，运行时不读，等于没有。
 *   - 阶段按剩余生命百分比切换（100%→60%→30%），每次跨界触发一次
 *     "阶段转换"：短时无敌 + 预警提示 + 强化，让战斗有明显节奏变化。
 *   - 技能按固定冷却释放，并且**必须提前预警**，否则玩家无法反应。
 */
import type { MovingEnemy } from '../entities/Enemy';

export type BossPhase = 1 | 2 | 3;

export interface BossAbilitySpec {
  id: string;
  /** 中文名，用于预警提示 */
  name: string;
  /** 冷却（毫秒） */
  cooldownMs: number;
  /** 释放前预警时长（毫秒），预报给玩家反应时间 */
  warningMs: number;
  description: string;
}

export const BOSS_ABILITIES: Record<string, BossAbilitySpec> = {
  flamethrower_lock: {
    id: 'flamethrower_lock',
    name: '烈焰封锁',
    cooldownMs: 11000,
    warningMs: 1800,
    description: '沿路径喷出火墙，暂时封锁被覆盖的建造格。',
  },
  wave_push: {
    id: 'wave_push',
    name: '怒涛推击',
    cooldownMs: 9000,
    warningMs: 1500,
    description: '掀起水浪，把周围敌人向前推进一大段距离。',
  },
  clone_decoy: {
    id: 'clone_decoy',
    name: '替身分身',
    cooldownMs: 13000,
    warningMs: 1400,
    description: '制造两个分身，干扰防御塔的目标选择。',
  },
  dragon_rush: {
    id: 'dragon_rush',
    name: '龙之冲锋',
    cooldownMs: 10000,
    warningMs: 1600,
    description: '短时间大幅提速，并释放一道龙之波动。',
  },
  barrier_control: {
    id: 'barrier_control',
    name: '精神屏障',
    cooldownMs: 12000,
    warningMs: 1700,
    description: '展开护盾吸收伤害，并短暂压制最近的一座防御塔。',
  },
  sky_raid: {
    id: 'sky_raid',
    name: '天空突袭',
    cooldownMs: 14000,
    warningMs: 2000,
    description: '召唤两只飞行单位，并从空中发起突袭。',
  },
  storm_surge: {
    id: 'storm_surge',
    name: '风暴涌动',
    cooldownMs: 11000,
    warningMs: 1700,
    description: '召来雷暴，对附近防御塔造成短时干扰。',
  },
  time_distort: {
    id: 'time_distort',
    name: '时空扭曲',
    cooldownMs: 13500,
    warningMs: 1800,
    description: '扭曲时间流速，使全场敌人短暂加速。',
  },
  shadow_realm: {
    id: 'shadow_realm',
    name: '暗影领域',
    cooldownMs: 12000,
    warningMs: 1600,
    description: '隐入暗影，短时间内无法被未具备侦测的防御塔选中。',
  },
  shockwave: {
    id: 'shockwave',
    name: '震地冲击',
    cooldownMs: 10000,
    warningMs: 1500,
    description: '震荡地面，击退周围敌人并短暂眩晕。',
  },
};

/** 阶段阈值：剩余生命比例低于该值即进入下一阶段 */
export const PHASE_THRESHOLDS = [0.6, 0.3];

/**
 * BOSS 运行时状态。
 *
 * 由 BattleScene 每个固定步驱动（保证与伤害/冷却一样不受帧率影响）。
 */
export interface BossRuntime {
  enemy: MovingEnemy;
  abilityId: string;
  phase: BossPhase;
  /** 技能下次可释放的模拟时间 */
  readyAtMs: number;
  /** 正在预警：预警结束的时刻 + 待释放的技能 ID */
  warningUntilMs: number;
  pendingAbilityId: string | null;
  /** 阶段转换的短暂无敌截止时间 */
  invulnerableUntilMs: number;
}

export function phaseForHp(hp: number, maxHp: number): BossPhase {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio <= PHASE_THRESHOLDS[1]) return 3;
  if (ratio <= PHASE_THRESHOLDS[0]) return 2;
  return 1;
}

/** 各阶段对 BOSS 的强化：速度与技能频率 */
export function phaseModifiers(phase: BossPhase): { speed: number; cooldownScale: number } {
  if (phase >= 3) return { speed: 1.28, cooldownScale: 0.62 };
  if (phase === 2) return { speed: 1.14, cooldownScale: 0.8 };
  return { speed: 1, cooldownScale: 1 };
}
