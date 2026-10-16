/**
 * 关卡系统 —— 8 个地图主题 × 10 关 = 80 关，全部数据驱动生成。
 *
 * 每关包含：地图尺寸、路径节点、可建造格、障碍物、初始金币、基地生命、
 * 可用精灵、波次编组、BOSS/特殊事件、通关奖励与星级条件。
 */
import { POKEDEX } from '../pokemon/pokedex';
import { STARTER_ENEMY_IDS, STARTER_TOWER_IDS } from '../pokemon/units';

/* ------------------------------------------------------------------ */
/* 章节 / 地图主题                                                      */
/* ------------------------------------------------------------------ */

export interface ChapterTheme {
  index: number;
  key: string;
  name: string;
  subtitle: string;
  mechanic: string;
  /** 地图配色（Phaser 用十六进制数字） */
  palette: {
    ground: number;
    groundAlt: number;
    path: number;
    pathEdge: number;
    accent: number;
    sky: number;
    fog: number;
  };
  /** 该章节地形的特殊规则 */
  rules: {
    /** 建造格数量修正 */
    buildSlots: number;
    /** 敌人速度修正 */
    enemySpeed: number;
    /** 敌人生命修正 */
    enemyHp: number;
    /** 是否限制视野 */
    limitedVision?: number;
    /** 是否有飘雪 / 沙暴等天气粒子 */
    weather?: 'snow' | 'sand' | 'ash' | 'petal' | 'spore' | 'none';
    /** 允许飞行的敌人可以走直线 */
    shortcutForFlyers?: boolean;
  };
  /** 本章 BOSS 的全国图鉴编号 */
  bossId: number;
  /** 本章敌人倾向的属性 */
  enemyTypes: string[];
}

