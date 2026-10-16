/**
 * IndexedDB 存档层 —— 无账号、纯本地（PRD 9.4）。
 *
 * 存三类数据：
 *   progress  已通关关卡、星级、解锁精灵、图鉴发现记录、成就
 *   settings  音量、画质、操作偏好、特效开关
 *   save meta 版本号与导出时间，用于 JSON 导入导出的兼容校验
 *
 * 所有写入都不阻塞战斗：写入失败只在控制台告警，不影响游戏推进。
 */
const DB_NAME = 'pokemon-tower-defense';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_PROGRESS = 'progress';
const STORE_SETTINGS = 'settings';

export const SAVE_VERSION = 1;

export interface LevelProgress {
  /** 关卡 id，如 "1-1" */
  id: string;
  stars: number;
  cleared: boolean;
  bestHpRatio: number;
  bestTimeMs: number;
  attempts: number;
  lastPlayedAt: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  unlockedAt: number;
}

export interface ProgressData {
  levels: Record<string, LevelProgress>;
  /** 已解锁的防御精灵编号 */
  unlockedPokemon: number[];
  /** 图鉴中已"发现"的精灵（遭遇过或使用过） */
  discovered: number[];
  /** 已见过的异色形态 */
  shinySeen: number[];
  achievements: Achievement[];
  totalCoinsEarned: number;
  totalEnemiesDefeated: number;
  totalVictories: number;
}

export interface SettingsData {
  bgmVolume: number;
  sfxVolume: number;
  quality: 'low' | 'medium' | 'high';
  screenShake: boolean;
  flash: boolean;
  damageNumbers: boolean;
  effectIntensity: number;
  defaultSpeed: 1 | 2 | 3;
  autoRotatePrompt: boolean;
  fullscreenOnStart: boolean;
}

export const DEFAULT_PROGRESS: ProgressData = {
  levels: {},
  unlockedPokemon: [],
  discovered: [],
  shinySeen: [],
  achievements: [],
  totalCoinsEarned: 0,
  totalEnemiesDefeated: 0,
  totalVictories: 0,
};

export const DEFAULT_SETTINGS: SettingsData = {
  bgmVolume: 0.5,
  sfxVolume: 0.7,
  quality: 'high',
  screenShake: true,
  flash: true,
  damageNumbers: true,
  effectIntensity: 1,
  defaultSpeed: 1,
  autoRotatePrompt: true,
  fullscreenOnStart: false,
};

/* ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;
/** IndexedDB 不可用时的内存回退（隐私模式 / 旧浏览器） */
let memoryFallback: Map<string, unknown> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) db.createObjectStore(STORE_PROGRESS);
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = fn(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

/* ------------------------------------------------------------------ */

export class SaveService {
  private progressCache: ProgressData | null = null;
  private settingsCache: SettingsData | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private available = true;

  async init(): Promise<void> {
    try {
      await openDb();
      this.available = true;
    } catch {
      this.available = false;
      memoryFallback = new Map();
      console.warn('[save] IndexedDB 不可用，本次会话使用内存存档');
    }
    await this.loadProgress();
    await this.loadSettings();
  }

  get isPersistent() {
    return this.available;
  }

  /* ---------------- 进度 ---------------- */

  async loadProgress(): Promise<ProgressData> {
    if (this.progressCache) return this.progressCache;
    let data: ProgressData | null = null;
    try {
      data = this.available
        ? (await tx<ProgressData | undefined>(STORE_PROGRESS, 'readonly', (s) => s.get('main'))) ?? null
        : (memoryFallback?.get('progress') as ProgressData) ?? null;
    } catch {
      data = null;
    }
    this.progressCache = { ...DEFAULT_PROGRESS, ...(data ?? {}) };
    // 保证嵌套字段也有默认值（旧存档兼容）
    this.progressCache.levels = { ...(data?.levels ?? {}) };
    this.progressCache.achievements = data?.achievements ?? [];
    this.progressCache.unlockedPokemon = data?.unlockedPokemon ?? [];
    this.progressCache.discovered = data?.discovered ?? [];
    this.progressCache.shinySeen = data?.shinySeen ?? [];
    return this.progressCache;
  }

  get progress(): ProgressData {
    return this.progressCache ?? DEFAULT_PROGRESS;
  }

  /** 延时写入，避免连续操作频繁触发 IDB 事务 */
  scheduleSave(delayMs = 500) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.saveNow(); }, delayMs);
  }

  async saveNow(): Promise<void> {
    if (!this.progressCache) return;
    this.saveTimer = null;
    try {
      if (this.available) {
        await tx(STORE_PROGRESS, 'readwrite', (s) => s.put(this.progressCache, 'main'));
        await tx(STORE_META, 'readwrite', (s) => s.put({ version: SAVE_VERSION, savedAt: Date.now() }, 'save-meta'));
      } else {
        memoryFallback?.set('progress', this.progressCache);
      }
    } catch (err) {
      // 存档失败不能打断战斗
      console.warn('[save] 进度写入失败', err);
    }
  }

  /* ---------------- 设置 ---------------- */

  /** 上次 loadSettings 时磁盘上是否已有保存的设置（用于判断首次进入） */
  settingsExistedOnDisk = false;

  async loadSettings(): Promise<SettingsData> {
    if (this.settingsCache) return this.settingsCache;
    let data: SettingsData | null = null;
    try {
      data = this.available
        ? (await tx<SettingsData | undefined>(STORE_SETTINGS, 'readonly', (s) => s.get('main'))) ?? null
        : (memoryFallback?.get('settings') as SettingsData) ?? null;
    } catch {
      data = null;
    }
    this.settingsExistedOnDisk = data !== null;
    this.settingsCache = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    return this.settingsCache;
  }

  get settings(): SettingsData {
    return this.settingsCache ?? DEFAULT_SETTINGS;
  }

  async saveSettings(patch: Partial<SettingsData>): Promise<void> {
    this.settingsCache = { ...(this.settingsCache ?? DEFAULT_SETTINGS), ...patch };
    try {
      if (this.available) await tx(STORE_SETTINGS, 'readwrite', (s) => s.put(this.settingsCache, 'main'));
      else memoryFallback?.set('settings', this.settingsCache);
    } catch (err) {
      console.warn('[save] 设置写入失败', err);
    }
  }

  /* ---------------- 关卡结算 ---------------- */

  recordLevelResult(result: {
    levelId: string; victory: boolean; stars: number; hpRatio: number; timeMs: number;
    enemiesKilled: number; coinsEarned: number;
  }): { isNew: boolean; bestStars: number } {
    const p = this.progress;
    const prev = p.levels[result.levelId];
    const isNew = !prev?.cleared && result.victory;
    const record: LevelProgress = {
      id: result.levelId,
      stars: Math.max(prev?.stars ?? 0, result.stars),
      cleared: (prev?.cleared ?? false) || result.victory,
      bestHpRatio: Math.max(prev?.bestHpRatio ?? 0, result.hpRatio),
      bestTimeMs: prev?.bestTimeMs ? Math.min(prev.bestTimeMs, result.timeMs) : result.timeMs,
      attempts: (prev?.attempts ?? 0) + 1,
      lastPlayedAt: Date.now(),
    };
    p.levels[result.levelId] = record;
    p.totalCoinsEarned += result.coinsEarned;
    p.totalEnemiesDefeated += result.enemiesKilled;
    if (result.victory) p.totalVictories++;
    this.scheduleSave();
    return { isNew, bestStars: record.stars };
  }

  unlockPokemon(ids: number[]): number[] {
    const p = this.progress;
    const added: number[] = [];
    for (const id of ids) {
      if (!p.unlockedPokemon.includes(id)) {
        p.unlockedPokemon.push(id);
        added.push(id);
      }
    }
    if (added.length) this.scheduleSave();
    return added;
  }

  discoverPokemon(id: number) {
    const p = this.progress;
    if (!p.discovered.includes(id)) {
      p.discovered.push(id);
      this.scheduleSave(1500);
    }
  }

  markShinySeen(id: number) {
    const p = this.progress;
    if (!p.shinySeen.includes(id)) {
      p.shinySeen.push(id);
      this.scheduleSave();
    }
  }

  unlockAchievement(id: string, name: string, description: string): boolean {
    const p = this.progress;
    if (p.achievements.some((a) => a.id === id)) return false;
    p.achievements.push({ id, name, description, unlockedAt: Date.now() });
    this.scheduleSave();
    return true;
  }

  /* ---------------- 导入导出 ---------------- */

  exportJson(): string {
    return JSON.stringify({
      version: SAVE_VERSION,
      exportedAt: new Date().toISOString(),
      progress: this.progress,
      settings: this.settings,
    }, null, 2);
  }

  /** 导入存档；返回是否成功与错误信息 */
  importJson(json: string): { ok: boolean; message: string } {
    let parsed: { version?: number; progress?: ProgressData; settings?: SettingsData };
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, message: 'JSON 格式错误' };
    }
    if (!parsed.progress) return { ok: false, message: '缺少 progress 字段' };
    if (parsed.version && parsed.version > SAVE_VERSION) {
      return { ok: false, message: `存档版本 ${parsed.version} 高于当前支持的 ${SAVE_VERSION}` };
    }
    this.progressCache = { ...DEFAULT_PROGRESS, ...parsed.progress };
    this.settingsCache = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };
    void this.saveNow();
    void this.saveSettings({});
    return { ok: true, message: '导入成功' };
  }

  async resetAll(): Promise<void> {
    this.progressCache = { ...DEFAULT_PROGRESS, levels: {}, unlockedPokemon: [], discovered: [], shinySeen: [], achievements: [] };
    await this.saveNow();
  }
}

export const saveService = new SaveService();
