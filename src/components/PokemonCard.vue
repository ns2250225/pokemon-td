<script setup lang="ts">
/**
 * 建造卡片 —— 底部建造栏的单个精灵条目。
 *
 * 展示费用、属性、职业定位；金币不足时置灰但仍可见（便于规划）。
 */
import { computed } from 'vue';
import PokemonImage from './PokemonImage.vue';
import TypeBadges from './TypeBadges.vue';
import { getTowerConfig } from '../data/pokemon/units';
import { POKEDEX } from '../data/pokemon/pokedex';
import { TYPE_COLORS, type PokemonType } from '../data/balance/typeChart';
import { useProgressStore } from '../stores/progress';
import { bus } from '../utils/eventBus';

const props = defineProps<{
  pokemonId: number;
  coins: number;
  active: boolean;
}>();

const emit = defineEmits<{ (e: 'pick', id: number): void }>();

const progress = useProgressStore();
const config = computed(() => getTowerConfig(props.pokemonId));
const entry = computed(() => POKEDEX[props.pokemonId]);
const affordable = computed(() => props.coins >= (config.value?.cost ?? 0));
const unlocked = computed(() => progress.isUnlocked(props.pokemonId));

const accent = computed(() => TYPE_COLORS[(entry.value?.types[0] as PokemonType) ?? 'normal']);

const archetype = computed(() => config.value?.archetype.label ?? '');

function pick() {
  // 锁定的卡也要有反馈：告诉玩家解锁途径，而不是点了没反应
  if (!unlocked.value) {
    bus.emit('battle:toast', {
      text: `${entry.value?.nameZh ?? '该精灵'} 未解锁 · ${config.value?.unlockHint ?? '通关章节奖励或开启宝箱解锁'}`,
      tone: 'info',
    });
    return;
  }
  if (!affordable.value) {
    bus.emit('battle:toast', { text: `金币不足（需要 ${config.value?.cost ?? 0}）`, tone: 'warn' });
    return;
  }
  emit('pick', props.pokemonId);
}
</script>

<template>
  <button
    class="pcard"
    :class="{ 'is-active': active, 'is-poor': !affordable, 'is-locked': !unlocked }"
    :style="{ '--accent': accent }"
    :disabled="!unlocked"
    :title="config?.archetype.mechanic"
    @click="pick"
  >
    <span class="pcard__cost" :class="{ 'is-poor': !affordable }">
      🪙 {{ config?.cost }}
    </span>

    <div class="pcard__art">
      <PokemonImage
        :pokemon-id="pokemonId"
        :name="entry?.nameZh"
        :type="entry?.types[0]"
        :size="48"
        variant="battle"
      />
    </div>

    <span class="pcard__name">{{ entry?.nameZh }}</span>

    <div class="pcard__types">
      <TypeBadges :types="entry?.types ?? []" size="sm" />
    </div>

    <span class="pcard__archetype">{{ archetype }}</span>

    <span v-if="!unlocked" class="pcard__lock">🔒<i class="pcard__lock-tag">未解锁</i></span>
  </button>
</template>

<style scoped>
.pcard {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: none;
  width: 92px;
  padding: 6px 4px 5px;
  border-radius: var(--radius);
  background: linear-gradient(180deg, rgba(39, 48, 64, 0.92), rgba(21, 27, 36, 0.92));
  border: 2px solid var(--line);
  transition: all 0.14s ease;
  border-top: 3px solid var(--accent);
}

.pcard:hover:not(.is-poor):not(.is-locked) {
  transform: translateY(-3px);
  border-color: var(--brand);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

.pcard:active:not(.is-poor):not(.is-locked) { transform: scale(0.96); }

.pcard.is-active {
  border-color: var(--brand);
  background: linear-gradient(180deg, rgba(255, 203, 5, 0.2), rgba(21, 27, 36, 0.95));
  box-shadow: 0 0 0 3px rgba(255, 203, 5, 0.28);
}

.pcard.is-poor { opacity: 0.55; }
.pcard.is-locked { opacity: 0.6; cursor: not-allowed; }
.pcard.is-locked .pcard__art { filter: grayscale(0.8) brightness(0.7); }
.pcard.is-locked:hover { transform: none; border-color: var(--line); box-shadow: none; }

.pcard__cost {
  position: absolute;
  top: -8px;
  right: -4px;
  font-size: 10px;
  font-weight: 800;
  background: var(--bg-3);
  color: var(--brand);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  white-space: nowrap;
}

.pcard__cost.is-poor { color: var(--bad); }

.pcard__art {
  display: grid;
  place-items: center;
  height: 46px;
}

.pcard__name {
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.pcard__types { transform: scale(0.9); }

.pcard__archetype {
  font-size: 8.5px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.pcard__lock {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 18px;
  display: grid;
  place-items: center;
  gap: 1px;
}

.pcard__lock-tag {
  font-style: normal;
  font-size: 8.5px;
  font-weight: 700;
  color: #dfe7f2;
  background: rgba(15, 20, 28, 0.85);
  border-radius: var(--radius-pill);
  padding: 0 5px;
  white-space: nowrap;
}

/* 矮屏（手机横屏）：压缩建造栏高度，少遮挡战场 */
@media (max-height: 520px) {
  .pcard {
    width: 72px;
    padding: 3px 2px 2px;
    gap: 0;
  }
  .pcard__art { height: 32px; }
  .pcard__art :deep(img) { max-height: 32px; }
  .pcard__name { font-size: 10px; }
  .pcard__archetype { display: none; }
  .pcard__cost { font-size: 9px; top: -6px; }
}
</style>
