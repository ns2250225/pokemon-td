/**
 * 存档 / 进度 store —— 包装 SaveService，向 Vue 组件暴露响应式数据。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { saveService, type ProgressData, type LevelProgress } from '../utils/save';
import { getAllLevels, CHAPTERS } from '../data/levels/levels';
import { STARTER_TOWER_IDS } from '../data/pokemon/units';
import { bus } from '../utils/eventBus';

/** 初始赠送的防御精灵：皮卡丘 / 小火龙 / 杰尼龟 / 妙蛙种子 */
export const INITIAL_UNLOCKS = [25, 4, 7, 1];


/* ------------------------------------------------------------------ */
/* 成就：定义与集中判定                                                  */
/* ------------------------------------------------------------------ */

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: '通关' | '挑战' | '收集';
  /** 返回当前进度与目标，用于进度条 */
  progress: (state: AchievementState) => { current: number; target: number };
}

/** 判定所需的全部进度数据（从 store 的响应式状态里抽取，便于纯函数测试） */
export interface AchievementState {
  levels: Record<string, LevelProgress>;
  stars: number;
  clearedCount: number;
  enemiesDefeated: number;
  victories: number;
  coinsEarned: number;
  unlocked: number[];
  discovered: number[];
  shinySeen: number[];
  totalSpecies: number;
}


/**
 * 成就定义表 —— 唯一事实来源。
 *
 * 全部 13 个成就都在这张表里声明，并由 evaluateAchievements() 统一判定。
 * 早先的做法是在 BattleScreen 里对 3 个成就手写 unlockAchievement 调用，
 * 结果是另外 10 个成就永远无法解锁（进度条能走满但图标一直锁着），
 * 而且手写的名称/描述会和面板里的表格逐渐不一致。
 */
export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    id: 'first-step', name: '初出茅庐', description: '首次通关任意关卡', category: '通关',
    progress: (s) => ({ current: Math.min(1, s.clearedCount), target: 1 }),
  },
  {
    id: 'forest-clear', name: '森林守卫', description: '通关常青森林全部 10 关', category: '通关',
    progress: (s) => ({
      current: Object.entries(s.levels).filter(([id, l]) => l.cleared && id.startsWith('1-')).length,
      target: 10,
    }),
  },
  {
    id: 'half-way', name: '半程英雄', description: '通关 40 个关卡', category: '通关',
    progress: (s) => ({ current: Math.min(40, s.clearedCount), target: 40 }),
  },
  {
    id: 'all-levels', name: '冠军之路', description: '通关全部 80 个关卡', category: '通关',
    progress: (s) => ({ current: s.clearedCount, target: 80 }),
  },
  {
    id: 'perfect-clear', name: '完美防守', description: '以满生命值通关任意关卡', category: '挑战',
    progress: (s) => ({
      current: Object.values(s.levels).some((l) => l.cleared && l.bestHpRatio >= 1) ? 1 : 0,
      target: 1,
    }),
  },
  {
    id: 'boss-slayer', name: '屠龙者', description: '通关任意章节的 BOSS 关', category: '挑战',
    progress: (s) => ({
      current: Object.keys(s.levels).filter((id) => s.levels[id].cleared && id.endsWith('-10')).length,
      target: 1,
    }),
  },
  {
    id: 'star-collector', name: '三星猎人', description: '累计获得 60 颗星', category: '挑战',
    progress: (s) => ({ current: Math.min(60, s.stars), target: 60 }),
  },
  {
    id: 'veteran', name: '百战之躯', description: '累计击败 5000 个敌人', category: '挑战',
    progress: (s) => ({ current: Math.min(5000, s.enemiesDefeated), target: 5000 }),
  },
  {
    id: 'collector', name: '收集者', description: '解锁 30 种防御精灵', category: '收集',
    progress: (s) => ({ current: Math.min(30, s.unlocked.length), target: 30 }),
  },
  {
    id: 'starter-full', name: '御三家齐全', description: '同时拥有妙蛙种子、小火龙、杰尼龟', category: '收集',
    progress: (s) => ({ current: [1, 4, 7].filter((id) => s.unlocked.includes(id)).length, target: 3 }),
  },
  {
    id: 'researcher', name: '研究员', description: `图鉴发现 ${Math.floor(1025 / 4)} 种宝可梦`, category: '收集',
    progress: (s) => ({ current: Math.min(Math.floor(s.totalSpecies / 4), s.discovered.length), target: Math.floor(s.totalSpecies / 4) }),
  },
  {
    id: 'shiny-hunter', name: '异色猎人', description: '见过 5 种异色形态', category: '收集',
    progress: (s) => ({ current: Math.min(5, s.shinySeen.length), target: 5 }),
  },
  {
    id: 'all-towers', name: '全员出战', description: `解锁全部 ${STARTER_TOWER_IDS.length} 种首发防御精灵`, category: '收集',
    progress: (s) => ({
      current: STARTER_TOWER_IDS.filter((id) => s.unlocked.includes(id)).length,
      target: STARTER_TOWER_IDS.length,
    }),
  },
];

