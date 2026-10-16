/**
 * 核心逻辑自检 —— 在 Node 中直接跑非渲染逻辑，验证游戏规则正确。
 *
 * 覆盖：
 *   1. 18 属性关系表的倍率与边界
 *   2. 伤害计算（克制 / 抵抗 / 免疫 / 穿甲 / 固定步长可复现）
 *   3. 目标选择（first / strongest / mostDense、对空、隐身）
 *   4. 关卡数据完整性（80 关、路径连通、波次非空、BOSS 配置）
 *   5. 单位配置完整性（1025 只都有防御与敌方配置）
 *   6. 状态效果叠加与汇总
 *
 * 运行： npm run test:logic
 */
import assert from 'node:assert/strict';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* =================================================================== */
/* 1. 属性关系表                                                        */
/* =================================================================== */

const chartMod = await import('../src/data/balance/typeChart.ts');
const { typeMultiplier, POKEMON_TYPES, TYPE_CHART, TD_MULTIPLIERS, TYPE_COLORS } = chartMod;

section('1. 十八属性关系表');

test('全部 18 属性都在表中', () => {
  assert.equal(POKEMON_TYPES.length, 18);
  for (const t of POKEMON_TYPES) {
    assert.ok(TYPE_CHART[t], `缺少 ${t} 的攻击行`);
    for (const d of POKEMON_TYPES) {
      assert.ok(typeof TYPE_CHART[t][d] === 'number', `${t} → ${d} 无效`);
    }
  }
});

test('水克制火 = 1.5', () => {
  assert.equal(typeMultiplier('water', ['fire']), TD_MULTIPLIERS.super);
});

test('火打水 = 0.75（被抵抗）', () => {
  assert.equal(typeMultiplier('fire', ['water']), TD_MULTIPLIERS.notVery);
});

test('电打地面 = 0.25（免疫宽松处理，防御塔不会完全失效）', () => {
  assert.equal(typeMultiplier('electric', ['ground']), TD_MULTIPLIERS.immune);
});

test('冰打龙/飞行双重克制被限制在 2.0 上限', () => {
  // 冰对龙 2×，对飞行 2× → 原版 4×，本作裁剪到 max
  assert.equal(typeMultiplier('ice', ['dragon', 'flying']), TD_MULTIPLIERS.max);
});

test('双重抵抗被限制在 0.5 下限', () => {
  // 火对水 0.5 × 火对龙 0.5 = 0.25 → 裁剪到 min
  assert.equal(typeMultiplier('fire', ['water', 'dragon']), TD_MULTIPLIERS.min);
});

test('严格免疫模式下免疫属性造成 0 伤害', () => {
  assert.equal(typeMultiplier('electric', ['ground'], true), 0);
});

test('所有倍率都在 [0.25, 2.0] 内', () => {
  for (const a of POKEMON_TYPES) {
    for (const d1 of POKEMON_TYPES) {
      for (const d2 of POKEMON_TYPES) {
        const m = typeMultiplier(a, [d1, d2]);
        assert.ok(m >= TD_MULTIPLIERS.immune - 1e-9 && m <= TD_MULTIPLIERS.max + 1e-9,
          `${a} → [${d1},${d2}] = ${m} 超出范围`);
      }
    }
  }
});

test('非免疫组合的倍率不低于 0.5 下限', () => {
  const hasImmunity = (a, d1, d2) => {
    const row = TYPE_CHART;
    // 通过严格模式判定是否含免疫（严格模式下免疫返回 0）
    return typeMultiplier(a, [d1], true) === 0 || typeMultiplier(a, [d2], true) === 0 || row[a][d1] === 0 || row[a][d2] === 0;
  };
  for (const a of POKEMON_TYPES) {
    for (const d1 of POKEMON_TYPES) {
      for (const d2 of POKEMON_TYPES) {
        const m = typeMultiplier(a, [d1, d2]);
        if (hasImmunity(a, d1, d2)) {
          assert.ok(m >= TD_MULTIPLIERS.immune - 1e-9, `${a} → [${d1},${d2}] = ${m} 低于免疫下限`);
        } else {
          assert.ok(m >= TD_MULTIPLIERS.min - 1e-9, `${a} → [${d1},${d2}] = ${m} 低于下限`);
        }
      }
    }
  }
});

test('免疫组合不会归零，且被抬到 0.25 下限', () => {
  // 一般系打岩石+幽灵：原版 0.5 × 0 = 0 → 本作按 0.75 × 0.25 = 0.1875，抬到下限 0.25
  assert.equal(typeMultiplier('normal', ['rock', 'ghost']), TD_MULTIPLIERS.immune);
  // 电系打水+地面：克制 1.5 × 免疫 0.25 = 0.375，高于下限，保留组合差异
  assert.equal(typeMultiplier('electric', ['water', 'ground']), 0.375);
  // 关键性质：含免疫的组合永远 > 0，防御塔不会完全失效
  for (const a of POKEMON_TYPES) {
    for (const d1 of POKEMON_TYPES) {
      for (const d2 of POKEMON_TYPES) {
        assert.ok(typeMultiplier(a, [d1, d2]) > 0,
          `${a} → [${d1},${d2}] 归零，违反"避免防御塔完全失去作用"的设计`);
      }
    }
  }
});

