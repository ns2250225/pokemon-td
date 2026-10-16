<script setup lang="ts">
/**
 * 关卡选择 —— 8 章节 × 10 关，含星级、解锁状态、章节机制说明。
 */
import { computed, ref } from 'vue';
import PokemonImage from './PokemonImage.vue';
import { CHAPTERS, getAllLevels, type LevelDef } from '../data/levels/levels';
import { useProgressStore } from '../stores/progress';
import { POKEDEX } from '../data/pokemon/pokedex';
import { audioEngine } from '../utils/audio';
import { TYPE_COLORS, type PokemonType } from '../data/balance/typeChart';

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'start', levelId: string): void;
}>();

const progress = useProgressStore();
const activeChapter = ref(progress.chapterProgress.find((c) => c.cleared < c.total)?.chapter.index ?? 1);

const levels = computed(() => getAllLevels().filter((l) => l.chapter === activeChapter.value));
const chapterInfo = computed(() => CHAPTERS[activeChapter.value - 1]);
const chapterStat = computed(() => progress.chapterProgress[activeChapter.value - 1]);

function isLocked(level: LevelDef): boolean {
  return !progress.isLevelUnlocked(level.id);
}

function starsFor(id: string): number {
  return progress.starsFor(id);
}

function selectChapter(index: number) {
  audioEngine.play('ui_click');
  activeChapter.value = index;
}

function start(level: LevelDef) {
  if (isLocked(level)) {
    audioEngine.play('ui_error');
    return;
  }
  audioEngine.play('ui_confirm');
  emit('start', level.id);
}

function paletteGradient(): string {
  const p = chapterInfo.value.palette;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  return `linear-gradient(135deg, ${hex(p.ground)} 0%, ${hex(p.groundAlt)} 50%, ${hex(p.sky)} 100%)`;
}
</script>

<template>
  <div class="levels">
    <header class="levels__bar">
      <button class="btn btn--ghost btn--sm" @click="audioEngine.play('ui_cancel'); emit('back')">
        ← 返回
      </button>
      <h2>选择关卡</h2>
      <div class="levels__total">
        总星数 <strong>{{ progress.totalStars }}</strong> / {{ progress.maxStars }}
      </div>
    </header>

    <div class="levels__chapters scroll">
      <button
        v-for="c in progress.chapterProgress"
        :key="c.chapter.index"
        class="chapter-tab"
        :class="{ 'is-active': c.chapter.index === activeChapter }"
        @click="selectChapter(c.chapter.index)"
      >
        <span class="chapter-tab__index">{{ c.chapter.index }}</span>
        <span class="chapter-tab__name">{{ c.chapter.name }}</span>
        <span class="chapter-tab__progress">{{ c.cleared }}/{{ c.total }}</span>
        <span class="chapter-tab__stars">★{{ c.stars }}</span>
      </button>
    </div>

    <div class="levels__detail panel" :style="{ backgroundImage: paletteGradient() }">
      <div class="levels__detail-inner">
        <div class="levels__chapter-head">
          <div>
            <h3>{{ chapterInfo.name }}</h3>
            <p class="levels__subtitle">{{ chapterInfo.subtitle }}</p>
          </div>
          <div class="levels__boss">
            <span class="levels__boss-label">章节 BOSS</span>
            <PokemonImage
              :pokemon-id="chapterInfo.bossId"
              :name="POKEDEX[chapterInfo.bossId]?.nameZh"
              :type="POKEDEX[chapterInfo.bossId]?.types[0]"
              variant="portrait"
              :size="56"
            />
            <strong>{{ POKEDEX[chapterInfo.bossId]?.nameZh }}</strong>
          </div>
        </div>

        <p class="levels__mechanic">⚙ {{ chapterInfo.mechanic }}</p>

        <div class="levels__types">
          <span class="levels__types-label">本章敌人属性</span>
          <span
            v-for="t in chapterInfo.enemyTypes"
            :key="t"
            class="chip"
            :style="{ background: TYPE_COLORS[t as PokemonType] ?? '#666' }"
          >
            {{ t }}
          </span>
        </div>

        <div class="levels__grid">
          <button
            v-for="level in levels"
            :key="level.id"
            class="level-card"
            :class="{
              'is-locked': isLocked(level),
              'is-cleared': level.id && progress.levels[level.id]?.cleared,
              'is-boss': level.index === 10,
            }"
            @click="start(level)"
          >
            <span class="level-card__num">{{ level.chapter }}-{{ level.index }}</span>
            <span v-if="level.index === 10" class="level-card__boss-tag">BOSS</span>
            <div class="level-card__stars">
              <span
                v-for="s in 3"
                :key="s"
                class="star"
                :class="{ 'is-on': starsFor(level.id) >= s }"
              >★</span>
            </div>
            <div class="level-card__meta">
              <span>🪙 {{ level.startCoins }}</span>
              <span>❤️ {{ level.baseHp }}</span>
              <span>🌊 {{ level.waveCount }}</span>
            </div>
            <span v-if="isLocked(level)" class="level-card__lock">🔒</span>
          </button>
        </div>

        <p class="levels__chapter-progress">
          本章 {{ chapterStat.cleared }}/{{ chapterStat.total }} 关 · {{ chapterStat.stars }}/{{ chapterStat.maxStars }} ★
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.levels {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px clamp(12px, 3vw, 32px);
  gap: 12px;
}

