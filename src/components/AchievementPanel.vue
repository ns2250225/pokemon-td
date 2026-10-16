<script setup lang="ts">
/**
 * 成就面板 —— 通关、收集、挑战三类成就（PRD 13.1）。
 */
import { computed } from 'vue';
import { useProgressStore, ACHIEVEMENT_DEFS } from '../stores/progress';
import { audioEngine } from '../utils/audio';

const emit = defineEmits<{ (e: 'back'): void }>();

const progress = useProgressStore();

const unlockedIds = computed(() => new Set(progress.achievements.map((a) => a.id)));

/** 用 store 里的统一定义表计算进度，避免两处表格逐渐不一致 */
const rows = computed(() =>
  ACHIEVEMENT_DEFS.map((def) => {
    const owned = progress.achievements.find((a) => a.id === def.id);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      unlocked: unlockedIds.value.has(def.id),
      unlockedAt: owned?.unlockedAt ?? 0,
      ...def.progress(progress.achievementState()),
    };
  }).map((r) => ({ ...r, ratio: Math.min(1, r.current / Math.max(1, r.target)) })),
);

const unlockedCount = computed(() => rows.value.filter((r) => r.unlocked).length);
const grouped = computed(() => {
  const cats: ('通关' | '挑战' | '收集')[] = ['通关', '挑战', '收集'];
  return cats.map((c) => ({ category: c, items: rows.value.filter((r) => r.category === c) }));
});

function fmtDate(ts: number) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="ach">
    <header class="ach__bar">
      <button class="btn btn--ghost btn--sm" @click="audioEngine.play('ui_cancel'); emit('back')">← 返回</button>
      <h2>成就</h2>
      <span class="ach__count">已解锁 <strong>{{ unlockedCount }}</strong> / {{ rows.length }}</span>
    </header>

    <div class="ach__summary panel">
      <div class="ach-stat">
        <span class="ach-stat__value">{{ progress.clearedCount }}</span>
        <span class="ach-stat__label">通关关卡</span>
      </div>
      <div class="ach-stat">
        <span class="ach-stat__value">{{ progress.totalStars }}</span>
        <span class="ach-stat__label">累计星数</span>
      </div>
      <div class="ach-stat">
        <span class="ach-stat__value">{{ progress.totalEnemiesDefeated }}</span>
        <span class="ach-stat__label">击败敌人</span>
      </div>
      <div class="ach-stat">
        <span class="ach-stat__value">{{ progress.totalVictories }}</span>
        <span class="ach-stat__label">胜利次数</span>
      </div>
      <div class="ach-stat">
        <span class="ach-stat__value">{{ progress.totalCoinsEarned }}</span>
        <span class="ach-stat__label">累计金币</span>
      </div>
    </div>

    <div class="ach__body scroll">
      <section v-for="g in grouped" :key="g.category" class="ach__group">
        <h3>{{ g.category }}</h3>
        <div class="ach__grid">
          <div
            v-for="a in g.items"
            :key="a.id"
            class="ach-card"
            :class="{ 'is-unlocked': a.unlocked }"
          >
            <div class="ach-card__head">
              <span class="ach-card__icon">{{ a.unlocked ? '🏅' : '🔒' }}</span>
              <div class="ach-card__titles">
                <strong>{{ a.name }}</strong>
                <span class="ach-card__desc">{{ a.description }}</span>
              </div>
            </div>
            <div class="ach-card__bar">
              <div class="ach-card__fill" :style="{ width: a.ratio * 100 + '%' }" />
            </div>
            <div class="ach-card__foot">
              <span>{{ Math.min(a.current, a.target) }} / {{ a.target }}</span>
              <span v-if="a.unlocked" class="ach-card__date">{{ fmtDate(a.unlockedAt) }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ach {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px clamp(10px, 2.4vw, 26px);
  gap: 8px;
}

.ach__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.ach__bar h2 { margin: 0; font-size: 19px; letter-spacing: 1px; }

.ach__count { margin-left: auto; font-size: 12px; color: var(--text-2); }
.ach__count strong { color: var(--brand); font-size: 15px; }

.ach__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 6px;
  padding: 10px 12px;
  flex-shrink: 0;
}

.ach-stat { display: flex; flex-direction: column; align-items: center; }
.ach-stat__value { font-size: 18px; font-weight: 800; color: var(--brand); }
.ach-stat__label { font-size: 10px; color: var(--text-2); }

.ach__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.ach__group h3 {
  margin: 0 0 7px;
  font-size: 13px;
  color: var(--text-1);
  letter-spacing: 1px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 4px;
}

.ach__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  align-content: start;
  padding-right: 4px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 8px;
}

/* 矮屏（手机横屏）：收紧卡片与间距 */
@media (max-height: 480px) {
  .ach__summary { padding: 6px 10px; }
  .ach-card { padding: 5px 9px; }
}

.ach-card {
  padding: 9px 11px;
  border-radius: var(--radius);
  background: var(--bg-1);
  border: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 6px;
  opacity: 0.72;
  transition: all 0.18s ease;
}

.ach-card.is-unlocked {
  opacity: 1;
  border-color: rgba(255, 203, 5, 0.45);
  background: linear-gradient(135deg, rgba(255, 203, 5, 0.1), var(--bg-1));
}

.ach-card__head {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.ach-card__icon { font-size: 20px; line-height: 1.2; flex: none; }

.ach-card__titles { display: flex; flex-direction: column; min-width: 0; }
.ach-card__titles strong { font-size: 13px; }
.ach-card__desc { font-size: 10.5px; color: var(--text-2); line-height: 1.5; }

.ach-card__bar {
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--bg-3);
  overflow: hidden;
}

.ach-card__fill {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, var(--brand));
  border-radius: var(--radius-pill);
  transition: width 0.4s ease;
}

.ach-card.is-unlocked .ach-card__fill { background: linear-gradient(90deg, #34d399, #4ade80); }

.ach-card__foot {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-2);
}

.ach-card__date { color: var(--good); }
</style>