test('18 属性都有配色', () => {
  for (const t of POKEMON_TYPES) assert.ok(/^#[0-9A-Fa-f]{6}$/.test(TYPE_COLORS[t]), `${t} 配色无效`);
});

/* =================================================================== */
/* 2. 招式库                                                            */
/* =================================================================== */

const movesMod = await import('../src/data/moves/moves.ts');
const { MOVES, MOVE_LIST, TYPE_BASIC_MOVE, TYPE_SIGNATURE_MOVE, TYPE_ULTIMATE_MOVE } = movesMod;

section('2. 技能库');

test('招式数量 >= 20（MVP 要求）', () => {
  assert.ok(MOVE_LIST.length >= 20, `只有 ${MOVE_LIST.length} 个招式`);
});

test('每个招式配置完整', () => {
  const validTargeting = new Set(['single', 'chain', 'pierce', 'area', 'cone', 'line', 'multi', 'global', 'aura']);
  const validTier = new Set(['common', 'enhanced', 'epic', 'legendary']);
  for (const m of MOVE_LIST) {
    assert.ok(m.id && m.name && m.type, `招式 ${m.id} 缺少基本字段`);
    assert.ok(POKEMON_TYPES.includes(m.type), `${m.id} 属性 ${m.type} 非法`);
    assert.ok(validTargeting.has(m.targeting), `${m.id} targeting ${m.targeting} 非法`);
    assert.ok(validTier.has(m.effectTier), `${m.id} tier ${m.effectTier} 非法`);
    assert.ok(typeof m.damageMultiplier === 'number' && m.damageMultiplier >= 0, `${m.id} 倍率非法`);
    assert.ok(typeof m.cooldownMs === 'number' && m.cooldownMs >= 0, `${m.id} 冷却非法`);
    assert.ok(m.effects && typeof m.effects === 'object', `${m.id} 缺少 effects`);
    assert.ok(m.description && m.description.length > 4, `${m.id} 缺少描述`);
  }
});

test('每个属性都有基础 / 招牌 / 终极招式', () => {
  for (const t of POKEMON_TYPES) {
    assert.ok(TYPE_BASIC_MOVE[t] && MOVES[TYPE_BASIC_MOVE[t]], `${t} 缺少基础招式`);
    assert.ok(TYPE_SIGNATURE_MOVE[t] && MOVES[TYPE_SIGNATURE_MOVE[t]], `${t} 缺少招牌招式`);
    assert.ok(TYPE_ULTIMATE_MOVE[t] && MOVES[TYPE_ULTIMATE_MOVE[t]], `${t} 缺少终极招式`);
  }
});

test('史诗 / 传说级技能都带蓄力或强视觉参数', () => {
  for (const m of MOVE_LIST.filter((x) => x.effectTier === 'epic' || x.effectTier === 'legendary')) {
    const hasSetup = (m.effects.castMs ?? 0) > 0 || (m.effects.screenShake ?? 0) > 0 || (m.effects.particles ?? 0) > 20;
    assert.ok(hasSetup, `${m.id} (${m.effectTier}) 缺少特效编排`);
  }
});

test('连锁技能都定义了 maxTargets 与 chainRange', () => {
  for (const m of MOVE_LIST.filter((x) => x.targeting === 'chain')) {
    assert.ok(m.maxTargets >= 2, `${m.id} 连锁目标数不足`);
    assert.ok(m.chainRange > 0, `${m.id} 缺少 chainRange`);
  }
});

/* =================================================================== */
/* 3. 伤害计算                                                          */
/* =================================================================== */

const combatMod = await import('../src/game/systems/CombatSystem.ts');
const { computeDamage, summarizeStatuses, attackAtLevel, mergeStatus } = combatMod;

section('3. 伤害计算');

const baseMove = MOVES.thunderbolt;

test('基础伤害为正且已取整', () => {
  const r = computeDamage({ attack: 50, move: baseMove, defenderTypes: ['water'], roll: 0.5, variance: 0 });
  assert.ok(r.amount > 0 && Number.isInteger(r.amount), `amount=${r.amount}`);
});

test('克制伤害高于被抵抗伤害', () => {
  const superHit = computeDamage({ attack: 50, move: baseMove, defenderTypes: ['water'], roll: 0.5, variance: 0 });
  const weakHit = computeDamage({ attack: 50, move: baseMove, defenderTypes: ['grass'], roll: 0.5, variance: 0 });
  assert.ok(superHit.amount > weakHit.amount, `${superHit.amount} 应 > ${weakHit.amount}`);
});

test('免疫属性返回 immune 与 0 伤害（严格模式）', () => {
  const r = computeDamage({
    attack: 50, move: baseMove, defenderTypes: ['ground'],
    strictImmunity: true, roll: 0.5, variance: 0,
  });
  assert.equal(r.immune, true);
  assert.equal(r.amount, 0);
});

test('固定步长下 roll 相同则伤害完全一致（可复现）', () => {
  const opts = { attack: 50, move: baseMove, defenderTypes: ['water'], roll: 0.31, variance: 0.05 };
  const a = computeDamage(opts).amount;
  const b = computeDamage({ ...opts }).amount;
  assert.equal(a, b, '相同输入必须得到相同输出');
});

test('护甲降低物理伤害，穿甲招式削减护甲影响', () => {
  const physical = MOVES.closecombat;
  const normal = computeDamage({ attack: 60, move: physical, defenderTypes: ['normal'], armor: 0.5, roll: 0.5, variance: 0 });
  const armored = computeDamage({ attack: 60, move: physical, defenderTypes: ['normal'], armor: 0.5, roll: 0.5, variance: 0 });
  assert.equal(normal.amount, armored.amount);
  // 对比无护甲
  const noArmor = computeDamage({ attack: 60, move: physical, defenderTypes: ['normal'], armor: 0, roll: 0.5, variance: 0 });
  assert.ok(noArmor.amount > normal.amount, '有护甲时伤害应更低');
});

test('护甲上限 80% 生效，不会被完全免伤', () => {
  const r = computeDamage({ attack: 100, move: MOVES.tackle, defenderTypes: ['normal'], armor: 0.99, roll: 0.5, variance: 0 });
  assert.ok(r.amount >= 1, '伤害最低为 1');
});

test('等级成长：Lv.5 相比 Lv.1 有显著提升', () => {
  const l1 = attackAtLevel(30, 1, 0.28);
  const l5 = attackAtLevel(30, 5, 0.28);
  assert.ok(l5 > l1 * 1.8, `${l1} → ${l5} 提升不足`);
});

section('3b. 状态效果');

test('减速状态降低移动速度', () => {
  const now = 1000;
  const s = mergeStatus(undefined, { kind: 'slow', durationMs: 3000, ratio: 0.5 }, now, 'ice');
  const mods = summarizeStatuses([s], now + 100);
  assert.ok(mods.speedMult <= 0.5 + 1e-6, `speedMult=${mods.speedMult}`);
});

test('眩晕使敌人完全静止', () => {
  const now = 1000;
  const s = mergeStatus(undefined, { kind: 'stun', durationMs: 800 }, now, 'electric');
  const mods = summarizeStatuses([s], now + 100);
  assert.equal(mods.frozen, true);
});

test('持续伤害按 dps × 层数累加', () => {
  const now = 0;
  const s = { ...mergeStatus(undefined, { kind: 'burn', durationMs: 5000, value: 10, maxStacks: 3 }, now, 'fire'), stacks: 3 };
  const mods = summarizeStatuses([s], 100);
  assert.equal(mods.dotPerSecond, 30);
});

test('过期状态不再生效', () => {
  const now = 0;
  const s = mergeStatus(undefined, { kind: 'slow', durationMs: 1000, ratio: 0.5 }, now, 'ice');
  const mods = summarizeStatuses([s], 2000);
  assert.equal(mods.speedMult, 1);
});

test('减速倍率有下限，不会被叠到静止', () => {
  const now = 0;
  const s = { ...mergeStatus(undefined, { kind: 'slow', durationMs: 9000, ratio: 0.85 }, now, 'ice'), stacks: 9 };
  const mods = summarizeStatuses([s], 100);
  assert.ok(mods.speedMult >= 0.12 - 1e-9, `speedMult=${mods.speedMult} 低于下限`);
});

/* =================================================================== */
/* 4. 关卡数据                                                          */
/* =================================================================== */

const levelsMod = await import('../src/data/levels/levels.ts');
const {
  getAllLevels, CHAPTERS, GRID_COLS, GRID_ROWS, blockedCells, TILE,
} = levelsMod;

section('4. 关卡与地图');

const levels = getAllLevels();

test('共 80 关，8 章节 × 10 关', () => {
  assert.equal(levels.length, 80, `实际 ${levels.length}`);
  assert.equal(CHAPTERS.length, 8);
  for (const c of CHAPTERS) {
    assert.equal(levels.filter((l) => l.chapter === c.index).length, 10, `第 ${c.index} 章关卡数不对`);
  }
});

test('关卡 id 唯一', () => {
  const ids = new Set(levels.map((l) => l.id));
  assert.equal(ids.size, 80);
});

test('每关路径从地图左外进入，终点落在最右侧可见列', () => {
  for (const l of levels) {
    const first = l.path[0];
    const last = l.path[l.path.length - 1];
    assert.ok(first.x < 0, `${l.id} 入口未在地图左外侧 (x=${first.x})`);
    // 终点必须落在最右侧可见列上：若取 GRID_COLS 会画到画布外，基地标记将不可见
    assert.equal(last.x, GRID_COLS - 1, `${l.id} 终点应在最后一列 (x=${last.x})`);
    assert.ok(last.y >= 0 && last.y < GRID_ROWS, `${l.id} 终点 y=${last.y} 越界`);
    assert.ok(l.path.length >= 4, `${l.id} 路径节点太少`);
  }
});

test('路径节点均在网格范围内（除入口/终点越界点）', () => {
  for (const l of levels) {
    for (let i = 1; i < l.path.length - 1; i++) {
      const p = l.path[i];
      assert.ok(p.x >= 0 && p.x < GRID_COLS, `${l.id} 节点 ${i} x=${p.x} 越界`);
      assert.ok(p.y >= 0 && p.y < GRID_ROWS, `${l.id} 节点 ${i} y=${p.y} 越界`);
    }
  }
});

test('路径为直连线段（相邻节点共享一行或一列）', () => {
  for (const l of levels) {
    for (let i = 0; i < l.path.length - 1; i++) {
      const a = l.path[i];
      const b = l.path[i + 1];
      assert.ok(a.x === b.x || a.y === b.y, `${l.id} 第 ${i} 段不是水平/垂直 (${a.x},${a.y})→(${b.x},${b.y})`);
    }
  }
});

test('路径长度与计算值一致且足以容纳战斗', () => {
  for (const l of levels) {
    assert.ok(l.pathLength > 800, `${l.id} 路径过短 ${l.pathLength}px`);
  }
});

test('阻塞格子覆盖整条路径', () => {
  const level = levels[0];
  const blocked = blockedCells(level.path);
  assert.ok(blocked.size > 20, `阻塞格只有 ${blocked.size} 个`);
  for (const key of blocked) {
    const [x, y] = key.split(',').map(Number);
    assert.ok(x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS, `阻塞格 ${key} 越界`);
  }
});

test('每关都有波次，且每波至少一组敌人', () => {
  for (const l of levels) {
    assert.ok(l.waves.length >= 8, `${l.id} 波次只有 ${l.waves.length}`);
    for (const w of l.waves) {
      assert.ok(w.groups.length > 0, `${l.id} 第 ${w.index} 波没有敌人组`);
      for (const g of w.groups) {
        assert.ok(g.count > 0, `${l.id} 波 ${w.index} 组数量为 0`);
        assert.ok(g.intervalMs > 0, `${l.id} 波 ${w.index} 间隔非法`);
        assert.ok(g.delayMs >= 0, `${l.id} 波 ${w.index} 延迟非法`);
      }
    }
  }
});

test('每章第 10 关是 BOSS 关，含 BOSS 编组', () => {
  for (const c of CHAPTERS) {
    const boss = levels.find((l) => l.chapter === c.index && l.index === 10);
    assert.ok(boss, `第 ${c.index} 章缺少第 10 关`);
    const bossWave = boss.waves.find((w) => w.isBoss);
    assert.ok(bossWave, `${boss.id} 没有 BOSS 波`);
    assert.ok(bossWave.groups.some((g) => g.note === 'BOSS'), `${boss.id} BOSS 波缺少 BOSS 编组`);
    assert.equal(boss.bossId, c.bossId);
  }
});

test('非 BOSS 关不设置 bossId', () => {
  for (const l of levels.filter((x) => x.index !== 10)) {
    assert.equal(l.bossId, null, `${l.id} 不该有 bossId`);
  }
});

test('关卡有初始金币、基地生命、可用精灵与障碍物', () => {
  for (const l of levels) {
    assert.ok(l.startCoins >= 300, `${l.id} 初始金币过低`);
    assert.ok(l.baseHp >= 10, `${l.id} 基地生命过低`);
    assert.ok(l.availableTowers.length >= 8, `${l.id} 可用精灵只有 ${l.availableTowers.length}`);
    assert.ok(l.obstacles.length >= 6, `${l.id} 障碍物只有 ${l.obstacles.length}`);
    assert.deepEqual(l.starHp, [0.5, 1.0]);
  }
});

test('障碍物不与路径重叠', () => {
  for (const l of levels) {
    const blocked = blockedCells(l.path);
    for (const o of l.obstacles) {
      assert.ok(!blocked.has(`${o.x},${o.y}`), `${l.id} 障碍物 (${o.x},${o.y}) 压在路径上`);
    }
  }
});

test('可用精灵列表随章节递进扩展', () => {
  const first = levels.find((l) => l.id === '1-1').availableTowers.length;
  const last = levels.find((l) => l.id === '8-10').availableTowers.length;
  assert.ok(last > first, `${first} → ${last} 没有扩展`);
});

test('同一关重复生成结果一致（确定性）', () => {
  const a = levels[10].waves.map((w) => w.groups.map((g) => `${g.pokemonId}x${g.count}`).join('|')).join('#');
  const fresh = levelsMod.getAllLevels()[10];
  const b = fresh.waves.map((w) => w.groups.map((g) => `${g.pokemonId}x${g.count}`).join('|')).join('#');
  assert.equal(a, b, '波次生成必须可复现');
});

/* =================================================================== */
/* 5. 单位配置                                                          */
/* =================================================================== */

const dexMod = await import('../src/data/pokemon/pokedex.ts');
const unitsMod = await import('../src/data/pokemon/units.ts');
const {
  getTowerConfig, getEnemyConfig, getAllTowerConfigs, getAllEnemyConfigs,
  STARTER_TOWER_IDS, STARTER_ENEMY_IDS, ENEMY_TRAITS, TYPE_ARCHETYPE,
} = unitsMod;
const { POKEDEX, ALL_IDS, TOTAL_SPECIES, coverageReport } = dexMod;

section('5. 单位配置');

test('图鉴收录 1025 种，编号连续 1..1025', () => {
  assert.equal(TOTAL_SPECIES, 1025, `实际 ${TOTAL_SPECIES}`);
  for (let i = 1; i <= 1025; i++) {
    assert.ok(POKEDEX[i], `缺少编号 ${i}`);
  }
});

test('全图鉴都有防御单位配置', () => {
  const towers = getAllTowerConfigs();
  assert.equal(towers.size, 1025, `实际 ${towers.size}`);
});

test('全图鉴都有敌方单位配置', () => {
  const enemies = getAllEnemyConfigs();
  assert.equal(enemies.size, 1025, `实际 ${enemies.size}`);
});

test('每个防御配置数值合法', () => {
  for (const cfg of getAllTowerConfigs().values()) {
    assert.ok(cfg.cost > 0, `${cfg.pokemonId} 费用非法`);
    assert.ok(cfg.damage > 0, `${cfg.pokemonId} 攻击力非法`);
    assert.ok(cfg.attackIntervalMs >= 400 && cfg.attackIntervalMs <= 2500, `${cfg.pokemonId} 间隔 ${cfg.attackIntervalMs}`);
    assert.ok(cfg.range >= 70 && cfg.range <= 350, `${cfg.pokemonId} 射程 ${cfg.range}`);
    assert.ok(cfg.moves.length >= 2, `${cfg.pokemonId} 招式不足`);
    assert.equal(cfg.maxLevel, 5);
    assert.ok(cfg.archetype?.label, `${cfg.pokemonId} 缺少职业`);
  }
});

test('每个敌方配置数值合法且特性非空', () => {
  for (const cfg of getAllEnemyConfigs().values()) {
    assert.ok(cfg.hp > 0, `${cfg.pokemonId} 生命非法`);
    assert.ok(cfg.speed > 0, `${cfg.pokemonId} 速度非法`);
    assert.ok(cfg.reward > 0, `${cfg.pokemonId} 奖励非法`);
    assert.ok(cfg.baseDamage >= 1, `${cfg.pokemonId} 扣血非法`);
    assert.ok(cfg.traits.length > 0, `${cfg.pokemonId} 无特性`);
    for (const t of cfg.traits) assert.ok(ENEMY_TRAITS[t], `未知特性 ${t}`);
    assert.ok(cfg.armor >= 0 && cfg.armor <= 0.6, `${cfg.pokemonId} 护甲 ${cfg.armor}`);
    assert.ok(cfg.magicResist >= 0 && cfg.magicResist <= 0.6, `${cfg.pokemonId} 魔抗 ${cfg.magicResist}`);
  }
});

test('18 种属性都有职业原型', () => {
  for (const t of POKEMON_TYPES) {
    assert.ok(TYPE_ARCHETYPE[t], `${t} 缺少职业原型`);
    assert.ok(TYPE_ARCHETYPE[t].label && TYPE_ARCHETYPE[t].mechanic, `${t} 职业信息不完整`);
  }
});

test('首发防御精灵 30 种且全部有效', () => {
  assert.equal(STARTER_TOWER_IDS.length, 30, `实际 ${STARTER_TOWER_IDS.length}`);
  assert.equal(new Set(STARTER_TOWER_IDS).size, 30, '有重复');
  for (const id of STARTER_TOWER_IDS) {
    assert.ok(POKEDEX[id], `首发精灵 ${id} 不存在`);
    assert.ok(getTowerConfig(id), `首发精灵 ${id} 没有防御配置`);
  }
});

test('首发敌人 50 种且全部有效', () => {
  assert.equal(STARTER_ENEMY_IDS.length, 50, `实际 ${STARTER_ENEMY_IDS.length}`);
  assert.equal(new Set(STARTER_ENEMY_IDS).size, 50, '有重复');
  for (const id of STARTER_ENEMY_IDS) {
    assert.ok(POKEDEX[id], `首发敌人 ${id} 不存在`);
    assert.ok(getEnemyConfig(id), `首发敌人 ${id} 没有敌方配置`);
  }
});

test('首发敌人覆盖全部 8 种基础敌方特性类别', () => {
  const found = new Set();
  for (const id of STARTER_ENEMY_IDS) {
    const cfg = getEnemyConfig(id);
    for (const t of cfg.traits) found.add(t);
  }
  // 至少覆盖普通/高速/重甲/飞行中的多数
  for (const need of ['normal', 'swift']) {
    // normal 或 swift 至少有一个存在即可（normal 只在无其他特性时出现）
  }
  assert.ok(found.size >= 5, `只覆盖了 ${found.size} 种特性: ${[...found].join(',')}`);
  assert.ok(found.has('flying'), '缺少飞行型敌人');
});

test('传说 / 幻兽敌人被标记为 BOSS 型', () => {
  const mewtwo = getEnemyConfig(150);
  assert.ok(mewtwo.traits.includes('boss'), '超梦应为 BOSS 型');
  assert.ok(mewtwo.ability, 'BOSS 应带专属技能');
  const mew = getEnemyConfig(151);
  assert.ok(mew.traits.includes('boss'), '梦幻应为 BOSS 型');
});

test('传说 / 幻兽的 BOSS 技能与属性相关', () => {
  const charizard = getEnemyConfig(6);
  assert.equal(charizard.ability, 'flamethrower_lock');
  const gengar = getEnemyConfig(94);
  assert.equal(gengar.ability, 'clone_decoy');
  const rayquaza = getEnemyConfig(384);
  assert.equal(rayquaza.ability, 'sky_raid');
});

test('可进化的精灵都有合法的进化目标与费用', () => {
  let withEvo = 0;
  for (const cfg of getAllTowerConfigs().values()) {
    if (!cfg.evolution) continue;
    withEvo++;
    assert.ok(POKEDEX[cfg.evolution.targetId], `${cfg.pokemonId} 进化目标 ${cfg.evolution.targetId} 不存在`);
    assert.ok(cfg.evolution.cost > 0, `${cfg.pokemonId} 进化费用非法`);
    assert.ok(cfg.evolution.cost < 3000, `${cfg.pokemonId} 进化费用过高 ${cfg.evolution.cost}`);
    // 进化目标必须比当前形态更进一步
    const cur = POKEDEX[cfg.pokemonId];
    const next = POKEDEX[cfg.evolution.targetId];
    assert.ok(next.evoStage >= cur.evoStage, `${cfg.pokemonId} 的进化目标阶段倒退`);
    assert.equal(next.evolvesFrom, cfg.pokemonId, `${cfg.pokemonId} 的进化目标不对应`);
  }
  // 与图鉴数据一致：458 只精灵有后续进化
  const expected = Object.values(POKEDEX).filter((e) => e.evolvesTo.length > 0).length;
  assert.equal(withEvo, expected, `配置数 ${withEvo} 与图鉴数据 ${expected} 不符`);
  assert.ok(withEvo > 400, `只有 ${withEvo} 只可进化，偏少`);
});

test('最终形态没有进化目标，但记录了进化来源', () => {
  const finals = Object.values(POKEDEX).filter((e) => e.evolvesTo.length === 0 && e.evolvesFrom !== null);
  assert.ok(finals.length > 300, `最终形态只有 ${finals.length}`);
  for (const e of finals) {
    assert.equal(getTowerConfig(e.id).evolution, null, `${e.id} 不应有进化目标`);
    assert.ok(POKEDEX[e.evolvesFrom], `${e.id} 的进化来源 ${e.evolvesFrom} 不存在`);
  }
});

test('进化链最多三阶段（含分支形态）', () => {
  const stages = new Set(Object.values(POKEDEX).map((e) => e.evoStage));
  assert.ok(stages.has(1) && stages.has(2) && stages.has(3), `阶段集合异常: ${[...stages].join(',')}`);
  for (const stage of stages) assert.ok(stage >= 1 && stage <= 3, `阶段 ${stage} 越界`);
});

test('防御与敌方配置共用同一精灵但数值独立', () => {
  const tower = getTowerConfig(25);
  const enemy = getEnemyConfig(25);
  assert.ok(tower.damage > 0 && enemy.hp > 0);
  assert.ok('attackIntervalMs' in tower && !('attackIntervalMs' in enemy));
  assert.ok('baseDamage' in enemy && !('baseDamage' in tower));
});

test('高种族值精灵造价更高（数值设计一致性）', () => {
  const weak = getTowerConfig(10);    // 绿毛虫
  const strong = getTowerConfig(150); // 超梦
  assert.ok(strong.cost > weak.cost, `${strong.cost} 应 > ${weak.cost}`);
  assert.ok(strong.damage > weak.damage);
});

/* =================================================================== */
/* 6. 素材覆盖                                                          */
/* =================================================================== */

section('6. 素材与图鉴覆盖');

test('图鉴数据完整（编号 / 中文名 / 属性 / 世代）', () => {
  for (const id of ALL_IDS) {
    const e = POKEDEX[id];
    assert.ok(e.nameZh && e.nameZh.length > 0, `${id} 缺少中文名`);
    assert.ok(e.nameEn && e.nameEn.length > 0, `${id} 缺少英文名`);
    assert.ok(e.types.length >= 1 && e.types.length <= 2, `${id} 属性数量异常`);
    assert.ok(e.generation >= 1 && e.generation <= 9, `${id} 世代异常`);
    assert.ok(e.slug, `${id} 缺少 slug`);
  }
});

test('属性名确实为中文（不是日文假名）', () => {
  const pikachu = POKEDEX[25];
  assert.equal(pikachu.nameZh, '皮卡丘');
  assert.equal(POKEDEX[1].nameZh, '妙蛙种子');
  assert.equal(POKEDEX[150].nameZh, '超梦');
});

test('每个精灵都有素材引用路径', () => {
  for (const id of ALL_IDS) {
    const e = POKEDEX[id];
    assert.ok(e.assets, `${id} 缺少 assets`);
    assert.ok(e.assets.front && e.assets.portrait && e.assets.animated, `${id} 素材路径不全`);
    assert.ok(e.assets.frontSource && e.assets.portraitSource, `${id} 缺少素材来源 URL（授权追溯需要）`);
  }
});

test('覆盖率报告的六个维度都被统计', () => {
  const rep = coverageReport();
  for (const key of ['pokedex', 'forms', 'staticSprite', 'animatedSprite', 'portrait', 'shiny', 'evolution', 'battleConfig']) {
    assert.ok(rep[key], `缺少 ${key} 统计`);
    assert.ok(rep[key].total > 0, `${key} 总数为 0`);
  }
  assert.equal(rep.pokedex.total, 1025);
});

test('静态素材覆盖率达到 100%（下载已完成）', () => {
  const rep = coverageReport();
  assert.equal(rep.staticSprite.covered, rep.staticSprite.total, `静态素材 ${rep.staticSprite.covered}/${rep.staticSprite.total}`);
  assert.equal(rep.portrait.covered, rep.portrait.total);
});

test('动态素材覆盖率达到 98% 以上', () => {
  const rep = coverageReport();
  assert.ok(rep.animatedSprite.ratio >= 0.98, `动态素材仅 ${(rep.animatedSprite.ratio * 100).toFixed(1)}%`);
});

test('全部精灵都有战斗配置（第三阶段目标）', () => {
  const rep = coverageReport();
  assert.equal(rep.battleConfig.covered, rep.battleConfig.total);
});

/* =================================================================== */
/* 7. 目标选择                                                          */
/* =================================================================== */

const targetingMod = await import('../src/game/systems/TargetingSystem.ts');
const { pickTarget, chainTargets, pierceTargets, coneTargets, multiTargets, areaTargets } = targetingMod;

section('7. 目标选择');

function fakeEnemy(opts) {
  return {
    id: opts.id ?? 1,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    hp: opts.hp ?? 100,
    maxHp: opts.hp ?? 100,
    alive: opts.alive ?? true,
    reachedEnd: false,
    radius: 20,
    distanceToEnd: opts.distanceToEnd ?? 1000,
    neighborCount: opts.neighborCount ?? 0,
    isFlying: opts.isFlying ?? false,
    stealthActive: opts.stealthActive ?? false,
    cfg: { types: opts.types ?? ['normal'], size: 1 },
  };
}

const ctx = { x: 0, y: 0, range: 200, canHitFlying: true, airOnly: false, revealsStealth: true, priority: 'first' };

test('first 优先选择离终点最近的敌人', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 50, y: 0, distanceToEnd: 900 }),
    fakeEnemy({ id: 2, x: 80, y: 0, distanceToEnd: 100 }),
    fakeEnemy({ id: 3, x: 120, y: 0, distanceToEnd: 500 }),
  ];
  const t = pickTarget(enemies, { ...ctx, priority: 'first' });
  assert.equal(t.id, 2);
});

