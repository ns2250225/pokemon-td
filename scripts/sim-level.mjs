/**
 * 关卡无头仿真 —— 复用游戏真实的 WaveSystem / TargetingSystem / CombatSystem /
 * MovingEnemy / PokemonTower 逻辑，在 Node 里以固定步长完整模拟一关。
 *
 * 目的：量化关卡难度。用几种"正常水平玩家"的建造策略跑完整关，
 * 看是否能赢、漏了几只、基地剩多少血。
 *
 * 用法：
 *   node .assets-cache/sim-level.bundle.mjs <levelId> [strategy]
 * 先用 esbuild 打包（见 package.json 或 balance-report 的打包命令）：
 *   npx esbuild scripts/sim-level.mjs --bundle --platform=node --format=esm \
 *     --target=node20 --outfile=.assets-cache/sim-level.bundle.mjs \
 *     --loader:.json=json --alias:phaser=<abs>/scripts/phaser-stub.js
 */
import { WaveSystem } from '../src/game/systems/WaveSystem.ts';
import { PokemonTower } from '../src/game/entities/Tower.ts';
import { pickTarget, resolveTargets } from '../src/game/systems/TargetingSystem.ts';
import { computeDamage } from '../src/game/systems/CombatSystem.ts';
import { typeMultiplier } from '../src/data/balance/typeChart.ts';
import { getLevel, blockedCells, GRID_COLS, GRID_ROWS, TILE } from '../src/data/levels/levels.ts';
import { getTowerConfig, getEnemyConfig } from '../src/data/pokemon/units.ts';
import { SIM_STEP_MS } from '../src/game/config.ts';

/* ------------------------------------------------------------------ */
/* 敌方平均威胁（用于塔的 DPS 估值）                                     */
/* ------------------------------------------------------------------ */

function avgDamagePerHit(tower, enemies) {
  const move = tower.config.moves[0].move;
  let sum = 0;
  for (const e of enemies) {
    const mult = typeMultiplier(move.type, e.types);
    const resist = move.category === 'physical' ? e.armor : e.magicResist;
    sum += tower.config.damage * move.damageMultiplier * mult * (1 - resist);
  }
  return sum / Math.max(1, enemies.length);
}

function towerAvgDps(tower, enemies) {
  return avgDamagePerHit(tower, enemies) / (tower.config.attackIntervalMs / 1000);
}

/* ------------------------------------------------------------------ */
/* 无头战斗                                                            */
/* ------------------------------------------------------------------ */

