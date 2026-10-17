<script setup lang="ts">
/**
 * 战斗界面容器 —— Phaser 画布 + Vue HUD 覆盖层。
 *
 * 分工：
 *   Phaser  → 地图、路径、精灵、特效、伤害数字（高频渲染）
 *   Vue     → 顶部状态栏、底部建造栏、升级面板、暂停菜单、结算（低频交互 UI）
 *
 * 两者通过 eventBus 通信，避免 Vue 直接持有场景内部对象。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import GameHUD from './GameHUD.vue';
import PokemonCard from './PokemonCard.vue';
import UpgradePanel from './UpgradePanel.vue';
import ResultPanel from './ResultPanel.vue';
import PauseMenu from './PauseMenu.vue';
import BossHealthBar from './BossHealthBar.vue';
import { createGame, type GameHandle } from '../game';
import { SCENE_KEYS } from '../game/config';
import type { BattleScene, BattleResult } from '../game/scenes/BattleScene';
import { setPendingLevelId } from '../game/scenes/SceneParams';
import { bus } from '../utils/eventBus';
import { getLevel } from '../data/levels/levels';
import { getTowerConfig } from '../data/pokemon/units';
import { POKEDEX } from '../data/pokemon/pokedex';
import { useProgressStore } from '../stores/progress';
import { useSettingsStore } from '../stores/game';
import { useOrientation } from '../composables/useOrientation';
import { audioEngine } from '../utils/audio';
import { precache, levelAssetUrls } from '../utils/offline';
import type { PokemonType } from '../data/balance/typeChart';

const props = defineProps<{ levelId: string }>();
const emit = defineEmits<{
  (e: 'exit'): void;
  (e: 'next-level', levelId: string): void;
}>();

const canvasHost = ref<HTMLDivElement | null>(null);
const gameHandle = shallowRef<GameHandle | null>(null);
const battleScene = shallowRef<BattleScene | null>(null);

const progress = useProgressStore();
const settings = useSettingsStore();
const orientation = useOrientation();
const level = computed(() => getLevel(props.levelId));

/* ---------------- HUD 状态 ---------------- */
const economy = ref({ coins: 0, hp: 10, maxHp: 10 });
const wave = ref({ index: 0, total: 1, isBoss: false });
const speed = ref<1 | 2 | 3>(1);
const buildMode = ref<{ pokemonId: number; cost: number } | null>(null);
const selected = ref<Record<string, unknown> | null>(null);
const paused = ref(false);
const pausedByUser = ref(false);
const result = ref<BattleResult | null>(null);
/** 本次通关新解锁的精灵（展示在结算面板上） */
const newUnlocks = ref<number[]>([]);
const boss = ref<{ pokemonId: number; name: string; hpRatio: number } | null>(null);
const toast = ref<{ text: string; tone: string } | null>(null);
/** 递增序号：只有最新一条提示的计时器可以清屏（旧提示被覆盖后不再抢清） */
let toastSeq = 0;

/** 建造栏只显示已解锁的精灵：未解锁的进图鉴看，不占建造栏 */
const availableTowers = computed(() =>
  (level.value?.availableTowers ?? []).filter((id) => progress.isUnlocked(id)),
);

/* ---------------- 建造栏滚动 ---------------- */
const cardsRef = ref<HTMLDivElement | null>(null);
/** 左右两端是否还有被裁掉的卡（控制渐隐提示） */
const fadeLeft = ref(false);
const fadeRight = ref(false);
/** 新解锁高亮中的精灵（几秒后消失） */
const flashIds = ref<Set<number>>(new Set());
let flashTimer: ReturnType<typeof setTimeout> | null = null;

function updateFades() {
  const el = cardsRef.value;
  if (!el) return;
  fadeLeft.value = el.scrollLeft > 4;
  fadeRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}

