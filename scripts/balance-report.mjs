/**
 * 关卡数值体检 —— 在 Node 中直接读取游戏数据，输出某关的敌我数值对比。
 *
 * 用法：node scripts/balance-report.mjs 1-1
 */
import { getLevel, getAllLevels } from '../src/data/levels/levels.ts';
import { getTowerConfig, getEnemyConfig, STARTER_TOWER_IDS } from '../src/data/pokemon/units.ts';
import { typeMultiplier } from '../src/data/balance/typeChart.ts';
import { MOVES } from '../src/data/moves/moves.ts';

const levelId = process.argv[2] || '1-1';
const level = getLevel(levelId);
if (!level) {
  console.error(`关卡不存在: ${levelId}`);
  process.exit(1);
}

console.log(`\n===== 关卡 ${level.id}（${level.name}）=====`);
console.log(`初始金币: ${level.startCoins}  基地生命: ${level.baseHp}  波数: ${level.waves.length}`);
console.log(`可用防御: ${level.availableTowers.map((id) => getTowerConfig(id)?.nameZh).join('、')}`);

/* ---------------- 敌方波次 ---------------- */
console.log('\n----- 波次构成 -----');
let totalEnemies = 0;
let totalHp = 0;
let totalReward = 0;
const enemyHpMap = new Map();
for (const wave of level.waves) {
  let waveEnemies = 0;
  const parts = [];
  for (const g of wave.wave?.groups ?? wave.groups) {
    const cfg = getEnemyConfig(g.pokemonId, 1);
    if (!cfg) continue;
    // 与 WaveSystem.spawnFrom 相同的缩放
    const difficulty = level.rules.enemyHp * (1 + (level.chapter - 1) * 0.12);
    const hp = Math.round(cfg.hp * difficulty);
    const reward = Math.round(cfg.reward * (1 + (level.chapter - 1) * 0.08));
    waveEnemies += g.count;
    totalHp += hp * g.count;
    totalReward += reward * g.count;
    enemyHpMap.set(g.pokemonId, hp);
    parts.push(`${cfg.nameZh}×${g.count}(hp${hp})`);
  }
  totalEnemies += waveEnemies;
  console.log(`  波${wave.index + 1}${wave.isBoss ? '(BOSS)' : ''}: 共${waveEnemies}只  ${parts.join(' + ')}`);
}
console.log(`总计: ${totalEnemies} 只敌人, 总血量 ${totalHp}, 击杀总收入 ${totalReward}`);

/* ---------------- 敌方个体 ---------------- */
console.log('\n----- 敌人个体属性（按章节规则缩放后）-----');
const difficulty = level.rules.enemyHp * (1 + (level.chapter - 1) * 0.12);
const speedScale = level.rules.enemySpeed;
const seen = new Set();
for (const wave of level.waves) {
  for (const g of wave.groups) {
    if (seen.has(g.pokemonId)) continue;
    seen.add(g.pokemonId);
    const cfg = getEnemyConfig(g.pokemonId, 1);
    if (!cfg) continue;
    const hp = Math.round(cfg.hp * difficulty);
    const speed = Math.round(cfg.speed * speedScale);
    console.log(`  ${cfg.nameZh}: hp=${hp} 速度=${speed}px/s 护甲=${cfg.armor.toFixed(2)} 魔抗=${cfg.magicResist.toFixed(2)} 奖励=${cfg.reward} 特性=[${cfg.traits.join(',')}]`);
  }
}

/* ---------------- 我方防御 ---------------- */
console.log('\n----- 防御塔属性（Lv.1，对波次敌人的平均实际 DPS）-----');
const enemyList = [...seen].map((id) => getEnemyConfig(id, 1)).filter(Boolean);
for (const id of level.availableTowers) {
  const t = getTowerConfig(id);
  if (!t) continue;
  const move = t.moves[0].move;
  // 单体招式对每种敌人的实际伤害 → 时间加权平均 DPS
  let weightedDps = 0;
  let totalWeight = 0;
  const detail = [];
  for (const e of enemyList) {
    const mult = typeMultiplier(move.type, e.types);
    const resist = move.category === 'physical' ? e.armor : e.magicResist;
    const dmg = t.damage * move.damageMultiplier * mult * (1 - resist);
    const dps = dmg / (t.attackIntervalMs / 1000);
    weightedDps += dps;
    totalWeight++;
    detail.push(`${e.nameZh}:${Math.round(dmg)}伤`);
  }
  const avgDps = weightedDps / Math.max(1, totalWeight);
  console.log(`  ${t.nameZh}(#${id}) 费用${t.cost} 攻${t.damage} 间隔${t.attackIntervalMs}ms 射程${t.range} 招式[${move.name}] 平均DPS=${avgDps.toFixed(1)}`);
}

/* ---------------- 经济测算 ---------------- */
console.log('\n----- 经济测算 -----');
let waveBonusTotal = 0;
for (const w of level.waves) waveBonusTotal += w.bonus;
console.log(`  波次奖励合计: ${waveBonusTotal}  击杀奖励合计: ${totalReward}  初始: ${level.startCoins}`);
console.log(`  全关可支配金币约: ${level.startCoins + waveBonusTotal + totalReward}`);
console.log(`  基地生命 ${level.baseHp}，每漏 1 只普通怪扣 1 点`);
