/**
 * 单位生成器 —— 从图鉴数据推导防御塔与敌方单位的战斗配置。
 *
 * PRD 13.2 第三阶段要求"不能仅用不同图片替换同一个通用单位来冒充完整玩法"，
 * 因此这里按 属性 / 基础种族值 / 进化阶段 / 体型 推导出：
 *   - 攻击方式（单体 / 连锁 / 穿透 / 范围 / 直线 / 多重 / 全屏）
 *   - 射程、攻速、造价、伤害
 *   - 招牌技能与进化后解锁的终极招式
 *   - 敌方单位的特性标签（高速 / 重甲 / 飞行 / 隐身 / 治疗 / 召唤 / BOSS）
 * 全部数值由规则算出，所以 1025 只精灵都有可用的战斗配置。
 */
import { POKEDEX, type PokedexEntry } from './pokedex';
import type { PokemonType } from '../balance/typeChart';
import {
  MOVES, TYPE_BASIC_MOVE, TYPE_SIGNATURE_MOVE, TYPE_ULTIMATE_MOVE, type MoveDef,
} from '../moves/moves';

/* ------------------------------------------------------------------ */
/* 属性 → 攻击原型                                                      */
/* ------------------------------------------------------------------ */

export interface ArchetypeProfile {
  /** 职业标识，用于 UI 分类与筛选 */
  key: string;
  /** 职业中文名 */
  label: string;
  /** 该属性偏好的攻击方式 */
  targeting: 'single' | 'chain' | 'pierce' | 'area' | 'cone' | 'line' | 'multi' | 'global' | 'aura';
  /** 射程系数（相对属性基准） */
  rangeScale: number;
  /** 攻速系数（相对属性基准，越大越快） */
  speedScale: number;
  /** 伤害系数 */
  damageScale: number;
  /** 造价系数 */
  costScale: number;
  /** 机制说明 */
  mechanic: string;
}

