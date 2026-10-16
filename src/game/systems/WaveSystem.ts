/**
 * 波次系统 —— 敌人生成、路径推进、状态结算、特性行为。
 *
 * 关键约束（PRD 9.3）：战斗模拟采用固定时间步长，速度变化不改变实际伤害、
 * 技能冷却和敌人生成数量。因此这里以 SIM_STEP_MS 为单位推进，
 * 倍速通过"每帧执行多个固定步"实现，而不是放大 dt。
 */
import Phaser from 'phaser';
import { DEPTH, SIM_STEP_MS, TILE } from '../config';
import type { LevelDef, Wave, WaveGroup } from '../../data/levels/levels';
import { getEnemyConfig, type EnemyConfig } from '../../data/pokemon/units';
import { MovingEnemy } from '../entities/Enemy';
import { summarizeStatuses } from './CombatSystem';
import { POKEDEX } from '../../data/pokemon/pokedex';

export interface WaveCallbacks {
  onEnemySpawned?: (enemy: MovingEnemy) => void;
  /**
   * 敌人被击杀（而非抵达终点）时回调。
   *
   * 这是**唯一**的死亡结算入口，必须在 splice 之前调用：金币奖励、击杀计数、
   * 分裂与召唤都依赖它。技能直击与持续伤害（灼烧/中毒）都经由这里，
   * 因此两类击杀都不会漏掉奖励。
   */
  onEnemyDied?: (enemy: MovingEnemy) => void;
  onEnemyReachedEnd?: (enemy: MovingEnemy, damage: number) => void;
  onWaveStart?: (wave: Wave, index: number) => void;
  onWaveComplete?: (index: number) => void;
  onAllWavesComplete?: () => void;
  onEnemyHealed?: (enemy: MovingEnemy, amount: number) => void;
  onSummon?: (parent: MovingEnemy, child: MovingEnemy) => void;
}

interface SpawnTask {
  atMs: number;
  group: WaveGroup;
  waveIndex: number;
  spawned: number;
}

export class WaveSystem {
  readonly level: LevelDef;
  private scene: Phaser.Scene;
  private callbacks: WaveCallbacks;

  enemies: MovingEnemy[] = [];
  /** 已使用的模拟时间（毫秒），与渲染帧率无关 */
  simTime = 0;

  currentWaveIndex = -1;
  private tasks: SpawnTask[] = [];
  private finishedSpawning = false;
  private waveStartTime = 0;
  private completedWaves = 0;

  /** 路径的世界坐标 */
  private pathPoints: { x: number; y: number }[] = [];
  /** 每一段的方向与长度，用于快速推进 */
  private segments: { x1: number; y1: number; x2: number; y2: number; len: number; dirX: number; dirY: number; cumulative: number }[] = [];
  private totalPathLength = 0;

  /** 敌人到终点的判定点 */
  private endPoint: { x: number; y: number };

  /** 飞行单位的直线路径 */
  private flyingPath: { x: number; y: number }[] = [];

