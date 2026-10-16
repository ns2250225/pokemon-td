/**
 * BOSS 行为实现（PRD 7.4）。
 *
 * 这些方法通过 `Object.assign` 混入 BattleScene 原型，
 * 而不是继续往 BattleScene.ts 里堆积——该文件已经承担了地图绘制、
 * 输入、经济、战斗结算等职责，BOSS 逻辑单独成文件更易维护与测试。
 *
 * 混入是安全的：这些成员都是新增的私有方法，不与场景已有成员重名，
 * 且 TypeScript 通过下面的接口声明获得完整的类型检查。
 */
import Phaser from 'phaser';
import { TILE } from '../config';
import { GRID_COLS } from '../../data/levels/levels';
import { MOVES } from '../../data/moves/moves';
import { bus } from '../../utils/eventBus';
import { MovingEnemy } from '../entities/Enemy';
import type { PokemonTower } from '../entities/Tower';
import { BOSS_ABILITIES, phaseForHp, phaseModifiers, type BossRuntime } from './BossSystem';

/** 混入所需的宿主能力：BattleScene 必须提供这些成员 */
export interface BossHost {
  waves: {
    simTime: number;
    enemies: MovingEnemy[];
    pathTotalLength: number;
  };
  towers: PokemonTower[];
  blocked: Set<string>;
  bossRuntime: BossRuntime | null;
  effects: {
    playWarning(x: number, y: number, label: string, durationMs: number): void;
    playImpactAt(
      move: unknown,
      x: number,
      y: number,
      color?: number,
      tierScale?: number,
    ): void;
    playUpgradeFx(
      x: number,
      y: number,
      color: number,
      kind: 'level' | 'evolution' | 'ultimate',
    ): void;
  };
  time: Phaser.Time.Clock;
  onEnemySpawned(enemy: MovingEnemy): void;
}

export interface BossMethods {
  updateBoss(this: BossHost & BossMethods): void;
  castBossAbility(this: BossHost & BossMethods, id: string, boss: MovingEnemy): void;
  spawnBossMinion(
    this: BossHost & BossMethods,
    boss: MovingEnemy,
    hpScale: number,
    speedScale: number,
    rewardScale: number,
    flying: boolean,
  ): void;
}

/** 供 BattleScene 构造时调用的安装函数 */
export function installBossBehaviour(host: BossHost): void {
  Object.assign(Object.getPrototypeOf(host), bossPrototype);
}