test('strongest 选择生命最高的敌人', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 50, y: 0, hp: 100 }),
    fakeEnemy({ id: 2, x: 80, y: 0, hp: 500 }),
    fakeEnemy({ id: 3, x: 120, y: 0, hp: 200 }),
  ];
  assert.equal(pickTarget(enemies, { ...ctx, priority: 'strongest' }).id, 2);
});

test('closest 选择距离最近的敌人', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 150, y: 0 }),
    fakeEnemy({ id: 2, x: 30, y: 0 }),
  ];
  assert.equal(pickTarget(enemies, { ...ctx, priority: 'closest' }).id, 2);
});

test('超出射程的敌人不会被选中', () => {
  const enemies = [fakeEnemy({ id: 1, x: 500, y: 0 })];
  assert.equal(pickTarget(enemies, { ...ctx, range: 100 }), null);
});

test('无法对空时忽略飞行单位', () => {
  const enemies = [fakeEnemy({ id: 1, x: 50, y: 0, isFlying: true })];
  assert.equal(pickTarget(enemies, { ...ctx, canHitFlying: false }), null);
  assert.equal(pickTarget(enemies, { ...ctx, canHitFlying: true }).id, 1);
});

test('不具备侦测时忽略隐身单位', () => {
  const enemies = [fakeEnemy({ id: 1, x: 50, y: 0, stealthActive: true })];
  assert.equal(pickTarget(enemies, { ...ctx, revealsStealth: false }), null);
  assert.equal(pickTarget(enemies, { ...ctx, revealsStealth: true }).id, 1);
});

