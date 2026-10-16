<script setup lang="ts">
/**
 * 精灵图像组件 —— 统一的素材回退链。
 *
 * 回退顺序（PRD 13.1「精灵图片：批量获取，缺失检测和回退显示」）：
 *   动态图集 → 静态像素图 → 立绘 → 纯 CSS 占位（显示属性色 + 中文名首字）
 *
 * 使用 <img> 而非 canvas，让浏览器自己处理解码与缓存，
 * 并且在预缓存（offline.ts）之后可以完全离线显示。
 */

import { computed, ref, watch } from 'vue';
import { texturePublicPath } from '../utils/assetPaths';
import { TYPE_COLORS } from '../data/balance/typeChart';
import type { PokemonType } from '../data/balance/typeChart';

const props = withDefaults(defineProps<{
  pokemonId: number;
  name?: string;
  type?: PokemonType | string;
  /** 展示用途决定优先使用的素材 */
  variant?: 'battle' | 'portrait' | 'icon' | 'shiny';
  /** 逻辑像素尺寸（宽高相同） */
  size?: number;
  /** 是否使用像素风渲染（image-rendering: pixelated） */
  pixelated?: boolean;
}>(), {
  variant: 'battle',
  size: 64,
  pixelated: true,
});

const kindIndex = ref(0);
const failed = ref(false);

const chain = computed(() => {
  const id = props.pokemonId;
  switch (props.variant) {
    case 'portrait':
      return [texturePublicPath('portrait', id), texturePublicPath('static', id), texturePublicPath('shiny', id)];
    case 'icon':
      return [texturePublicPath('icon', id), texturePublicPath('static', id), texturePublicPath('portrait', id)];
    case 'shiny':
      return [texturePublicPath('shiny', id), texturePublicPath('static', id), texturePublicPath('portrait', id)];
    case 'battle':
    default:
      // 战斗优先用图集首帧（用 CSS 显示一张图集的可见部分不方便），
      // 因此这里用静态图；动态动画由 Phaser 场景负责。
      return [texturePublicPath('static', id), texturePublicPath('icon', id), texturePublicPath('portrait', id)];
  }
});

const src = computed(() => chain.value[kindIndex.value]);

const color = computed(() => {
  const t = (props.type as PokemonType) ?? 'normal';
  return TYPE_COLORS[t] ?? TYPE_COLORS.normal;
});

const initial = computed(() => (props.name ?? '?').slice(0, 1));

watch(() => props.pokemonId, () => {
  kindIndex.value = 0;
  failed.value = false;
});

function onError() {
  if (kindIndex.value < chain.value.length - 1) {
    kindIndex.value++;
  } else {
    failed.value = true;
  }
}
</script>

<template>
  <div
    class="pkm-img"
    :style="{
      width: size + 'px',
      height: size + 'px',
      background: failed ? color + '33' : 'transparent',
    }"
  >
    <img
      v-if="!failed"
      :src="src"
      :alt="name ?? String(pokemonId)"
      loading="lazy"
      decoding="async"
      :style="{ imageRendering: pixelated ? 'pixelated' : 'auto' }"
      @error="onError"
    />
    <span v-else class="pkm-img__fallback" :style="{ color }">{{ initial }}</span>
  </div>
</template>

<style scoped>
.pkm-img {
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 8px;
  overflow: hidden;
}

.pkm-img img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.pkm-img__fallback {
  font-weight: 800;
  font-size: 0.9em;
  opacity: 0.9;
}
</style>
