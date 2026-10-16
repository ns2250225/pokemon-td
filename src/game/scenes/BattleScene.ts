/**
 * 战斗场景 —— 塔防核心循环。
 *
 * 职责：
 *  - 渲染地图 / 路径 / 可建造格 / 障碍物
 *  - 建造、选中、升级、进化、出售防御精灵
 *  - 以固定时间步长驱动 WaveSystem、目标选择、伤害结算
 *  - 协调 EffectSystem 播放技能特效
 *  - 处理触控与鼠标交互（含竖屏兜底坐标映射）
 */
import Phaser from 'phaser';
import {
  DEPTH, TILE, GAME_WIDTH, GAME_HEIGHT, SCENE_KEYS, SIM_STEP_MS,
  QUALITY_CONFIG, isMobileDevice, type QualityLevel, type GameSpeed,
} from '../config';
import { consumePendingLevelId } from './SceneParams';
import { preloadMapAssets, drawMapTerrain, drawMapObstacle, drawMapEndpoints } from '../MapRenderer';
import { AssetService, textureKeys } from '../managers/AssetManager';
import { EffectSystem } from '../systems/EffectSystem';
import { WaveSystem } from '../systems/WaveSystem';
import { SpatialGrid } from '../systems/SpatialGrid';
import { computeDamage, damageColor, type ActiveStatus } from '../systems/CombatSystem';
import { pickTarget, resolveTargets } from '../systems/TargetingSystem';
import { PokemonTower } from '../entities/Tower';
import { MovingEnemy } from '../entities/Enemy';
import { getTowerConfig, type TowerConfig } from '../../data/pokemon/units';
import { getLevel, blockedCells, GRID_COLS, GRID_ROWS, type LevelDef } from '../../data/levels/levels';
import { POKEDEX } from '../../data/pokemon/pokedex';
import { TYPE_COLORS, TYPE_LABELS, type PokemonType } from '../../data/balance/typeChart';
import { MOVES } from '../../data/moves/moves';
import { bus } from '../../utils/eventBus';
import { getGameSettings } from '../../stores/settings';
import type { BossRuntime } from '../systems/BossSystem';
import { installBossBehaviour } from '../systems/BossBehaviour';

/** 关卡开始前加载素材的时间预算：超过则带着占位图直接开局 */
const PRELOAD_BUDGET_MS = 8000;

export interface BattleResult {
  levelId: string;
  victory: boolean;
  stars: number;
  hpRatio: number;
  coinsEarned: number;
  enemiesKilled: number;
  wavesCleared: number;
  timeMs: number;
}

export class BattleScene extends Phaser.Scene {
  /** 当前关卡定义（public 以便自动化测试读取路径） */
  level!: LevelDef;
  private assets!: AssetService;
  private effects!: EffectSystem;
  private waves!: WaveSystem;
  private grid!: SpatialGrid<MovingEnemy>;

  private towers: PokemonTower[] = [];
  private towerByUid = new Map<number, PokemonTower>();
  private nextUid = 1;

  private blocked = new Set<string>();
  private obstacles: {
    def: { x: number; y: number; kind: string; hp: number; reward: Record<string, unknown> };
    maxHp: number;
    sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Container | null;
  }[] = [];

  private coins = 0;
  private baseHp = 10;
  private maxBaseHp = 10;
  private enemiesKilled = 0;
  private elapsedMs = 0;
  private state: 'loading' | 'preparing' | 'running' | 'paused' | 'won' | 'lost' = 'loading';

  private speed: GameSpeed = 1;
  private accumulator = 0;

  /** 建造模式：当前选中的待建造精灵编号 */
  /** 当前存活的 BOSS 运行时（同一时刻最多一个） */
  bossRuntime: BossRuntime | null = null;

  // 由 systems/BossBehaviour.ts 混入实现（见 startBattle 里的 installBossBehaviour）
  declare updateBoss: () => void;

  private buildSelection: number | null = null;
  private selectedTower: PokemonTower | null = null;

  private ghostLayer!: Phaser.GameObjects.Container;
  private towerLayer!: Phaser.GameObjects.Container;
  private enemyLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;

  private buildableHighlights = new Map<string, Phaser.GameObjects.Rectangle>();
  private rangePreview: Phaser.GameObjects.Arc | null = null;
  private weatherEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  /** 每帧复用的临时数组，避免 GC 抖动 */
  private scratch: MovingEnemy[] = [];
  private pendingImpacts: { atMs: number; fn: () => void }[] = [];

  constructor() {
    super({ key: SCENE_KEYS.BATTLE });
  }

  preload() {
    preloadMapAssets(this);
  }