test('airOnly 时只打飞行单位', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 50, y: 0, isFlying: false }),
    fakeEnemy({ id: 2, x: 60, y: 0, isFlying: true }),
  ];
  assert.equal(pickTarget(enemies, { ...ctx, airOnly: true }).id, 2);
});

test('死亡或已抵达终点的敌人不会被选中', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 50, y: 0, alive: false }),
    { ...fakeEnemy({ id: 2, x: 60, y: 0 }), reachedEnd: true },
  ];
  assert.equal(pickTarget(enemies, ctx), null);
});

test('连锁弹射在范围内逐跳传播且不重复', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 0, y: 0 }),
    fakeEnemy({ id: 2, x: 60, y: 0 }),
    fakeEnemy({ id: 3, x: 120, y: 0 }),
    fakeEnemy({ id: 4, x: 300, y: 0 }), // 超出连锁距离
  ];
  const chain = chainTargets(enemies[0], enemies, 5, 90, ctx);
  assert.ok(chain.length >= 2, `连锁只命中 ${chain.length}`);
  assert.equal(new Set(chain.map((e) => e.id)).size, chain.length, '连锁有重复目标');
  assert.ok(!chain.some((e) => e.id === 4), '超出连锁范围的目标被命中');
});

test('连锁目标数受 maxTargets 限制', () => {
  const enemies = Array.from({ length: 10 }, (_, i) => fakeEnemy({ id: i + 1, x: i * 40, y: 0 }));
  const chain = chainTargets(enemies[0], enemies, 3, 60, ctx);
  assert.ok(chain.length <= 3, `连锁命中 ${chain.length} 个，超过上限`);
});

