<script setup lang="ts">
/**
 * 宝可梦图鉴 —— 全 1025 种可浏览、筛选、搜索（PRD 9.1）。
 *
 * 性能要点：图鉴数据 4 MB、条目 1025 个，因此
 *   - 列表分页渲染（每页 60 条），避免一次性挂载上千个 DOM 节点
 *   - 图像使用 loading="lazy" 与原生解码
 *   - 索引（按属性 / 世代 / 搜索）在 pokedex.ts 里缓存
 */
import { computed, onMounted, ref, watch } from 'vue';
import PokemonImage from './PokemonImage.vue';
import TypeBadges from './TypeBadges.vue';
import PokedexDetail from './PokedexDetail.vue';
import {
  ALL_IDS, POKEDEX, POKEDEX_META, TOTAL_SPECIES, coverageReport,
  idsByGeneration, idsByType, searchPokedex,
} from '../data/pokemon/pokedex';
import { POKEMON_TYPES, TYPE_COLORS, TYPE_LABELS, type PokemonType } from '../data/balance/typeChart';
import { useProgressStore } from '../stores/progress';
import { audioEngine } from '../utils/audio';

const emit = defineEmits<{ (e: 'back'): void }>();

const progress = useProgressStore();

const query = ref('');
const selectedTypes = ref<PokemonType[]>([]);
const selectedGeneration = ref<number | 0>(0);
const showOnlyUnlocked = ref(false);
const showShiny = ref(false);
const page = ref(0);
const PAGE_SIZE = 60;

const focusId = ref<number | null>(null);
const showCoverage = ref(false);

const generations = computed(() => Object.keys(POKEDEX_META.generationBreakdown).sort());