  create() {
    const levelId = consumePendingLevelId();
    const level = levelId ? getLevel(levelId) : null;
    if (!level) {
      this.scene.start(SCENE_KEYS.LEVEL_SELECT);
      return;
    }
    this.level = level;

    const settings = getGameSettings();
    this.speed = Math.min(3, Math.max(1, settings.defaultSpeed)) as GameSpeed;

    this.assets = new AssetService(this, isMobileDevice() ? 80 : 160);
    this.effects = new EffectSystem(this, {
      quality: settings.quality,
      screenShakeEnabled: settings.screenShake,
      flashEnabled: settings.flash,
      damageNumbersEnabled: settings.damageNumbers,
      intensity: settings.effectIntensity,
    });

    this.grid = new SpatialGrid<MovingEnemy>(GAME_WIDTH, GAME_HEIGHT, TILE);

    this.towerLayer = this.add.container(0, 0);
    this.enemyLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.ghostLayer = this.add.container(0, 0).setDepth(DEPTH.buildSlots);
    this.uiLayer = this.add.container(0, 0).setDepth(DEPTH.ui);

    this.ensureEffectTextures();
    this.drawMap();
    this.setupWaves();
    this.setupInput();
    this.startBattle();

    this.events.once('shutdown', () => {
      this.cleanup();
      if (import.meta.env.DEV) {
        const w = window as unknown as { __PTD__?: unknown };
        if (w.__PTD__ === this) delete w.__PTD__;
      }
    });
    this.scale.on('resize', this.handleResize, this);

    if (import.meta.env.DEV) {
      const w = window as unknown as { __PTD__?: BattleScene };
      w.__PTD__ = this;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 初始化                                                              */
  /* ------------------------------------------------------------------ */

  /** 特效纹理体积很小，进入关卡时一次性加载 */
  private ensureEffectTextures() {
    const groups = ['common', 'fire', 'water', 'electric', 'ice', 'grass', 'psychic', 'ultimate'];
    const assets = this.assets;
    assets.loadEffects(groups).then(() => {
      if (this.sys.isActive() && this.assets === assets) this.createWeather();
    }).catch(() => { /* 缺失时 EffectSystem 会回退到默认纹理 */ });
  }

  private setupWaves() {
    this.waves = new WaveSystem(this, this.level, {
      onEnemySpawned: (enemy) => this.onEnemySpawned(enemy),
      onEnemyReachedEnd: (enemy, damage) => this.onEnemyReachedEnd(enemy, damage),
      onEnemyDied: (enemy) => this.onEnemyKilled(enemy),
      onWaveStart: (wave, index) => {
        bus.emit('battle:wave', { index, total: this.level.waves.length, isBoss: wave.isBoss });
      },
      onWaveComplete: (index) => {
        // 波次通关奖励：levels.ts 为每波配置了 bonus，这里统一结算。
        // 结算点必须与 onWaveComplete 回调对齐，否则越到后期经济越跟不上波次压力。
        const wave = this.level.waves[index];
        if (wave?.bonus) {
          this.coins += wave.bonus;
          this.effects.playCoin(GAME_WIDTH / 2, TILE * 2, wave.bonus);
          this.emitEconomy();
          bus.emit('battle:toast', { text: `第 ${index + 1} 波通过！奖励 ${wave.bonus} 金币`, tone: 'good' });
        }
      },
      onAllWavesComplete: () => this.finish(true),
      onSummon: (_parent, child) => this.onEnemySpawned(child),
    });
  }

  private drawMap() {
    drawMapTerrain(this, this.level);
    drawMapEndpoints(this, this.level);

    this.blocked = blockedCells(this.level.path);
    // HUD / 建造栏遮挡的行不允许建造。
    for (let x = 0; x < GRID_COLS; x++) {
      for (const y of [0, 1, 11, 12, 13]) this.blocked.add(`${x},${y}`);
    }
    this.buildableHighlights.clear();
    this.obstacles = this.level.obstacles.map((def) => {
      this.blocked.add(`${def.x},${def.y}`);
      return { def, maxHp: def.hp, sprite: drawMapObstacle(this, def, this.level.theme.key) };
    });

    if (this.level.theme.rules.limitedVision) {
      const v = this.level.theme.rules.limitedVision;
      const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, this.level.theme.palette.fog, 1 - v);
      overlay.setDepth(DEPTH.weather - 1).setBlendMode(Phaser.BlendModes.MULTIPLY);
    }
  }

  private createWeather() {
    if (this.weatherEmitter) return;
    const kind = this.level.theme.rules.weather;
    if (!kind || kind === 'none') return;
    const settings = getGameSettings();
    if (settings.quality === 'low') return;

    const textures: Record<string, string> = {
      snow: 'fx-ice-crystal', sand: 'fx-common-dot', ash: 'fx-common-dot', petal: 'fx-grass-blade', spore: 'fx-common-smoke',
    };
    const key = textures[kind];
    if (!this.textures.exists(key)) return;

    const tint =
      kind === 'snow' ? 0xffffff
      : kind === 'sand' ? 0xe0c078
      : kind === 'ash' ? 0x8b6f5a
      : kind === 'petal' ? 0xff9ecb
      : 0x9a7ad0;

    const density = this.effects.config.particles;

    const emitter = this.add.particles(0, 0, key, {
      x: { min: -60, max: GAME_WIDTH + 60 },
      y: -40,
      lifespan: kind === 'sand' ? 2600 : 4200,
      speedX: kind === 'sand' ? { min: 220, max: 380 } : { min: -40, max: 40 },
      speedY: kind === 'sand' ? { min: 40, max: 90 } : { min: 60, max: 140 },
      scale: kind === 'snow' ? { min: 0.1, max: 0.24 } : { min: 0.08, max: 0.2 },
      alpha: { min: 0.25, max: 0.7 },
      rotate: { min: 0, max: 360 },
      quantity: Math.max(1, Math.round(3 * density)),
      frequency: kind === 'sand' ? 40 : 90,
      tint,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    emitter.setDepth(DEPTH.weather);
    this.weatherEmitter = emitter;
    if (this.state === 'paused' || this.state === 'won' || this.state === 'lost') emitter.stop();
  }

  /* ------------------------------------------------------------------ */
  /* 输入                                                                */
  /* ------------------------------------------------------------------ */

  private setupInput() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handlePointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer));

    // 键盘快捷键（PC）
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-SPACE', () => this.togglePause());
      kb.on('keydown-ESC', () => {
        if (this.selectedTower) this.deselectTower();
        else if (this.buildSelection !== null) this.cancelBuild();
        else this.pauseAndExit();
      });
      kb.on('keydown-ONE', () => this.setSpeed(1));
      kb.on('keydown-TWO', () => this.setSpeed(2));
      kb.on('keydown-THREE', () => this.setSpeed(3));
      kb.on('keydown-U', () => { if (this.selectedTower) this.tryUpgrade(); });
      kb.on('keydown-E', () => { if (this.selectedTower) this.tryEvolve(); });
      kb.on('keydown-S', () => { if (this.selectedTower) this.trySell(); });
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (this.buildSelection === null) return;
    const { gx, gy } = this.pointerToGrid(pointer);
    if (!this.rangePreview) return;
    const tpl = getTowerConfig(this.buildSelection);
    if (!tpl) return;
    this.rangePreview.setPosition(gx * TILE + TILE / 2, gy * TILE + TILE / 2);
    this.rangePreview.setRadius(tpl.range);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (this.state === 'won' || this.state === 'lost') return;
    if (this.state === 'paused') return;

    const { gx, gy } = this.pointerToGrid(pointer);
    if (gx < 0 || gy < 0 || gx >= GRID_COLS || gy >= GRID_ROWS) return;

    // 1. 点到自己已建的单位 → 选中
    const existing = this.towers.find((t) => t.gridX === gx && t.gridY === gy);
    if (existing && this.buildSelection === null) {
      this.selectTower(existing);
      return;
    }

    // 2. 建造模式下点击合法格子 → 建造
    if (this.buildSelection !== null) {
      const key = `${gx},${gy}`;
      if (this.blocked.has(key) || existing) {
        this.flashInvalid(gx, gy);
        return;
      }
      this.placeTower(this.buildSelection, gx, gy);
      return;
    }

    // 3. 点击空处 → 取消选中
    this.deselectTower();
  }

