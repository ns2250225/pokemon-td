<script setup lang="ts">
/**
 * 波次预览面板 —— 出怪前展示本波敌人的构成、属性与特性特点。
 *
 * 由 `battle:waveReady` 事件驱动显示（波次进入待命态），
 * 玩家点击"开始出怪"后通过 BattleScene.startNextWave() 确认，
 * WaveSystem 才会真正调度这一波的生成任务。
 */
import { computed } from 'vue';
import TypeBadges from './TypeBadges.vue';
import PokemonImage from './PokemonImage.vue';
import { ENEMY_TRAITS, getEnemyConfig, type EnemyTrait } from '../data/pokemon/units';
import { POKEDEX } from '../data/pokemon/pokedex';
import type { LevelDef } from '../data/levels/levels';
import type { PokemonType } from '../data/balance/typeChart';

const props = defineProps<{
  level: LevelDef;
  waveIndex: number;
  waveTotal: number;
}>();

const emit = defineEmits<{
  (e: 'start'): void;
}>();

interface PreviewEntry {
  pokemonId: number;
  name: string;
  count: number;
  types: PokemonType[];
  isBoss: boolean;
}

const wave = computed(() => props.level.waves[props.waveIndex]);

/** 按精灵聚合本波编组（同精灵多组合并数量），保持出场顺序 */
const entries = computed<PreviewEntry[]>(() => {
  const w = wave.value;
  if (!w) return [];
  const order: number[] = [];
  const info = new Map<number, { count: number; isBoss: boolean }>();
  for (const g of w.groups) {
    const hit = info.get(g.pokemonId);
    if (hit) {
      hit.count += g.count;
      hit.isBoss = hit.isBoss || g.note === 'BOSS';
      continue;
    }
    info.set(g.pokemonId, { count: g.count, isBoss: g.note === 'BOSS' });
    order.push(g.pokemonId);
  }
  return order.map((pid) => ({
    pokemonId: pid,
    name: POKEDEX[pid]?.nameZh ?? `#${pid}`,
    count: info.get(pid)?.count ?? 0,
    types: (getEnemyConfig(pid, 1)?.types ?? POKEDEX[pid]?.types ?? []) as PokemonType[],
    isBoss: info.get(pid)?.isBoss ?? false,
  }));
});

/** 本波涉及的全部属性（去重） */
const waveTypes = computed<PokemonType[]>(() => {
  const set = new Set<PokemonType>();
  for (const e of entries.value) for (const t of e.types) set.add(t);
  return [...set];
});

/** 需要提醒玩家的特性（普通型不展示），按威胁优先级排序 */
const TRAIT_ORDER: EnemyTrait[] = [
  'boss', 'stealth', 'flying', 'summoner', 'splitter', 'healer',
  'commander', 'armored', 'shielded', 'regen', 'swift',
];
const traits = computed<EnemyTrait[]>(() => {
  const present = new Set<EnemyTrait>();
  for (const e of entries.value) {
    for (const t of getEnemyConfig(e.pokemonId, 1)?.traits ?? []) {
      if (TRAIT_ORDER.includes(t)) present.add(t);
    }
  }
  return TRAIT_ORDER.filter((t) => present.has(t));
});

const traitLabel = (t: EnemyTrait) => ENEMY_TRAITS[t]?.label ?? t;
const traitTip = (t: EnemyTrait) => {
  const p = ENEMY_TRAITS[t];
  return p ? `${p.description}${p.counter ? ` 应对：${p.counter}` : ''}` : '';
};

const totalCount = computed(() => entries.value.reduce((a, e) => a + e.count, 0));
</script>