export const TYPE_ARCHETYPE: Record<PokemonType, ArchetypeProfile> = {
  electric: { key: 'chain', label: '连锁攻击型', targeting: 'chain', rangeScale: 1.0, speedScale: 1.15, damageScale: 0.9, costScale: 1.05, mechanic: '闪电在多个敌人之间弹射，适合清理密集怪群。' },
  fire:     { key: 'burst', label: '范围爆发型', targeting: 'area', rangeScale: 0.92, speedScale: 0.92, damageScale: 1.15, costScale: 1.1, mechanic: '喷射火焰形成燃烧区域，造成持续伤害。' },
  water:    { key: 'pierce', label: '穿透减速型', targeting: 'pierce', rangeScale: 1.1, speedScale: 1.0, damageScale: 1.0, costScale: 1.0, mechanic: '水弹穿透直线上的多个敌人。' },
  grass:    { key: 'control', label: '控制持续伤害型', targeting: 'area', rangeScale: 0.96, speedScale: 0.95, damageScale: 0.95, costScale: 0.95, mechanic: '藤鞭与种子提供缠绕和持续伤害。' },
  ghost:    { key: 'curse', label: '诅咒群攻型', targeting: 'area', rangeScale: 1.05, speedScale: 0.88, damageScale: 1.1, costScale: 1.15, mechanic: '暗影球与诅咒对大范围敌人造成伤害和负面状态。' },
  dragon:   { key: 'ultimate', label: '高费用终极输出型', targeting: 'line', rangeScale: 1.2, speedScale: 0.78, damageScale: 1.35, costScale: 1.6, mechanic: '高额伤害，释放龙之波动与流星群等大范围技能。' },
  ice:      { key: 'freeze', label: '冻结控制型', targeting: 'pierce', rangeScale: 1.05, speedScale: 0.95, damageScale: 0.92, costScale: 1.0, mechanic: '冰系攻击减速并冻结敌人。' },
  rock:     { key: 'knockback', label: '击退压制型', targeting: 'line', rangeScale: 0.9, speedScale: 0.82, damageScale: 1.2, costScale: 1.05, mechanic: '岩石系攻击击退敌人，压缩其推进节奏。' },
  psychic:  { key: 'control2', label: '控制型', targeting: 'area', rangeScale: 1.12, speedScale: 0.9, damageScale: 1.0, costScale: 1.1, mechanic: '念力场减速与削弱敌人。' },
  steel:    { key: 'armorpen', label: '穿甲型', targeting: 'pierce', rangeScale: 1.0, speedScale: 0.94, damageScale: 1.08, costScale: 1.1, mechanic: '钢系攻击无视护甲。' },
  poison:   { key: 'dot', label: '持续伤害型', targeting: 'area', rangeScale: 0.94, speedScale: 0.96, damageScale: 0.9, costScale: 0.9, mechanic: '毒素叠加，长时间消耗敌人。' },
  fighting: { key: 'melee', label: '近战爆发型', targeting: 'cone', rangeScale: 0.62, speedScale: 1.3, damageScale: 1.45, costScale: 0.9, mechanic: '短射程高爆发，无视护甲。' },
  fairy:    { key: 'buff', label: '增益辅助型', targeting: 'area', rangeScale: 1.06, speedScale: 1.0, damageScale: 1.0, costScale: 1.15, mechanic: '为附近防御单位提供增益并削弱敌人。' },
  flying:   { key: 'antiair', label: '对空型', targeting: 'line', rangeScale: 1.18, speedScale: 1.08, damageScale: 0.95, costScale: 1.0, mechanic: '可命中飞行单位，攻击直线上的敌人。' },
  bug:      { key: 'multihit', label: '多段攻击型', targeting: 'line', rangeScale: 0.95, speedScale: 1.25, damageScale: 0.85, costScale: 0.92, mechanic: '多段连续攻击，削甲效果明显。' },
  dark:     { key: 'armorbreak', label: '破甲型', targeting: 'single', rangeScale: 1.0, speedScale: 1.0, damageScale: 1.25, costScale: 1.05, mechanic: '撕碎护甲，提升全队后续伤害。' },
  ground:   { key: 'quake', label: '震地群伤型', targeting: 'area', rangeScale: 0.88, speedScale: 0.82, damageScale: 1.25, costScale: 1.1, mechanic: '大范围震地伤害并眩晕，无法命中飞行单位。' },
  normal:   { key: 'balanced', label: '均衡型', targeting: 'single', rangeScale: 1.0, speedScale: 1.0, damageScale: 1.0, costScale: 1.0, mechanic: '数值均衡，适合作为前排基础输出。' },
};

/* ------------------------------------------------------------------ */
/* 数值推导                                                             */
/* ------------------------------------------------------------------ */

const RARITY_SCALE = {
  normal: { cost: 1.0, damage: 1.0, range: 1.0 },
  baby: { cost: 0.75, damage: 0.8, range: 0.95 },
  legendary: { cost: 2.4, damage: 1.7, range: 1.2 },
  mythical: { cost: 2.8, damage: 1.85, range: 1.25 },
} as const;

/** 基础攻击力 —— 由攻击 / 特攻种族值推导 */
function deriveDamage(entry: PokedexEntry): number {
  const s = entry.baseStats;
  const offensive = Math.max(s['attack'] ?? 50, s['special-attack'] ?? 50);
  const rarity = RARITY_SCALE[entry.rarity];
  // 22 是基准：种族值 100 的精灵基础攻击约 24
  return Math.round((14 + offensive * 0.12) * rarity.damage * 10) / 10;
}