/** 组合筛选：类型 ∩ 世代 ∩ 搜索 ∩ 解锁 */
const filtered = computed<number[]>(() => {
  let ids: number[];

  if (query.value.trim()) {
    ids = searchPokedex(query.value, 2000);
  } else {
    ids = ALL_IDS;
  }

  if (selectedGeneration.value) {
    const genSet = new Set(idsByGeneration(selectedGeneration.value));
    ids = ids.filter((id) => genSet.has(id));
  }

  if (selectedTypes.value.length) {
    ids = ids.filter((id) => {
      const t = POKEDEX[id]?.types ?? [];
      return selectedTypes.value.every((st) => t.includes(st));
    });
  }

  if (showOnlyUnlocked.value) {
    const unlocked = new Set(progress.unlockedPokemon);
    ids = ids.filter((id) => unlocked.has(id));
  }

  return ids;
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const pageItems = computed(() => filtered.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE));

watch([query, selectedTypes, selectedGeneration, showOnlyUnlocked], () => { page.value = 0; });

const focusEntry = computed(() => (focusId.value ? POKEDEX[focusId.value] ?? null : null));

const coverage = computed(() => coverageReport());

function toggleType(t: PokemonType) {
  audioEngine.play('ui_click');
  const idx = selectedTypes.value.indexOf(t);
  if (idx >= 0) selectedTypes.value = selectedTypes.value.filter((x) => x !== t);
  else selectedTypes.value = [...selectedTypes.value, t];
}

function setGen(g: number | 0) {
  audioEngine.play('ui_click');
  selectedGeneration.value = g;
}

function open(id: number) {
  audioEngine.play('ui_click');
  focusId.value = id;
  progress.discover(id);
}

function close() {
  audioEngine.play('ui_cancel');
  focusId.value = null;
}

function gotoPage(p: number) {
  audioEngine.play('ui_click');
  page.value = Math.max(0, Math.min(pageCount.value - 1, p));
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

onMounted(() => { /* 数据已是同步静态导入，无需额外加载 */ });
</script>

<template>
  <div class="dex">
    <header class="dex__bar">
      <button class="btn btn--ghost btn--sm" @click="audioEngine.play('ui_cancel'); emit('back')">← 返回</button>
      <h2>宝可梦图鉴</h2>
      <div class="dex__meta">
        <span>收录 <strong>{{ TOTAL_SPECIES }}</strong> 种</span>
        <span>已发现 <strong>{{ progress.discoveryRatio }}</strong></span>
        <button class="btn btn--ghost btn--sm" @click="showCoverage = !showCoverage">
          {{ showCoverage ? '隐藏' : '素材' }}覆盖率
        </button>
      </div>
    </header>

    <!-- 覆盖率报告 -->
    <div v-if="showCoverage" class="dex__coverage panel">
      <h3>素材与数据覆盖报告</h3>
      <p class="dex__coverage-note">
        完整性按三层分别统计：图鉴条目、静态素材、动态素材。拥有静态插画不等于具备完整战斗动画。
      </p>
      <div class="coverage-grid">
        <div v-for="(v, k) in coverage" :key="k" class="cov-cell">
          <span class="cov-cell__label">{{
            { pokedex: '图鉴条目', forms: '形态数据', staticSprite: '静态素材', animatedSprite: '动态素材',
              portrait: '官方立绘', shiny: '异色素材', evolution: '进化关系', battleConfig: '战斗配置' }[k as string] ?? k
          }}</span>
          <div class="cov-cell__bar">
            <div class="cov-cell__fill" :style="{ width: pct(v.ratio) }" />
          </div>
          <span class="cov-cell__value">{{ v.covered }}/{{ v.total }} · {{ pct(v.ratio) }}</span>
        </div>
      </div>
      <p class="dex__license">
        数据来源：{{ POKEDEX_META.source }} · 授权状态：{{ POKEDEX_META.license.license }}（
        未确认为可商用）
      </p>
    </div>

    <!-- 筛选区 -->
    <div class="dex__filters">
      <div class="dex__search">
        <input
          v-model="query"
          type="search"
          placeholder="搜索中文名 / 英文名 / 编号…"
          class="dex__search-input"
          enterkeyhint="search"
        />
        <button v-if="query" class="dex__search-clear" @click="query = ''">✕</button>
      </div>

      <div class="dex__gens">
        <button class="gen-chip" :class="{ 'is-active': selectedGeneration === 0 }" @click="setGen(0)">全部</button>
        <button
          v-for="g in generations"
          :key="g"
          class="gen-chip"
          :class="{ 'is-active': selectedGeneration === Number(g) }"
          @click="setGen(Number(g))"
        >
          {{ POKEDEX_META.generationBreakdown[g] }} · 第{{ g }}世代
        </button>
      </div>

      <div class="dex__types">
        <button
          v-for="t in POKEMON_TYPES"
          :key="t"
          class="type-filter"
          :class="{ 'is-active': selectedTypes.includes(t) }"
          :style="{ '--tc': TYPE_COLORS[t] }"
          @click="toggleType(t)"
        >
          {{ TYPE_LABELS[t] }}
        </button>
      </div>

      <div class="dex__toggles">
        <label class="toggle">
          <input v-model="showOnlyUnlocked" type="checkbox" />
          <span>只看已解锁</span>
        </label>
        <label class="toggle">
          <input v-model="showShiny" type="checkbox" />
          <span>显示异色形态</span>
        </label>
        <span class="dex__count">命中 {{ filtered.length }} 条</span>
      </div>
    </div>

    <!-- 列表 -->
    <div class="dex__list scroll">
      <button
        v-for="id in pageItems"
        :key="id"
        class="dex-item"
        :class="{ 'is-unlocked': progress.isUnlocked(id), 'is-boss': POKEDEX[id]?.rarity !== 'normal' }"
        @click="open(id)"
      >
        <span class="dex-item__no">#{{ String(id).padStart(4, '0') }}</span>
        <PokemonImage
          :pokemon-id="id"
          :name="POKEDEX[id]?.nameZh"
          :type="POKEDEX[id]?.types[0]"
          :variant="showShiny && progress.shinySeen.includes(id) ? 'shiny' : 'battle'"
          :size="46"
          :pixelated="false"
        />
        <span class="dex-item__name">{{ POKEDEX[id]?.nameZh }}</span>
        <span class="dex-item__en">{{ POKEDEX[id]?.nameEn }}</span>
        <TypeBadges :types="POKEDEX[id]?.types ?? []" size="sm" />
        <span v-if="!progress.isUnlocked(id)" class="dex-item__lock">未解锁</span>
      </button>
    </div>

    <!-- 分页 -->
    <div v-if="pageCount > 1" class="dex__pager">
      <button class="btn btn--ghost btn--sm" :disabled="page === 0" @click="gotoPage(0)">« 首页</button>
      <button class="btn btn--ghost btn--sm" :disabled="page === 0" @click="gotoPage(page - 1)">‹ 上一页</button>
      <span class="dex__pager-info">{{ page + 1 }} / {{ pageCount }}</span>
      <button class="btn btn--ghost btn--sm" :disabled="page >= pageCount - 1" @click="gotoPage(page + 1)">下一页 ›</button>
      <button class="btn btn--ghost btn--sm" :disabled="page >= pageCount - 1" @click="gotoPage(pageCount - 1)">末页 »</button>
    </div>

    <!-- 详情弹层 -->
    <PokedexDetail v-if="focusEntry" :entry="focusEntry" @close="close" @focus="open" />
  </div>
</template>

<style scoped>
.dex {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px clamp(10px, 2.4vw, 26px);
  gap: 8px;
}

.dex__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.dex__bar h2 { margin: 0; font-size: 19px; letter-spacing: 1px; }

.dex__meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-2);
}

