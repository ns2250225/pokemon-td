<script setup lang="ts">
/**
 * 属性徽章 —— 显示单 / 双属性，配色来自统一的属性表。
 */
import { computed } from 'vue';
import { TYPE_COLORS, TYPE_COLORS_DARK, TYPE_LABELS, type PokemonType } from '../data/balance/typeChart';

const props = withDefaults(defineProps<{
  types: (PokemonType | string)[];
  size?: 'sm' | 'md' | 'lg';
  /** 是否在徽章上显示克制倍率提示 */
  multiplier?: number | null;
}>(), {
  size: 'md',
  multiplier: null,
});

const items = computed(() => props.types.map((t) => {
  const key = t as PokemonType;
  return {
    key,
    label: TYPE_LABELS[key] ?? String(t),
    color: TYPE_COLORS[key] ?? TYPE_COLORS.normal,
    dark: TYPE_COLORS_DARK[key] ?? TYPE_COLORS_DARK.normal,
  };
}));
</script>

<template>
  <div class="type-badges" :class="`type-badges--${size}`">
    <span
      v-for="t in items"
      :key="t.key"
      class="chip type-chip"
      :style="{ background: `linear-gradient(180deg, ${t.color}, ${t.dark})` }"
    >
      {{ t.label }}
    </span>
    <span
      v-if="multiplier !== null && multiplier !== undefined"
      class="type-badges__mult"
      :class="{
        'is-super': multiplier >= 1.9,
        'is-good': multiplier > 1.01 && multiplier < 1.9,
        'is-weak': multiplier < 0.99,
      }"
    >
      ×{{ multiplier.toFixed(2) }}
    </span>
  </div>
</template>

<style scoped>
.type-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.type-chip {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.22);
}

.type-badges--sm .type-chip { font-size: 10px; padding: 1px 6px; }
.type-badges--md .type-chip { font-size: 12px; padding: 3px 9px; }
.type-badges--lg .type-chip { font-size: 14px; padding: 5px 12px; }

.type-badges__mult {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-2);
  padding-left: 2px;
}

.type-badges__mult.is-super { color: #ff8a5c; }
.type-badges__mult.is-good { color: #ffc766; }
.type-badges__mult.is-weak { color: #7f8ea3; }
</style>