/** 攻击间隔（毫秒）—— 由速度种族值推导，快 = 间隔短 */
function deriveAttackInterval(entry: PokedexEntry, profile: ArchetypeProfile): number {
  const speed = entry.baseStats['speed'] ?? 60;
  const base = 1150 - speed * 3.2; // 速度 100 → 830ms
  const rarity = RARITY_SCALE[entry.rarity];
  const interval = (base / profile.speedScale) / (1 + (rarity.damage - 1) * 0.18);
  return Math.round(Math.min(2400, Math.max(420, interval)));
}

/** 攻击范围（像素）—— 由体型 / 属性职业 / 稀有度推导 */
function deriveRange(entry: PokedexEntry, profile: ArchetypeProfile): number {
  const height = entry.height ?? 10; // 分米
  const sizeFactor = 1 + Math.min(height, 40) / 120;
  const rarity = RARITY_SCALE[entry.rarity];
  // 基准 165：约覆盖 2.5 格路径，让相邻塔的火力自然衔接。
  // 射程过短时敌人大部分行程都在所有塔的覆盖之外，面板 DPS 再高也无济于事。
  const range = 165 * profile.rangeScale * sizeFactor * rarity.range;
  return Math.round(Math.min(380, Math.max(100, range)));
}

/** 建造费用 —— 综合种族值总和、稀有度、职业系数 */
function deriveCost(entry: PokedexEntry, profile: ArchetypeProfile): number {
  const total = entry.statTotal;
  const rarity = RARITY_SCALE[entry.rarity];
  const raw = (60 + total * 0.19) * profile.costScale * (1 + (rarity.cost - 1) * 0.5);
  return Math.round(raw / 5) * 5;
}

/** 进化费用 */
function deriveEvolutionCost(entry: PokedexEntry, target: PokedexEntry | null): number {
  if (!target) return 0;
  const base = deriveCost(entry, TYPE_ARCHETYPE[entry.types[0] as PokemonType] ?? TYPE_ARCHETYPE.normal);
  const targetCost = deriveCost(target, TYPE_ARCHETYPE[target.types[0] as PokemonType] ?? TYPE_ARCHETYPE.normal);
  return Math.round((base * 0.8 + Math.abs(targetCost - base) * 1.4) / 10) * 10;
}

/** 敌人基础生命 —— 与防御塔 DPS 对齐 */
function deriveEnemyHp(entry: PokedexEntry, stage: number): number {
  const s = entry.baseStats;
  const bulk = ((s['hp'] ?? 45) * 2 + (s['defense'] ?? 45) + (s['special-defense'] ?? 45)) / 4;
  const rarity = entry.rarity === 'legendary' ? 3.2 : entry.rarity === 'mythical' ? 3.6 : 1;
  // 基准 22 + bulk * 1.25：第一章基础敌人约 70-110 血，3 座初始塔可以在
  // 单波内清完；更高章节再按章节系数放大。
  return Math.round((22 + bulk * 1.25) * (1 + (stage - 1) * 0.22) * rarity);
}

function deriveEnemySpeed(entry: PokedexEntry): number {
  const speed = entry.baseStats['speed'] ?? 60;
  // 像素/秒，路径总长约 2000px，速度 60 → 约 96 px/s
  return Math.round(Math.min(190, Math.max(38, 62 + speed * 0.55)));
}

/* ------------------------------------------------------------------ */
/* 敌方特性                                                             */
/* ------------------------------------------------------------------ */

export type EnemyTrait =
  | 'normal' | 'swift' | 'armored' | 'flying' | 'stealth' | 'healer'
  | 'summoner' | 'boss' | 'shielded' | 'regen' | 'splitter' | 'commander';

export interface EnemyTraitProfile {
  key: EnemyTrait;
  label: string;
  description: string;
  counter: string;
}

