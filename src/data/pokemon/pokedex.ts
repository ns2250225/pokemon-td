/**
 * 图鉴数据入口 —— 懒加载 + 索引缓存。
 *
 * pokedex.json 约 4 MB，直接静态 import 会被打进主 chunk 拖慢首屏
 * （PRD 12.2 要求"按章节和关卡分包，禁止首屏加载全图鉴图片"）。
 * 因此这里通过动态 import 按需加载，并在此之上建立常用索引。
 */
import type { PokemonType } from '../balance/typeChart';

export interface PokemonForm {
  slug: string;
  isDefault: boolean;
  formId: number;
  label: string;
  types: PokemonType[];
  typeLabels: string[];
  height: number;
  weight: number;
  stats: Record<string, number>;
  abilities: { name: string; hidden: boolean }[];
}

export interface PokemonAssets {
  front: string;
  portrait: string;
  shiny: string;
  icon: string;
  animated: string;
  frontSource: string;
  portraitSource: string;
  shinySource: string;
  iconSource: string;
  animatedSource: string;
  animatedFallbackSource: string;
}

export interface PokedexEntry {
  id: number;
  slug: string;
  nameZh: string;
  nameEn: string;
  generation: number;
  generationName: string;
  types: PokemonType[];
  typeLabels: string[];
  color: string;
  habitat: string | null;
  shape: string | null;
  rarity: 'normal' | 'baby' | 'legendary' | 'mythical';
  isLegendary: boolean;
  isMythical: boolean;
  captureRate: number;
  baseStats: Record<string, number>;
  statTotal: number;
  abilities: { name: string; hidden: boolean }[];
  height: number | null;
  weight: number | null;
  flavor: string | null;
  evoStage: number;
  evoStageCount: number;
  evolvesFrom: number | null;
  evolvesTo: number[];
  evolutionChainId: number | null;
  forms: PokemonForm[];
  spriteId: number;
  assets: PokemonAssets | null;
  assetStatus: {
    static: 'pending' | 'ok' | 'missing';
    animated: 'pending' | 'ok' | 'missing';
    portrait: 'pending' | 'ok' | 'missing';
    shiny: 'pending' | 'ok' | 'missing';
  };
}

export interface PokedexMeta {
  generatedAt: string;
  source: string;
  speciesCount: number;
  formCount: number;
  missingForms: { id: number; nameZh: string }[];
  generationBreakdown: Record<string, number>;
  typeBreakdown: Record<string, number>;
  rarityBreakdown: Record<string, number>;
  speciesWithEvolution: number;
  evolutionChains: number;
  license: { upstream: string; license: string; commercial: boolean; note: string };
}

/** 同步可用的图鉴数据（由 vite 在构建时内联，见 vite.config.ts 的 json.stringify: false） */
import POKEDEX_RAW from './pokedex.json';
import EVOLUTION_CHAINS_RAW from './evolution-chains.json';
import POKEDEX_META_RAW from './pokedex-meta.json';

export const POKEDEX = POKEDEX_RAW as unknown as Record<number, PokedexEntry>;
export const EVOLUTION_CHAINS = EVOLUTION_CHAINS_RAW as unknown as Record<number, ChainNode>;
export const POKEDEX_META = POKEDEX_META_RAW as unknown as PokedexMeta;

export interface ChainNode {
  id: number;
  name: string;
  stage: number;
  evolvesFrom: number | null;
  trigger: Record<string, unknown> | null;
  children: ChainNode[];
}

export const ALL_IDS: number[] = Object.keys(POKEDEX).map(Number).sort((a, b) => a - b);
export const TOTAL_SPECIES = ALL_IDS.length;

/* ------------------------------------------------------------------ */
/* 索引                                                                 */
/* ------------------------------------------------------------------ */

let byTypeIndex: Map<PokemonType, number[]> | null = null;
let byGenerationIndex: Map<number, number[]> | null = null;

export function idsByType(type: PokemonType): number[] {
  if (!byTypeIndex) {
    byTypeIndex = new Map();
    for (const id of ALL_IDS) {
      for (const t of POKEDEX[id].types) {
        const list = byTypeIndex.get(t);
        if (list) list.push(id);
        else byTypeIndex.set(t, [id]);
      }
    }
  }
  return byTypeIndex.get(type) ?? [];
}

export function idsByGeneration(gen: number): number[] {
  if (!byGenerationIndex) {
    byGenerationIndex = new Map();
    for (const id of ALL_IDS) {
      const g = POKEDEX[id].generation;
      const list = byGenerationIndex.get(g);
      if (list) list.push(id);
      else byGenerationIndex.set(g, [id]);
    }
  }
  return byGenerationIndex.get(gen) ?? [];
}

export function getPokemon(id: number): PokedexEntry | null {
  return POKEDEX[id] ?? null;
}

/** 完整的进化链（含所有分支），用于图鉴的进化关系展示 */
export function getEvolutionChain(id: number): ChainNode | null {
  const entry = POKEDEX[id];
  if (!entry?.evolutionChainId) return null;
  return EVOLUTION_CHAINS[entry.evolutionChainId] ?? null;
}

/** 按名称搜索（中文 / 英文 / 编号） */
export function searchPokedex(query: string, limit = 60): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_IDS.slice(0, limit);
  const results: { id: number; score: number }[] = [];
  for (const id of ALL_IDS) {
    const e = POKEDEX[id];
    let score = 0;
    if (String(id) === q) score = 1000;
    else if (String(id).startsWith(q)) score = 900;
    else if (e.nameZh.includes(q)) score = e.nameZh === q ? 800 : 600 - e.nameZh.indexOf(q);
    else if (e.nameEn.toLowerCase() === q) score = 700;
    else if (e.nameEn.toLowerCase().startsWith(q)) score = 500;
    else if (e.slug.includes(q)) score = 400;
    else if (e.nameZh.includes(q.toUpperCase())) score = 300;
    if (score > 0) results.push({ id, score });
  }
  results.sort((a, b) => b.score - a.score || a.id - b.id);
  return results.slice(0, limit).map((r) => r.id);
}

/** 覆盖统计：图鉴条目 / 静态素材 / 动态素材三层分别统计（PRD 6.2） */
export function coverageReport() {
  const total = ALL_IDS.length;
  let staticOk = 0;
  let animOk = 0;
  let portraitOk = 0;
  let shinyOk = 0;
  let withForms = 0;
  let withEvolution = 0;
  let battleReady = 0;

  for (const id of ALL_IDS) {
    const e = POKEDEX[id];
    if (e.assetStatus.static === 'ok') staticOk++;
    if (e.assetStatus.animated === 'ok') animOk++;
    if (e.assetStatus.portrait === 'ok') portraitOk++;
    if (e.assetStatus.shiny === 'ok') shinyOk++;
    if (e.forms.length > 0) withForms++;
    if (e.evolvesTo.length > 0) withEvolution++;
    if (e.assetStatus.static === 'ok' && e.forms.length > 0) battleReady++;
  }

  return {
    pokedex: { covered: total, total, ratio: 1 },
    forms: { covered: withForms, total, ratio: withForms / total },
    staticSprite: { covered: staticOk, total, ratio: staticOk / total },
    animatedSprite: { covered: animOk, total, ratio: animOk / total },
    portrait: { covered: portraitOk, total, ratio: portraitOk / total },
    shiny: { covered: shinyOk, total, ratio: shinyOk / total },
    evolution: { covered: withEvolution, total, ratio: withEvolution / total },
    battleConfig: { covered: battleReady, total, ratio: battleReady / total },
  };
}