/** 桌面端滚轮直接横移建造栏（纵向增量转横向），不再依赖 Shift+滚轮 */
function onCardsWheel(e: WheelEvent) {
  const el = cardsRef.value;
  if (!el) return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    el.scrollLeft += e.deltaY;
    updateFades();
  }
}

/** 新解锁的卡滚到可见区并高亮几秒，提示"刚解锁的在这里" */
function flashNewCards(ids: number[]) {
  if (!ids.length) return;
  void nextTick(() => {
    const el = cardsRef.value;
    const target = el?.querySelector(`[data-pokemon-id="${ids[0]}"]`);
    target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    updateFades();
  });
  flashIds.value = new Set(ids);
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashIds.value = new Set(); }, 4000);
}

watch(availableTowers, (now, prev) => {
  const added = now.filter((id) => !prev.includes(id));
  if (added.length) flashNewCards(added);
  void nextTick(updateFades);
});
const showResult = computed(() => result.value !== null);

/* ---------------- 生命周期 ---------------- */

onMounted(async () => {
  if (!canvasHost.value) return;

  // 必须在创建 Phaser.Game 之前写入关卡 id：
  // 场景在 Game 构造时就会 create()，此时再传参已经太晚。
  setPendingLevelId(props.levelId);

  const handle = createGame(canvasHost.value);
  gameHandle.value = handle;

  audioEngine.startBgm(level.value?.chapter ?? 1);
  registerBusHandlers();
  registerPrecache();
  window.addEventListener('resize', updateFades);
  void nextTick(updateFades);

  // 「开始游戏时尝试全屏」设置（PRD 8.4）：移动端横屏体验明显更好，
  // 但浏览器要求全屏必须由用户手势触发，因此只在本次点击链内尝试一次，
  // 失败则静默忽略（不弹错误，用户仍可用首页/设置里的全屏按钮）。
  if (settings.fullscreenOnStart && orientation.isMobile.value && !orientation.isFullscreen.value) {
    void orientation.requestFullscreen().catch(() => {});
  }

  // 场景在 Phaser.Game 构造函数里异步启动，这里轮询到可用为止。
  // 直接取 getScene() 常常拿到未完成 create 的实例，因此用轮询 + 超时兜底。
  await waitForBattleScene(handle);
});