.levels__bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.levels__bar h2 {
  margin: 0;
  font-size: 20px;
  letter-spacing: 1px;
}

.levels__total {
  margin-left: auto;
  font-size: 13px;
  color: var(--text-1);
}

.levels__total strong { color: var(--brand); font-size: 17px; }

.levels__chapters {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  padding-bottom: 4px;
  overflow-x: auto;
  overflow-y: hidden;
}

.chapter-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 108px;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--bg-1);
  border: 2px solid var(--line);
  transition: all 0.16s ease;
  flex: none;
}

.chapter-tab.is-active {
  border-color: var(--brand);
  background: var(--bg-2);
  box-shadow: 0 0 0 3px rgba(255, 203, 5, 0.15);
}

.chapter-tab__index {
  font-size: 10px;
  color: var(--text-2);
  letter-spacing: 1px;
}

.chapter-tab__name {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.chapter-tab__progress,
.chapter-tab__stars {
  font-size: 10px;
  color: var(--text-2);
}

.chapter-tab__stars { color: var(--brand); }

.levels__detail {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background-size: cover;
}

.levels__detail::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(13, 17, 23, 0.55), rgba(13, 17, 23, 0.88));
  backdrop-filter: blur(2px);
}

.levels__detail-inner {
  position: relative;
  height: 100%;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.levels__chapter-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.levels__chapter-head h3 {
  margin: 0;
  font-size: 22px;
  letter-spacing: 1px;
}

.levels__subtitle {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--text-1);
}

.levels__boss {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.35);
  padding: 6px 12px;
  border-radius: var(--radius);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.levels__boss-label {
  font-size: 10px;
  color: var(--warn);
  letter-spacing: 1px;
}

.levels__boss strong { font-size: 13px; }

.levels__mechanic {
  margin: 0;
  font-size: 13px;
  color: var(--text-1);
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--warn);
  line-height: 1.6;
}

.levels__types {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.levels__types-label {
  font-size: 11px;
  color: var(--text-2);
}

.levels__types .chip {
  font-size: 11px;
  padding: 2px 8px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.levels__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
}

.level-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 8px;
  border-radius: var(--radius);
  background: rgba(21, 27, 36, 0.86);
  border: 2px solid var(--line);
  transition: all 0.15s ease;
  min-height: 84px;
}

.level-card:hover:not(.is-locked) {
  border-color: var(--brand);
  transform: translateY(-2px);
}

.level-card:active:not(.is-locked) { transform: scale(0.97); }

.level-card.is-cleared {
  border-color: rgba(74, 222, 128, 0.5);
  background: rgba(21, 40, 30, 0.86);
}

.level-card.is-boss {
  border-color: rgba(248, 113, 113, 0.6);
}

.level-card.is-locked {
  opacity: 0.45;
  cursor: not-allowed;
}

.level-card__num {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.5px;
}

.level-card__boss-tag {
  font-size: 9px;
  font-weight: 800;
  color: #fff;
  background: var(--bad);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  letter-spacing: 1px;
}

.level-card__stars {
  display: flex;
  gap: 1px;
  font-size: 14px;
  color: #3d4654;
}

.star.is-on { color: var(--brand); text-shadow: 0 0 6px rgba(255, 203, 5, 0.6); }

.level-card__meta {
  display: flex;
  gap: 6px;
  font-size: 9.5px;
  color: var(--text-2);
}

.level-card__lock {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 12px;
}

.levels__chapter-progress {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-2);
  text-align: center;
}

/* 矮屏（手机横屏）：收紧关卡选择页 */
@media (max-height: 480px) {
  .levels { padding: 8px clamp(10px, 2vw, 24px); gap: 8px; }
  .levels__detail-inner { padding: 8px 10px; gap: 6px; }
  .levels__grid { gap: 5px; }
}

</style>
