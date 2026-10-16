<script setup lang="ts">
/**
 * 主菜单 —— 开始游戏、图鉴、成就、设置、全屏。
 */
import { computed, ref } from 'vue';
import PokemonImage from './PokemonImage.vue';
import { useProgressStore } from '../stores/progress';
import { audioEngine } from '../utils/audio';
import { POKEDEX, TOTAL_SPECIES } from '../data/pokemon/pokedex';
import { CHAPTERS, getAllLevels } from '../data/levels/levels';

const emit = defineEmits<{
  (e: 'play'): void;
  (e: 'pokedex'): void;
  (e: 'settings'): void;
  (e: 'achievements'): void;
  (e: 'toggle-fullscreen'): void;
}>();

defineProps<{
  isFullscreen: boolean;
  fullscreenSupported: boolean;
}>();

const progress = useProgressStore();
const hovered = ref<number | null>(null);

/** 主菜单上的招牌精灵：皮卡丘 / 喷火龙 / 水箭龟 / 妙蛙花 / 超梦 */
const showcase = [25, 6, 9, 3, 150];

const stats = computed(() => [
  { label: '已通关', value: `${progress.clearedCount}/${getAllLevels().length}` },
  { label: '总星数', value: `${progress.totalStars}/${progress.maxStars}` },
  { label: '图鉴发现', value: `${progress.discoveryRatio}/${TOTAL_SPECIES}` },
  { label: '可用精灵', value: String(progress.unlockedPokemon.length) },
]);

const lastLevel = computed(() => {
  const all = getAllLevels();
  // 找到第一个未通关的关卡
  const next = all.find((l) => !progress.levels[l.id]?.cleared);
  return next ?? all[all.length - 1];
});

function onHover(id: number | null) {
  hovered.value = id;
  if (id !== null) audioEngine.play('ui_hover');
}

function click(fn: () => void) {
  audioEngine.play('ui_confirm');
  fn();
}
</script>

<template>
  <div class="menu">
    <div class="menu__bg-decor" aria-hidden="true">
      <span v-for="i in 18" :key="i" class="spark" :style="{ '--i': i }" />
    </div>

    <header class="menu__header">
      <div class="menu__logo">
        <span class="menu__ball" aria-hidden="true" />
        <div>
          <h1>宝可梦守卫战</h1>
          <p>Pokémon Tower Defense · 2D 策略塔防</p>
        </div>
      </div>

      <div class="menu__top-actions">
        <button
          class="btn btn--ghost btn--sm"
          :disabled="!fullscreenSupported"
          :title="fullscreenSupported ? '切换全屏' : '当前浏览器不支持全屏'"
          @click="click(() => emit('toggle-fullscreen'))"
        >
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </button>
      </div>
    </header>

    <div class="menu__body">
      <div class="menu__showcase" @mouseleave="onHover(null)">
        <div
          v-for="id in showcase"
          :key="id"
          class="showcase-card"
          :class="{ 'is-hover': hovered === id }"
          @mouseenter="onHover(id)"
        >
          <PokemonImage
            :pokemon-id="id"
            :name="POKEDEX[id]?.nameZh"
            :type="POKEDEX[id]?.types[0]"
            variant="portrait"
            pixelated
            :size="hovered === id ? 132 : 112"
          />
          <span class="showcase-card__name">{{ POKEDEX[id]?.nameZh }}</span>
        </div>
      </div>

      <nav class="menu__actions">
        <button class="btn btn--primary btn--lg menu__play" @click="click(() => emit('play'))">
          <span class="menu__play-icon">▶</span>
          开始游戏
        </button>

        <div class="menu__sub">
          <button class="btn btn--ghost" @click="click(() => emit('pokedex'))">
            宝可梦图鉴
          </button>
          <button class="btn btn--ghost" @click="click(() => emit('achievements'))">
            成就
          </button>
          <button class="btn btn--ghost" @click="click(() => emit('settings'))">
            设置
          </button>
        </div>

        <div class="menu__continue" v-if="lastLevel">
          <span class="menu__continue-label">继续进度</span>
          <strong>{{ lastLevel.name }}</strong>
          <span class="menu__continue-sub">{{ CHAPTERS[lastLevel.chapter - 1].mechanic }}</span>
        </div>
      </nav>
    </div>

    <footer class="menu__stats">
      <div v-for="s in stats" :key="s.label" class="stat">
        <span class="stat__value">{{ s.value }}</span>
        <span class="stat__label">{{ s.label }}</span>
      </div>
      <p class="menu__notice">
        非商业技术原型 · 素材授权状态见 docs/ASSET_LICENSES.md
      </p>
    </footer>
  </div>