export const useProgressStore = defineStore('progress', () => {
  const ready = ref(false);
  const levels = ref<Record<string, LevelProgress>>({});
  const unlockedPokemon = ref<number[]>([]);
  const discovered = ref<number[]>([]);
  const shinySeen = ref<number[]>([]);
  const achievements = ref<ProgressData['achievements']>([]);
  const totalCoinsEarned = ref(0);
  const totalEnemiesDefeated = ref(0);
  const totalVictories = ref(0);

  async function init() {
    await saveService.init();
    const p = saveService.progress;
    levels.value = { ...p.levels };
    unlockedPokemon.value = [...p.unlockedPokemon];
    discovered.value = [...p.discovered];
    shinySeen.value = [...p.shinySeen];
    achievements.value = [...p.achievements];
    totalCoinsEarned.value = p.totalCoinsEarned;
    totalEnemiesDefeated.value = p.totalEnemiesDefeated;
    totalVictories.value = p.totalVictories;

    // 首次进入：赠送初始精灵
    if (!unlockedPokemon.value.length) {
      saveService.unlockPokemon(INITIAL_UNLOCKS);
      unlockedPokemon.value = [...INITIAL_UNLOCKS];
    }
    ready.value = true;
  }

  function syncFromSave() {
    const p = saveService.progress;
    levels.value = { ...p.levels };
    unlockedPokemon.value = [...p.unlockedPokemon];
    discovered.value = [...p.discovered];
    shinySeen.value = [...p.shinySeen];
    achievements.value = [...p.achievements];
    totalCoinsEarned.value = p.totalCoinsEarned;
    totalEnemiesDefeated.value = p.totalEnemiesDefeated;
    totalVictories.value = p.totalVictories;
  }

  function recordResult(result: Parameters<typeof saveService.recordLevelResult>[0]) {
    const outcome = saveService.recordLevelResult(result);
    syncFromSave();
    // 每次记录战绩后统一判定成就：调用方不必记得为每个成就写解锁逻辑
    evaluateAchievements();
    return outcome;
  }

  function unlock(ids: number[]) {
    const added = saveService.unlockPokemon(ids);
    if (added.length) {
      unlockedPokemon.value = [...saveService.progress.unlockedPokemon];
      bus.emit('progress:unlocked', added);
    }
    return added;
  }

  /**
   * 从防御名册里挑选未解锁的精灵（宝箱 / 通关奖励用）。
   *
   * 优先级：prefer 列表内（如当前关的建造名单，解锁后立刻可用）> 名册其余。
   * 全部解锁后返回空数组，调用方自行兜底。
   */
  function pickUnlockCandidates(count: number, prefer: number[] = []): number[] {
    if (count <= 0) return [];
    const locked = STARTER_TOWER_IDS.filter((id) => !unlockedPokemon.value.includes(id));
    if (!locked.length) return [];
    const shuffle = <T,>(arr: T[]): T[] => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const preferred = shuffle(locked.filter((id) => prefer.includes(id)));
    const rest = shuffle(locked.filter((id) => !prefer.includes(id)));
    return [...preferred, ...rest].slice(0, count);
  }

  function discover(id: number) {
    saveService.discoverPokemon(id);
    if (!discovered.value.includes(id)) discovered.value = [...discovered.value, id];
    evaluateAchievements();
  }

  function markShinySeen(id: number) {
    saveService.markShinySeen(id);
    if (!shinySeen.value.includes(id)) shinySeen.value = [...shinySeen.value, id];
    evaluateAchievements();
  }

  function isUnlocked(id: number): boolean {
    return unlockedPokemon.value.includes(id);
  }

  function getLevelProgress(id: string): LevelProgress | undefined {
    return levels.value[id];
  }

  function starsFor(id: string): number {
    return levels.value[id]?.stars ?? 0;
  }

  /** 关卡是否解锁：第一章第 1 关永远开放，之后要求上一关通关 */
  function isLevelUnlocked(levelId: string): boolean {
    const all = getAllLevels();
    const idx = all.findIndex((l) => l.id === levelId);
    if (idx <= 0) return true;
    const prev = all[idx - 1];
    return levels.value[prev.id]?.cleared ?? false;
  }

  function unlockAchievement(id: string, name: string, description: string): boolean {
    const ok = saveService.unlockAchievement(id, name, description);
    if (ok) {
      achievements.value = [...saveService.progress.achievements];
      bus.emit('progress:achievement', { id, name, description });
    }
    return ok;
  }

  /** 总星数 */
  const totalStars = computed(() => Object.values(levels.value).reduce((a, l) => a + l.stars, 0));
  const maxStars = computed(() => getAllLevels().length * 3);
  const clearedCount = computed(() => Object.values(levels.value).filter((l) => l.cleared).length);

  /** 章节完成度 */
  const chapterProgress = computed(() =>
    CHAPTERS.map((c) => {
      const chapterLevels = getAllLevels().filter((l) => l.chapter === c.index);
      const cleared = chapterLevels.filter((l) => levels.value[l.id]?.cleared).length;
      const stars = chapterLevels.reduce((a, l) => a + (levels.value[l.id]?.stars ?? 0), 0);
      return { chapter: c, cleared, total: chapterLevels.length, stars, maxStars: chapterLevels.length * 3 };
    }),
  );

  /** 图鉴发现率 */
  const discoveryRatio = computed(() => discovered.value.length);

  async function exportSave(): Promise<string> {
    return saveService.exportJson();
  }

  function importSave(json: string) {
    const res = saveService.importJson(json);
    if (res.ok) syncFromSave();
    return res;
  }

  async function reset() {
    await saveService.resetAll();
    saveService.unlockPokemon(INITIAL_UNLOCKS);
    syncFromSave();
  }

  /** 因为全部 1025 只都有战斗配置，模拟"全解锁"用于图鉴展示 */
  const allStarterIds = STARTER_TOWER_IDS;


  /** 当前成就判定所需的进度快照 */
  function achievementState(totalSpecies = 1025): AchievementState {
    return {
      levels: levels.value,
      stars: totalStars.value,
      clearedCount: clearedCount.value,
      enemiesDefeated: totalEnemiesDefeated.value,
      victories: totalVictories.value,
      coinsEarned: totalCoinsEarned.value,
      unlocked: unlockedPokemon.value,
      discovered: discovered.value,
      shinySeen: shinySeen.value,
      totalSpecies,
    };
  }

  /**
   * 遍历全部成就定义，解锁所有已达成但尚未标记的成就。
   *
   * 由 recordResult / unlock / discover 等入口调用，这样"达成条件"
   * 与"解锁动作"不会因为漏写某个调用点而失效。
   * 返回本次新解锁的成就 ID 列表。
   */
  function evaluateAchievements(totalSpecies = 1025): string[] {
    const state = achievementState(totalSpecies);
    const owned = new Set(achievements.value.map((a) => a.id));
    const newly: string[] = [];
    for (const def of ACHIEVEMENT_DEFS) {
      if (owned.has(def.id)) continue;
      const { current, target } = def.progress(state);
      if (target > 0 && current >= target) {
        if (unlockAchievement(def.id, def.name, def.description)) newly.push(def.id);
      }
    }
    return newly;
  }

  return {
    ready,
    levels,
    unlockedPokemon,
    discovered,
    shinySeen,
    achievements,
    totalCoinsEarned,
    totalEnemiesDefeated,
    totalVictories,
    totalStars,
    maxStars,
    clearedCount,
    chapterProgress,
    discoveryRatio,
    allStarterIds,
    init,
    syncFromSave,
    recordResult,
    unlock,
    pickUnlockCandidates,
    discover,
    markShinySeen,
    isUnlocked,
    getLevelProgress,
    starsFor,
    isLevelUnlocked,
    unlockAchievement,
    evaluateAchievements,
    achievementState,
    exportSave,
    importSave,
    reset,
  };
});