export const CHAPTERS: ChapterTheme[] = [
  {
    index: 1, key: 'forest', name: '常青森林', subtitle: '基础建造和波次',
    mechanic: '地形开阔，适合熟悉建造、升级与波次节奏。',
    palette: { ground: 0x4d7c3a, groundAlt: 0x5f8f47, path: 0xb99a63, pathEdge: 0x8f7444, accent: 0x2f5c26, sky: 0x8fd3f4, fog: 0x000000 },
    rules: { buildSlots: 1.0, enemySpeed: 1.0, enemyHp: 1.0, weather: 'petal' },
    // 第一章教学关：只考地面敌人。飞行单位需要专门的对空防御，
    // 放在第七章（天空之城）作为主题考点，第一章出现只会劝退。
    bossId: 3, enemyTypes: ['grass', 'bug', 'normal'],
  },
  {
    index: 2, key: 'beach', name: '海滨小镇', subtitle: '水路和减速',
    mechanic: '路径含浅水段，敌人经过水域时移动速度下降 20%。',
    palette: { ground: 0xe8d9a0, groundAlt: 0xdccb8c, path: 0xc9b177, pathEdge: 0xa2895a, accent: 0x3f9fd0, sky: 0x9fe0f7, fog: 0x000000 },
    rules: { buildSlots: 0.95, enemySpeed: 0.96, enemyHp: 1.05, weather: 'none' },
    bossId: 9, enemyTypes: ['water', 'flying', 'normal', 'bug'],
  },
  {
    index: 3, key: 'volcano', name: '火山地带', subtitle: '熔岩地形',
    mechanic: '熔岩间歇喷发，命中范围内的防御单位会短暂停火。',
    palette: { ground: 0x53321f, groundAlt: 0x6b4028, path: 0x2e1a10, pathEdge: 0xd8562a, accent: 0xe8683a, sky: 0x3b1d10, fog: 0x000000 },
    rules: { buildSlots: 0.9, enemySpeed: 1.04, enemyHp: 1.12, weather: 'ash' },
    bossId: 6, enemyTypes: ['fire', 'rock', 'ground', 'poison'],
  },
  {
    index: 4, key: 'snow', name: '冰雪山脉', subtitle: '冻结和滑行',
    mechanic: '冰面路段敌人会滑行加速，但冰系伤害对其加成 15%。',
    palette: { ground: 0xdfeaf2, groundAlt: 0xc9dae6, path: 0xa8c4d6, pathEdge: 0x7d9fb5, accent: 0x5f86a3, sky: 0xcfe8f5, fog: 0x000000 },
    rules: { buildSlots: 0.92, enemySpeed: 1.06, enemyHp: 1.1, weather: 'snow' },
    bossId: 131, enemyTypes: ['ice', 'water', 'flying', 'rock'],
  },
  {
    index: 5, key: 'manor', name: '幽灵古堡', subtitle: '隐身敌人',
    mechanic: '部分敌人周期性隐身，需要幽灵系或具备侦测能力的单位才能锁定。',
    palette: { ground: 0x3a3450, groundAlt: 0x473f61, path: 0x59476b, pathEdge: 0x2a2437, accent: 0x8a5fc4, sky: 0x241f36, fog: 0x1a1526 },
    rules: { buildSlots: 0.88, enemySpeed: 1.02, enemyHp: 1.15, weather: 'spore', limitedVision: 0.86 },
    bossId: 94, enemyTypes: ['ghost', 'dark', 'psychic', 'poison'],
  },
  {
    index: 6, key: 'desert', name: '沙漠遗迹', subtitle: '沙暴和视野限制',
    mechanic: '沙暴周期性笼罩战场，视野受限；攻击范围外的敌人不可见但仍可被范围技能命中。',
    palette: { ground: 0xd9b877, groundAlt: 0xc9a765, path: 0xb08f52, pathEdge: 0x8f7241, accent: 0x6f5a30, sky: 0xf0d9a8, fog: 0xd9b877 },
    rules: { buildSlots: 0.86, enemySpeed: 1.0, enemyHp: 1.18, weather: 'sand', limitedVision: 0.72 },
    bossId: 208, enemyTypes: ['ground', 'rock', 'steel', 'fire'],
  },
  {
    index: 7, key: 'sky', name: '天空之城', subtitle: '飞行敌人',
    // 天空之城的考点是"飞行单位走直线捷径 + 必须对空"，
    // 不再叠加额外的血量/速度乘数 —— 捷径本身已经是难度。
    mechanic: '大量飞行单位沿直线穿越地图，地面技能无法命中，需要专门的对空防御。',
    palette: { ground: 0xbfd6ef, groundAlt: 0xa9c6e6, path: 0xe4eefb, pathEdge: 0x8fa9c9, accent: 0xf2f7ff, sky: 0x6fb3e8, fog: 0xdceaf7 },
    rules: { buildSlots: 0.84, enemySpeed: 0.92, enemyHp: 0.85, weather: 'none', shortcutForFlyers: true },
    bossId: 384, enemyTypes: ['flying', 'dragon', 'electric', 'fairy'],
  },
  {
    index: 8, key: 'champion', name: '冠军之路', subtitle: '高强度混合敌群',
    mechanic: '全属性混编的高强度敌群，BOSS 拥有多阶段技能。',
    palette: { ground: 0x6b6f8a, groundAlt: 0x7c8099, path: 0x9aa0b8, pathEdge: 0x4d5169, accent: 0xd6b34a, sky: 0x2f3350, fog: 0x000000 },
    rules: { buildSlots: 0.82, enemySpeed: 1.0, enemyHp: 1.05, weather: 'none' },
    bossId: 448, enemyTypes: ['dragon', 'steel', 'fighting', 'psychic', 'ghost', 'fairy'],
  },
];

/* ------------------------------------------------------------------ */
/* 路径模板                                                             */
/* ------------------------------------------------------------------ */

export type GridPoint = { x: number; y: number };

/** 关卡网格：24 列 × 14 行，格子 64px，地图 1536 × 896 */
export const GRID_COLS = 24;
export const GRID_ROWS = 14;
export const TILE = 64;

/**
 * 8 条基础路径（网格坐标），每条都经过左侧入口 → 右侧终点，
 * 按章节的难度递进增加转折数量。
 *
 * 行带约束：所有路径都落在第 2~10 行。屏幕顶部被 HUD、底部被建造栏覆盖，
 * 走进这两段的路径/敌人会被遮挡（第 11~13 行在建造栏下面）。
 */