const bossPrototype: BossMethods = {
  /**
   * 驱动 BOSS 的阶段与技能。
   *
   * 每个固定步调用一次，因此技能节奏与伤害结算一样不受帧率与倍速影响
   * （倍速只改变每帧执行多少步，不改变单步内的行为）。
   */
  updateBoss(this: BossHost & BossMethods) {
    const boss = this.waves.enemies.find((e) => e.isBoss && e.alive);

    if (!boss) {
      // BOSS 消失（被击杀或抵达终点）：清空运行时状态
      if (this.bossRuntime) this.bossRuntime = null;
      return;
    }

    const now = this.waves.simTime;

    // 首次出现：建立运行时并给出登场预警
    if (!this.bossRuntime || this.bossRuntime.enemy !== boss) {
      const abilityId = boss.cfg.ability ?? 'shockwave';
      const spec = BOSS_ABILITIES[abilityId] ?? BOSS_ABILITIES.shockwave;
      this.bossRuntime = {
        enemy: boss,
        abilityId: spec.id,
        phase: 1,
        // 登场后先给玩家一段缓冲再放第一个技能
        readyAtMs: now + spec.cooldownMs * 0.6,
        warningUntilMs: 0,
        pendingAbilityId: null,
        invulnerableUntilMs: 0,
      };
      this.effects.playWarning(boss.x, boss.y, spec.name, spec.warningMs);
      bus.emit('battle:toast', { text: `BOSS 登场：${boss.cfg.nameZh}`, tone: 'warn' });
      return;
    }

    const rt = this.bossRuntime;
    const spec = BOSS_ABILITIES[rt.abilityId] ?? BOSS_ABILITIES.shockwave;

    // ---- 阶段转换：跨过生命阈值时强化并短暂无敌 ----
    // 无敌窗口是刻意的：给玩家一个"读懂阶段变化"的停顿，
    // 否则 BOSS 会在换阶段的一瞬间被打死，阶段机制形同虚设。
    const nextPhase = phaseForHp(boss.hp, boss.maxHp);
    if (nextPhase > rt.phase) {
      rt.phase = nextPhase;
      const mods = phaseModifiers(nextPhase);
      boss.speed = boss.baseSpeed * mods.speed;
      rt.invulnerableUntilMs = now + 900;
      boss.invulnerableUntil = rt.invulnerableUntilMs;
      rt.readyAtMs = Math.min(rt.readyAtMs, now + 1200);
      this.effects.playUpgradeFx(boss.x, boss.y, 0xff5555, nextPhase >= 3 ? 'ultimate' : 'evolution');
      bus.emit('battle:toast', { text: `${boss.cfg.nameZh} 进入第 ${nextPhase} 阶段！`, tone: 'warn' });
      bus.emit('battle:bossPhase', { pokemonId: boss.id, phase: nextPhase });
    }

    boss.invulnerable = now < rt.invulnerableUntilMs;

    // ---- 技能预警 → 到点释放 ----
    // 两段式是 PRD 7.4 的要求：先预警，玩家才有反应余地
    if (rt.pendingAbilityId && now >= rt.warningUntilMs) {
      const pending = rt.pendingAbilityId;
      rt.pendingAbilityId = null;
      this.castBossAbility(pending, boss);
      rt.readyAtMs = now + spec.cooldownMs * phaseModifiers(rt.phase).cooldownScale;
      return;
    }

    if (!rt.pendingAbilityId && now >= rt.readyAtMs) {
      rt.pendingAbilityId = rt.abilityId;
      rt.warningUntilMs = now + spec.warningMs;
      this.effects.playWarning(boss.x, boss.y, spec.name, spec.warningMs);
    }
  },

  /**
   * 释放 BOSS 技能。
   *
   * 每个分支都必须产生真实的玩法后果（封锁建造区 / 召唤 / 加速 / 压制防御塔 /
   * 隐身等），而不是只播一段特效——否则 BOSS 与普通敌人在玩法上没有区别。
   */
  castBossAbility(this: BossHost & BossMethods, id: string, boss: MovingEnemy) {
    switch (id) {
      case 'flamethrower_lock': {
        // 沿路径前方封锁若干建造格，持续 6 秒
        const cells: string[] = [];
        const baseGx = Math.floor(boss.x / TILE);
        const gy = Math.floor(boss.y / TILE);
        for (let i = 1; i <= 4; i++) {
          const gx = baseGx + i;
          if (gx >= 0 && gx < GRID_COLS) cells.push(`${gx},${gy}`);
        }
        for (const key of cells) this.blocked.add(key);
        this.effects.playImpactAt(MOVES.flamethrower, boss.x + TILE * 2, boss.y, undefined, 1);
        this.time.delayedCall(6000, () => {
          for (const key of cells) {
            const [gx, gy2] = key.split(',').map(Number);
            // 有防御塔占位的格子不能解锁
            if (!this.towers.some((t) => t.gridX === gx && t.gridY === gy2)) {
              this.blocked.delete(key);
            }
          }
        });
        bus.emit('battle:toast', { text: '建造区被烈焰封锁 6 秒！', tone: 'warn' });
        break;
      }

      case 'wave_push': {
        // 把周围的敌人向前推进一大段（负值 = 沿路径前进）
        for (const e of this.waves.enemies) {
          if (e === boss || !e.alive) continue;
          if (Math.hypot(e.x - boss.x, e.y - boss.y) > 220) continue;
          e.addStatusPartial('knockback', { pendingKnockback: -170 });
        }
        this.effects.playImpactAt(MOVES.surf, boss.x, boss.y, undefined, 1);
        break;
      }

      case 'clone_decoy': {
        // 两个低血量、零奖励的分身：纯粹用来误导目标选择
        this.spawnBossMinion(boss, 0.18, 1.05, 0, false);
        this.spawnBossMinion(boss, 0.18, 1.05, 0, false);
        this.effects.playImpactAt(MOVES.shadowball, boss.x, boss.y, undefined, 1);
        break;
      }

      case 'dragon_rush': {
        boss.speed = boss.baseSpeed * 2.1;
        boss.speedLockUntil = this.waves.simTime + 4200;
        this.effects.playImpactAt(MOVES.dragonpulse, boss.x, boss.y, undefined, 1);
        break;
      }

      case 'barrier_control': {
        boss.shield = Math.round(boss.maxHp * 0.22);
        boss.shieldMax = boss.shield;
        // 压制距离最近的一座防御塔
        let target: PokemonTower | null = null;
        let best = Infinity;
        for (const t of this.towers) {
          const d = Math.hypot(t.x - boss.x, t.y - boss.y);
          if (d < best) {
            best = d;
            target = t;
          }
        }
        target?.lockFor(3000, this.waves.simTime);
        this.effects.playImpactAt(MOVES.psychicmove, boss.x, boss.y, undefined, 1);
        break;
      }

      case 'sky_raid': {
        this.spawnBossMinion(boss, 0.16, 1.35, 0.5, true);
        this.spawnBossMinion(boss, 0.16, 1.35, 0.5, true);
        this.effects.playImpactAt(MOVES.airslash, boss.x, boss.y, undefined, 1);
        break;
      }

      case 'storm_surge': {
        for (const t of this.towers) {
          if (Math.hypot(t.x - boss.x, t.y - boss.y) <= 260) t.lockFor(1800, this.waves.simTime);
        }
        this.effects.playImpactAt(MOVES.thunder, boss.x, boss.y, undefined, 1);
        break;
      }

      case 'time_distort': {
        // ratio 取负值 = 加速而非减速
        for (const e of this.waves.enemies) {
          if (e.alive) e.addStatusPartial('slow', { ratio: -0.35, expiresAt: this.waves.simTime + 3500 });
        }
        this.effects.playImpactAt(MOVES.psychicmove, boss.x, boss.y, undefined, 1);
        break;
      }

      case 'shadow_realm': {
        boss.stealthUntil = this.waves.simTime + 4500;
        boss.stealthActive = true;
        boss.revealedUntil = 0;
        this.effects.playImpactAt(MOVES.shadowball, boss.x, boss.y, undefined, 1);
        break;
      }

      default: {
        // 震地冲击：击退并眩晕周围的普通敌人
        for (const e of this.waves.enemies) {
          if (e === boss || !e.alive) continue;
          if (Math.hypot(e.x - boss.x, e.y - boss.y) > 200) continue;
          e.addStatusPartial('stun', { expiresAt: this.waves.simTime + 900 });
        }
        this.effects.playImpactAt(MOVES.earthquake, boss.x, boss.y, undefined, 1);
        break;
      }
    }
  },

  /** 生成 BOSS 的召唤物 / 分身 */
  spawnBossMinion(
    this: BossHost & BossMethods,
    boss: MovingEnemy,
    hpScale: number,
    speedScale: number,
    rewardScale: number,
    flying: boolean,
  ) {
    const child = new MovingEnemy({
      config: boss.cfg,
      hpScale,
      speedScale,
      rewardScale,
      difficultyScale: boss.difficultyScale,
      isBoss: false,
      stealthPeriodMs: 0,
      healRange: 0,
      healPerSecond: 0,
    });
    child.x = boss.x;
    child.y = boss.y;
    child.traveled = boss.traveled;
    child.distanceToEnd = Math.max(0, this.waves.pathTotalLength - child.traveled);
    if (flying) child.isFlying = true;
    this.waves.enemies.push(child);
    this.onEnemySpawned(child);
  },
};
