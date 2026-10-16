<script setup lang="ts">
/**
 * BOSS 血条 —— 顶部固定的长条 + 名称 + 属性提示（PRD 7.4）。
 */
import { computed } from 'vue';
import PokemonImage from './PokemonImage.vue';
import { POKEDEX } from '../data/pokemon/pokedex';
import { ENEMY_TRAITS } from '../data/pokemon/units';

const props = defineProps<{
  pokemonId: number;
  name: string;
  hpRatio: number;
}>();

const entry = computed(() => POKEDEX[props.pokemonId]);
const traits = computed(() => {
  const e = entry.value;
  if (!e) return [];
  // 用条目属性推导展示用的特性标签（与敌方配置一致的规则子集）
  const out: string[] = [];
  if (e.rarity !== 'normal') out.push(ENEMY_TRAITS.boss.label);
  if (e.types.includes('flying')) out.push(ENEMY_TRAITS.flying.label);
  if (e.types.includes('ghost')) out.push(ENEMY_TRAITS.stealth.label);
  if (e.baseStats.hp >= 100) out.push(ENEMY_TRAITS.regen.label);
  return out;
});

const percent = computed(() => Math.max(0, Math.min(100, props.hpRatio * 100)));
</script>

<template>
  <div class="boss-bar">
    <PokemonImage
      :pokemon-id="pokemonId"
      :name="name"
      :type="entry?.types[0]"
      variant="battle"
      :size="34"
    />
    <div class="boss-bar__body">
      <div class="boss-bar__head">
        <strong>{{ name }}</strong>
        <span v-for="t in traits" :key="t" class="boss-bar__trait">{{ t }}</span>
      </div>
      <div class="boss-bar__track">
        <div class="boss-bar__fill" :style="{ width: percent + '%' }" />
      </div>
    </div>
    <span class="boss-bar__percent">{{ Math.ceil(percent) }}%</span>
  </div>
</template>

<style scoped>
.boss-bar {
  position: absolute;
  top: calc(var(--safe-top) + 62px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(520px, 86vw);
  padding: 6px 12px;
  border-radius: var(--radius);
  background: linear-gradient(90deg, rgba(120, 20, 20, 0.9), rgba(60, 10, 10, 0.9));
  border: 2px solid rgba(248, 113, 113, 0.55);
  box-shadow: 0 6px 24px rgba(220, 38, 38, 0.3);
  animation: float-up 0.3s ease;
}

.boss-bar__body { flex: 1; min-width: 0; }

.boss-bar__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}

.boss-bar__head strong {
  font-size: 13px;
  letter-spacing: 1px;
  white-space: nowrap;
}

.boss-bar__trait {
  font-size: 9px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.16);
  color: #ffdede;
}

.boss-bar__track {
  height: 9px;
  border-radius: var(--radius-pill);
  background: rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.boss-bar__fill {
  height: 100%;
  background: linear-gradient(90deg, #f87171, #fca5a5);
  transition: width 0.2s ease;
}

.boss-bar__percent {
  font-size: 12px;
  font-weight: 800;
  color: #ffd0d0;
}
</style>