<template>
  <div v-if="wave" class="wave-preview" role="dialog" aria-label="波次预览">
    <div class="wave-preview__head">
      <strong class="wave-preview__title">第 {{ waveIndex + 1 }} / {{ waveTotal }} 波</strong>
      <span v-if="wave.isBoss" class="wave-preview__boss">BOSS</span>
      <span class="wave-preview__sub">共 {{ totalCount }} 只 · 整备好防御再开怪</span>
    </div>

    <div class="wave-preview__enemies">
      <div
        v-for="e in entries"
        :key="e.pokemonId"
        class="wave-preview__enemy"
        :class="{ 'is-boss': e.isBoss }"
      >
        <PokemonImage
          :pokemon-id="e.pokemonId"
          :name="e.name"
          :type="e.types[0]"
          variant="icon"
          :size="28"
        />
        <span class="wave-preview__name">{{ e.name }}</span>
        <span class="wave-preview__count">×{{ e.count }}</span>
        <span v-if="e.isBoss" class="wave-preview__boss-mini">BOSS</span>
      </div>
    </div>

    <div class="wave-preview__meta">
      <div v-if="waveTypes.length" class="wave-preview__row">
        <span class="wave-preview__label">属性</span>
        <TypeBadges :types="waveTypes" size="sm" />
      </div>
      <div v-if="traits.length" class="wave-preview__row">
        <span class="wave-preview__label">特性</span>
        <span class="wave-preview__traits">
          <span
            v-for="t in traits"
            :key="t"
            class="chip wave-preview__trait"
            :title="traitTip(t)"
          >{{ traitLabel(t) }}</span>
        </span>
      </div>
    </div>

    <button class="btn btn--primary wave-preview__start" @click="emit('start')">
      ⚔ 开始出怪
    </button>
  </div>
</template>

<style scoped>
/* 底部居中、悬浮在建造栏上方：与顶部 HUD / 提示 / BOSS 血条互不遮挡，
   也贴近整备阶段玩家的操作区（建造栏）。 */
.wave-preview {
  position: absolute;
  left: 50%;
  bottom: calc(112px + var(--safe-bottom));
  transform: translateX(-50%);
  z-index: 26;
  max-width: min(560px, calc(100vw - 24px));
  padding: 10px 14px 12px;
  border-radius: var(--radius);
  background: rgba(15, 20, 28, 0.94);
  border: 1px solid var(--line);
  border-top: 3px solid var(--accent);
  box-shadow: var(--shadow);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: wave-preview-in 0.22s ease;
}

@keyframes wave-preview-in {
  from { opacity: 0; transform: translate(-50%, 10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

.wave-preview__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.wave-preview__title {
  font-size: 16px;
  white-space: nowrap;
}

.wave-preview__boss {
  flex: none;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #ffd7d7;
  background: linear-gradient(180deg, #c23a3a, #8f1f1f);
  border: 1px solid #ff8a8a;
}

.wave-preview__sub {
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wave-preview__enemies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.wave-preview__enemy {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px 2px 3px;
  border-radius: var(--radius-pill);
  background: rgba(39, 48, 64, 0.75);
  border: 1px solid var(--line);
}

.wave-preview__enemy.is-boss {
  border-color: #ff8a8a;
  background: rgba(112, 32, 32, 0.5);
}

.wave-preview__name {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.wave-preview__count {
  font-size: 12px;
  font-weight: 800;
  color: var(--brand);
}

.wave-preview__boss-mini {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #ffd7d7;
}

.wave-preview__meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.wave-preview__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wave-preview__label {
  flex: none;
  font-size: 10.5px;
  color: var(--text-2);
  letter-spacing: 2px;
}

.wave-preview__traits {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.wave-preview__trait {
  font-size: 10.5px;
  padding: 1px 8px;
  color: var(--text);
  background: rgba(90, 104, 128, 0.4);
  border-color: rgba(255, 255, 255, 0.16);
  cursor: help;
}

.wave-preview__start {
  align-self: center;
  min-width: 180px;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 2px;
}

/* 矮屏（手机横屏）：建造栏只有 ~50px，预览随之贴底收紧 */
@media (max-height: 520px) {
  .wave-preview {
    bottom: calc(56px + var(--safe-bottom));
    padding: 6px 10px 8px;
    gap: 5px;
  }
  .wave-preview__title { font-size: 13px; }
  .wave-preview__sub { font-size: 10px; }
  .wave-preview__enemy { gap: 3px; }
  .wave-preview__name { font-size: 10.5px; }
  .wave-preview__count { font-size: 10.5px; }
  .wave-preview__start {
    min-width: 140px;
    font-size: 13px;
    padding-top: 4px;
    padding-bottom: 4px;
  }
}
</style>