export const ENEMY_TRAITS: Record<EnemyTrait, EnemyTraitProfile> = {
  normal: { key: 'normal', label: '普通型', description: '标准速度和生命值。', counter: '常规输出即可。' },
  swift: { key: 'swift', label: '高速型', description: '移动速度快、生命较低。', counter: '用减速和追踪攻击。' },
  armored: { key: 'armored', label: '重甲型', description: '物理减伤、移动缓慢。', counter: '使用特殊攻击和穿甲技能。' },
  flying: { key: 'flying', label: '飞行型', description: '可跨越部分地形，地面技能无效。', counter: '布置对空防御。' },
  stealth: { key: 'stealth', label: '隐身型', description: '特定条件下不可被锁定。', counter: '使用幽灵系侦测单位。' },
  healer: { key: 'healer', label: '治疗型', description: '持续恢复附近敌人生命。', counter: '优先集火击杀。' },
  summoner: { key: 'summoner', label: '召唤型', description: '行进中产生小型敌人。', counter: '使用范围攻击清场。' },
  boss: { key: 'boss', label: 'BOSS 型', description: '极高生命，多阶段技能。', counter: '组合防御与终极技能。' },
  shielded: { key: 'shielded', label: '护盾型', description: '周期性获得伤害护盾。', counter: '穿甲与高爆发。' },
  regen: { key: 'regen', label: '再生型', description: '脱离战斗后快速回血。', counter: '持续压制不让其脱战。' },
  splitter: { key: 'splitter', label: '分裂型', description: '死亡时分裂出两个小型单位。', counter: '范围伤害防止漏怪。' },
  commander: { key: 'commander', label: '指挥官', description: '为周围敌人提供速度与减伤光环。', counter: '优先击杀指挥官。' },
};

function deriveEnemyTraits(entry: PokedexEntry): EnemyTrait[] {
  const traits: EnemyTrait[] = [];
  const s = entry.baseStats;
  const speed = s['speed'] ?? 60;
  const defense = s['defense'] ?? 50;
  const hp = s['hp'] ?? 50;

  if (entry.rarity === 'legendary' || entry.rarity === 'mythical') traits.push('boss');
  if (speed >= 110) traits.push('swift');
  if (defense >= 110 && speed < 80) traits.push('armored');
  if (entry.types.includes('flying')) traits.push('flying');
  if (entry.types.includes('ghost') && speed >= 80) traits.push('stealth');
  if ((s['special-defense'] ?? 0) >= 110) traits.push('shielded');
  if (hp >= 100) traits.push('regen');
  if (entry.types.includes('grass') || entry.types.includes('bug')) traits.push('summoner');
  // 治疗型要稀缺：只有"超能力 + 高特防"或"妖精 + 高特防"的支援型才具备，
  // 否则超能力/妖精两大属性会让战场出现大量治疗者，战线无法推进。
  const specialBulk = ((entry.baseStats['special-defense'] ?? 45) + (entry.baseStats['hp'] ?? 45)) / 2;
  if ((entry.types.includes('psychic') || entry.types.includes('fairy')) && specialBulk >= 105) {
    traits.push('healer');
  }
  if (entry.types.includes('dark') && entry.types.includes('poison')) traits.push('splitter');
  if (s['special-attack'] && s['special-attack'] >= 120) traits.push('commander');

  const unique = [...new Set(traits)];
  return unique.length ? unique : ['normal'];
}

/* ------------------------------------------------------------------ */
/* 输出类型                                                             */
/* ------------------------------------------------------------------ */

export interface TowerMoveSlot {
  id: string;
  move: MoveDef;
  /** 升到多少级解锁：1 / 3 / 终极强化(5) */
  unlockLevel: 1 | 3 | 5;
}

export interface TowerConfig {
  pokemonId: number;
  nameZh: string;
  generation: number;
  types: PokemonType[];
  archetype: ArchetypeProfile;
  cost: number;
  /** 基础攻击力 */
  damage: number;
  /** 攻击间隔（毫秒） */
  attackIntervalMs: number;
  /** 射程（像素） */
  range: number;
  targeting: string;
  /** 每级提升：伤害 / 攻速 / 射程 */
  growth: { damage: number; attackSpeed: number; range: number };
  /** 最高普通等级 */
  maxLevel: number;
  moves: TowerMoveSlot[];
  evolution: { targetId: number; cost: number } | null;
  rarity: PokedexEntry['rarity'];
  spriteKey: number;
  /** 是否解锁可用（由存档系统决定） */
  unlockHint: string;
}