/** 等待 BattleScene 完成 create 并可用 */
function waitForBattleScene(handle: GameHandle, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const s = handle.game.scene.getScene(SCENE_KEYS.BATTLE) as BattleScene | null;
      // scene.sys.isActive() 为 true 才说明 create() 已跑完
      if (s && s.sys?.isActive?.()) {
        battleScene.value = s;
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        battleScene.value = s ?? null;
        resolve();
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

onBeforeUnmount(() => {
  unregisterBusHandlers();
  audioEngine.stopBgm();
  window.removeEventListener('resize', updateFades);
  if (flashTimer) clearTimeout(flashTimer);
  gameHandle.value?.destroy();
  gameHandle.value = null;
  battleScene.value = null;
});

/* ---------------- 事件桥 ---------------- */

const offHandlers: (() => void)[] = [];

function registerBusHandlers() {
  offHandlers.push(
    bus.on<{ coins: number; hp: number; maxHp: number }>('battle:economy', (e) => { economy.value = e; }),
    bus.on<{ index: number; total: number; isBoss: boolean }>('battle:wave', (w) => {
      wave.value = w;
      audioEngine.play(w.isBoss ? 'boss_warning' : 'wave_start');
      if (w.isBoss) bus.emit('battle:toast', { text: 'BOSS 来袭！', tone: 'warn' });
    }),
    bus.on<{ speed: 1 | 2 | 3 }>('battle:speed', (s) => { speed.value = s.speed; }),
    bus.on<{ pokemonId: number; cost: number } | null>('battle:buildMode', (b) => { buildMode.value = b; }),
    bus.on<Record<string, unknown> | null>('battle:selectTower', (t) => {
      selected.value = t;
      audioEngine.play(t ? 'ui_click' : 'ui_cancel');
    }),
    bus.on<boolean>('battle:paused', (p) => { paused.value = p; }),
    bus.on<{ text: string; tone: string }>('battle:toast', (t) => {
      toast.value = t;
      audioEngine.play(t.tone === 'warn' ? 'ui_error' : 'ui_click');
      // 不能用 toast.value === t 判断：ref 会把对象包装成 reactive 代理，
      // 与原始载荷永不相等，计时器永远清不掉提示（提示会一直挂在屏幕上）。
      const id = ++toastSeq;
      setTimeout(() => { if (toastSeq === id) toast.value = null; }, 2200);
    }),
    bus.on<BattleResult>('battle:finished', (r) => {
      result.value = r;
      newUnlocks.value = [];
      if (r.victory) {
        audioEngine.play('victory');
        const outcome = progress.recordResult({
          levelId: r.levelId,
          victory: true,
          stars: r.stars,
          hpRatio: r.hpRatio,
          timeMs: r.timeMs,
          enemiesKilled: r.enemiesKilled,
          coinsEarned: r.coinsEarned,
        });
        // 通关奖励解锁精灵。
        // 成就判定不需要在这里逐个调用——progress store 的 recordResult()
        // 已经统一遍历成就表判定，避免"定义了成就却忘了加解锁调用"。
        const lv = level.value;
        const granted: number[] = [];
        if (lv) {
          // 章尾（第 10 关）：下一章主题精灵（关卡数据内定）
          if (lv.reward.unlockIds.length) granted.push(...progress.unlock(lv.reward.unlockIds));
          // 章中（第 4/7/9 关）：从防御名册里补送未解锁的，优先本关建造名单
          const extra = lv.reward.unlockCount ?? 0;
          if (extra > 0) {
            granted.push(...progress.unlock(progress.pickUnlockCandidates(extra, lv.availableTowers)));
          }
        }
        if (granted.length) newUnlocks.value = granted;
        void outcome;
      } else {
        audioEngine.play('defeat');
      }
    }),
    bus.on('battle:exitRequested', () => { requestExit(); }),
    bus.on<{ pokemonId: number }>('battle:discovered', (d) => {
      // 遭遇即发现：敌人出场 / 放置或进化精灵时计入图鉴
      if (d?.pokemonId) progress.discover(d.pokemonId);
    }),
    bus.on('battle:hiddenUnlock', () => {
      // 宝箱隐藏解锁：具体解锁哪只在运行时按账号进度决定（优先本关可用名单）
      const roster = battleScene.value?.level.availableTowers ?? [];
      const [pick] = progress.pickUnlockCandidates(1, roster);
      if (!pick) {
        bus.emit('battle:toast', { text: '宝藏开启：防御图鉴已全部解锁！', tone: 'info' });
        return;
      }
      progress.unlock([pick]);
      bus.emit('battle:toast', {
        text: `发现隐藏精灵：${POKEDEX[pick]?.nameZh ?? pick}！已加入建造栏`,
        tone: 'good',
      });
    }),
    bus.on<{ pokemonId: number; name: string; hpRatio: number }>('battle:bossProgress', (b) => {
      boss.value = { pokemonId: b.pokemonId, name: b.name, hpRatio: b.hpRatio };
    }),
    bus.on<{ pokemonId: number; name: string }>('battle:bossDefeated', () => {
      boss.value = null;
    }),
  );
}

function unregisterBusHandlers() {
  for (const off of offHandlers) off();
  offHandlers.length = 0;
}

/** 预缓存本关会用到的精灵资源，实现"无网络也能继续游玩" */
function registerPrecache() {
  const lv = level.value;
  if (!lv) return;
  const ids = [...new Set([...lv.availableTowers, ...lv.waves.flatMap((w) => w.groups.map((g) => g.pokemonId)), lv.bossId ?? 0].filter(Boolean))];
  // 在浏览器空闲时预热，避免抢占首屏带宽
  const run = () => { void precache(levelAssetUrls(lv.id, ids.slice(0, 24))); };
  if ('requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run);
  } else {
    setTimeout(run, 3000);
  }
}

/* ---------------- 交互 ---------------- */

function beginBuild(pokemonId: number) {
  battleScene.value?.beginBuild(pokemonId);
}

function cancelBuild() {
  battleScene.value?.cancelBuild();
}

function upgrade() {
  if (battleScene.value?.tryUpgrade()) audioEngine.play('level_up');
}

function evolve() {
  void battleScene.value?.tryEvolve().then((ok) => { if (ok) audioEngine.play('evolve'); });
}

function sell() {
  if (battleScene.value?.trySell()) audioEngine.play('sell');
}

function deselect() {
  battleScene.value?.deselectTower();
}

function setSpeed(s: 1 | 2 | 3) {
  battleScene.value?.setSpeed(s);
  audioEngine.play('ui_click');
}

function togglePause() {
  battleScene.value?.togglePause();
  pausedByUser.value = !pausedByUser.value;
}

function requestExit() {
  paused.value = true;
  pausedByUser.value = false;
}

function confirmExit() {
  emit('exit');
}

function restart() {
  result.value = null;
  newUnlocks.value = [];
  paused.value = false;
  pausedByUser.value = false;
  // 重新设置关卡 id，保证场景 restart 后能再次读取到
  setPendingLevelId(props.levelId);
  battleScene.value?.restart();
}

function goNextLevel() {
  const lv = level.value;
  if (!lv) return emit('exit');
  const nextIndex = lv.index + 1;
  const nextId = nextIndex <= 10 ? `${lv.chapter}-${nextIndex}` : `${lv.chapter + 1}-1`;
  const next = getLevel(nextId);
  if (!next) return emit('exit');
  audioEngine.play('ui_confirm');
  // 先关掉结算面板再切换关卡：本组件由 App 按 activeLevelId :key 强制重建，
  // 但即便被复用也不能残留旧战局的结算弹窗（否则会挡住新一关的画面与输入）。
  result.value = null;
  newUnlocks.value = [];
  selected.value = null;
  emit('next-level', nextId);
}

/** 当前选中卡片的属性，用于范围预览着色 */
const buildType = computed<PokemonType | undefined>(() => {
  if (!buildMode.value) return undefined;
  const cfg = getTowerConfig(buildMode.value.pokemonId);
  return cfg?.types[0];
});
</script>

<template>
  <div class="battle">
    <!-- Phaser 画布 -->
    <div ref="canvasHost" class="battle__canvas" />

    <!-- 顶部状态栏 -->
    <GameHUD
      :coins="economy.coins"
      :hp="economy.hp"
      :max-hp="economy.maxHp"
      :level-id="levelId"
      :level-name="level?.name ?? ''"
      :chapter-name="level?.theme.name ?? ''"
      :wave-index="wave.index"
      :wave-total="wave.total"
      :speed="speed"
      @pause="togglePause"
      @set-speed="setSpeed"
    />

    <!-- BOSS 血条 -->
    <BossHealthBar v-if="boss" v-bind="boss" />

    <!-- 建造栏 -->
    <div class="battle__build-bar" :class="{ 'is-dimmed': showResult || pausedByUser }">
      <div class="battle__build-hint" v-if="buildMode">
        点击地图上的绿色格子放置 · <button class="link" @click="cancelBuild">取消</button>
      </div>
      <div class="battle__cards-wrap">
        <div
          ref="cardsRef"
          class="battle__cards scroll"
          @scroll="updateFades"
          @wheel="onCardsWheel"
        >
          <PokemonCard
            v-for="id in availableTowers"
            :key="id"
            :pokemon-id="id"
            :coins="economy.coins"
            :active="buildMode?.pokemonId === id"
            :is-new="flashIds.has(id)"
            @pick="beginBuild(id)"
          />
        </div>
        <div v-if="fadeLeft" class="cards-fade cards-fade--left" aria-hidden="true"></div>
        <div v-if="fadeRight" class="cards-fade cards-fade--right" aria-hidden="true"></div>
      </div>
    </div>

    <!-- 升级 / 进化 / 出售面板 -->
    <UpgradePanel
      v-if="selected && !showResult"
      :info="selected"
      :coins="economy.coins"
      @close="deselect"
      @upgrade="upgrade"
      @evolve="evolve"
      @sell="sell"
      @switch-move="(i: number) => battleScene?.setActiveMove(i)"
    />

    <!-- 暂停菜单 -->
    <PauseMenu
      v-if="pausedByUser && !showResult"
      :level-name="level?.name ?? ''"
      @resume="togglePause"
      @restart="restart"
      @exit="confirmExit"
    />

    <!-- 结算面板 -->
    <ResultPanel
      v-if="result"
      :result="result"
      :level-name="level?.name ?? ''"
      :has-next="!!(level && (level.index < 10 || level.chapter < 8))"
      :new-unlocks="newUnlocks"
      @retry="restart"
      @next="goNextLevel"
      @exit="confirmExit"
    />

    <!-- 轻提示 -->
    <Transition name="fade">
      <div v-if="toast" class="battle__toast" :class="`tone-${toast.tone}`">
        {{ toast.text }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.battle {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0a0e14;
  overflow: hidden;
}

.battle__canvas {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

.battle__canvas :deep(canvas) {
  display: block;
  max-width: 100%;
  max-height: 100%;
}

.battle__build-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  background: linear-gradient(180deg, rgba(13, 17, 23, 0.4), rgba(13, 17, 23, 0.95));
  border-top: 1px solid var(--line);
  padding: 6px calc(8px + var(--safe-left)) calc(6px + var(--safe-bottom)) calc(8px + var(--safe-right));
  backdrop-filter: blur(6px);
  transition: opacity 0.2s ease;
}

/* 矮屏（手机横屏）：收紧内边距，让建造栏少占战场高度 */
@media (max-height: 520px) {
  .battle__build-bar {
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .battle__build-hint { padding-bottom: 1px; font-size: 11px; }
  .battle__cards { gap: 5px; }
}

.battle__build-bar.is-dimmed {
  opacity: 0;
  pointer-events: none;
}

.battle__build-hint {
  text-align: center;
  font-size: 12px;
  color: var(--brand);
  padding-bottom: 4px;
}

.link {
  color: var(--accent);
  text-decoration: underline;
  font-size: 12px;
  min-height: auto;
}

.battle__cards-wrap {
  position: relative;
  min-width: 0;
}

/* 两端渐隐：提示还有卡片在屏幕外 */
.cards-fade {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 42px;
  pointer-events: none;
  z-index: 2;
}

.cards-fade--left {
  left: calc(var(--safe-left, 0px));
  background: linear-gradient(to right, rgba(13, 17, 23, 0.95), transparent);
}

.cards-fade--right {
  right: calc(var(--safe-right, 0px));
  background: linear-gradient(to left, rgba(13, 17, 23, 0.95), transparent);
}

.battle__cards {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}

.battle__toast {
  position: absolute;
  top: 96px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  padding: 8px 20px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 700;
  background: rgba(21, 27, 36, 0.95);
  border: 2px solid var(--line);
  box-shadow: var(--shadow);
  animation: float-up 0.24s ease;
  pointer-events: none;
}

.battle__toast.tone-warn { border-color: var(--warn); color: var(--warn); }
.battle__toast.tone-good { border-color: var(--good); color: var(--good); }
.battle__toast.tone-info { border-color: var(--accent); color: var(--accent); }
</style>