  /** 屏幕坐标 → 网格坐标（考虑相机缩放与可能的 CSS 旋转兜底） */
  private pointerToGrid(pointer: Phaser.Input.Pointer): { gx: number; gy: number } {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return {
      gx: Math.floor(worldPoint.x / TILE),
      gy: Math.floor(worldPoint.y / TILE),
    };
  }

  /* ------------------------------------------------------------------ */
  /* 建造 / 升级 / 进化 / 出售                                            */
  /* ------------------------------------------------------------------ */

  private highlightBuildable(config: TowerConfig) {
    this.clearHighlights();
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        const key = `${gx},${gy}`;
        if (this.blocked.has(key)) continue;
        if (this.towers.some((t) => t.gridX === gx && t.gridY === gy)) continue;
        const rect = this.add.rectangle(gx * TILE + TILE / 2, gy * TILE + TILE / 2, TILE - 6, TILE - 6, 0x66dd66, 0.18);
        rect.setStrokeStyle(2, 0x8fe36b, 0.55).setDepth(DEPTH.buildSlots);
        this.buildableHighlights.set(key, rect);
      }
    }
    // 范围预览跟随鼠标
    this.rangePreview?.destroy();
    const preview = this.add.circle(0, 0, config.range, 0x8fe36b, 0.1);
    preview.setStrokeStyle(2, 0x8fe36b, 0.6).setDepth(DEPTH.buildSlots - 1).setVisible(false);
    this.rangePreview = preview;
  }

  private clearHighlights() {
    for (const r of this.buildableHighlights.values()) r.destroy();
    this.buildableHighlights.clear();
  }

  private flashInvalid(gx: number, gy: number) {
    const rect = this.add.rectangle(gx * TILE + TILE / 2, gy * TILE + TILE / 2, TILE - 6, TILE - 6, 0xff5555, 0.5);
    rect.setDepth(DEPTH.buildSlots + 1);
    this.tweens.add({ targets: rect, alpha: 0, duration: 320, onComplete: () => rect.destroy() });
    this.effects.popStatus(gx * TILE + TILE / 2, gy * TILE + TILE / 2, '不可建造', '#ff8888');
  }

  /** 由 Vue UI 调用：选择要建造的精灵 */
  beginBuild(pokemonId: number) {
    const config = getTowerConfig(pokemonId);
    if (!config) return;
    if (this.coins < config.cost) {
      bus.emit('battle:toast', { text: `金币不足（需要 ${config.cost}）`, tone: 'warn' });
      return;
    }
    this.deselectTower();
    this.buildSelection = pokemonId;
    this.highlightBuildable(config);
    this.rangePreview?.setVisible(true);
    bus.emit('battle:buildMode', { pokemonId, cost: config.cost });
  }

  cancelBuild() {
    this.buildSelection = null;
    this.clearHighlights();
    this.rangePreview?.destroy();
    this.rangePreview = null;
    bus.emit('battle:buildMode', null);
  }

  /**
   * 在指定格放置防御塔，返回是否成功。
   *
   * 与鼠标交互走同一条路径（校验金币 / 占用 / 是否压在路径上），
   * 供自动化测试与脚本化调用使用；返回 Promise 以便等待异步的素材加载。
   */
  async placeTowerAt(gx: number, gy: number, pokemonId: number): Promise<boolean> {
    const config = getTowerConfig(pokemonId);
    if (!config) return false;
    if (this.coins < config.cost) return false;
    if (gx < 0 || gy < 0 || gx >= GRID_COLS || gy >= GRID_ROWS) return false;
    // 与 handlePointerDown 的建造分支保持同一套校验：
    // blocked 既包含路径格，也包含已建塔与不可建造的障碍格
    if (this.blocked.has(`${gx},${gy}`)) return false;
    if (this.towers.some((t) => t.gridX === gx && t.gridY === gy)) return false;
    await this.placeTower(pokemonId, gx, gy);
    return this.towers.some((t) => t.gridX === gx && t.gridY === gy);
  }

  private async placeTower(pokemonId: number, gx: number, gy: number) {
    const config = getTowerConfig(pokemonId);
    if (!config) return;
    if (this.coins < config.cost) {
      bus.emit('battle:toast', { text: `金币不足（需要 ${config.cost}）`, tone: 'warn' });
      this.cancelBuild();
      return;
    }

    // 先扣金币，动画期间不允许再次建造同一格
    this.coins -= config.cost;
    this.emitEconomy();

    const tower = new PokemonTower(this.nextUid++, config, gx, gy);
    this.towers.push(tower);
    this.towerByUid.set(tower.uid, tower);

    // 精灵球登场动画（PRD 3.3）
    const x = gx * TILE + TILE / 2;
    const y = gy * TILE + TILE / 2;
    this.blocked.add(`${gx},${gy}`);
    this.clearHighlights();
    const buildingId = this.buildSelection;
    this.buildSelection = null;
    bus.emit('battle:buildMode', null);

    // 先加载该精灵资源再播放动画
    const assets = this.assets;
    await assets.loadPokemon(pokemonId, ['static', 'animated']).catch(() => {});
    if (!this.sys.isActive() || this.assets !== assets || !this.towers.includes(tower)) return;
    this.discoverSpecies(pokemonId);

    const tempKey = textureKeys(pokemonId).animated;
    const tempKeyStatic = textureKeys(pokemonId).static;
    const animKey = this.textures.exists(tempKey) ? tempKey : (this.textures.exists(tempKeyStatic) ? tempKeyStatic : null);
    await this.effects.playSpawnAnimation(x, y, animKey ?? 'fx-common-dot', 1);
    if (!this.sys.isActive() || this.assets !== assets || !this.towers.includes(tower)) return;

    tower.createView(this, this.assets);
    tower.setBaseScaleY(tower.sprite?.scaleY ?? 1);
    tower.onFire = (t, move) => this.fireMove(t, move);

    bus.emit('battle:towerPlaced', { pokemonId, uid: tower.uid });
    this.selectTower(tower);

    // 建造后若仍按着建造意图且金币足够，保持建造模式方便连续放置
    if (buildingId !== null && this.coins >= config.cost) {
      // 不自动回到建造模式，避免误触；玩家再点一次卡片即可
    }
  }

  private selectTower(tower: PokemonTower) {
    if (this.selectedTower === tower) return;
    this.deselectTower();
    this.selectedTower = tower;
    tower.setSelected(this, true);
    bus.emit('battle:selectTower', {
      uid: tower.uid,
      pokemonId: tower.pokemonId,
      name: POKEDEX[tower.pokemonId]?.nameZh ?? '',
      level: tower.level,
      maxLevel: tower.config.maxLevel,
      damage: Math.round(tower.attackPower),
      intervalMs: Math.round(tower.attackInterval),
      range: Math.round(tower.range),
      upgradeCost: tower.upgradeCost,
      sellValue: tower.sellValue,
      canUpgrade: tower.level < tower.config.maxLevel,
      canEvolve: tower.canEvolve,
      evolutionCost: tower.evolutionCost,
      evolutionTargetId: tower.config.evolution?.targetId ?? null,
      evolutionTargetName: tower.config.evolution
        ? POKEDEX[tower.config.evolution.targetId]?.nameZh ?? ''
        : '',
      evolved: tower.isEvolved,
      moves: tower.unlockedMoves.map((m) => ({ id: m.id, name: m.name, tier: m.effectTier, type: m.type })),
      activeMoveIndex: tower.activeMoveIndex,
      kills: tower.kills,
    });
  }

  deselectTower() {
    if (!this.selectedTower) return;
    this.selectedTower.setSelected(this, false);
    this.selectedTower = null;
    bus.emit('battle:selectTower', null);
  }

  /** 切换当前使用的招式（多招式时由 UI 触发） */
  setActiveMove(index: number) {
    if (!this.selectedTower) return;
    this.selectedTower.activeMoveIndex = index;
    bus.emit('battle:selectTower', {
      ...(this.buildTowerInfo(this.selectedTower)),
      activeMoveIndex: index,
    });
  }

  private buildTowerInfo(tower: PokemonTower) {
    return {
      uid: tower.uid,
      pokemonId: tower.pokemonId,
      name: POKEDEX[tower.pokemonId]?.nameZh ?? '',
      level: tower.level,
      maxLevel: tower.config.maxLevel,
      damage: Math.round(tower.attackPower),
      intervalMs: Math.round(tower.attackInterval),
      range: Math.round(tower.range),
      upgradeCost: tower.upgradeCost,
      sellValue: tower.sellValue,
      canUpgrade: tower.level < tower.config.maxLevel,
      canEvolve: tower.canEvolve,
      evolutionCost: tower.evolutionCost,
      evolutionTargetId: tower.config.evolution?.targetId ?? null,
      evolutionTargetName: tower.config.evolution ? POKEDEX[tower.config.evolution.targetId]?.nameZh ?? '' : '',
      evolved: tower.isEvolved,
      moves: tower.unlockedMoves.map((m) => ({ id: m.id, name: m.name, tier: m.effectTier, type: m.type })),
      activeMoveIndex: tower.activeMoveIndex,
      kills: tower.kills,
    };
  }

  /**
   * 升级一个防御塔。
   *
   * 不传参数时作用于当前选中的塔（UI 路径）；显式传入 tower 时作用于指定塔，
   * 供脚本化与批量操作使用——否则每次都必须先改选中状态，极易静默失败。
   */
  tryUpgrade(target?: PokemonTower): boolean {
    const tower = target ?? this.selectedTower;
    if (!tower) return false;
    if (tower.level >= tower.config.maxLevel) {
      bus.emit('battle:toast', { text: '已达最高等级，可尝试进化', tone: 'info' });
      return false;
    }
    const cost = tower.upgradeCost;
    if (this.coins < cost) {
      bus.emit('battle:toast', { text: `金币不足（需要 ${cost}）`, tone: 'warn' });
      return false;
    }
    this.coins -= cost;
    tower.upgrade();
    tower.refreshBadge(this);
    this.emitEconomy();
    this.effects.playUpgradeFx(tower.x, tower.y, this.typeColor(tower), tower.level >= 5 ? 'ultimate' : 'level');
    if (tower === this.selectedTower) bus.emit('battle:selectTower', this.buildTowerInfo(tower));
    return true;
  }

  async tryEvolve(): Promise<boolean> {
    const tower = this.selectedTower;
    if (!tower || !tower.config.evolution) return false;
    if (tower.level < 3) {
      bus.emit('battle:toast', { text: '进化需要先升到 Lv.3', tone: 'warn' });
      return false;
    }
    if (tower.isEvolved) {
      bus.emit('battle:toast', { text: '该单位已经进化过了', tone: 'info' });
      return false;
    }
    const cost = tower.evolutionCost;
    if (this.coins < cost) {
      bus.emit('battle:toast', { text: `金币不足（需要 ${cost}）`, tone: 'warn' });
      return false;
    }
    const targetId = tower.config.evolution.targetId;
    const targetConfig = getTowerConfig(targetId);
    if (!targetConfig) return false;

    this.coins -= cost;
    tower.invested += cost;

    // 进化动画（PRD 3.4：更换精灵形象、提升属性与技能）
    this.effects.playUpgradeFx(tower.x, tower.y, this.typeColor(tower), 'evolution');
    const assets = this.assets;
    await assets.loadPokemon(targetId, ['static', 'animated']).catch(() => {});
    if (!this.sys.isActive() || this.assets !== assets || !this.towers.includes(tower)) return false;
    await new Promise((r) => this.time.delayedCall(420, r));
    if (!this.sys.isActive() || this.assets !== assets || !this.towers.includes(tower)) return false;
    this.discoverSpecies(targetId);

    tower.evolve(targetConfig);
    tower.rebuildView(this, this.assets);
    tower.setBaseScaleY(tower.sprite?.scaleY ?? 1);
    this.emitEconomy();
    bus.emit('battle:selectTower', this.buildTowerInfo(tower));
    bus.emit('battle:evolved', { from: tower.pokemonId, to: targetId, name: POKEDEX[targetId]?.nameZh ?? '' });
    this.effects.playUpgradeFx(tower.x, tower.y, this.typeColor(tower), 'ultimate');
    return true;
  }

  trySell(): boolean {
    const tower = this.selectedTower;
    if (!tower) return false;
    const refund = tower.sellValue;
    this.coins += refund;
    this.blocked.delete(`${tower.gridX},${tower.gridY}`);
    tower.destroyView();
    this.towers = this.towers.filter((t) => t.uid !== tower.uid);
    this.towerByUid.delete(tower.uid);
    this.selectedTower = null;
    this.emitEconomy();
    this.effects.playCoin(tower.x, tower.y, refund);
    bus.emit('battle:selectTower', null);
    bus.emit('battle:sold', { refund });
    return true;
  }

  private typeColor(tower: PokemonTower): number {
    return Phaser.Display.Color.HexStringToColor(TYPE_COLORS[tower.config.types[0]] ?? '#ffffff').color;
  }

  private emitEconomy() {
    bus.emit('battle:economy', { coins: this.coins, hp: this.baseHp, maxHp: this.maxBaseHp });
  }

  /* ------------------------------------------------------------------ */
  /* 战斗循环                                                            */
  /* ------------------------------------------------------------------ */

  /** 预加载本关会用到的全部精灵，避免出场时才发现素材缺失 */
  private async preloadLevelAssets() {
    const ids = new Set<number>();
    for (const id of this.level.availableTowers) ids.add(id);
    for (const wave of this.level.waves) {
      for (const g of wave.groups) ids.add(g.pokemonId);
    }
    if (this.level.bossId) ids.add(this.level.bossId);

    // 按需裁剪：装饰与地方单位分开加载，先加载敌人（更早出场）
    const list = [...ids];
    this.assets.resetFailures();
    await this.assets.loadPokemonSet(list, ['static', 'animated']);
  }

  private startBattle() {
    // 安装 BOSS 阶段/技能行为（实现在 systems/BossBehaviour.ts）
    installBossBehaviour(this as unknown as Parameters<typeof installBossBehaviour>[0]);
    this.state = 'preparing';
    this.coins = this.level.startCoins;
    this.baseHp = this.level.baseHp;
    this.maxBaseHp = this.level.baseHp;
    this.emitEconomy();
    bus.emit('battle:level', {
      id: this.level.id,
      name: this.level.name,
      chapter: this.level.chapter,
      theme: this.level.theme.name,
      mechanic: this.level.theme.mechanic,
      waveCount: this.level.waves.length,
      availableTowers: this.level.availableTowers,
    });
    this.emitSpeed();
    // 先加载本关精灵，再开始波次；给玩家准备时间，期间可以建造
    // 先加载本关精灵，再开始波次；给玩家准备时间，期间可以建造。
    //
    // 有整体超时兜底：素材加载再慢也不能让关卡永远停在"准备中"——
    // 缺失的素材会走占位回退，游戏仍然可玩。
    const assets = this.assets;
    const begin = () => {
      if (!this.sys.isActive() || this.assets !== assets || this.state !== 'preparing') return;
      this.time.delayedCall(600, () => {
        if (!this.sys.isActive() || this.assets !== assets || this.state !== 'preparing') return;
        this.state = 'running';
        this.waves.start();
      });
    };
    const guard = setTimeout(begin, PRELOAD_BUDGET_MS);
    this.preloadLevelAssets()
      .catch(() => { /* 单只素材失败不影响开始 */ })
      .finally(() => {
        clearTimeout(guard);
        begin();
      });
  }

  override update(_time: number, delta: number) {
    if (this.state !== 'running') {
      this.render(delta);
      return;
    }

    // 固定时间步长 + 倍速 = 每帧执行多个固定步（PRD 9.3）
    this.accumulator += Math.min(delta, 100) * this.speed;

    let steps = 0;
    const maxSteps = 20; // 防止卡顿后一次追太多步导致长时间冻结
    while (this.accumulator >= SIM_STEP_MS && steps < maxSteps) {
      this.simulateStep();
      this.accumulator -= SIM_STEP_MS;
      steps++;
    }
    if (steps >= maxSteps) this.accumulator = 0;

    this.elapsedMs += Math.min(delta, 100) * this.speed;
    this.render(delta);
  }

  /** 一个固定时间步的完整模拟：状态 → 移动 → 攻击 → 伤害 */
  private simulateStep() {
    // 1. 敌人推进与特性（内部已含状态结算）
    this.waves.step();

    // 1b. BOSS 阶段转换与技能（PRD 7.4）
    this.updateBoss();

    // 2. 重建空间网格（一次遍历）
    // 死亡结算统一发生在 waves.step() 内部（onEnemyDied 回调），
    // 因此这里不再做第二次扫描——两条结算路径会让金币与击杀数被重复计入。
    this.grid.rebuild(this.waves.enemies);
    this.emitBossProgress();

    // 3. 计算邻居密度（供 mostDense 目标选择）
    for (const e of this.waves.enemies) {
      e.neighborCount = this.grid.queryCircle(e.x, e.y, 78, this.scratch).length - 1;
    }

    // 4. 防御单位攻击
    const now = this.waves.simTime;
    for (const tower of this.towers) {
      const move = tower.tick(SIM_STEP_MS, now);
      if (!move) continue;
      tower.onFire?.(tower, move);
    }

    // 5. 处理到时的命中回调（保证伤害与视觉同步）
    if (this.pendingImpacts.length) {
      const due = this.pendingImpacts.filter((p) => p.atMs <= now);
      this.pendingImpacts = this.pendingImpacts.filter((p) => p.atMs > now);
      for (const d of due) d.fn();
    }

    // 6. 障碍物是否被摧毁（范围技能命中判定在 applyMove 内处理）
  }

  /* ------------------------------------------------------------------ */
  /* 攻击与伤害                                                          */
  /* ------------------------------------------------------------------ */

  private fireMove(tower: PokemonTower, move: typeof MOVES[string]) {
    const enemies = this.waves.enemies;
    if (!enemies.length && move.targeting !== 'aura') return;

    // 纯自身增益招式
    if (move.targeting === 'aura' && move.damageMultiplier === 0) {
      tower.applySelfBuff(move, this.waves.simTime);
      tower.lockFor(move.cooldownMs * 0.4, this.waves.simTime);
      this.effects.playUpgradeFx(tower.x, tower.y, this.typeColor(tower), 'level');
      return;
    }

    const ctx = {
      x: tower.x,
      y: tower.y,
      range: tower.range,
      canHitFlying: move.canHitFlying || tower.config.types.includes('flying') || tower.config.types.includes('electric'),
      airOnly: !!move.airOnly,
      revealsStealth: tower.revealsStealth || !!move.revealsStealth,
      priority: 'first' as const,
    };

    // 主目标
    const primary = pickTarget(enemies, ctx, move);
    if (!primary && move.targeting !== 'global') return;

    const targets = resolveTargets(move, ctx, enemies, primary);
    if (!targets.length && move.targeting !== 'global') return;

    // 标记隐身单位显形
    for (const t of targets) {
      if (t.stealthActive && ctx.revealsStealth) t.revealedUntil = this.waves.simTime + 2500;
    }

    const targetX = primary ? primary.x : tower.x;
    const targetY = primary ? primary.y : tower.y;

    // 蓄力锁定
    const castMs = move.effects.castMs ?? 0;
    tower.lockFor(castMs + 120, this.waves.simTime);

    // 播放特效，命中时刻结算伤害
    const impactAt = this.waves.simTime + castMs + (move.effects.speed ? (Math.hypot(targetX - tower.x, targetY - tower.y) / move.effects.speed) * 1000 : 0);
    const targetsAtFire = targets.slice();

    this.effects.playMove({
      originX: tower.x,
      originY: tower.y - 8,
      targetX,
      targetY,
      type: move.type as PokemonType,
      move,
      skipCast: castMs === 0,
    }).catch(() => {});

    this.pendingImpacts.push({
      atMs: impactAt,
      fn: () => this.applyMoveDamage(tower, move, targetsAtFire, targetX, targetY),
    });
  }

  /** 结算一次招式的全部伤害与状态 */
  private applyMoveDamage(
    tower: PokemonTower,
    move: typeof MOVES[string],
    targets: MovingEnemy[],
    targetX: number,
    targetY: number,
  ) {
    // 多段命中
    const hits = move.hits ?? 1;
    const interval = move.hitIntervalMs ?? 0;

    const runHit = (hitIndex: number) => {
      let anyKill = false;
      let totalDamage = 0;

      for (const enemy of targets) {
        if (!enemy.alive) continue;
        // 范围 / 直线技能在后续段位需要重新判定距离
        if (move.targeting !== 'single' && move.targeting !== 'chain') {
          const d = Math.hypot(enemy.x - targetX, enemy.y - targetY);
          const limit = move.radius ?? move.length ?? tower.range;
          if (d > limit + enemy.radius) continue;
        }

        const result = computeDamage({
          attack: tower.attackPower,
          move,
          defenderTypes: enemy.cfg.types as PokemonType[],
          armor: enemy.armor,
          magicResist: enemy.magicResist,
          vulnerability: enemy.vulnerability,
          // 关卡难度只通过敌人血量/数量体现，不再对塔的伤害二次打折：
          // 早期版本在这里再除一个 difficultyScale，与敌人血量放大叠加后，
          // 后期章节的塔面板 DPS 虚高 40% 而实际输出锐减。
          difficultyScale: 1,
          roll: ((tower.uid * 31 + hitIndex * 17 + enemy.id) % 100) / 100,
        });

        if (result.immune) continue;

        const dealt = enemy.applyDamage(result.amount);
        totalDamage += dealt;
        const killed = !enemy.alive;

        this.effects.popDamage(enemy.x, enemy.y - enemy.radius, result.amount, damageColor(result.typeMult, result.crit), result.crit);
        if (result.typeMult >= 1.9) {
          this.effects.popStatus(enemy.x, enemy.y - enemy.radius - 20, '克制!', '#ff9b6b');
        }

        // 状态效果
        if (move.status && enemy.alive) {
          const status: ActiveStatus = {
            kind: move.status.kind,
            expiresAt: this.waves.simTime + move.status.durationMs,
            dps: move.status.value ?? 0,
            ratio: move.status.ratio ?? 0,
            stacks: 1,
            pendingKnockback: move.status.distance ?? 0,
            sourceType: move.type as PokemonType,
            maxStacks: move.status.maxStacks ?? 1,
          };
          enemy.mergeStatusFrom(move.status, this.waves.simTime, move.type as PokemonType);
          void status;
          const label = this.statusLabel(move.status.kind);
          if (label) this.effects.popStatus(enemy.x, enemy.y - enemy.radius - 34, label, this.statusColor(move.status.kind));
        }

        if (killed) {
          anyKill = true;
          tower.registerHit(dealt, true);
        } else {
          tower.registerHit(dealt, false);
        }
      }

      // 击杀结算统一交给 reapDeadEnemies（每个固定步扫描一次），
      // 使持续伤害等非技能来源的死亡也能正确计数与掉落奖励。
      void anyKill;
    };

    for (let i = 0; i < hits; i++) {
      if (i === 0) runHit(0);
      else this.time.delayedCall(i * interval, () => runHit(i));
    }

    // 命中障碍物（保卫萝卜式清理玩法）：整次攻击只结算一次
    this.damageObstaclesInRadius(
      targetX, targetY,
      move.radius ?? move.length ?? 40,
      tower.attackPower * move.damageMultiplier,
    );

    // 自身增益
    tower.applySelfBuff(move, this.waves.simTime);
  }

  private statusLabel(kind: string): string | null {
    const map: Record<string, string> = {
      burn: '灼烧', slow: '减速', freeze: '冻结', stun: '眩晕', poison: '中毒',
      curse: '诅咒', armorBreak: '破甲', knockback: '击退', weaken: '削弱', mark: '标记',
    };
    return map[kind] ?? null;
  }

  private statusColor(kind: string): string {
    const map: Record<string, string> = {
      burn: '#ff8c42', slow: '#7fd4e8', freeze: '#a8e6ff', stun: '#ffd76e', poison: '#c084fc',
      curse: '#9a7ad0', armorBreak: '#ffb4a2', knockback: '#e0c078', weaken: '#f0a8c0', mark: '#ffffff',
    };
    return map[kind] ?? '#ffffff';
  }

  private damageObstaclesInRadius(x: number, y: number, radius: number, damage: number) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      const ox = obs.def.x * TILE + TILE / 2;
      const oy = obs.def.y * TILE + TILE / 2;
      // +60：单体招式的基础判定约 100px，恰好覆盖贴路径一格的障碍
      //（含斜角 90px）；再远就只有范围招式能清理了。
      if (Math.hypot(ox - x, oy - y) > radius + 60) continue;
      obs.def.hp -= damage * 0.35;
      if (obs.def.hp <= 0) {
        this.clearObstacle(obs, ox, oy);
        this.obstacles.splice(i, 1);
      } else if (obs.sprite) {
        // 受击抖动
        this.tweens.add({ targets: obs.sprite, x: ox + 3, duration: 50, yoyo: true, repeat: 1 });
      }
    }
  }

  private clearObstacle(
    obs: { def: { x: number; y: number; kind: string; hp: number; reward: Record<string, unknown> }; sprite: Phaser.GameObjects.Container | Phaser.GameObjects.Image | null },
    x: number,
    y: number,
  ) {
    const reward = obs.def.reward as { coins?: number; buildSlot?: boolean; hiddenUnlock?: boolean; buff?: string };
    this.effects.playDeath(x, y, ['normal'], false);
    obs.sprite?.destroy();
    this.blocked.delete(`${obs.def.x},${obs.def.y}`);

    if (reward.coins) {
      this.coins += reward.coins;
      this.effects.playCoin(x, y, reward.coins);
      this.emitEconomy();
    }
    if (reward.buildSlot) {
      bus.emit('battle:toast', { text: '清出额外建造位！', tone: 'good' });
    }
    if (reward.buff === 'attackSpeed') {
      for (const t of this.towers) {
        t.addBuff({ kind: 'attackSpeed', ratio: 0.25, expiresAt: this.waves.simTime + 15000 });
      }
      bus.emit('battle:toast', { text: '全场攻击速度 +25%（15 秒）', tone: 'good' });
    }
    if (reward.hiddenUnlock) {
      // 只通知"开出了隐藏解锁"，具体解锁哪只由 UI 层按账号进度挑选：
      // 场景不应知道存档状态（关卡数据与账号解耦）。
      bus.emit('battle:hiddenUnlock', null);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 事件                                                                */
  /* ------------------------------------------------------------------ */

  private onEnemySpawned(enemy: MovingEnemy) {
    // 遭遇即发现（宝可梦图鉴的"见过"语义）
    this.discoverSpecies(enemy.id);
    // 敌人可能在资源尚未加载完时出场（例如召唤出的新单位）。
    // 先创建带静态回退的视图，同时在后台加载真实素材，加载完成后重建视图，
    // 避免出现"没有精灵显示"的空场（精灵图片缺失时仍会用占位色块呈现）。
    if (!this.textures.exists(textureKeys(enemy.id).static) && !this.textures.exists(textureKeys(enemy.id).animated)) {
      this.loadEnemyAssets(enemy);
    }
    enemy.createView(this, this.assets);
    // 入场淡入
    if (enemy.sprite) {
      const targetAlpha = 1;
      enemy.sprite.setAlpha(0);
      this.tweens.add({ targets: enemy.sprite, alpha: targetAlpha, duration: 260 });
    }
  }

  /** 图鉴发现：同一场景内每种精灵只上报一次，由 UI 层写入进度 */
  private discoveredSpecies = new Set<number>();
  private discoverSpecies(pokemonId: number) {
    if (this.discoveredSpecies.has(pokemonId)) return;
    this.discoveredSpecies.add(pokemonId);
    bus.emit('battle:discovered', { pokemonId });
  }

  /** 后台加载敌人素材并在完成后重建视图（带并发去重） */
  private loadingEnemies = new Set<number>();

  private async loadEnemyAssets(enemy: MovingEnemy) {
    const id = enemy.id;
    if (this.loadingEnemies.has(id)) return;
    this.loadingEnemies.add(id);
    const assets = this.assets;
    try {
      await assets.loadPokemon(id, ['static', 'animated']);
    } catch {
      /* 素材缺失时保留回退视图 */
    } finally {
      if (this.assets === assets) this.loadingEnemies.delete(id);
    }
    // 加载完成时可能已经切换关卡，旧场景不能再创建视图。
    if (!this.sys.isActive() || this.assets !== assets || !this.waves.enemies.includes(enemy) || !enemy.alive || enemy.reachedEnd) return;
    enemy.destroyView();
    enemy.createView(this, this.assets);
  }

  /** 向 UI 推送 BOSS 血量（约 5Hz，避免每帧触发 Vue 重渲染） */
  private emitBossProgress() {
    const boss = this.waves.enemies.find((e) => e.isBoss && e.alive);
    if (!boss) {
      if (this.lastBossEmit !== null) {
        this.lastBossEmit = null;
      }
      return;
    }
    if (this.lastBossEmit !== null && this.waves.simTime - this.lastBossEmit < 200) return;
    this.lastBossEmit = this.waves.simTime;
    bus.emit('battle:bossProgress', {
      pokemonId: boss.id,
      name: boss.cfg.nameZh,
      hpRatio: Math.max(0, boss.hp / Math.max(1, boss.maxHp)),
    });
  }

  private lastBossEmit: number | null = null;

  private onEnemyKilled(enemy: MovingEnemy) {
    if (!enemy.alive && !enemy.__counted) {
      enemy.__counted = true;
      this.enemiesKilled++;
      this.coins += enemy.reward;
      this.effects.playCoin(enemy.x, enemy.y, enemy.reward);
      this.effects.playDeath(enemy.x, enemy.y, enemy.cfg.types as PokemonType[], enemy.isBoss);
      enemy.destroyView();
      this.emitEconomy();

      // 分裂型：死亡时产生两个小型单位
      if (enemy.traits.has('splitter') && !enemy.isBoss) {
        for (let i = 0; i < 2; i++) {
          const child = new MovingEnemy({
            config: enemy.cfg,
            hpScale: 0.28,
            speedScale: 1.2,
            rewardScale: 0.4,
            difficultyScale: enemy.difficultyScale,
            isBoss: false,
            stealthPeriodMs: 0,
            healRange: 0,
            healPerSecond: 0,
          });
          child.x = enemy.x;
          child.y = enemy.y;
          child.traveled = enemy.traveled + (i === 0 ? -TILE * 0.6 : 0);
          child.distanceToEnd = Math.max(0, this.waves.pathTotalLength - child.traveled);
          this.waves.enemies.push(child);
          this.onEnemySpawned(child);
        }
      }

      if (enemy.isBoss) {
        bus.emit('battle:bossDefeated', { pokemonId: enemy.id, name: enemy.cfg.nameZh });
      }
    }
  }

  private onEnemyReachedEnd(enemy: MovingEnemy, damage: number) {
    if (enemy.__countedReach) return;
    enemy.__countedReach = true;
    this.baseHp -= damage;
    enemy.destroyView();
    const end = this.level.path[this.level.path.length - 1];
    this.effects.playBaseHit(end.x * TILE + TILE / 2, end.y * TILE + TILE / 2);
    this.emitEconomy();

    if (this.baseHp <= 0) {
      this.baseHp = 0;
      this.finish(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 渲染同步                                                            */
  /* ------------------------------------------------------------------ */

  private render(delta: number) {
    void delta;
    const now = this.waves?.simTime ?? 0;
    for (const e of this.waves?.enemies ?? []) {
      e.syncView(this, now);
    }
    for (const t of this.towers) t.syncView(now);
  }

  /* ------------------------------------------------------------------ */
  /* 控制                                                                */
  /* ------------------------------------------------------------------ */

  setSpeed(speed: GameSpeed) {
    this.speed = speed;
    this.emitSpeed();
  }

  private emitSpeed() {
    bus.emit('battle:speed', { speed: this.speed });
  }

  togglePause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.weatherEmitter?.stop();
      bus.emit('battle:paused', true);
    } else if (this.state === 'paused') {
      this.state = 'running';
      this.weatherEmitter?.start();
      bus.emit('battle:paused', false);
    }
  }

  pauseAndExit() {
    if (this.state === 'running') this.togglePause();
    bus.emit('battle:exitRequested', true);
  }

  /** 由 UI 触发：直接重开本关 */
  restart() {
    this.cleanup();
    this.scene.restart();
  }

  quitToMenu() {
    this.cleanup();
    this.scene.start(SCENE_KEYS.LEVEL_SELECT);
  }

  private finish(victory: boolean) {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = victory ? 'won' : 'lost';
    this.weatherEmitter?.stop();

    const hpRatio = this.baseHp / this.maxBaseHp;
    let stars = 0;
    if (victory) {
      stars = 1;
      if (hpRatio >= 0.5) stars = 2;
      if (hpRatio >= 1) stars = 3;
    }

    const bgmLevel = 1 + (this.level.chapter - 1) * 0.1;
    const coinsEarned = Math.round((this.level.reward.coins + this.enemiesKilled * 4) * bgmLevel);

    const result: BattleResult = {
      levelId: this.level.id,
      victory,
      stars,
      hpRatio,
      coinsEarned,
      enemiesKilled: this.enemiesKilled,
      wavesCleared: this.waves.completedWaveCount,
      timeMs: Math.round(this.elapsedMs),
    };

    if (victory) {
      this.effects.playUpgradeFx(GAME_WIDTH / 2, GAME_HEIGHT / 2, 0xffe066, 'ultimate');
    }

    // 结算事件必须同步派发。
    //
    // 早先用 this.time.delayedCall(700, ...) 延后派发以先播完胜利特效，
    // 但 Phaser 的 Clock 只在真实帧回调里推进：当模拟被以固定步长快进
    // （或标签页被节流）时，这个回调可能永远不执行，导致玩家打赢了却
    // 看不到结算界面、进度也不写入。视觉延迟交给结算面板自身的入场动画。
    bus.emit('battle:finished', result);
  }

  private handleResize() {
    // 画布尺寸变化由 Scale Manager 处理；这里仅重算范围预览
    this.rangePreview?.setRadius(this.rangePreview.radius);
  }

  /**
   * 调试用状态快照。
   *
   * 只在开发构建（import.meta.env.DEV）里挂到 window.__PTD__，
   * 供自动化烟雾测试断言"敌人生成 / 伤害结算 / 建造"是否真的发生，
   * 而不必依赖截图肉眼判断。生产构建不会暴露。
   */
  debugState() {
    return {
      state: this.state,
      coins: this.coins,
      baseHp: this.baseHp,
      maxBaseHp: this.maxBaseHp,
      simTime: Math.round(this.waves?.simTime ?? 0),
      enemiesAlive: this.waves?.enemies.length ?? 0,
      enemiesKilled: this.enemiesKilled,
      towers: this.towers.map((t) => ({
        uid: t.uid,
        pokemonId: t.pokemonId,
        level: t.level,
        gridX: t.gridX,
        gridY: t.gridY,
        damage: Math.round(t.attackPower),
        range: Math.round(t.range),
        kills: t.kills,
        totalDamage: Math.round(t.totalDamage),
        hasView: !!t.sprite,
      })),
      obstaclesLeft: this.obstacles.length,
      boss: (() => {
        const b = this.waves.enemies.find((e) => e.isBoss);
        return b ? { name: b.cfg.nameZh, hp: Math.round(b.hp), maxHp: b.maxHp, ability: b.cfg.ability, phase: this.bossRuntime?.phase ?? null } : null;
      })(),
      bossRuntime: this.bossRuntime ? { ability: this.bossRuntime.abilityId, phase: this.bossRuntime.phase } : null,
      waveIndex: this.waves?.currentWaveIndex ?? -1,
      wavesCleared: this.waves?.completedWaveCount ?? 0,
      pendingSpawns: this.waves?.pendingCount ?? 0,
      blockedCount: this.blocked.size,
      enemySample: (this.waves?.enemies ?? []).slice(0, 6).map((e) => ({
        id: e.id, name: e.cfg.nameZh, hp: Math.round(e.hp), maxHp: e.maxHp,
        x: Math.round(e.x), y: Math.round(e.y), traveled: Math.round(e.traveled),
        distanceToEnd: Math.round(e.distanceToEnd), statuses: e.statuses.length,
        hasView: !!e.sprite,
      })),
      totalPathLength: Math.round(this.waves?.pathTotalLength ?? 0),
    };
  }

  /**
   * 调试用：同步推进指定数量的固定步，跳过渲染。
   *
   * 自动化测试需要在一关内跑完上百秒的模拟时间，而无声渲染（headless）
   * 的帧率只有个位数，靠等待真实时间不可行。这里直接连续调用 simulateStep，
   * 因为模拟本身与渲染解耦（固定步长），结果与逐帧运行完全一致。
   *
   * 每批之间用 setTimeout 让出主线程，使 Phaser 能处理补间与粒子回收。
   */
  debugFastForward(steps: number): { steps: number; state: string; simTime: number } {
    const cap = Math.max(0, Math.min(steps, 20000));
    for (let i = 0; i < cap; i++) {
      if (this.state !== 'running') break;
      this.simulateStep();
      this.elapsedMs += SIM_STEP_MS;
    }
    return { steps: cap, state: this.state, simTime: Math.round(this.waves.simTime) };
  }

  private cleanup() {
    this.scale.off('resize', this.handleResize, this);
    this.waves?.destroy();
    this.loadingEnemies.clear();
    for (const t of this.towers) t.destroyView();
    this.towers = [];
    this.towerByUid.clear();
    this.obstacles = [];
    this.pendingImpacts = [];
    this.effects?.destroy();
    this.weatherEmitter?.destroy();
    this.weatherEmitter = null;
  }
}

declare module '../entities/Enemy' {
  interface MovingEnemy {
    __counted?: boolean;
    __countedReach?: boolean;
  }
}