class HeadlessBattle {
  constructor(level, strategy) {
    this.level = level;
    this.strategy = strategy;
    this.coins = level.startCoins;
    this.baseHp = level.baseHp;
    this.maxBaseHp = level.baseHp;
    this.enemiesKilled = 0;
    this.enemiesLeaked = 0;
    this.towers = [];
    this.nextUid = 1;
    this.blocked = blockedCells(level.path);
    for (const o of level.obstacles) this.blocked.add(`${o.x},${o.y}`);
    this.pendingImpacts = [];
    this.finished = null; // 'won' | 'lost'
    this.waveLog = [];

    const enemyIds = new Set();
    for (const w of level.waves) for (const g of w.groups) enemyIds.add(g.pokemonId);
    this.sampleEnemies = [...enemyIds]
      .map((id) => getTowerSample(id))
      .filter(Boolean);
    this.levelHasFlying = this.sampleEnemies.some((e) => e.isFlying);
    this.levelHasStealth = this.sampleEnemies.some((e) => e.isStealth);
    // 按波次构成加权计算飞行 / 隐身敌人占比
    let total = 0, flyers = 0, stealths = 0;
    for (const w of level.waves) {
      for (const g of w.groups) {
        const cfg = getEnemyConfig(g.pokemonId, 1);
        if (!cfg) continue;
        total += g.count;
        if (cfg.isFlying) flyers += g.count;
        if (cfg.isStealth) stealths += g.count;
      }
    }
    this.flyingShare = total ? flyers / total : 0;
    this.stealthShare = total ? stealths / total : 0;

    this.waves = new WaveSystem(null, level, {
      onEnemySpawned: () => {},
      onEnemyDied: (e) => this.onEnemyKilled(e),
      onEnemyReachedEnd: (e, dmg) => this.onEnemyReachedEnd(dmg),
      onWaveStart: (w, i) => this.waveLog.push({ wave: i + 1, isBoss: w.isBoss, t: Math.round(this.waves.simTime), alive: this.waves.enemies.length }),
      onWaveComplete: (i) => {
        // 与 BattleScene.onWaveComplete 一致：发放波次通关奖励
        const w = this.level.waves[i];
        if (w?.bonus) this.coins += w.bonus;
      },
      onAllWavesComplete: () => { this.finished = 'won'; },
      onEnemyHealed: () => {},
      onSummon: () => {},
    });

    // 候选建造格与路径覆盖采样。
    // 天空之城（shortcutForFlyers）：飞行敌人走直线、地面敌人走普通路径，
    // 两条路径都按敌群占比加权采样，逼 AI 混编对空 + 对地防御。
    const share = this.flyingShare;
    if (level.rules.shortcutForFlyers && share > 0) {
      const first = level.path[0];
      const last = level.path[level.path.length - 1];
      const fly = [
        { x: first.x * TILE + TILE / 2, y: first.y * TILE + TILE / 2 },
        { x: last.x * TILE + TILE / 2, y: first.y * TILE + TILE / 2 },
        { x: last.x * TILE + TILE / 2, y: last.y * TILE + TILE / 2 },
      ];
      this.pathSamples = [];
      // 直线占 share 权重、地面占 1-share：采样密度按权重分配
      const groundStep = share < 1 ? Math.min(160, 20 * (share / (1 - share))) : Infinity;
      const addLine = (a, b) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.round(len / 20));
        for (let k = 0; k < n; k++) {
          this.pathSamples.push({
            x: a.x + ((b.x - a.x) * k) / n,
            y: a.y + ((b.y - a.y) * k) / n,
            claims: 0,
          });
        }
      };
      for (let i = 0; i < fly.length - 1; i++) addLine(fly[i], fly[i + 1]);
      if (share < 1) {
        this.pathSamples.push(...samplePath(level.path, groundStep));
      }
    } else {
      this.pathSamples = samplePath(level.path, 20);
    }
    this.buildSpots = this.collectBuildSpots();
  }

  collectBuildSpots() {
    const spots = [];
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        if (this.blocked.has(`${gx},${gy}`)) continue;
        spots.push({ gx, gy, x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 });
      }
    }
    return spots;
  }

  /** 格子能覆盖多少未被他塔覆盖的路径采样点 */
  coverageOf(x, y, range, owner) {
    let fresh = 0;
    let covered = 0;
    for (const p of this.pathSamples) {
      if (Math.hypot(p.x - x, p.y - y) > range) continue;
      if (p.claims === 0) fresh++;
      else covered++;
    }
    // 独占覆盖价值 1，重叠补位（基地前第二层防御）价值 0.4
    return { fresh, value: fresh + covered * 0.4 };
  }

  onEnemyKilled(enemy) {
    if (enemy.alive || enemy.__counted) return;
    enemy.__counted = true;
    this.enemiesKilled++;
    this.coins += enemy.reward;
    // 分裂型（与 BattleScene.onEnemyKilled 一致）
    if (enemy.traits.has('splitter') && !enemy.isBoss) {
      for (let i = 0; i < 2; i++) {
        const MovingEnemyCtor = this.MovingEnemyCtor;
        const child = new MovingEnemyCtor({
          config: enemy.cfg,
          hpScale: 0.28 * (this.level.rules.enemyHp * (1 + (this.level.chapter - 1) * 0.12)),
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
      }
    }
  }

  onEnemyReachedEnd(damage) {
    this.enemiesLeaked++;
    this.baseHp -= damage;
    if (this.baseHp <= 0) {
      this.baseHp = 0;
      this.finished = 'lost';
    }
  }

  /* ---- 复刻 BattleScene.fireMove / applyMoveDamage ---- */

  fireMove(tower, move) {
    const enemies = this.waves.enemies;
    if (!enemies.length && move.targeting !== 'aura') return;

    if (move.targeting === 'aura' && move.damageMultiplier === 0) {
      tower.applySelfBuff(move, this.waves.simTime);
      tower.lockFor(move.cooldownMs * 0.4, this.waves.simTime);
      return;
    }

    const ctx = {
      x: tower.x, y: tower.y, range: tower.range,
      canHitFlying: move.canHitFlying || tower.config.types.includes('flying') || tower.config.types.includes('electric'),
      airOnly: !!move.airOnly,
      revealsStealth: tower.revealsStealth || !!move.revealsStealth,
      priority: 'first',
    };

    const primary = pickTarget(enemies, ctx, move);
    if (!primary && move.targeting !== 'global') return;
    const targets = resolveTargets(move, ctx, enemies, primary);
    if (!targets.length && move.targeting !== 'global') return;

    for (const t of targets) {
      if (t.stealthActive && ctx.revealsStealth) t.revealedUntil = this.waves.simTime + 2500;
    }

    const targetX = primary ? primary.x : tower.x;
    const targetY = primary ? primary.y : tower.y;
    const castMs = move.effects.castMs ?? 0;
    tower.lockFor(castMs + 120, this.waves.simTime);
    const impactAt = this.waves.simTime + castMs
      + (move.effects.speed ? (Math.hypot(targetX - tower.x, targetY - tower.y) / move.effects.speed) * 1000 : 0);
    const targetsAtFire = targets.slice();
    this.pendingImpacts.push({
      atMs: impactAt,
      fn: () => this.applyMoveDamage(tower, move, targetsAtFire, targetX, targetY),
    });
  }

  applyMoveDamage(tower, move, targets, targetX, targetY) {
    const hits = move.hits ?? 1;
    const runHit = (hitIndex) => {
      for (const enemy of targets) {
        if (!enemy.alive) continue;
        if (move.targeting !== 'single' && move.targeting !== 'chain') {
          const d = Math.hypot(enemy.x - targetX, enemy.y - targetY);
          const limit = move.radius ?? move.length ?? tower.range;
          if (d > limit + enemy.radius) continue;
        }
        const result = computeDamage({
          attack: tower.attackPower,
          move,
          defenderTypes: enemy.cfg.types,
          armor: enemy.armor,
          magicResist: enemy.magicResist,
          vulnerability: enemy.vulnerability,
          difficultyScale: 1 / enemy.difficultyScale,
          roll: ((tower.uid * 31 + hitIndex * 17 + enemy.id) % 100) / 100,
        });
        if (result.immune) continue;
        const dealt = enemy.applyDamage(result.amount);
        tower.registerHit(dealt, !enemy.alive);
        if (move.status && enemy.alive) {
          enemy.mergeStatusFrom(move.status, this.waves.simTime, move.type);
        }
      }
    };
    // 基础招式都是单段；多段在无头仿真里按同一步结算（对平衡结论影响可忽略）
    for (let i = 0; i < hits; i++) runHit(i);
    tower.applySelfBuff(move, this.waves.simTime);
  }

  simulateStep() {
    this.waves.step();
    if (this.finished) return;

    const now = this.waves.simTime;
    for (const tower of this.towers) {
      const move = tower.tick(SIM_STEP_MS, now);
      if (move) this.fireMove(tower, move);
    }

    if (this.pendingImpacts.length) {
      const due = this.pendingImpacts.filter((p) => p.atMs <= now);
      this.pendingImpacts = this.pendingImpacts.filter((p) => p.atMs > now);
      for (const d of due) d.fn();
    }
  }

  /* ---- 玩家策略：每秒决策一次 ---- */

  act() {
    const s = this.strategy;
    const actions = [];

    // 波次里有飞行 / 隐身敌人时，像看过波次预告的玩家一样，
    // 让具备对空 / 反隐能力的塔的比例不低于敌群中的对应占比。
    const flyingShare = this.flyingShare, stealthShare = this.stealthShare;
    const antiAirHave = this.towers.filter((t) => isAntiAir(t.config)).length;
    const revealsHave = this.towers.filter((t) => isRevealer(t.config)).length;
    const needAntiAir = flyingShare > 0 && antiAirHave < Math.ceil(flyingShare * (this.towers.length + 1));
    const needReveals = stealthShare > 0 && revealsHave < Math.ceil(stealthShare * (this.towers.length + 1));

    // 新建塔：挑性价比最高的可负担塔
    let towerOptions = this.level.availableTowers
      .map((id) => getTowerConfig(id))
      .filter((c) => c && c.cost <= this.coins)
      .map((c) => {
        const probe = { config: c };
        return { cfg: c, dps: towerAvgDps(probe, this.sampleEnemies), value: towerAvgDps(probe, this.sampleEnemies) / c.cost };
      })
      .sort((a, b) => b.value - a.value);

    if (needReveals) {
      const capable = towerOptions.filter((o) => isRevealer(o.cfg));
      if (capable.length) towerOptions = capable;
    } else if (needAntiAir) {
      const capable = towerOptions.filter((o) => isAntiAir(o.cfg));
      if (capable.length) towerOptions = capable;
    }

    const totalSamples = Math.max(1, this.pathSamples.length);

    for (const opt of towerOptions) {
      if (s.prefer && !s.prefer.has(opt.cfg.pokemonId)) continue;
      // 找覆盖最大的空格：优先独占覆盖，后期没有独占位时接受重叠补位
      //（真实玩家也会在基地前堆冗余防御）
      let best = null;
      const minFresh = s.minFresh ?? 2;
      for (const spot of this.buildSpots) {
        if (this.blocked.has(`${spot.gx},${spot.gy}`)) continue;
        if (this.towers.some((t) => t.gridX === spot.gx && t.gridY === spot.gy)) continue;
        const cov = this.coverageOf(spot.x, spot.y, opt.cfg.range, spot);
        // 优先独占覆盖段；地图饱和后接受重叠补位（0.4 权重/采样点）
        if (cov.fresh < minFresh && cov.value < 3) continue;
        if (!best || cov.value > best.value) best = { ...spot, score: cov.fresh, value: cov.value };
      }
      if (best && best.value > 0) {
        // 边际收益：覆盖价值占比 × DPS / 金币（与升级同一把尺子）
        const frac = best.value / totalSamples;
        actions.push({
          kind: 'build', cost: opt.cfg.cost, score: (opt.dps * frac) / opt.cfg.cost,
          validate: () => !this.towers.some((t) => t.gridX === best.gx && t.gridY === best.gy),
          run: () => {
            const tower = new PokemonTower(this.nextUid++, opt.cfg, best.gx, best.gy);
            tower.spotClaims = 0;
            this.towers.push(tower);
            this.blocked.add(`${best.gx},${best.gy}`);
            this.coins -= opt.cfg.cost;
            // 只把此前无人覆盖的采样点记为这座塔的独占覆盖，
            // 后续升级的边际收益才不会因为重叠覆盖被高估
            for (const p of this.pathSamples) {
              if (p.claims === 0 && Math.hypot(p.x - best.x, p.y - best.y) <= opt.cfg.range) {
                p.claims++;
                tower.spotClaims++;
              }
            }
          },
        });
      }
    }

    // 升级：DPS 增益 / 金币（乘上该塔自己的路径覆盖占比）
    for (const t of this.towers) {
      if (t.level >= t.config.maxLevel) continue;
      const cost = t.upgradeCost;
      if (cost > this.coins) continue;
      const curDps = towerAvgDps(t, this.sampleEnemies);
      const newDps = curDps * (1 + t.config.growth.damage + t.config.growth.attackSpeed);
      const frac = (t.spotClaims ?? 1) / totalSamples;
      actions.push({
        kind: 'upgrade', cost,
        score: ((newDps - curDps) * frac) / cost,
        run: () => { this.coins -= cost; t.upgrade(); },
      });
    }

    // 进化：Lv>=3 且未进化的塔（与 BattleScene.tryEvolve 同一套扣费逻辑）
    for (const t of this.towers) {
      if (!t.canEvolve) continue;
      const cost = t.evolutionCost;
      if (cost > this.coins) continue;
      const targetCfg = getTowerConfig(t.config.evolution.targetId);
      if (!targetCfg) continue;
      const curDps = towerAvgDps(t, this.sampleEnemies);
      const newDps = towerAvgDps({ config: targetCfg }, this.sampleEnemies);
      const frac = (t.spotClaims ?? 1) / totalSamples;
      actions.push({
        kind: 'evolve', cost,
        score: ((newDps - curDps) * frac) / Math.max(1, cost),
        run: () => { this.coins -= cost; t.invested += cost; t.evolve(targetCfg); },
      });
    }

    actions.sort((a, b) => b.score - a.score);
    for (const a of actions) {
      if (a.cost > this.coins) continue;
      if (a.kind === 'build' && this.towers.length >= s.maxTowers) continue;
      // 执行前重新校验（动作生成时格子可能已被占用）
      if (a.kind === 'build' && !a.validate()) continue;
      a.run();
      if (s.oneActionPerTick) break;
    }
  }

  run(maxMs = 30 * 60 * 1000) {
    // 开局先连续建造/升级（准备阶段金币全部投入）
    for (let i = 0; i < 30 && !this.finished; i++) this.act();
    this.waves.start();
    this.debugEvery10s = !process.env.QUIET;
    let steps = 0;
    let lastAct = 0;
    let lastLog = 0;
    while (!this.finished && this.waves.simTime < maxMs) {
      // 波次待命时自动确认开始出怪（无头仿真没有 UI 按钮，直接等价于点击）
      if (this.waves.awaitingStartWave >= 0) this.waves.confirmStartWave();
      this.simulateStep();
      steps++;
      if (this.waves.simTime - lastAct >= 1000) {
        lastAct = this.waves.simTime;
        this.act();
      }
      if (this.debugEvery10s && this.waves.simTime - lastLog >= 10000) {
        lastLog = this.waves.simTime;
        const alive = this.waves.enemies;
        const hpSum = alive.reduce((a, e) => a + e.hp, 0);
        const dmgSum = this.towers.reduce((a, t) => a + t.totalDamage, 0);
        console.log(`  [t=${(this.waves.simTime / 1000).toFixed(0)}s] 场上${alive.length}只 血量${Math.round(hpSum)} 塔输出${Math.round(dmgSum)} 击杀${this.enemiesKilled} 金币${Math.round(this.coins)} 塔${this.towers.length}座`);
        // 输出停滞时的敌人快照（定位软锁）
        const lastDmg = this.lastDmgSum ?? 0;
        if (dmgSum === lastDmg && alive.length > 0) {
          for (const e of alive.slice(0, 5)) {
            console.log(`    卡住: ${e.cfg.nameZh} hp=${Math.round(e.hp)}/${e.maxHp} traveled=${Math.round(e.traveled)}/${Math.round(this.waves.pathTotalLength)} flying=${e.isFlying} stealth=${e.stealthActive} 状态=[${e.statuses.map((s) => s.kind).join(',')}]`);
          }
        }
        this.lastDmgSum = dmgSum;
      }
    }
    return {
      result: this.finished ?? 'timeout',
      baseHp: this.baseHp,
      maxBaseHp: this.maxBaseHp,
      killed: this.enemiesKilled,
      leaked: this.enemiesLeaked,
      towers: this.towers.length,
      coins: Math.round(this.coins),
      simSec: Math.round(this.waves.simTime / 1000),
      waveLog: this.waveLog,
    };
  }
}

/* MovingEnemy 是循环依赖（Tower ↔ Enemy 无关，WaveSystem → Enemy），动态引入 */
let MovingEnemyCtor = null;
async function init() {
  const mod = await import('../src/game/entities/Enemy.ts');
  MovingEnemyCtor = mod.MovingEnemy;
}
function getTowerSample(id) {
  if (!sampleCache.has(id)) sampleCache.set(id, getEnemyConfig(id, 1));
  return sampleCache.get(id);
}
const sampleCache = new Map();

/* ------------------------------------------------------------------ */
/* 塔的反制能力判定                                                      */
/* ------------------------------------------------------------------ */

function isAntiAir(cfg) {
  return cfg.types.includes('electric') || cfg.types.includes('flying')
    || cfg.moves.some((m) => m.move.canHitFlying);
}

function isRevealer(cfg) {
  return cfg.types.includes('ghost') || cfg.moves.some((m) => m.move.revealsStealth);
}

/* ------------------------------------------------------------------ */
/* 路径采样                                                            */
/* ------------------------------------------------------------------ */

function samplePath(path, step = 20) {
  const pts = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) * TILE;
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      pts.push({
        x: (a.x + ((b.x - a.x) * k) / n) * TILE + TILE / 2,
        y: (a.y + ((b.y - a.y) * k) / n) * TILE + TILE / 2,
        claims: 0,
      });
    }
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

