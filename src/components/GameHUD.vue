<script setup lang="ts">
/**
 * 顶部状态栏 —— 关卡名、基地生命、金币、波次进度、速度、暂停。
 */
import { computed } from 'vue';
import { SPEED_OPTIONS, type GameSpeed } from '../game/config';

const props = defineProps<{
  coins: number;
  hp: number;
  maxHp: number;
  levelId: string;
  levelName: string;
  chapterName: string;
  waveIndex: number;
  waveTotal: number;
  speed: GameSpeed;
}>();

const emit = defineEmits<{
  (e: 'pause'): void;
  (e: 'set-speed', speed: GameSpeed): void;
}>();

const hpPercent = computed(() => Math.max(0, Math.min(100, (props.hp / Math.max(1, props.maxHp)) * 100)));
const hpTone = computed(() => (hpPercent.value > 60 ? 'good' : hpPercent.value > 30 ? 'warn' : 'bad'));
/** 未开始的波次显示为 0，避免显示 "1/10" 让玩家误以为已经在打 */
const waveLabel = computed(() => `${Math.max(0, props.waveIndex + 1)}/${props.waveTotal}`);

const hearts = computed(() => {
  const total = props.maxHp;
  // 生命值很多时用进度条，少时用爱心
  return total <= 12 ? Array.from({ length: total }, (_, i) => i < props.hp) : null;
});
</script>

<template>
  <header class="hud">
    <div class="hud__left">
      <div class="hud__level">
        <span class="hud__chapter">{{ chapterName }}</span>
        <strong>{{ levelName }}</strong>
      </div>
    </div>

    <div class="hud__center">
      <div class="hud__stat hud__stat--hp">
        <span class="hud__label">基地生命</span>
        <div v-if="hearts" class="hud__hearts">
          <span v-for="(alive, i) in hearts" :key="i" :class="{ 'is-off': !alive }">❤</span>
        </div>
        <div v-else class="hud__bar">
          <div class="hud__bar-fill" :class="`tone-${hpTone}`" :style="{ width: hpPercent + '%' }" />
          <span class="hud__bar-text">{{ hp }}/{{ maxHp }}</span>
        </div>
      </div>

      <div class="hud__stat">
        <span class="hud__label">金币</span>
        <strong class="hud__value hud__value--coin">🪙 {{ coins }}</strong>
      </div>

      <div class="hud__stat">
        <span class="hud__label">波次</span>
        <strong class="hud__value">🌊 {{ waveLabel }}</strong>
      </div>
    </div>

    <div class="hud__right">
      <div class="speed-group">
        <button
          v-for="s in SPEED_OPTIONS"
          :key="s"
          class="speed-btn"
          :class="{ 'is-active': speed === s }"
          :aria-pressed="speed === s"
          @click="emit('set-speed', s)"
        >
          {{ s }}×
        </button>
      </div>
      <button class="btn btn--ghost btn--sm hud__pause" @click="emit('pause')">
        ⏸ 暂停
      </button>
    </div>
  </header>
</template>

<style scoped>
.hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(6px + var(--safe-top)) calc(12px + var(--safe-right)) 6px calc(12px + var(--safe-left));
  background: linear-gradient(180deg, rgba(13, 17, 23, 0.95), rgba(13, 17, 23, 0.35));
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(8px);
  flex-wrap: wrap;
}

.hud__left { min-width: 0; flex: 0 1 auto; }

.hud__chapter {
  display: block;
  font-size: 10px;
  color: var(--text-2);
  letter-spacing: 1px;
}

.hud__left strong {
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  max-width: 30vw;
}

.hud__center {
  display: flex;
  align-items: center;
  gap: clamp(10px, 2.4vw, 28px);
  flex: 1;
  justify-content: center;
}

.hud__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.hud__label {
  font-size: 9.5px;
  color: var(--text-2);
  letter-spacing: 0.5px;
}

.hud__value {
  font-size: 15px;
  font-weight: 800;
  white-space: nowrap;
}

.hud__value--coin { color: var(--brand); }

.hud__hearts {
  display: flex;
  gap: 1px;
  font-size: 13px;
  color: #ff6b6b;
  line-height: 1;
}

.hud__hearts .is-off { color: #3a4250; }

.hud__bar {
  position: relative;
  width: 96px;
  height: 12px;
  border-radius: var(--radius-pill);
  background: #2a323f;
  overflow: hidden;
}

.hud__bar-fill {
  height: 100%;
  transition: width 0.24s ease;
  border-radius: var(--radius-pill);
}

.hud__bar-fill.tone-good { background: linear-gradient(90deg, #34d399, #4ade80); }
.hud__bar-fill.tone-warn { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.hud__bar-fill.tone-bad { background: linear-gradient(90deg, #dc2626, #f87171); }

.hud__bar-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 9px;
  font-weight: 800;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.hud__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
}

.speed-group {
  display: flex;
  background: var(--bg-2);
  border-radius: var(--radius-pill);
  padding: 2px;
  border: 1px solid var(--line);
}

.speed-btn {
  min-width: 38px;
  min-height: 30px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 800;
  color: var(--text-2);
  transition: all 0.14s ease;
}

.speed-btn.is-active {
  background: var(--brand);
  color: #3a2c00;
}

@media (max-width: 720px) {
  .hud__left strong { max-width: 22vw; font-size: 13px; }
  .hud__pause { padding: 0 10px; font-size: 12px; }
  .speed-btn { min-width: 32px; font-size: 11px; }
  .hud__value { font-size: 13px; }
}
</style>
