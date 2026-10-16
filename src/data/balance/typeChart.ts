/**
 * 十八属性关系表（数据驱动，禁止在精灵攻击逻辑中硬编码）。
 *
 * 与原版对战的差异（PRD 4.4）：
 *   - 克制   → ×1.5
 *   - 被抵抗 → ×0.75
 *   - 双重克制 / 双重抵抗 → ×2.0 / ×0.5
 *   - 免疫   → 默认 ×0.25（避免某些防御塔完全失去作用）
 *   - 最终倍率限制在 [0.5, 2.0] 区间
 */

export const POKEMON_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

/** 属性中文名 */
export const TYPE_LABELS: Record<PokemonType, string> = {
  normal: '一般', fire: '火', water: '水', electric: '电', grass: '草', ice: '冰',
  fighting: '格斗', poison: '毒', ground: '地面', flying: '飞行', psychic: '超能力',
  bug: '虫', rock: '岩石', ghost: '幽灵', dragon: '龙', dark: '恶', steel: '钢', fairy: '妖精',
};

/** 属性主题色（UI 徽章、技能特效用） */
export const TYPE_COLORS: Record<PokemonType, string> = {
  normal: '#A8A878', fire: '#F08030', water: '#6890F0', electric: '#F8D030',
  grass: '#78C850', ice: '#98D8D8', fighting: '#C03028', poison: '#A040A0',
  ground: '#E0C068', flying: '#A890F0', psychic: '#F85888', bug: '#A8B820',
  rock: '#B8A038', ghost: '#705898', dragon: '#7038F8', dark: '#705848',
  steel: '#B8B8D0', fairy: '#EE99AC',
};

export const TYPE_COLORS_DARK: Record<PokemonType, string> = {
  normal: '#6D6D4E', fire: '#9C531F', water: '#445E9C', electric: '#A1871F',
  grass: '#4E8234', ice: '#638D8D', fighting: '#7D1F1A', poison: '#682A68',
  ground: '#927D44', flying: '#6D6D9E', psychic: '#A13959', bug: '#6D7A1F',
  rock: '#786824', ghost: '#493963', dragon: '#4924A1', dark: '#49392F',
  steel: '#787887', fairy: '#9B6470',
};

type Chart = Partial<Record<PokemonType, Partial<Record<PokemonType, 0 | 0.5 | 1 | 2>>>>;

/**
 * 原版 18 属性关系（攻击方 → 防御方），使用原版倍率书写：
 *   2   = 克制，0.5 = 被抵抗，0 = 免疫
 * 未列出的组合默认为 1。
 */
const RAW_CHART: Chart = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: {
    fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5,
    bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5,
  },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: {
    normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5,
    rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5,
  },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: {
    fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2,
    ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5,
  },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

/** 塔防倍率方案 */
export const TD_MULTIPLIERS = {
  /** 克制 */
  super: 1.5,
  /** 被抵抗 */
  notVery: 0.75,
  /** 免疫（默认宽松，避免防御塔完全无效） */
  immune: 0.25,
  /** 最终倍率上下限 */
  min: 0.5,
  max: 2.0,
} as const;

/** 把原版倍率映射到塔防倍率（多元表查表，不用浮点乘法累加） */
const MAP_2 = TD_MULTIPLIERS.super; // 2 → 1.5
const MAP_HALF = TD_MULTIPLIERS.notVery; // 0.5 → 0.75
const MAP_0 = TD_MULTIPLIERS.immune; // 0 → 0.25
const MAP_1 = 1;

function mapSingle(raw: number): number {
  if (raw === 2) return MAP_2;
  if (raw === 0.5) return MAP_HALF;
  if (raw === 0) return MAP_0;
  return MAP_1;
}