const PATH_TEMPLATES: GridPoint[][] = [
  // 1 森林：简单三折
  [{ x: -1, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 9 }, { x: 13, y: 9 }, { x: 13, y: 3 }, { x: 20, y: 3 }, { x: 20, y: 7 }, { x: GRID_COLS - 1, y: 7 }],
  // 2 海滨：含长直水道
  [{ x: -1, y: 9 }, { x: 6, y: 9 }, { x: 6, y: 3 }, { x: 11, y: 3 }, { x: 11, y: 10 }, { x: 18, y: 10 }, { x: 18, y: 5 }, { x: GRID_COLS - 1, y: 5 }],
  // 3 火山：之字形
  [{ x: -1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 7 }, { x: 9, y: 7 }, { x: 9, y: 2 }, { x: 15, y: 2 }, { x: 15, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 5 }, { x: GRID_COLS - 1, y: 5 }],
  // 4 雪山：双 S 弯
  [{ x: -1, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 4 }, { x: 16, y: 4 }, { x: 16, y: 10 }, { x: 21, y: 10 }, { x: 21, y: 6 }, { x: GRID_COLS - 1, y: 6 }],
  // 5 古堡：长廊 + 回廊
  [{ x: -1, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 8 }, { x: 3, y: 8 }, { x: 3, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 6 }, { x: 17, y: 6 }, { x: 17, y: 10 }, { x: 22, y: 10 }, { x: 22, y: 4 }, { x: GRID_COLS - 1, y: 4 }],
  // 6 沙漠：细密折线
  [{ x: -1, y: 10 }, { x: 4, y: 10 }, { x: 4, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 10 }, { x: 13, y: 10 }, { x: 13, y: 4 }, { x: 17, y: 4 }, { x: 17, y: 9 }, { x: 21, y: 9 }, { x: 21, y: 3 }, { x: GRID_COLS - 1, y: 3 }],
  // 7 天空：宽阔折返，飞行单位会走直线
  [{ x: -1, y: 7 }, { x: 5, y: 7 }, { x: 5, y: 2 }, { x: 11, y: 2 }, { x: 11, y: 10 }, { x: 17, y: 10 }, { x: 17, y: 7 }, { x: GRID_COLS - 1, y: 7 }],
  // 8 冠军：最长最绕
  [{ x: -1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 6 }, { x: 7, y: 6 }, { x: 7, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 8 }, { x: 6, y: 8 }, { x: 6, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 6 }, { x: 20, y: 6 }, { x: 20, y: 10 }, { x: 23, y: 10 }, { x: 23, y: 4 }, { x: GRID_COLS - 1, y: 4 }],
];

/* ------------------------------------------------------------------ */
/* 波次生成                                                             */
/* ------------------------------------------------------------------ */

/** 隐身种判定：与 units.ts 的 deriveEnemyTraits 保持一致（幽灵 + 速度 ≥ 80） */
function isStealthSpecies(id: number): boolean {
  const e = POKEDEX[id];
  return !!e && (e.types ?? []).includes('ghost') && (e.baseStats?.['speed'] ?? 0) >= 80;
}

export interface WaveGroup {
  /** 敌人全国图鉴编号 */
  pokemonId: number;
  /** 数量 */
  count: number;
  /** 出场间隔（毫秒） */
  intervalMs: number;
  /** 相对本波开始的延迟 */
  delayMs: number;
  /** 该组敌人的属性筛选标注（供 UI 显示） */
  note?: string;
}

export interface Wave {
  index: number;
  groups: WaveGroup[];
  /** 本波奖励金币 */
  bonus: number;
  /** 是否 BOSS 波 */
  isBoss: boolean;
}

export interface LevelDef {
  id: string;
  chapter: number;
  index: number;
  name: string;
  /** 关卡内的总波数 */
  waveCount: number;
  path: GridPoint[];
  /** 路径总长度（像素），用于计算敌人行程时间 */
  pathLength: number;
  startCoins: number;
  baseHp: number;
  /** 可使用的防御精灵编号 */
  availableTowers: number[];
  waves: Wave[];
  bossId: number | null;
  /** 星级条件：生命值百分比阈值 */
  starHp: [number, number];
  obstacles: ObstacleDef[];
  rules: ChapterTheme['rules'];
  theme: ChapterTheme;
  reward: { coins: number; unlockIds: number[]; unlockCount: number };
}