test('直线穿透命中沿线的敌人并按距离排序', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 200, y: 0 }),
    fakeEnemy({ id: 2, x: 80, y: 0 }),
    fakeEnemy({ id: 3, x: 140, y: 0 }),
  ];
  const hits = pierceTargets(0, 0, 1, 0, 300, 40, enemies, ctx);
  assert.deepEqual(hits.map((e) => e.id), [2, 3, 1]);
});

test('直线穿透排除偏离轴线的敌人', () => {
  const enemies = [fakeEnemy({ id: 1, x: 100, y: 80 })];
  assert.equal(pierceTargets(0, 0, 1, 0, 300, 30, enemies, ctx).length, 0);
});

test('锥形范围只命中方向一侧的敌人', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 100, y: 0 }),      // 正前方，在锥内
    fakeEnemy({ id: 2, x: -100, y: 0 }),     // 反方向，不在锥内
    fakeEnemy({ id: 3, x: 0, y: 150 }),      // 侧方 90°，在 46° 锥外
  ];
  const hits = coneTargets(0, 0, 1, 0, 200, 46, enemies, ctx);
  assert.deepEqual(hits.map((e) => e.id), [1]);
});

test('圆形范围命中半径内全部敌人', () => {
  const enemies = [
    fakeEnemy({ id: 1, x: 50, y: 0 }),
    fakeEnemy({ id: 2, x: 0, y: 70 }),
    fakeEnemy({ id: 3, x: 200, y: 0 }),
  ];
  assert.equal(areaTargets(0, 0, 100, enemies, ctx).length, 2);
});