function mapProduct(product: number): number {
  // product 是两个单属性倍率的乘积，按 PRD 的 4 档 + 上下限裁剪
  if (product >= MAP_2 * MAP_2 - 1e-6) return TD_MULTIPLIERS.max; // 双重克制
  if (product <= MAP_HALF * MAP_HALF + 1e-6) {
    // 双重抵抗 / 抵抗+免疫 → 下限，但免疫组合保持宽松下限
    return TD_MULTIPLIERS.min;
  }
  return Math.min(TD_MULTIPLIERS.max, Math.max(TD_MULTIPLIERS.min, product));
}

/**
 * 计算攻击属性对防御属性组合的伤害倍率。
 * @param attackType 攻击方属性
 * @param defenderTypes 防御方一至两种属性
 * @param strict 是否启用严格免疫（免疫 → 0 伤害）
 */
export function typeMultiplier(
  attackType: PokemonType,
  defenderTypes: PokemonType[],
  strict = false,
): number {
  if (strict) {
    let strictProduct = 1;
    for (const d of defenderTypes) {
      const raw = RAW_CHART[attackType]?.[d];
      if (raw === 0) return 0;
      strictProduct *= mapSingle(raw ?? 1);
    }
    return Math.min(TD_MULTIPLIERS.max, Math.max(TD_MULTIPLIERS.min, strictProduct));
  }

  let product = 1;
  let hasImmune = false;
  for (const d of defenderTypes) {
    const raw = RAW_CHART[attackType]?.[d];
    if (raw === 0) hasImmune = true;
    product *= mapSingle(raw ?? 1);
  }
  if (hasImmune) {
    // 免疫按 ×0.25 处理，且这是**绝对下限**：即使叠加了抵抗（0.25 × 0.75 = 0.1875），
    // 也不允许低于 0.25。否则"免疫 + 抵抗"的组合会让某些防御塔近乎完全失效，
    // 与 PRD 4.4「避免某些防御塔完全失去作用」的设计意图相悖。
    return Math.max(TD_MULTIPLIERS.immune, Math.min(TD_MULTIPLIERS.max, product));
  }
  return mapProduct(product);
}

/** 攻击方的克制关系描述，用于 UI 提示与图鉴 */
export function effectivenessLabel(mult: number): { label: string; tone: 'super' | 'good' | 'normal' | 'weak' } {
  if (mult >= TD_MULTIPLIERS.max) return { label: '双重克制', tone: 'super' };
  if (mult > 1.001) return { label: '克制', tone: 'good' };
  if (mult < 1 - 0.001 && mult > TD_MULTIPLIERS.immune + 0.001) return { label: '被抵抗', tone: 'weak' };
  if (mult <= TD_MULTIPLIERS.immune + 0.001) return { label: '效果微弱', tone: 'weak' };
  return { label: '一般', tone: 'normal' };
}

/** 预生成完整倍率表，便于运行时零计算查表 */
export const TYPE_CHART: Record<string, Record<string, number>> = (() => {
  const table: Record<string, Record<string, number>> = {};
  for (const atk of POKEMON_TYPES) {
    table[atk] = {};
    for (const def of POKEMON_TYPES) {
      table[atk][def] = typeMultiplier(atk, [def]);
    }
  }
  return table;
})();

/** 供图鉴展示：某属性的克制 / 被克制列表 */
export function typeRelationships(t: PokemonType) {
  const strong: PokemonType[] = [];
  const weak: PokemonType[] = [];
  const noEffect: PokemonType[] = [];
  for (const d of POKEMON_TYPES) {
    const raw = RAW_CHART[t]?.[d];
    if (raw === 2) strong.push(d);
    else if (raw === 0.5) weak.push(d);
    else if (raw === 0) noEffect.push(d);
  }
  const defensiveWeakTo: PokemonType[] = [];
  const defensiveResists: PokemonType[] = [];
  for (const a of POKEMON_TYPES) {
    const raw = RAW_CHART[a]?.[t];
    if (raw === 2) defensiveWeakTo.push(a);
    else if (raw === 0.5) defensiveResists.push(a);
  }
  return { strong, weak, noEffect, defensiveWeakTo, defensiveResists };
}
