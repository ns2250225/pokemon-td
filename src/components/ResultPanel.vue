<script setup lang="ts">
/**
 * 关卡结算面板 —— 星级评价、统计、新解锁、重试 / 下一关 / 返回。
 */
import { computed } from 'vue';
import type { BattleResult } from '../game/scenes/BattleScene';
import { POKEDEX } from '../data/pokemon/pokedex';

const props = defineProps<{
  result: BattleResult;
  levelName: string;
  hasNext: boolean;
  /** 本次通关新解锁的精灵编号（空则不展示） */
  newUnlocks?: number[];
}>();

const emit = defineEmits<{
  (e: 'retry'): void;
  (e: 'next'): void;
  (e: 'exit'): void;
}>();

const hpPercent = computed(() => Math.round(props.result.hpRatio * 100));
const timeText = computed(() => {
  const total = Math.floor(props.result.timeMs / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
});

const starText = computed(() => ['', '通关', '守住半数生命', '满生命通关'][props.result.stars] ?? '');
</script>

<template>
  <div class="overlay">
    <div class="result panel" :class="result.victory ? 'is-win' : 'is-lose'">
      <div class="result__banner">
        <span class="result__icon">{{ result.victory ? '🏆' : '💥' }}</span>
        <h2>{{ result.victory ? '关卡通过' : '防守失败' }}</h2>
        <p class="result__level">{{ levelName }}</p>
      </div>

      <div v-if="result.victory" class="result__stars">
        <span
          v-for="s in 3"
          :key="s"
          class="result-star"
          :class="{ 'is-on': result.stars >= s }"
          :style="{ animationDelay: `${s * 0.16}s` }"
        >★</span>
      </div>
      <p class="result__star-note">{{ result.victory ? starText : '基地生命归零，再试一次吧' }}</p>

      <div v-if="newUnlocks?.length" class="result__unlock">
        <span class="result__unlock-label">🎉 新解锁</span>
        <span v-for="id in newUnlocks" :key="id" class="result__unlock-chip">
          {{ POKEDEX[id]?.nameZh ?? `#${id}` }}
        </span>
      </div>

      <div class="result__stats">
        <div class="rstat">
          <span class="rstat__label">剩余生命</span>
          <strong :class="{ 'is-low': hpPercent < 50 }">{{ hpPercent }}%</strong>
        </div>
        <div class="rstat">
          <span class="rstat__label">击败敌人</span>
          <strong>{{ result.enemiesKilled }}</strong>
        </div>
        <div class="rstat">
          <span class="rstat__label">通过波次</span>
          <strong>{{ result.wavesCleared }}</strong>
        </div>
        <div class="rstat">
          <span class="rstat__label">用时</span>
          <strong>{{ timeText }}</strong>
        </div>
        <div class="rstat rstat--wide">
          <span class="rstat__label">获得金币</span>
          <strong class="is-coin">🪙 {{ result.coinsEarned }}</strong>
        </div>
      </div>

      <div class="result__actions">
        <button v-if="result.victory && hasNext" class="btn btn--primary btn--lg" @click="emit('next')">
          下一关 →
        </button>
        <button v-else-if="result.victory" class="btn btn--primary btn--lg" @click="emit('exit')">
          返回关卡选择
        </button>
        <button class="btn btn--ghost" @click="emit('retry')">重新挑战</button>
        <button v-if="!result.victory" class="btn btn--ghost" @click="emit('exit')">返回关卡选择</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: rgba(6, 9, 13, 0.82);
  backdrop-filter: blur(5px);
}

.result {
  width: min(460px, 92vw);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  animation: float-up 0.24s ease;
  border-width: 2px;
}

.result.is-win { border-color: rgba(74, 222, 128, 0.5); box-shadow: 0 0 40px rgba(74, 222, 128, 0.18); }
.result.is-lose { border-color: rgba(248, 113, 113, 0.5); box-shadow: 0 0 40px rgba(248, 113, 113, 0.15); }

.result__banner { text-align: center; }

.result__icon { font-size: 44px; display: block; line-height: 1.1; }

.result h2 {
  margin: 4px 0 0;
  font-size: 26px;
  letter-spacing: 3px;
}

.result.is-win h2 { color: var(--good); }
.result.is-lose h2 { color: var(--bad); }

.result__level {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-2);
}

.result__stars {
  display: flex;
  gap: 10px;
  font-size: 40px;
  line-height: 1;
}

.result-star {
  color: #3d4654;
  animation: star-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.result-star.is-on {
  color: var(--brand);
  text-shadow: 0 0 18px rgba(255, 203, 5, 0.75);
}

@keyframes star-pop {
  from { transform: scale(0.4) rotate(-40deg); opacity: 0; }
  to { transform: scale(1) rotate(0); opacity: 1; }
}

.result__star-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-1);
}

.result__unlock {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgba(255, 203, 5, 0.1);
  border: 1px dashed rgba(255, 203, 5, 0.45);
  animation: float-up 0.3s ease 0.35s both;
}

.result__unlock-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--brand);
}

.result__unlock-chip {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-2);
  border: 1px solid var(--line);
  font-size: 12px;
  font-weight: 700;
}

.result__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  width: 100%;
}

.rstat {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: 7px 4px;
}

.rstat--wide { grid-column: span 4; flex-direction: row; justify-content: center; gap: 8px; }

.rstat__label { font-size: 9.5px; color: var(--text-2); }
.rstat strong { font-size: 15px; }
.rstat strong.is-low { color: var(--bad); }
.rstat strong.is-coin { color: var(--brand); }

.result__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
}
</style>
