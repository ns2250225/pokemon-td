<script setup lang="ts">
/**
 * 图鉴详情弹层 —— 图片、属性、种族值、进化链、技能、防御定位、异色形态。
 *
 * PRD 9.1：图鉴与游戏解锁状态分离，未解锁也能查看基础资料。
 */
import { computed, ref } from 'vue';
import PokemonImage from './PokemonImage.vue';
import TypeBadges from './TypeBadges.vue';
import {
  POKEDEX, getEvolutionChain, type ChainNode, type PokedexEntry,
} from '../data/pokemon/pokedex';
import { getTowerConfig, getEnemyConfig, ENEMY_TRAITS } from '../data/pokemon/units';
import { MOVES } from '../data/moves/moves';
import { TYPE_COLORS, TYPE_LABELS, typeRelationships, type PokemonType } from '../data/balance/typeChart';
import { useProgressStore } from '../stores/progress';
import { audioEngine } from '../utils/audio';

const props = defineProps<{ entry: PokedexEntry }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'focus', id: number): void;
}>();

const progress = useProgressStore();
const showShiny = ref(false);

const tower = computed(() => getTowerConfig(props.entry.id));
const enemy = computed(() => getEnemyConfig(props.entry.id));
const unlocked = computed(() => progress.isUnlocked(props.entry.id));
const discovered = computed(() => progress.discovered.includes(props.entry.id));

const accent = computed(() => TYPE_COLORS[(props.entry.types[0] as PokemonType) ?? 'normal']);

const stats = computed(() => {
  const s = props.entry.baseStats;
  return [
    { key: 'hp', label: 'HP', value: s.hp ?? 0, max: 255 },
    { key: 'attack', label: '攻击', value: s.attack ?? 0, max: 190 },
    { key: 'defense', label: '防御', value: s.defense ?? 0, max: 230 },
    { key: 'special-attack', label: '特攻', value: s['special-attack'] ?? 0, max: 194 },
    { key: 'special-defense', label: '特防', value: s['special-defense'] ?? 0, max: 230 },
    { key: 'speed', label: '速度', value: s.speed ?? 0, max: 200 },
  ];
});

const chainRoot = computed(() => getEvolutionChain(props.entry.id));

/** 把进化链拍平成按 stage 分组的行，便于横向展示 */
const chainRows = computed(() => {
  const root = chainRoot.value;
  if (!root) return [] as ChainNode[][];
  const rows: ChainNode[][] = [];
  const walk = (node: ChainNode) => {
    const idx = node.stage - 1;
    rows[idx] = rows[idx] ?? [];
    if (!rows[idx].some((n) => n.id === node.id)) rows[idx].push(node);
    for (const c of node.children) walk(c);
  };
  walk(root);
  return rows.filter(Boolean);
});

/** 该精灵的防御定位信息 + 技能 */
const towerInfo = computed(() => {
  const cfg = tower.value;
  if (!cfg) return null;
  return {
    archetype: cfg.archetype.label,
    mechanic: cfg.archetype.mechanic,
    cost: cfg.cost,
    damage: cfg.damage,
    intervalMs: cfg.attackIntervalMs,
    range: cfg.range,
    growth: cfg.growth,
    maxLevel: cfg.maxLevel,
    moves: cfg.moves.map((m) => ({
      id: m.id,
      name: m.move.name,
      tier: m.move.effectTier,
      type: m.move.type,
      unlockLevel: m.unlockLevel,
      description: m.move.description,
      targeting: m.move.targeting,
      radius: m.move.radius ?? m.move.length ?? 0,
    })),
    evolution: cfg.evolution,
  };
});

const enemyInfo = computed(() => {
  const cfg = enemy.value;
  if (!cfg) return null;
  return {
    hp: cfg.hp,
    speed: cfg.speed,
    reward: cfg.reward,
    armor: cfg.armor,
    magicResist: cfg.magicResist,
    baseDamage: cfg.baseDamage,
    traits: cfg.traits.map((t) => ENEMY_TRAITS[t]),
    ability: cfg.ability,
  };
});

const relations = computed(() => props.entry.types.map((t) => ({
  type: t as PokemonType,
  ...typeRelationships(t as PokemonType),
})));

const targetingLabel: Record<string, string> = {
  single: '单体', chain: '连锁弹射', pierce: '直线穿透', area: '圆形范围',
  cone: '锥形范围', line: '直线范围', multi: '多目标', global: '全屏', aura: '自身光环',
};

const tierLabel: Record<string, string> = {
  common: '普通', enhanced: '强化', epic: '史诗', legendary: '传说',
};

function statPercent(v: number, max: number) {
  return `${Math.min(100, (v / max) * 100)}%`;
}