  constructor(scene: Phaser.Scene, level: LevelDef, callbacks: WaveCallbacks) {
    this.scene = scene;
    this.level = level;
    this.callbacks = callbacks;

    this.pathPoints = level.path.map((p) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 }));
    this.buildSegments();

    this.endPoint = this.pathPoints[this.pathPoints.length - 1];

    // 飞行单位：从入口直线飞到终点（PRD 4.3 飞行型"可跨越部分地形"）
    this.flyingPath = [this.pathPoints[0], { x: this.endPoint.x, y: this.pathPoints[0].y }, this.endPoint];
  }

  private buildSegments() {
    let cumulative = 0;
    this.segments = [];
    for (let i = 0; i < this.pathPoints.length - 1; i++) {
      const a = this.pathPoints[i];
      const b = this.pathPoints[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      this.segments.push({
        x1: a.x, y1: a.y, x2: b.x, y2: b.y, len,
        dirX: dx / len, dirY: dy / len,
        cumulative,
      });
      cumulative += len;
    }
    this.totalPathLength = cumulative;
  }

  get pathTotalLength() { return this.totalPathLength; }

  /** 依据已经走过的距离求出世界坐标与该处方向 */
  positionAt(traveled: number, flying: boolean): { x: number; y: number; dirX: number; dirY: number } {
    if (flying) {
      // 飞行路径：两段直线
      const mid = this.flyingPath[1];
      const firstLen = Math.hypot(mid.x - this.flyingPath[0].x, mid.y - this.flyingPath[0].y);
      if (traveled <= firstLen) {
        const t = traveled / (firstLen || 1);
        return {
          x: this.flyingPath[0].x + (mid.x - this.flyingPath[0].x) * t,
          y: this.flyingPath[0].y + (mid.y - this.flyingPath[0].y) * t,
          dirX: 1, dirY: 0,
        };
      }
      const secondLen = Math.hypot(this.endPoint.x - mid.x, this.endPoint.y - mid.y);
      const t = Math.min(1, (traveled - firstLen) / (secondLen || 1));
      return {
        x: mid.x + (this.endPoint.x - mid.x) * t,
        y: mid.y + (this.endPoint.y - mid.y) * t,
        dirX: 1, dirY: (this.endPoint.y - mid.y) >= 0 ? 1 : -1,
      };
    }

    if (traveled >= this.totalPathLength) {
      const last = this.segments[this.segments.length - 1];
      return { x: last.x2, y: last.y2, dirX: last.dirX, dirY: last.dirY };
    }
    // 线性查找段（路径段数很少，无需二分）
    let seg = this.segments[0];
    for (const s of this.segments) {
      if (traveled >= s.cumulative && traveled <= s.cumulative + s.len) { seg = s; break; }
      seg = s;
    }
    const t = (traveled - seg.cumulative) / (seg.len || 1);
    return {
      x: seg.x1 + seg.dirX * seg.len * t,
      y: seg.y1 + seg.dirY * seg.len * t,
      dirX: seg.dirX,
      dirY: seg.dirY,
    };
  }

  /** 飞行单位的路径长度不同，需要单独换算 */
  private flyingPathLength(): number {
    const mid = this.flyingPath[1];
    return Math.hypot(mid.x - this.flyingPath[0].x, mid.y - this.flyingPath[0].y)
      + Math.hypot(this.endPoint.x - mid.x, this.endPoint.y - mid.y);
  }

  /* ---------------------------------------------------------------- */
  /* 生成                                                              */
  /* ---------------------------------------------------------------- */

  private scheduleWave(waveIndex: number) {
    const wave = this.level.waves[waveIndex];
    if (!wave) return;
    this.currentWaveIndex = waveIndex;
    this.waveStartTime = this.simTime;
    this.finishedSpawning = false;
    this.tasks = [];

    for (const group of wave.groups) {
      // 数量随波次与关卡难度增长，但由关卡数据固定，不受游戏速度影响
      for (let i = 0; i < group.count; i++) {
        this.tasks.push({
          atMs: this.simTime + group.delayMs + i * group.intervalMs,
          group,
          waveIndex,
          spawned: 0,
        });
      }
    }
    this.tasks.sort((a, b) => a.atMs - b.atMs);
    this.callbacks.onWaveStart?.(wave, waveIndex);
  }

  start() {
    this.scheduleWave(0);
  }

  private spawnFrom(
    group: WaveGroup,
    isBoss: boolean,
    overrideHpScale = 1,
    overrideSpeedScale = 1,
    spawnAt = 0,
    /** 召唤子体继承母体的飞行属性：飞行/地面两条路径长度不同，
     *  若不继承，飞行的母体会把地面子体"瞬移"到地面路径的对应距离处，
     *  出现在与母体无关的位置（天空章的防御真空区）。 */
    inheritFlyingPath = false,
  ): MovingEnemy | null {
    const base = getEnemyConfig(group.pokemonId, 1);
    if (!base) return null;

    const difficulty = this.level.rules.enemyHp * (1 + (this.level.chapter - 1) * 0.06);
    const hpScale = difficulty * overrideHpScale;
    const speedScale = this.level.rules.enemySpeed * overrideSpeedScale * (isBoss ? 0.86 : 1);

    const enemy = new MovingEnemy({
      config: base,
      hpScale,
      speedScale,
      // 击杀奖励随章节同步上涨，保证后期买塔/升级的购买力
      rewardScale: 1 + (this.level.chapter - 1) * 0.12,
      difficultyScale: 1 + (this.level.chapter - 1) * 0.06,
      isBoss,
      stealthPeriodMs: base.isStealth ? 4200 : 0,
      // 治疗半径与每秒治疗量按关卡难度一起缩放。
      // 固定值（此前是硬编码 130px / 26hp·s⁻¹）会让每章的治疗型敌人
      // 相对防御塔越来越强，最终使整关无法造成有效伤害。
      healRange: 110 * (1 + (this.level.chapter - 1) * 0.06),
      healPerSecond: 0,
    });

    // isFlying 是类型语义（决定哪些塔能命中），走不走直线由 shortcut 决定；
    // 两者在天空章之外是解耦的
    const usesFlyingPath = inheritFlyingPath || (enemy.isFlying && this.level.rules.shortcutForFlyers);
    const pos = usesFlyingPath ? this.positionAt(spawnAt, true) : this.pathPoints[0];
    enemy.x = pos.x;
    enemy.y = pos.y;
    // 让敌人在路径起点略微错开，避免完全重叠
    enemy.traveled = spawnAt;
    enemy.distanceToEnd = (usesFlyingPath ? this.flyingPathLength() : this.totalPathLength) - spawnAt;
    enemy.isFlying = inheritFlyingPath || base.isFlying;

    this.enemies.push(enemy);
    this.callbacks.onEnemySpawned?.(enemy);
    return enemy;
  }

  /* ---------------------------------------------------------------- */
  /* 推进                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 执行一个固定时间步。
   * @param speed 游戏速度倍率（每帧由调用方循环调用多次）
   */
  step() {
    this.simTime += SIM_STEP_MS;
    const dt = SIM_STEP_MS / 1000;

    // ---- 生成 ----
    if (this.tasks.length) {
      const pending: SpawnTask[] = [];
      for (const t of this.tasks) {
        if (t.atMs <= this.simTime) {
          const wave = this.level.waves[t.waveIndex];
          const isBoss = !!(wave?.isBoss && t.group.note === 'BOSS');
          this.spawnFrom(t.group, !!isBoss);
        } else {
          pending.push(t);
        }
      }
      this.tasks = pending;
    }

    // ---- 敌人推进 ----
    const now = this.simTime;
    const healTargets: MovingEnemy[] = [];

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) {
        // 进入本轮时就已经死亡：可能是上一轮技能/反伤造成，先结算再移除
        if (!e.reachedEnd) this.callbacks.onEnemyDied?.(e);
        this.enemies.splice(i, 1);
        continue;
      }
      if (e.reachedEnd) continue;

      e.tickStatuses(now);
      if (!e.alive) {
        // 持续伤害（灼烧 / 中毒 / 诅咒）致死：与技能击杀同等对待
        if (!e.reachedEnd) this.callbacks.onEnemyDied?.(e);
        this.enemies.splice(i, 1);
        continue;
      }
      e.updateStealth(now);

      // 治疗型与召唤型特性
      e.tickAbilities(dt, {
        heal: (target, amount) => {
          target.hp = Math.min(target.maxHp, target.hp + amount);
          this.callbacks.onEnemyHealed?.(target, amount);
        },
        summon: (parent) => {
          const childCfg = this.pickSummonChild(parent.cfg);
          if (!childCfg) return;
          // 子体：0.35 倍血量、与母体同速（不再加速），母体位置稍后方出生，
          // 并继承母体的行进路径（飞行/地面），给防御塔留出拦截窗口。
          // 召唤物不再带召唤特性：草/虫系子体本身多半也是召唤者，
          // 级联召唤会让波次指数滚雪球（一波 9 只滚成 20+），前期塔群无法应对。
          const parentUsesFlyingPath = parent.isFlying && this.level.rules.shortcutForFlyers;
          const child = this.spawnFrom(
            { pokemonId: childCfg.pokemonId, count: 1, intervalMs: 0, delayMs: 0 },
            false, 0.35, 1.0,
            Math.max(0, parent.traveled - 60),
            parentUsesFlyingPath,
          );
          if (child) {
            child.traits.delete('summoner');
            this.callbacks.onSummon?.(parent, child);
          }
        },
      });

      if (e.wantsHeal()) healTargets.push(e);

      // 状态影响下的移动
      const mods = summarizeStatuses(e.statuses, now);
      const knockback = e.consumeKnockback(dt);
      if (!mods.frozen) {
        let speed = e.speed * mods.speedMult;
        // 海滨：水域减速（用章节规则近似）
        if (this.level.theme.key === 'beach') speed *= 0.86;
        const advance = speed * dt - knockback;
        e.traveled += advance;
        if (e.traveled < 0) e.traveled = 0;
      } else {
        e.traveled -= knockback;
        if (e.traveled < 0) e.traveled = 0;
      }

      const usesFlyingPath = !!(e.isFlying && this.level.rules.shortcutForFlyers);
      const pathLen = usesFlyingPath ? this.flyingPathLength() : this.totalPathLength;
      const pos = this.positionAt(e.traveled, usesFlyingPath);
      e.x = pos.x;
      e.y = pos.y;
      e.dirX = pos.dirX;
      e.dirY = pos.dirY;
      e.distanceToEnd = pathLen - e.traveled;

      if (e.traveled >= pathLen) {
        e.reachedEnd = true;
        e.alive = false;
        this.callbacks.onEnemyReachedEnd?.(e, e.baseDamage);
        this.enemies.splice(i, 1);
      }
    }

    // ---- 治疗型：为附近敌人回血 ----
    //
    // 数值上限很关键：治疗是"减伤"而非"免疫"。单个治疗者每秒回复量
    // 必须明显低于防御塔的叠加 DPS，否则战线会永久停滞。
    // 这里按自身最大生命值的百分比计算，使强度随血量自然缩放，
    // 同时对同一目标的叠加治疗设上限，避免堆叠数个治疗者后无法击穿。
    if (healTargets.length) {
      const healedThisStep = new Map<MovingEnemy, number>();
      for (const healer of healTargets) {
        const perSecond = Math.max(1, healer.maxHp * 0.035);
        const amount = perSecond * dt;
        const range = healer.healRange;
        for (const other of this.enemies) {
          if (other === healer) continue;
          if (other.maxHp > healer.maxHp * 1.5) continue; // 治疗不了远强于自己的单位
          const d = Math.hypot(other.x - healer.x, other.y - healer.y);
          if (d > range) continue;
          const already = healedThisStep.get(other) ?? 0;
          const cap = other.maxHp * 0.06; // 每步最多回复 6% 最大生命（约 3.6%/秒）
          const grant = Math.min(amount, Math.max(0, cap - already));
          if (grant <= 0) continue;
          other.hp = Math.min(other.maxHp, other.hp + grant);
          healedThisStep.set(other, already + grant);
          this.callbacks.onEnemyHealed?.(other, grant);
        }
      }
    }

    // ---- 波次完成判定 ----
    if (this.tasks.length === 0 && this.enemies.length === 0 && this.currentWaveIndex >= 0) {
      const wave = this.level.waves[this.currentWaveIndex];
      if (wave) {
        this.completedWaves++;
        this.callbacks.onWaveComplete?.(this.currentWaveIndex);
        const next = this.currentWaveIndex + 1;
        if (next < this.level.waves.length) {
          // 波间休整：给玩家 4 秒造塔时间（固定步长计时，倍速下等效缩短）
          this.simTime += 4000;
          this.scheduleWave(next);
        } else if (!this.finishedSpawning) {
          this.finishedSpawning = true;
          this.currentWaveIndex = -1;
          this.callbacks.onAllWavesComplete?.();
        }
      }
    }
  }

  private pickSummonChild(parent: EnemyConfig): EnemyConfig | null {
    // 召唤出比自身弱一档的小型敌人：取图鉴里同属性、种族值更低的精灵
    const candidates = Object.values(POKEDEX).filter((p) => {
      if (p.id === parent.pokemonId) return false;
      if (!p.types.some((t) => parent.types.includes(t))) return false;
      return p.statTotal < (POKEDEX[parent.pokemonId]?.statTotal ?? 400) * 0.8;
    });
    if (!candidates.length) return null;
    // 确定性选择，避免随机导致战斗结果不可复现
    const pick = candidates[(parent.pokemonId * 7 + Math.floor(this.simTime / 1000)) % candidates.length];
    return getEnemyConfig(pick.id, 1);
  }

  /** 当前是否已经没有任何敌人且没有待生成 */
  get isIdle(): boolean {
    return this.tasks.length === 0 && this.enemies.length === 0;
  }

  get pendingCount(): number {
    return this.tasks.length;
  }

  /** 计算当前波次的剩余敌人数（含待生成），用于 UI */
  get remainingInWave(): number {
    return this.tasks.length + this.enemies.length;
  }

  /** 本关全部波次是否已完成 */
  get allDone(): boolean {
    return this.finishedSpawning && this.completedWaves >= this.level.waves.length;
  }

  get completedWaveCount() {
    return this.completedWaves;
  }

  destroy() {
    for (const e of this.enemies) e.destroyView();
    this.enemies = [];
    this.tasks = [];
  }
}