export interface ObstacleDef {
  x: number;
  y: number;
  kind: 'tree' | 'rock' | 'bush' | 'chest' | 'crystal' | 'ruin';
  hp: number;
  /** 清除奖励 */
  reward: { coins?: number; buildSlot?: boolean; hiddenUnlock?: boolean; buff?: string };
}

/** 从章节的敌人属性池里挑出符合的图鉴编号 */
function enemyPoolForChapter(chapter: ChapterTheme): number[] {
  const pool: number[] = [];
  const allowed = new Set(chapter.enemyTypes);
  for (const id of STARTER_ENEMY_IDS) {
    const e = POKEDEX[id];
    if (!e) continue;
    if (e.types.some((t) => allowed.has(t))) pool.push(id);
  }
  // 后期关卡不再混入全属性敌人： Off-theme 敌人（如在冰章节出隐身幽灵）
  // 需要玩家临时补针对性塔，是纯噪声难度而非可学习的挑战。
  // 每章自身属性池已有 10~25 种敌人，足够支撑 10 关的数量/词缀变化。
  return pool.length ? pool : STARTER_ENEMY_IDS.slice();
}

/** 用确定性的伪随机保证同一关卡每次生成的波次一致 */
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

function buildWaves(
  chapter: ChapterTheme,
  levelIndex: number,
  difficulty: number,
  bossId: number,
): Wave[] {
  const rng = makeRng(chapter.index * 1000 + levelIndex * 37);
  const pool = enemyPoolForChapter(chapter);
  const waveCount = 8 + Math.floor(levelIndex / 2) + (levelIndex >= 8 ? 2 : 0);
  const waves: Wave[] = [];

  // 飞行敌人需要专门的对空防御（电系/飞行系塔）。
  // 非天空章节：飞行占比 ≤ 40%，否则没带对空塔的玩家整波漏怪。
  // 天空之城反过来：地面敌人占比 ≤ 40%，否则整波纯地面会让对空塔全程空转。
  // 每一波都按占比拆成"飞行组 + 地面组"，保证任何一波都无法绕过对方的防御投资。
  const isSkyChapter = chapter.index === 7;
  const poolFly = pool.filter((id) => (POKEDEX[id]?.types ?? []).includes('flying'));
  const poolGround = pool.filter((id) => !(POKEDEX[id]?.types ?? []).includes('flying'));
  const flyPool = poolFly.length ? poolFly : pool;
  const groundPool = poolGround.length ? poolGround : pool;
  const minorityCap = 0.4;

  // 隐身敌人（幽灵 + 高速）只有鬼系/侦测塔能稳定锁定。
  // 幽灵古堡（第五章）是隐身机制的教学章；其他章节直接排除隐身种，
  // 避免"整波隐身"成为无法应对的硬门槛。
  const isManorChapter = chapter.index === 5;
  const pickTame = (poolToPick: number[]): number => {
    const pid = poolToPick[Math.floor(rng() * poolToPick.length)];
    if (isManorChapter || !isStealthSpecies(pid)) return pid;
    // 在原子池内替换隐身种，维持飞行/地面占比纪律
    const tamed = poolToPick.filter((id) => !isStealthSpecies(id));
    const fallback = tamed.length ? tamed : poolToPick;
    return fallback[Math.floor(rng() * fallback.length)];
  };

  for (let w = 0; w < waveCount; w++) {
    const isBossWave = levelIndex === 9 && w === waveCount - 1;
    const groups: WaveGroup[] = [];

    // 基础编组：数量随波次和难度增长。
    // 前期增长放缓（3 + w*1.05），避免教学关在中段就出现两位数敌潮；
    // 难度系数 0.15/级：到最终章每波基础数量 +11，配合章节血量系数递进。
    const baseCount = 3 + Math.floor(w * 1.05) + Math.floor(difficulty * 0.15);
    const groupCount = 1 + Math.min(2, Math.floor(w / 4));

    // 本章的"少数派"敌群（非天空章 = 飞行；天空章 = 地面）
    const minorityTotal = Math.min(
      baseCount - 1,
      Math.max(1, Math.round((baseCount / groupCount) * (0.5 + rng()) * minorityCap)),
    );
    const minorityPool = isSkyChapter ? groundPool : flyPool;
    const majorityPool = isSkyChapter ? flyPool : groundPool;
    const minorityDelay = 800 + Math.floor(rng() * 900);

    const pushGroup = (pid: number, count: number, delayMs: number, note?: string) => {
      if (count <= 0) return;
      groups.push({
        pokemonId: pid,
        count,
        intervalMs: Math.max(340, 950 - w * 45 - difficulty * 8),
        delayMs,
        note,
      });
    };

    // 少数派拆成 groupCount 个小编组，主群同样
    let minorityLeft = minorityTotal;
    let majorityLeft = baseCount - minorityTotal;
    for (let g = 0; g < groupCount; g++) {
      const isLast = g === groupCount - 1;
      const minorityPart = isLast ? minorityLeft : Math.max(0, Math.round(minorityTotal / groupCount) + Math.floor(rng() * 2) - 1);
      const majorityPart = isLast ? majorityLeft : Math.round(majorityLeft / (groupCount - g)) + Math.floor(rng() * 2) - 1;
      minorityLeft -= minorityPart;
      majorityLeft -= Math.max(0, majorityPart);
      pushGroup(pickTame(minorityPool), minorityPart, g * 1400 + minorityDelay);
      pushGroup(pickTame(majorityPool), Math.max(1, majorityPart), g * 1400);
    }

    if (isBossWave && bossId) {
      groups.push({ pokemonId: bossId, count: 1, intervalMs: 1000, delayMs: 2500, note: 'BOSS' });
      // BOSS 随行小队：从主群池抽取（天空章 = 飞行护卫）
      pushGroup(pickTame(majorityPool), 6, 0, '精英护卫');
    }

    waves.push({
      index: w,
      groups,
      bonus: Math.round(25 + w * 8 + difficulty * 4),
      isBoss: isBossWave,
    });
  }
  return waves;
}