export interface EnemyConfig {
  pokemonId: number;
  nameZh: string;
  types: PokemonType[];
  hp: number;
  speed: number;
  /** 抵达终点扣减的基地生命 */
  baseDamage: number;
  /** 护甲（物理减伤比例 0-1） */
  armor: number;
  /** 魔抗（特殊减伤比例 0-1） */
  magicResist: number;
  /** 击杀金币奖励 */
  reward: number;
  traits: EnemyTrait[];
  isFlying: boolean;
  isStealth: boolean;
  size: number;
  rarity: PokedexEntry['rarity'];
  spriteKey: number;
  /** 特殊技能（BOSS / 精英用） */
  ability: string | null;
}

/* ------------------------------------------------------------------ */
/* 生成                                                                 */
/* ------------------------------------------------------------------ */

function pickMoves(entry: PokedexEntry): TowerMoveSlot[] {
  const primary = entry.types[0] as PokemonType;
  const secondary = entry.types[1] as PokemonType | undefined;
  const slots: TowerMoveSlot[] = [];

  const basicId = TYPE_BASIC_MOVE[primary] ?? 'tackle';
  slots.push({ id: basicId, move: MOVES[basicId], unlockLevel: 1 });

  // 第二属性在 Lv.2 提供差异化普攻（若不同于主属性）
  if (secondary && TYPE_BASIC_MOVE[secondary] && TYPE_BASIC_MOVE[secondary] !== basicId) {
    const id2 = TYPE_BASIC_MOVE[secondary];
    if (!slots.some((s) => s.id === id2)) {
      slots.push({ id: id2, move: MOVES[id2], unlockLevel: 1 });
    }
  }

  const sigId = TYPE_SIGNATURE_MOVE[primary];
  if (sigId && !slots.some((s) => s.id === sigId)) {
    slots.push({ id: sigId, move: MOVES[sigId], unlockLevel: 3 });
  }
  // 传说 / 幻兽额外获得第二属性的招牌技
  if (secondary && (entry.rarity === 'legendary' || entry.rarity === 'mythical')) {
    const sig2 = TYPE_SIGNATURE_MOVE[secondary];
    if (sig2 && !slots.some((s) => s.id === sig2)) {
      slots.push({ id: sig2, move: MOVES[sig2], unlockLevel: 3 });
    }
  }

  const ultId = TYPE_ULTIMATE_MOVE[primary];
  if (ultId && !slots.some((s) => s.id === ultId)) {
    slots.push({ id: ultId, move: MOVES[ultId], unlockLevel: 5 });
  }
  if (secondary) {
    const ult2 = TYPE_ULTIMATE_MOVE[secondary];
    if (ult2 && !slots.some((s) => s.id === ult2)) {
      slots.push({ id: ult2, move: MOVES[ult2], unlockLevel: 5 });
    }
  }
  return slots;
}