const levelId = process.argv[2] || '1-1';
const strategyName = process.argv[3] || 'good';

await init();

const level = getLevel(levelId);
if (!level) {
  console.error(`关卡不存在: ${levelId}`);
  process.exit(1);
}

const allTowerIds = level.availableTowers;
const strategies = {
  // 悠闲玩家：位置要求低，最多 6 座塔
  casual: { maxTowers: 6, oneActionPerTick: false, minFresh: 2 },
  // 认真玩家：只建在覆盖 ≥120px 路径的格子，其余钱升级；金币充足时补塔到 16 座
  good: { maxTowers: 16, oneActionPerTick: false, minFresh: 6 },
  // 极限玩家：不设塔数上限
  max: { maxTowers: 24, oneActionPerTick: false, minFresh: 6 },
};

const strategy = strategies[strategyName] ?? strategies.good;
const battle = new HeadlessBattle(level, strategy);
battle.MovingEnemyCtor = MovingEnemyCtor;

const t0 = Date.now();
const r = battle.run();
const ms = Date.now() - t0;

console.log(`\n===== 仿真 ${level.id} 策略:${strategyName} =====`);
console.log(`结果: ${r.result === 'won' ? '✓ 胜利' : r.result === 'lost' ? '✗ 失败' : '? 超时'}  基地血量 ${r.baseHp}/${r.maxBaseHp}  击杀 ${r.killed}  漏怪 ${r.leaked}`);
console.log(`塔数 ${r.towers}  剩余金币 ${r.coins}  模拟时长 ${r.simSec}s  (计算耗时 ${ms}ms)`);
console.log('塔布点:', battle.towers.map((t) => `(${t.gridX},${t.gy ?? t.gridY}) L${t.level} ${Math.round(t.totalDamage)}伤`).join('  '));
for (const w of r.waveLog) {
  console.log(`  波${w.wave}${w.isBoss ? '(BOSS)' : ''} @${(w.t / 1000).toFixed(0)}s 场上已有 ${w.alive} 只`);
}