/** 依据路径模板生成障碍物（保卫萝卜式的地图清理玩法） */
function buildObstacles(path: GridPoint[], chapter: ChapterTheme, levelIndex: number, count: number): ObstacleDef[] {
  const rng = makeRng(chapter.index * 977 + levelIndex * 131);
  const occupied = new Set<string>();
  // 路径的一圈邻域：障碍物只放在这里。
  // 障碍物靠塔的攻击溅射清理（命中点周围约 100px），离路径超过一格就永远
  // 打不到——尤其宝箱背着隐藏解锁，必须保证每只都开得出来。
  const nearPath = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
      occupied.add(`${x},${y}`);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) nearPath.add(`${x + dx},${y + dy}`);
      }
    }
  }

  const kinds: ObstacleDef['kind'][] =
    chapter.key === 'forest' ? ['tree', 'bush', 'tree', 'rock']
    : chapter.key === 'beach' ? ['rock', 'bush', 'chest']
    : chapter.key === 'volcano' ? ['rock', 'crystal', 'rock']
    : chapter.key === 'snow' ? ['crystal', 'rock', 'tree']
    : chapter.key === 'manor' ? ['ruin', 'chest', 'bush']
    : chapter.key === 'desert' ? ['ruin', 'rock', 'chest']
    : chapter.key === 'sky' ? ['crystal', 'ruin', 'chest']
    : ['ruin', 'chest', 'crystal', 'rock'];

  const obstacles: ObstacleDef[] = [];
  let attempts = 0;
  while (obstacles.length < count && attempts < count * 40) {
    attempts++;
    const x = Math.floor(rng() * GRID_COLS);
    // 与路径同处 2~10 行的可见行带（顶栏/底栏覆盖之外）
    const y = 2 + Math.floor(rng() * 9);
    const key = `${x},${y}`;
    if (!nearPath.has(key)) continue;
    if (occupied.has(key)) continue;
    // 与已有障碍保持一格间距，避免连成一片
    if (obstacles.some((o) => Math.abs(o.x - x) <= 1 && Math.abs(o.y - y) <= 1)) continue;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const hp = Math.round((60 + rng() * 90) * (1 + levelIndex * 0.12));
    const reward: ObstacleDef['reward'] = {};
    if (kind === 'tree' || kind === 'bush') reward.coins = Math.round(25 + rng() * 45);
    else if (kind === 'rock') { reward.coins = Math.round(40 + rng() * 40); if (rng() > 0.55) reward.buildSlot = true; }
    // 宝箱的隐藏解锁只打标记，具体解锁哪只由运行时决定：
    // 关卡数据是账号无关的，只有打开宝箱的那一刻才知道玩家还缺哪只。
    else if (kind === 'chest') { reward.coins = Math.round(80 + rng() * 120); if (rng() > 0.7) reward.hiddenUnlock = true; }
    else if (kind === 'crystal') { reward.coins = Math.round(50 + rng() * 50); reward.buff = 'attackSpeed'; }
    else reward.coins = Math.round(35 + rng() * 55);
    obstacles.push({ x, y, kind, hp, reward });
  }
  return obstacles;
}