export function buildTowerConfig(entry: PokedexEntry): TowerConfig {
  const primary = entry.types[0] as PokemonType;
  const profile = TYPE_ARCHETYPE[primary] ?? TYPE_ARCHETYPE.normal;
  const evoTargetId = entry.evolvesTo.length ? entry.evolvesTo[0] : null;
  const evoTarget = evoTargetId ? POKEDEX[evoTargetId] ?? null : null;

  return {
    pokemonId: entry.id,
    nameZh: entry.nameZh,
    generation: entry.generation,
    types: entry.types as PokemonType[],
    archetype: profile,
    cost: deriveCost(entry, profile),
    damage: deriveDamage(entry),
    attackIntervalMs: deriveAttackInterval(entry, profile),
    range: deriveRange(entry, profile),
    targeting: profile.targeting,
    growth: { damage: 0.28, attackSpeed: 0.11, range: 0.06 },
    maxLevel: 5,
    moves: pickMoves(entry),
    evolution: evoTarget ? { targetId: evoTarget.id, cost: deriveEvolutionCost(entry, evoTarget) } : null,
    rarity: entry.rarity,
    spriteKey: entry.spriteId,
    unlockHint: entry.rarity === 'legendary' ? '传说精灵：通关全部章节后解锁'
      : entry.rarity === 'mythical' ? '幻之精灵：达成特殊条件解锁'
      : entry.evoStage > 1 ? `由 ${entry.evolvesFrom ? POKEDEX[entry.evolvesFrom]?.nameZh ?? '前形态' : '前形态'} 进化获得`
      : '通关章节奖励或开启宝箱解锁',
  };
}

export function buildEnemyConfig(entry: PokedexEntry, stage = 1): EnemyConfig {
  const s = entry.baseStats;
  const defense = s['defense'] ?? 50;
  const spDef = s['special-defense'] ?? 50;
  const traits = deriveEnemyTraits(entry);
  // 传说 / 幻兽与章节指定 BOSS 都按 BOSS 处理
  const isBoss = traits.includes('boss') || CHAPTER_BOSS_IDS.has(entry.id);
  const height = entry.height ?? 10;

  return {
    pokemonId: entry.id,
    nameZh: entry.nameZh,
    types: entry.types as PokemonType[],
    hp: Math.round(deriveEnemyHp(entry, stage) * (isBoss ? 1.6 : 1)),
    speed: deriveEnemySpeed(entry),
    baseDamage: isBoss ? 5 : entry.rarity === 'mythical' ? 4 : entry.evoStage >= 3 ? 2 : 1,
    armor: Math.min(0.55, Math.max(0, (defense - 45) / 220)),
    magicResist: Math.min(0.55, Math.max(0, (spDef - 45) / 220)),
    reward: Math.round((10 + entry.statTotal * 0.09) * (isBoss ? 6 : 1)),
    traits,
    isFlying: traits.includes('flying'),
    isStealth: traits.includes('stealth'),
    size: Math.min(1.5, Math.max(0.72, 0.72 + height / 40)),
    rarity: entry.rarity,
    spriteKey: entry.spriteId,
    ability: isBoss ? bossAbilityFor(entry) : null,
  };
}

/** 章节指定 BOSS（见 levels.ts 的 bossId），即使不是传说精灵也获得专属技能 */
const CHAPTER_BOSS_IDS = new Set([
  3,   // 妙蛙花   第一章
  9,   // 水箭龟   第二章
  6,   // 喷火龙   第三章
  131, // 拉普拉斯 第四章
  94,  // 耿鬼     第五章
  208, // 大钢蛇   第六章
  384, // 烈空坐   第七章
  448, // 路卡利欧 第八章
]);

export function isChapterBoss(id: number): boolean {
  return CHAPTER_BOSS_IDS.has(id);
}

/** BOSS 专属技能（PRD 7.4） */
function bossAbilityFor(entry: PokedexEntry): string {
  if (entry.id === 6) return 'flamethrower_lock';    // 喷火龙：喷射火焰并封锁建造区域
  if (entry.id === 130) return 'wave_push';          // 暴鲤龙：水浪推动其他敌人
  if (entry.id === 94) return 'clone_decoy';         // 耿鬼：制造分身干扰目标选择
  if (entry.id === 149) return 'dragon_rush';        // 快龙：短时加速并释放龙之波动
  if (entry.id === 150) return 'barrier_control';    // 超梦：护盾并周期控制防御单位
  if (entry.id === 384) return 'sky_raid';           // 烈空坐：空中突袭并召唤龙系敌人
  if (entry.id === 249 || entry.id === 250) return 'storm_surge';
  if (entry.id === 483 || entry.id === 484) return 'time_distort';
  if (entry.id === 487) return 'shadow_realm';
  if (entry.types.includes('fire')) return 'flamethrower_lock';
  if (entry.types.includes('dragon')) return 'dragon_rush';
  if (entry.types.includes('ghost')) return 'clone_decoy';
  if (entry.types.includes('psychic')) return 'barrier_control';
  if (entry.types.includes('water')) return 'wave_push';
  return 'shockwave';
}

