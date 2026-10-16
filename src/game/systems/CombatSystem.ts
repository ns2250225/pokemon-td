/**
 * 伤害计算系统 —— 纯函数，与渲染完全解耦。
 *
 * PRD 5.4 要求"伤害计算与视觉动画分离，防止掉帧改变战斗结果"，
 * 因此这里所有计算都在固定时间步长内完成，不读取任何渲染状态。
 */
import { type PokemonType, typeMultiplier } from '../../data/balance/typeChart';
import type { MoveDef, StatusEffectConfig } from '../../data/moves/moves';

export interface DamageInput {
  /** 攻击方基础攻击力（含等级成长与增益） */
  attack: number;
  move: MoveDef;
  /** 防御方属性 */
  defenderTypes: PokemonType[];
  /** 防御方护甲减伤比例 0-1（物理） */
  armor?: number;
  /** 防御方魔抗减伤比例 0-1（特殊） */
  magicResist?: number;
  /** 防御方的易伤/减伤修正（来自 debuff，如 armorBreak / weaken） */
  vulnerability?: number;
  /** 是否启用严格免疫（特殊关卡） */
  strictImmunity?: boolean;
  /** 关卡难度系数 */
  difficultyScale?: number;
  /** 随机浮动范围（±ratio），默认 0.05 */
  variance?: number;
  /** 伤害随机种子，保证固定步长内可复现 */
  roll?: number;
}

export interface DamageResult {
  /** 最终伤害（已取整，最小 1） */
  amount: number;
  /** 属性克制倍率 */
  typeMult: number;
  /** 是否被免疫 */
  immune: boolean;
  /** 是否暴击（由等级差触发） */
  crit: boolean;
}

/**
 * 单次命中伤害。
 *
 * 公式：攻击力 × 招式倍率 × 属性克制 × (1 - 减伤) × 易伤修正 × 难度 × 浮动
 * 说明：这是塔防数值，不是原版宝可梦公式。设计目标是让"属性搭配"比"堆等级"更重要。
 */
export function computeDamage(input: DamageInput): DamageResult {
  const {
    attack, move, defenderTypes,
    armor = 0, magicResist = 0, vulnerability = 0,
    strictImmunity = false, difficultyScale = 1, variance = 0.05, roll = 0.5,
  } = input;

  const typeMult = typeMultiplier(move.type, defenderTypes, strictImmunity);
  if (typeMult <= 0) {
    return { amount: 0, typeMult: 0, immune: true, crit: false };
  }

  // 穿甲招式忽略一部分护甲
  const isPhysical = move.category === 'physical';
  const rawResist = isPhysical ? armor : magicResist;
  const resist = move.ignoreArmor ? rawResist * 0.25 : rawResist;

  // 免疫属性给予 0.25 倍已是下限，不再额外减伤
  const mitigation = 1 - Math.min(0.8, Math.max(0, resist));
  const vulnMult = 1 + Math.max(-0.6, Math.min(0.8, vulnerability));

  const varianceMult = 1 + (roll * 2 - 1) * variance;

  const raw = attack * move.damageMultiplier * typeMult * mitigation * vulnMult * difficultyScale * varianceMult;

  // 暴击：roll 落在最高 12% 区间时 x1.5，提供正反馈同时不破坏固定步长复现性
  const crit = roll > 0.88;
  const amount = Math.max(1, Math.round(raw * (crit ? 1.5 : 1)));

  return { amount, typeMult, immune: false, crit };
}

/* ------------------------------------------------------------------ */
/* 状态效果                                                             */
/* ------------------------------------------------------------------ */

export interface ActiveStatus {
  kind: StatusEffectConfig['kind'];
  expiresAt: number;
  /** 每秒伤害 */
  dps: number;
  /** 减速/削弱比例 */
  ratio: number;
  stacks: number;
  /** 击退待处理的位移（由敌人实体消费） */
  pendingKnockback: number;
  sourceType: PokemonType;
  maxStacks: number;
}

/** 状态是否可叠加，以及叠加规则 */
export function mergeStatus(existing: ActiveStatus | undefined, incoming: StatusEffectConfig, now: number, type: PokemonType): ActiveStatus {
  const duration = incoming.durationMs;
  if (!existing || existing.expiresAt <= now) {
    return {
      kind: incoming.kind,
      expiresAt: now + duration,
      dps: incoming.value ?? 0,
      ratio: incoming.ratio ?? 0,
      stacks: 1,
      pendingKnockback: incoming.distance ?? 0,
      sourceType: type,
      maxStacks: incoming.maxStacks ?? 1,
    };
  }
  // 同种状态：刷新时长，取更高的数值，层数叠加
  return {
    ...existing,
    expiresAt: Math.max(existing.expiresAt, now + duration),
    dps: Math.max(existing.dps, incoming.value ?? 0),
    ratio: Math.max(existing.ratio, incoming.ratio ?? 0),
    stacks: Math.min(existing.maxStacks, existing.stacks + 1),
    pendingKnockback: existing.pendingKnockback + (incoming.distance ?? 0),
  };
}

/** 状态对敌人的综合影响，供 WaveSystem / 移动逻辑读取 */
export interface StatusModifiers {
  speedMult: number;
  /** 完全无法移动 */
  frozen: boolean;
  armorBonus: number;
  vulnerability: number;
  dotPerSecond: number;
}

export function summarizeStatuses(statuses: ActiveStatus[], now: number): StatusModifiers {
  let speedMult = 1;
  let frozen = false;
  let vulnerability = 0;
  let dot = 0;

  for (const s of statuses) {
    if (s.expiresAt <= now) continue;
    switch (s.kind) {
      case 'slow':
        speedMult *= 1 - Math.min(0.85, s.ratio);
        break;
      case 'freeze':
        // 冰冻：叠加两层以上直接定身，否则按比例强减速
        if (s.stacks >= 2) frozen = true;
        else speedMult *= 1 - Math.min(0.9, s.ratio);
        break;
      case 'stun':
        frozen = true;
        break;
      case 'weaken':
        vulnerability += s.ratio * s.stacks;
        break;
      case 'armorBreak':
        vulnerability += s.ratio * s.stacks;
        break;
      case 'curse':
      case 'poison':
      case 'burn':
        dot += s.dps * s.stacks;
        break;
      case 'mark':
        vulnerability += 0.15 * s.stacks;
        break;
      default:
        break;
    }
  }

  return {
    speedMult: Math.max(0.12, speedMult),
    frozen,
    armorBonus: 0,
    vulnerability: Math.min(0.9, vulnerability),
    dotPerSecond: dot,
  };
}

/** 供 UI 显示的伤害数字颜色 */
export function damageColor(mult: number, crit: boolean): string {
  if (crit) return '#ffd76e';
  if (mult >= 1.9) return '#ff6b6b';
  if (mult > 1.0) return '#ffa94d';
  if (mult < 0.9) return '#9aa5b1';
  return '#ffffff';
}

/** 攻击力成长曲线：每级提升，终极强化（Lv.5）额外跳升 */
export function attackAtLevel(base: number, level: number, growthPerLevel: number): number {
  const linear = base * (1 + growthPerLevel * (level - 1));
  // Lv.5 额外 +18%，让终极强化有显著感受
  const bonus = level >= 5 ? 1.18 : 1;
  return linear * bonus;
}