function pathLengthOf(path: GridPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    total += (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * TILE;
  }
  return total;
}

/** 可用防御精灵：随章节逐步解锁，前期只给基础组合 */
function availableTowersFor(chapterIndex: number, levelIndex: number): number[] {
  const tier = (chapterIndex - 1) * 10 + levelIndex; // 0..79
  const unlockCount = Math.min(STARTER_TOWER_IDS.length, 8 + Math.floor(tier * 0.42));
  const list = STARTER_TOWER_IDS.slice(0, unlockCount);
  // 每个新章节额外赠送该章节属性倾向的精灵
  const theme = CHAPTERS[chapterIndex - 1];
  for (const id of STARTER_TOWER_IDS) {
    const e = POKEDEX[id];
    if (!e) continue;
    if (e.types.some((t) => theme.enemyTypes.includes(t)) && !list.includes(id)) list.push(id);
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* 全量关卡生成                                                         */
/* ------------------------------------------------------------------ */

let levelCache: LevelDef[] | null = null;

export function getAllLevels(): LevelDef[] {
  if (levelCache) return levelCache;
  const levels: LevelDef[] = [];

  for (const chapter of CHAPTERS) {
    const basePath = PATH_TEMPLATES[chapter.index - 1];
    for (let li = 0; li < 10; li++) {
      const difficulty = (chapter.index - 1) * 10 + li; // 0..79
      // 后期关卡在地图右侧追加一个额外的折返点，增加路径长度
      const path = li < 3 ? basePath : shiftPath(basePath, li);
      const bossId = li === 9 ? chapter.bossId : null;

      levels.push({
        id: `${chapter.index}-${li + 1}`,
        chapter: chapter.index,
        index: li + 1,
        name: `${chapter.name} ${chapter.index}-${li + 1}`,
        waveCount: 8 + Math.floor(li / 2) + (li >= 8 ? 2 : 0),
        path,
        pathLength: pathLengthOf(path),
        startCoins: 500 + chapter.index * 40 + li * 25,
        baseHp: 10 + Math.floor(chapter.index / 2),
        availableTowers: availableTowersFor(chapter.index, li),
        waves: buildWaves(chapter, li, difficulty, chapter.bossId),
        bossId,
        starHp: [0.5, 1.0],
        obstacles: buildObstacles(path, chapter, li, 6 + Math.floor(chapter.index / 2) + (li >= 7 ? 3 : 0)),
        rules: chapter.rules,
        theme: chapter,
        reward: {
          coins: 120 + difficulty * 18,
          unlockIds: li === 9 ? nextChapterRewards(chapter.index) : [],
          // 章中奖励：第 4、7 关各送 1 只、第 9 关送 2 只（运行时从防御名册
          // 里挑未解锁的，优先本关建造名单内的）。避免"整章只有章尾一款奖励"。
          unlockCount: (li === 3 || li === 6) ? 1 : li === 8 ? 2 : 0,
        },
      });
    }
  }

  levelCache = levels;
  return levels;
}

/**
 * 后期关卡：在长直段上插入一个 U 形折返，增加路径长度。
 *
 * 关键约束：敌人只能沿网格轴移动（寻路与渲染都按行/列推进），
 * 因此折返必须由若干条水平/垂直线段组成，不能出现斜线段。
 */
function shiftPath(base: GridPoint[], levelIndex: number): GridPoint[] {
  const depth = Math.min(3, Math.floor(levelIndex / 3));
  if (depth <= 0) return dedupePath(base);

  const out: GridPoint[] = [];
  for (let i = 0; i < base.length - 1; i++) {
    out.push(base[i]);
    const a = base[i];
    const b = base[i + 1];
    const horizontal = a.y === b.y;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

    // 只在足够长的线段上插入，且隔段插入避免过于曲折
    if (len < 5 || i % 2 !== 1) continue;

    if (horizontal) {
      const midX = Math.round((a.x + b.x) / 2);
      // 折返只进 2~10 行的可见行带（顶栏/底栏之外的区域）
      const detourY = clamp(a.y + (i % 4 === 1 ? depth : -depth), 2, 10);
      if (detourY === a.y) continue;
      // a →(水平)→ (midX,a.y) →(垂直)→ (midX,detourY) →(水平)→ (b.x,detourY) →(垂直)→ b
      out.push({ x: midX, y: a.y });
      out.push({ x: midX, y: detourY });
      out.push({ x: b.x, y: detourY });
    } else {
      const midY = Math.round((a.y + b.y) / 2);
      const detourX = clamp(a.x + (i % 4 === 1 ? depth : -depth), 0, GRID_COLS - 1);
      if (detourX === a.x) continue;
      // a →(垂直)→ (a.x,midY) →(水平)→ (detourX,midY) →(垂直)→ (detourX,b.y) →(水平)→ b
      out.push({ x: a.x, y: midY });
      out.push({ x: detourX, y: midY });
      out.push({ x: detourX, y: b.y });
    }
  }
  out.push(base[base.length - 1]);
  return dedupePath(out);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 去掉相邻重复点与共线的中间点，保证每段都是有效的水平/垂直线段 */
function dedupePath(path: GridPoint[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  // 移除共线冗余点（a-b-c 同一直线时 b 可删）
  const simplified: GridPoint[] = [];
  for (let i = 0; i < out.length; i++) {
    const prev = simplified[simplified.length - 1];
    const next = out[i + 1];
    if (prev && next) {
      const sameCol = prev.x === out[i].x && out[i].x === next.x;
      const sameRow = prev.y === out[i].y && out[i].y === next.y;
      if (sameCol || sameRow) continue;
    }
    simplified.push(out[i]);
  }
  return simplified;
}

/** 通关本章最后一关后解锁的精灵 */
function nextChapterRewards(chapterIndex: number): number[] {
  const next = CHAPTERS[chapterIndex]; // chapterIndex 是 1-based，取下一章
  if (!next) {
    // 全部通关：解锁传说 / 幻兽
    return [150, 249, 250, 384, 483, 484, 487];
  }
  const out: number[] = [];
  for (const id of STARTER_TOWER_IDS) {
    const e = POKEDEX[id];
    if (e && e.types.some((t) => next.enemyTypes.includes(t))) out.push(id);
  }
  return out.slice(0, 4);
}

export function getLevel(id: string): LevelDef | null {
  return getAllLevels().find((l) => l.id === id) ?? null;
}

export function getLevelsByChapter(chapter: number): LevelDef[] {
  return getAllLevels().filter((l) => l.chapter === chapter);
}

/** 把网格路径转成世界坐标（像素） */
export function pathToWorld(path: GridPoint[]): { x: number; y: number }[] {
  return path.map((p) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 }));
}

/** 收集路径占据的格子（这些格不可建造） */
export function blockedCells(path: GridPoint[]): Set<string> {
  const blocked = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
      if (x >= 0 && y >= 0 && x < GRID_COLS && y < GRID_ROWS) blocked.add(`${x},${y}`);
    }
  }
  return blocked;
}