function statTone(v: number) {
  if (v >= 120) return 'high';
  if (v >= 80) return 'mid';
  if (v >= 50) return 'low';
  return 'min';
}

function go(id: number) {
  audioEngine.play('ui_click');
  emit('focus', id);
}

function toggleShiny() {
  audioEngine.play('ui_click');
  showShiny.value = !showShiny.value;
  if (showShiny.value) progress.markShinySeen(props.entry.id);
}

const variant = computed(() => (showShiny.value ? 'shiny' : 'portrait'));
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="detail panel" :style="{ '--accent': accent }">
      <button class="detail__close" aria-label="关闭" @click="emit('close')">✕</button>

      <div class="detail__hero">
        <div class="detail__art">
          <PokemonImage
            :pokemon-id="entry.id"
            :name="entry.nameZh"
            :type="entry.types[0]"
            :variant="variant"
            :size="150"
            :pixelated="false"
          />
          <button class="detail__shiny-btn" :class="{ 'is-on': showShiny }" @click="toggleShiny">
            {{ showShiny ? '异色形态' : '普通形态' }}
          </button>
        </div>

        <div class="detail__id">
          <span class="detail__no">No.{{ String(entry.id).padStart(4, '0') }}</span>
          <h2>{{ entry.nameZh }}</h2>
          <p class="detail__en">{{ entry.nameEn }} · {{ entry.slug }}</p>
          <TypeBadges :types="entry.types" size="lg" />
          <div class="detail__tags">
            <span class="detail__tag">{{ entry.generationName }}</span>
            <span v-if="entry.rarity === 'legendary'" class="detail__tag is-legend">传说</span>
            <span v-if="entry.rarity === 'mythical'" class="detail__tag is-myth">幻兽</span>
            <span v-if="entry.rarity === 'baby'" class="detail__tag">幼年</span>
            <span class="detail__tag">
              {{ unlocked ? '已解锁' : discovered ? '已发现' : '未发现' }}
            </span>
          </div>
          <p v-if="entry.flavor" class="detail__flavor">{{ entry.flavor }}</p>
        </div>
      </div>

      <div class="detail__cols scroll">
        <!-- 左列：种族值 + 属性关系 -->
        <section class="detail__section">
          <h3>种族值 <span class="detail__total">{{ entry.statTotal }}</span></h3>
          <div class="stats">
            <div v-for="s in stats" :key="s.key" class="stat-row">
              <span class="stat-row__label">{{ s.label }}</span>
              <span class="stat-row__value">{{ s.value }}</span>
              <div class="stat-row__bar">
                <div class="stat-row__fill" :class="`tone-${statTone(s.value)}`" :style="{ width: statPercent(s.value, s.max) }" />
              </div>
            </div>
          </div>
          <div class="detail__sub-info">
            <span>身高 {{ (entry.height ?? 0) / 10 }} m</span>
            <span>体重 {{ (entry.weight ?? 0) / 10 }} kg</span>
            <span>形态数 {{ entry.forms.length }}</span>
          </div>
        </section>

        <section class="detail__section">
          <h3>属性克制关系</h3>
          <div v-for="r in relations" :key="r.type" class="relation">
            <div class="relation__head">
              <span class="chip" :style="{ background: TYPE_COLORS[r.type] }">{{ TYPE_LABELS[r.type] }}</span>
            </div>
            <div class="relation__row">
              <span class="relation__label">克制</span>
              <span v-if="!r.strong.length" class="relation__none">—</span>
              <span v-for="t in r.strong" :key="t" class="mini-chip" :style="{ background: TYPE_COLORS[t] }">{{ TYPE_LABELS[t] }}</span>
            </div>
            <div class="relation__row">
              <span class="relation__label">被抵抗</span>
              <span v-if="!r.weak.length" class="relation__none">—</span>
              <span v-for="t in r.weak" :key="t" class="mini-chip" :style="{ background: TYPE_COLORS[t] }">{{ TYPE_LABELS[t] }}</span>
            </div>
            <div class="relation__row">
              <span class="relation__label">怕</span>
              <span v-if="!r.defensiveWeakTo.length" class="relation__none">—</span>
              <span v-for="t in r.defensiveWeakTo" :key="t" class="mini-chip" :style="{ background: TYPE_COLORS[t] }">{{ TYPE_LABELS[t] }}</span>
            </div>
            <div class="relation__row">
              <span class="relation__label">抵抗</span>
              <span v-if="!r.defensiveResists.length" class="relation__none">—</span>
              <span v-for="t in r.defensiveResists" :key="t" class="mini-chip" :style="{ background: TYPE_COLORS[t] }">{{ TYPE_LABELS[t] }}</span>
            </div>
          </div>
        </section>

        <!-- 中列：防御配置 -->
        <section class="detail__section" v-if="towerInfo">
          <h3>防御定位 · {{ towerInfo.archetype }}</h3>
          <p class="detail__mechanic">{{ towerInfo.mechanic }}</p>
          <div class="kv-grid">
            <div class="kv"><span>建造费用</span><strong>🪙 {{ towerInfo.cost }}</strong></div>
            <div class="kv"><span>基础攻击</span><strong>{{ towerInfo.damage }}</strong></div>
            <div class="kv"><span>攻击间隔</span><strong>{{ towerInfo.intervalMs }}ms</strong></div>
            <div class="kv"><span>射程</span><strong>{{ towerInfo.range }}px</strong></div>
            <div class="kv"><span>最高等级</span><strong>Lv.{{ towerInfo.maxLevel }}</strong></div>
            <div class="kv" v-if="towerInfo.evolution">
              <span>进化</span>
              <strong>{{ POKEDEX[towerInfo.evolution.targetId]?.nameZh }} · 🪙{{ towerInfo.evolution.cost }}</strong>
            </div>
          </div>

          <h3 class="detail__h3-gap">招式（按等级解锁）</h3>
          <div class="moves">
            <div
              v-for="m in towerInfo.moves"
              :key="m.id"
              class="move-row"
              :style="{ '--mc': TYPE_COLORS[m.type as PokemonType] }"
            >
              <span class="move-row__unlock">Lv.{{ m.unlockLevel }}</span>
              <div class="move-row__body">
                <div class="move-row__head">
                  <strong>{{ m.name }}</strong>
                  <span class="move-row__tier">{{ tierLabel[m.tier] }}</span>
                  <span class="move-row__target">{{ targetingLabel[m.targeting] ?? m.targeting }}</span>
                </div>
                <p class="move-row__desc">{{ m.description }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 右列：敌方配置 + 进化链 -->
        <section class="detail__section" v-if="enemyInfo">
          <h3>作为敌人的表现</h3>
          <div class="kv-grid">
            <div class="kv"><span>生命</span><strong>{{ enemyInfo.hp }}</strong></div>
            <div class="kv"><span>速度</span><strong>{{ enemyInfo.speed }} px/s</strong></div>
            <div class="kv"><span>击杀奖励</span><strong>🪙 {{ enemyInfo.reward }}</strong></div>
            <div class="kv"><span>物理减伤</span><strong>{{ (enemyInfo.armor * 100).toFixed(0) }}%</strong></div>
            <div class="kv"><span>特殊减伤</span><strong>{{ (enemyInfo.magicResist * 100).toFixed(0) }}%</strong></div>
            <div class="kv"><span>漏怪扣血</span><strong>❤️ {{ enemyInfo.baseDamage }}</strong></div>
          </div>
          <div class="traits">
            <span v-for="t in enemyInfo.traits" :key="t.key" class="trait-chip" :title="t.description">
              {{ t.label }}
            </span>
          </div>
          <p class="detail__counter" v-if="enemyInfo.traits.length">
            应对：{{ enemyInfo.traits.map((t) => t.counter).join(' ') }}
          </p>
        </section>

        <section class="detail__section" v-if="chainRows.length">
          <h3>进化链</h3>
          <div class="chain">
            <div v-for="(row, ri) in chainRows" :key="ri" class="chain__row">
              <span class="chain__stage">第 {{ ri + 1 }} 阶段</span>
              <div class="chain__nodes">
                <button
                  v-for="node in row"
                  :key="node.id"
                  class="chain__node"
                  :class="{ 'is-current': node.id === entry.id }"
                  @click="go(node.id)"
                >
                  <PokemonImage
                    :pokemon-id="node.id"
                    :name="POKEDEX[node.id]?.nameZh"
                    :type="POKEDEX[node.id]?.types[0]"
                    :size="48"
                  />
                  <span>{{ POKEDEX[node.id]?.nameZh }}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: grid;
  place-items: center;
  background: rgba(6, 9, 13, 0.78);
  backdrop-filter: blur(4px);
  padding: 16px;
}