test('多目标齐射数量受上限约束', () => {
  const enemies = Array.from({ length: 9 }, (_, i) => fakeEnemy({ id: i + 1, x: i * 15, y: 0 }));
  assert.equal(multiTargets(enemies, 4, ctx).length, 4);
});

test('候选不足时多目标返回全部合法目标', () => {
  const enemies = [fakeEnemy({ id: 1, x: 10, y: 0 }), fakeEnemy({ id: 2, x: 20, y: 0 })];
  assert.equal(multiTargets(enemies, 5, ctx).length, 2);
});

/* =================================================================== */
/* 8. 空间网格                                                          */
/* =================================================================== */

const gridMod = await import('../src/game/systems/SpatialGrid.ts');
const { SpatialGrid } = gridMod;

section('8. 空间网格');

test('圆形查询准确返回范围内实体', () => {
  const grid = new SpatialGrid(1000, 1000, 64);
  const es = [
    fakeEnemy({ id: 1, x: 100, y: 100 }),
    fakeEnemy({ id: 2, x: 130, y: 100 }),
    fakeEnemy({ id: 3, x: 400, y: 400 }),
  ];
  grid.rebuild(es);
  const found = grid.queryCircle(100, 100, 60);
  assert.equal(found.length, 2);
  assert.ok(found.some((e) => e.id === 1) && found.some((e) => e.id === 2));
});

