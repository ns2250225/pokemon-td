<script setup lang="ts">
/**
 * 升级 / 进化 / 出售面板 —— 点击已放置精灵后弹出。
 */
import { computed } from 'vue';
import PokemonImage from './PokemonImage.vue';
import TypeBadges from './TypeBadges.vue';
import { POKEDEX } from '../data/pokemon/pokedex';
import { MOVES } from '../data/moves/moves';
import { TYPE_COLORS, type PokemonType } from '../data/balance/typeChart';
const props = defineProps<{
  info: Record<string, unknown>;
  coins: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'upgrade'): void;
  (e: 'evolve'): void;
  (e: 'sell'): void;
  (e: 'switch-move', index: number): void;
}>();

const pokemonId = computed(() => props.info.pokemonId as number);
const entry = computed(() => POKEDEX[pokemonId.value]);
const level = computed(() => props.info.level as number);
const maxLevel = computed(() => props.info.maxLevel as number);
const canUpgrade = computed(() => props.info.canUpgrade as boolean);
const canEvolve = computed(() => props.info.canEvolve as boolean);
const upgradeCost = computed(() => props.info.upgradeCost as number);
const evolutionCost = computed(() => props.info.evolutionCost as number);
const sellValue = computed(() => props.info.sellValue as number);
const evolved = computed(() => props.info.evolved as boolean);
const moves = computed(() => (props.info.moves ?? []) as { id: string; name: string; tier: string; type: string }[]);
const activeMoveIndex = computed(() => (props.info.activeMoveIndex as number) ?? 0);

const canAffordUpgrade = computed(() => props.coins >= upgradeCost.value);
const canAffordEvolve = computed(() => props.coins >= evolutionCost.value);

const accent = computed(() => TYPE_COLORS[(entry.value?.types[0] as PokemonType) ?? 'normal']);

const tierLabel: Record<string, string> = {
  common: '普通', enhanced: '强化', epic: '史诗', legendary: '传说',
};

const damage = computed(() => props.info.damage as number);
const intervalMs = computed(() => props.info.intervalMs as number);
const range = computed(() => props.info.range as number);
const kills = computed(() => (props.info.kills as number) ?? 0);

/** 攻击速度换算成每秒次数，比毫秒更直观 */
const attacksPerSecond = computed(() => (1000 / Math.max(1, intervalMs.value)).toFixed(2));

/** 进化后的数值预览 */
const evolutionPreview = computed(() => {
  const targetId = props.info.evolutionTargetId as number | null;
  if (!targetId) return null;
  const target = POKEDEX[targetId];
  if (!target) return null;
  return {
    id: targetId,
    name: target.nameZh,
    types: target.types,
    statDelta: target.statTotal - (entry.value?.statTotal ?? 0),
  };
});

function moveTier(tier: string) {
  return tierLabel[tier] ?? tier;
}

function moveColor(type: string) {
  return TYPE_COLORS[type as PokemonType] ?? '#888';
}

function moveDescription(id: string) {
  return MOVES[id]?.description ?? '';
}
</script>

<template>
  <div class="upgrade panel" :style="{ '--accent': accent }">
    <button class="upgrade__close" aria-label="关闭" @click="emit('close')">✕</button>

    <div class="upgrade__head">
      <PokemonImage
        :pokemon-id="pokemonId"
        :name="entry?.nameZh"
        :type="entry?.types[0]"
        variant="portrait"
        :size="62"
      />
      <div class="upgrade__title">
        <div class="upgrade__name">
          <strong>{{ entry?.nameZh }}</strong>
          <span class="upgrade__level">Lv.{{ level }}/{{ maxLevel }}</span>
          <span v-if="evolved" class="upgrade__evolved">已进化</span>
        </div>
        <TypeBadges :types="entry?.types ?? []" size="sm" />
      </div>
    </div>

    <div class="upgrade__stats">
      <div class="stat-cell">
        <span class="stat-cell__label">攻击力</span>
        <strong>{{ damage }}</strong>
      </div>
      <div class="stat-cell">
        <span class="stat-cell__label">每秒攻击</span>
        <strong>{{ attacksPerSecond }}</strong>
      </div>
      <div class="stat-cell">
        <span class="stat-cell__label">射程</span>
        <strong>{{ range }}</strong>
      </div>
      <div class="stat-cell">
        <span class="stat-cell__label">击杀</span>
        <strong>{{ kills }}</strong>
      </div>
    </div>

    <div class="upgrade__moves">
      <span class="upgrade__section">可用招式（点击切换）</span>
      <button
        v-for="(m, i) in moves"
        :key="m.id"
        class="move-chip"
        :class="{ 'is-active': i === activeMoveIndex }"
        :style="{ '--mcolor': moveColor(m.type) }"
        :title="moveDescription(m.id)"
        @click="emit('switch-move', i)"
      >
        <span class="move-chip__tier">{{ moveTier(m.tier) }}</span>
        {{ m.name }}
      </button>
    </div>

    <div class="upgrade__actions">
      <button
        v-if="canUpgrade"
        class="btn btn--good upgrade__btn"
        :aria-disabled="!canAffordUpgrade"
        @click="canAffordUpgrade && emit('upgrade')"
      >
        升级 <span class="upgrade__cost">🪙 {{ upgradeCost }}</span>
      </button>
      <div v-else class="upgrade__maxed">已达最高等级</div>

      <button
        v-if="canEvolve"
        class="btn btn--primary upgrade__btn upgrade__btn--evolve"
        :aria-disabled="!canAffordEvolve"
        @click="canAffordEvolve && emit('evolve')"
      >
        进化 → {{ evolutionPreview?.name ?? '???' }}
        <span class="upgrade__cost">🪙 {{ evolutionCost }}</span>
      </button>
      <div v-else-if="!evolved && info.evolutionTargetId" class="upgrade__hint">
        升到 Lv.3 后可进化
      </div>

      <button class="btn btn--danger upgrade__btn upgrade__btn--sell" @click="emit('sell')">
        出售 <span class="upgrade__cost">🪙 +{{ sellValue }}</span>
      </button>
    </div>

    <div v-if="evolutionPreview" class="upgrade__preview">
      进化预览：种族值总和 {{ evolutionPreview.statDelta >= 0 ? '+' : '' }}{{ evolutionPreview.statDelta }}
    </div>
  </div>