.detail {
  width: min(980px, 96vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  border-top: 4px solid var(--accent);
  animation: float-up 0.2s ease;
  overflow: hidden;
}

.detail__close {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-3);
  color: var(--text-1);
  display: grid;
  place-items: center;
  z-index: 2;
}

.detail__hero {
  display: flex;
  gap: 18px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%);
}

.detail__art {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: none;
}

.detail__shiny-btn {
  font-size: 10px;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-3);
  border: 1px solid var(--line);
  color: var(--text-2);
}

.detail__shiny-btn.is-on {
  background: linear-gradient(90deg, #a855f7, #ec4899);
  color: #fff;
  border-color: transparent;
}

.detail__id { min-width: 0; flex: 1; }

.detail__no {
  font-size: 11px;
  color: var(--text-2);
  letter-spacing: 1.5px;
}

.detail__id h2 {
  margin: 2px 0 0;
  font-size: 30px;
  letter-spacing: 2px;
}

.detail__en {
  margin: 2px 0 8px;
  font-size: 12px;
  color: var(--text-2);
}

.detail__tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.detail__tag {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-3);
  color: var(--text-1);
}

.detail__tag.is-legend { background: linear-gradient(90deg, #f59e0b, #ef4444); color: #fff; }
.detail__tag.is-myth { background: linear-gradient(90deg, #8b5cf6, #ec4899); color: #fff; }

.detail__flavor {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-1);
  line-height: 1.7;
  max-width: 62ch;
  border-left: 3px solid var(--accent);
  padding-left: 10px;
}

.detail__cols {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  padding: 14px 18px 18px;
  align-content: start;
}

.detail__section h3 {
  margin: 0 0 8px;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--text-1);
  border-bottom: 1px solid var(--line);
  padding-bottom: 5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail__h3-gap { margin-top: 14px !important; }

.detail__total {
  font-size: 12px;
  color: var(--brand);
  font-weight: 800;
}

.stats { display: flex; flex-direction: column; gap: 5px; }

.stat-row {
  display: grid;
  grid-template-columns: 44px 34px 1fr;
  gap: 6px;
  align-items: center;
}

.stat-row__label { font-size: 11px; color: var(--text-2); }
.stat-row__value { font-size: 12px; font-weight: 800; text-align: right; }

.stat-row__bar {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-3);
  overflow: hidden;
}

.stat-row__fill { height: 100%; border-radius: var(--radius-pill); transition: width 0.3s ease; }
.stat-row__fill.tone-high { background: linear-gradient(90deg, #34d399, #4ade80); }
.stat-row__fill.tone-mid { background: linear-gradient(90deg, #fbbf24, #facc15); }
.stat-row__fill.tone-low { background: linear-gradient(90deg, #fb923c, #f97316); }
.stat-row__fill.tone-min { background: linear-gradient(90deg, #f87171, #ef4444); }

.detail__sub-info {
  display: flex;
  gap: 12px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-2);
  flex-wrap: wrap;
}

.relation {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--line);
}

.relation:last-child { border-bottom: none; }

.relation__head { margin-bottom: 5px; }

.relation__row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 3px;
}

.relation__label {
  font-size: 10px;
  color: var(--text-2);
  min-width: 42px;
}

.relation__none { font-size: 10px; color: var(--text-2); }

.mini-chip {
  font-size: 9.5px;
  font-weight: 700;
  color: #fff;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.detail__mechanic {
  margin: 0 0 10px;
  font-size: 11.5px;
  color: var(--text-1);
  line-height: 1.7;
  background: var(--bg-2);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--accent);
}

.kv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
  gap: 6px;
}

.kv {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
}

.kv span { font-size: 9.5px; color: var(--text-2); }
.kv strong { font-size: 12.5px; }

.moves { display: flex; flex-direction: column; gap: 5px; }

.move-row {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  border-left: 3px solid var(--mc);
}

.move-row__unlock {
  font-size: 9.5px;
  font-weight: 800;
  color: var(--brand);
  flex: none;
  min-width: 32px;
}

.move-row__body { min-width: 0; }

.move-row__head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.move-row__head strong { font-size: 12.5px; }

.move-row__tier {
  font-size: 9px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--mc);
  color: #fff;
}

.move-row__target {
  font-size: 9.5px;
  color: var(--text-2);
}

.move-row__desc {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: var(--text-2);
  line-height: 1.55;
}

.traits { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }

.trait-chip {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--line);
  color: var(--text-1);
}

.detail__counter {
  margin: 8px 0 0;
  font-size: 10.5px;
  color: var(--text-2);
  line-height: 1.6;
}

.chain { display: flex; flex-direction: column; gap: 8px; }

.chain__row { display: flex; flex-direction: column; gap: 4px; }

.chain__stage { font-size: 10px; color: var(--text-2); }

.chain__nodes { display: flex; gap: 6px; flex-wrap: wrap; }

.chain__node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 7px;
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  border: 1px solid var(--line);
  transition: all 0.14s ease;
}

.chain__node:hover { border-color: var(--brand); }

.chain__node.is-current {
  border-color: var(--brand);
  background: rgba(255, 203, 5, 0.14);
}

.chain__node span { font-size: 10px; }

@media (max-width: 700px) {
  .detail__hero { flex-direction: column; align-items: center; text-align: center; }
  .detail__id h2 { font-size: 24px; }
  .detail__flavor { margin-inline: auto; }
  .detail__cols { padding: 12px; gap: 12px; }
}
</style>