.dex__meta strong { color: var(--brand); }

.dex__coverage {
  padding: 12px 14px;
  flex-shrink: 0;
  max-height: 34vh;
  overflow-y: auto;
}

.dex__coverage h3 { margin: 0 0 4px; font-size: 14px; }

.dex__coverage-note,
.dex__license {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.6;
}

.dex__license { margin: 8px 0 0; }

.coverage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.cov-cell {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  align-items: center;
}

.cov-cell__label { font-size: 11px; color: var(--text-1); }
.cov-cell__value { font-size: 10px; color: var(--text-2); }

.cov-cell__bar {
  grid-column: 1 / -1;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--bg-3);
  overflow: hidden;
}

.cov-cell__fill {
  height: 100%;
  background: linear-gradient(90deg, #34d399, var(--brand));
  border-radius: var(--radius-pill);
}

.dex__filters {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex-shrink: 0;
}

.dex__search { position: relative; max-width: 380px; }

.dex__search-input {
  width: 100%;
  min-height: 40px;
  padding: 0 34px 0 14px;
  border-radius: var(--radius-pill);
  background: var(--bg-1);
  border: 1px solid var(--line);
  font-size: 14px;
  outline: none;
}

.dex__search-input:focus { border-color: var(--brand); }

.dex__search-clear {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg-3);
  font-size: 11px;
  display: grid;
  place-items: center;
}

.dex__gens,
.dex__types {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.gen-chip,
.type-filter {
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-1);
  border: 1px solid var(--line);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-2);
  transition: all 0.14s ease;
}

.gen-chip.is-active { background: var(--brand); color: #3a2c00; border-color: #fff0a8; }

.type-filter { --tc: #888; border-left: 3px solid var(--tc); }
.type-filter.is-active { background: var(--tc); color: #fff; border-color: #fff; }

.dex__toggles {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-2);
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.toggle input { accent-color: var(--brand); width: 15px; height: 15px; }

.dex__count { margin-left: auto; }

.dex__list {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
  gap: 6px;
  align-content: start;
  padding-right: 4px;
}

.dex-item {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  gap: 0 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  border: 1px solid var(--line);
  text-align: left;
  transition: all 0.13s ease;
}

.dex-item:hover { border-color: var(--brand); transform: translateY(-1px); }
.dex-item.is-unlocked { border-left: 3px solid var(--good); }
.dex-item.is-boss { background: linear-gradient(135deg, rgba(168, 85, 247, 0.12), var(--bg-1)); }

.dex-item__no {
  grid-column: 1 / -1;
  font-size: 9.5px;
  color: var(--text-2);
  letter-spacing: 0.5px;
}

.dex-item > :deep(.pkm-img) { grid-row: 2 / 4; }

.dex-item__name { font-size: 13px; font-weight: 700; }

.dex-item__en {
  font-size: 9.5px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dex-item__lock {
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 9px;
  color: var(--text-2);
  background: var(--bg-3);
  padding: 1px 5px;
  border-radius: var(--radius-pill);
}

.dex__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  padding-top: 4px;
}

.dex__pager-info { font-size: 12px; color: var(--text-1); min-width: 68px; text-align: center; }
</style>