</template>

<style scoped>
.upgrade {
  position: absolute;
  right: calc(10px + var(--safe-right));
  bottom: calc(130px + var(--safe-bottom));
  z-index: 30;
  width: 264px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 3px solid var(--accent);
  animation: float-up 0.18s ease;
}

.upgrade__close {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--bg-3);
  color: var(--text-1);
  font-size: 13px;
  display: grid;
  place-items: center;
}

.upgrade__head {
  display: flex;
  gap: 10px;
  align-items: center;
}

.upgrade__title { min-width: 0; }

.upgrade__name {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 3px;
}

.upgrade__name strong { font-size: 16px; }

.upgrade__level {
  font-size: 11px;
  font-weight: 800;
  color: var(--brand);
  background: rgba(255, 203, 5, 0.14);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}

.upgrade__evolved {
  font-size: 10px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(90deg, #a855f7, #ec4899);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}

.upgrade__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: 5px 2px;
}

.stat-cell__label { font-size: 9px; color: var(--text-2); }
.stat-cell strong { font-size: 14px; }

.upgrade__section {
  font-size: 10px;
  color: var(--text-2);
  letter-spacing: 0.5px;
}

.upgrade__moves {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.move-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-left: 3px solid var(--mcolor);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-1);
  transition: all 0.14s ease;
  text-align: left;
}

.move-chip:hover { background: var(--bg-3); }

.move-chip.is-active {
  background: rgba(255, 203, 5, 0.14);
  border-color: var(--brand);
  color: var(--text-0);
}

.move-chip__tier {
  font-size: 9px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--mcolor);
  color: #fff;
  flex: none;
}

.upgrade__actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.upgrade__btn {
  width: 100%;
  justify-content: space-between;
  font-size: 13px;
}

.upgrade__btn--sell { font-size: 12px; }

.upgrade__cost {
  font-size: 11px;
  opacity: 0.9;
}

.upgrade__maxed,
.upgrade__hint {
  text-align: center;
  font-size: 11px;
  color: var(--text-2);
  padding: 6px;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
}

.upgrade__preview {
  font-size: 10.5px;
  color: var(--text-2);
  text-align: center;
  line-height: 1.5;
}

@media (max-width: 700px) {
  .upgrade {
    width: calc(100vw - 20px);
    max-width: 320px;
    right: auto;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(128px + var(--safe-bottom));
  }
}

/* 矮屏（手机横屏）：面板被顶栏与建造栏夹在中间，可用高度只有 ~240px。
   限制面板高度、超高内部滚动，并整体压缩内容，保证标题/属性/招式/按钮全部可达。 */
@media (max-height: 520px) {
  .upgrade {
    bottom: calc(96px + var(--safe-bottom));
    max-height: calc(100vh - 96px - 88px); /* 底栏 96 + 顶部 HUD 84 + 余量 */
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    width: min(300px, calc(100vw - 16px));
    padding: 8px 10px;
    gap: 5px;
  }
  .upgrade__head { gap: 8px; }
  .upgrade__head :deep(.pkm-img) { height: 38px !important; width: 38px !important; }
  .upgrade__name strong { font-size: 13px; }
  .upgrade__stats { gap: 3px; }
  .stat-cell { padding: 2px 2px; }
  .stat-cell__label { font-size: 8px; }
  .stat-cell strong { font-size: 12px; }
  .upgrade__moves { gap: 3px; }
  .move-chip { padding: 3px 7px; font-size: 10.5px; }
  .upgrade__actions { gap: 4px; }
  .upgrade__btn { min-height: 32px; font-size: 12px; }
  .upgrade__close { top: 4px; right: 6px; width: 22px; height: 22px; font-size: 11px; }
}

</style>