</template>

<style scoped>
.menu {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px clamp(16px, 4vw, 48px);
  position: relative;
  overflow: hidden;
}

.menu__bg-decor {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.spark {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--brand);
  opacity: 0.35;
  left: calc((var(--i) * 53) % 100 * 1%);
  top: calc((var(--i) * 37) % 100 * 1%);
  animation: float-slow calc(6s + var(--i) * 0.4s) ease-in-out infinite alternate;
}

@keyframes float-slow {
  from { transform: translateY(0) scale(1); opacity: 0.15; }
  to { transform: translateY(-26px) scale(1.5); opacity: 0.5; }
}

.menu__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.menu__logo {
  display: flex;
  align-items: center;
  gap: 14px;
}

.menu__ball {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: linear-gradient(180deg, #ee4444 0 48%, #f5f5f5 48% 56%, #f5f5f5 100%);
  border: 4px solid #2b3340;
  position: relative;
  box-shadow: var(--shadow);
  flex: none;
}

.menu__ball::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f5f5f5;
  border: 4px solid #2b3340;
}

.menu h1 {
  margin: 0;
  font-size: clamp(24px, 3.4vw, 40px);
  letter-spacing: 2px;
  background: linear-gradient(180deg, #fff3b0, var(--brand));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 3px 12px rgba(255, 203, 5, 0.25);
}

.menu__logo p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-2);
  letter-spacing: 0.5px;
}

.menu__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: clamp(16px, 3vw, 44px);
  align-items: center;
}

@media (max-width: 860px) {
  .menu__body { grid-template-columns: 1fr; gap: 12px; }
  .menu__showcase { order: 2; }
  .menu__actions { order: 1; }
}

.menu__showcase {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: clamp(6px, 1.4vw, 20px);
  flex-wrap: wrap;
  padding-bottom: 8px;
}

.showcase-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  padding: 6px;
  border-radius: var(--radius);
}

.showcase-card.is-hover {
  transform: translateY(-10px);
}

.showcase-card__name {
  font-size: 12px;
  color: var(--text-1);
  font-weight: 700;
}

.menu__actions {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: stretch;
  max-width: 420px;
  justify-self: center;
  width: 100%;
}

.menu__play {
  animation: pulse-glow 2.4s ease-out infinite;
  font-size: 20px;
}

.menu__play-icon { font-size: 15px; }

.menu__sub {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.menu__continue {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed var(--line);
}

.menu__continue-label {
  font-size: 11px;
  color: var(--text-2);
  letter-spacing: 1px;
}

.menu__continue strong { font-size: 16px; }

.menu__continue-sub {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
}

.menu__stats {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: clamp(14px, 3vw, 40px);
  padding-top: 12px;
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}

.stat {
  display: flex;
  flex-direction: column;
}

.stat__value {
  font-size: 18px;
  font-weight: 800;
  color: var(--brand);
}

.stat__label {
  font-size: 11px;
  color: var(--text-2);
}

.menu__notice {
  margin: 0 0 0 auto;
  font-size: 11px;
  color: var(--text-2);
  max-width: 44ch;
  text-align: right;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .menu__notice { display: none; }
}

/* 矮屏（手机横屏）：压缩主菜单垂直布局，底部统计条保持可见 */
@media (max-height: 480px) {
  .menu { padding: 6px clamp(12px, 3vw, 32px); }
  .menu__ball { width: 30px; height: 30px; }
  .menu__header h1 { font-size: 22px; }
  .menu__header p { font-size: 11px; }
  .menu__body { gap: 10px; }
  .menu__showcase { flex-wrap: nowrap; gap: 12px; padding-bottom: 2px; }
  .menu__showcase :deep(.pkm-img) { height: 46px !important; width: auto !important; }
  .menu__showcase :deep(img) { height: 100%; width: 100%; }
  .showcase-card__name { font-size: 10px; }
  .menu__play { font-size: 15px; }
  .menu__stats { padding-top: 5px; gap: 14px; }
}

</style>