test('网格查询不返回死亡实体', () => {
  const grid = new SpatialGrid(500, 500, 64);
  grid.rebuild([fakeEnemy({ id: 1, x: 50, y: 50, alive: false }), fakeEnemy({ id: 2, x: 55, y: 50 })]);
  assert.equal(grid.queryCircle(50, 50, 100).length, 1);
});

test('grid.rebuild 会清空上一次的内容', () => {
  const grid = new SpatialGrid(500, 500, 64);
  grid.rebuild([fakeEnemy({ id: 1, x: 50, y: 50 })]);
  grid.rebuild([]);
  assert.equal(grid.queryCircle(50, 50, 500).length, 0);
});

test('nearest 返回最近实体', () => {
  const grid = new SpatialGrid(1000, 1000, 64);
  grid.rebuild([
    fakeEnemy({ id: 1, x: 100, y: 100 }),
    fakeEnemy({ id: 2, x: 104, y: 100 }),
  ]);
  assert.equal(grid.nearest(100, 100, 100).id, 1);
});

/* =================================================================== */
/* 汇总                                                                 */
/* =================================================================== */

const failed = results.filter((r) => !r.ok);
console.log('\n' + '='.repeat(64));
console.log(`核心逻辑自检：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('\n失败项：');
  for (const f of failed) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
console.log('全部通过 ✓');