/* ------------------------------------------------------------------ */
/* 全量构建（惰性，第一次访问时计算并缓存）                              */
/* ------------------------------------------------------------------ */

let towerCache: Map<number, TowerConfig> | null = null;
let enemyCache: Map<number, EnemyConfig> | null = null;

export function getAllTowerConfigs(): Map<number, TowerConfig> {
  if (!towerCache) {
    towerCache = new Map();
    for (const entry of Object.values(POKEDEX)) {
      towerCache.set(entry.id, buildTowerConfig(entry));
    }
  }
  return towerCache;
}

export function getTowerConfig(id: number): TowerConfig | null {
  return getAllTowerConfigs().get(id) ?? null;
}

export function getAllEnemyConfigs(): Map<number, EnemyConfig> {
  if (!enemyCache) {
    enemyCache = new Map();
    for (const entry of Object.values(POKEDEX)) {
      enemyCache.set(entry.id, buildEnemyConfig(entry));
    }
  }
  return enemyCache;
}

export function getEnemyConfig(id: number, stage = 1): EnemyConfig | null {
  if (stage === 1) return getAllEnemyConfigs().get(id) ?? null;
  const base = POKEDEX[id];
  return base ? buildEnemyConfig(base, stage) : null;
}

/* ------------------------------------------------------------------ */
/* 首发名册（PRD MVP：30 种防御 / 50 种敌人）                            */
/* ------------------------------------------------------------------ */

/** 首批 30 种可用防御精灵：覆盖全部 18 属性与全部职业原型 */
export const STARTER_TOWER_IDS: number[] = [
  1,   // 妙蛙种子 草
  4,   // 小火龙   火
  7,   // 杰尼龟   水
  25,  // 皮卡丘   电（连锁）
  39,  // 胖丁     妖精
  52,  // 喵喵     一般
  58,  // 卡蒂狗   火
  63,  // 凯西     超能力
  66,  // 腕力     格斗
  74,  // 小拳石   岩石
  77,  // 小火马   火
  81,  // 小磁怪   钢/电
  92,  // 鬼斯     幽灵/毒
  95,  // 大岩蛇   岩石/地面
  104, // 卡拉卡拉 地面
  123, // 飞天螳螂 虫/飞行
  129, // 鲤鱼王   水
  133, // 伊布     一般
  147, // 迷你龙   龙
  158, // 小锯鳄   水
  172, // 皮丘     电
  175, // 波克比   妖精
  179, // 咩利羊   电
  194, // 乌波     水/地面
  209, // 布卢     妖精
  214, // 赫拉克罗斯 虫/格斗
  215, // 狃拉     恶/冰
  246, // 幼基拉斯 岩石/地面
  252, // 木守宫   草
  255, // 火稚鸡   火
];

/** 首批 50 种可出现敌人：覆盖全部 8 种敌方特性 */
export const STARTER_ENEMY_IDS: number[] = [
  10, 11, 13, 14, 16, 19, 21, 23, 27, 29,
  32, 41, 43, 46, 48, 50, 56, 60, 69, 72,
  98, 100, 109, 111, 116, 118, 120, 127, 128, 138,
  140, 161, 163, 165, 167, 170, 177, 183, 187, 191,
  198, 200, 201, 203, 206, 211, 218, 220, 223, 228,
];
