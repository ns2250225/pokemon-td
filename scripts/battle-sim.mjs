/**
 * 完整战斗仿真测试 —— 验证核心循环能真正跑完并产出结算（PRD 8.4 / 8.5）。
 *
 * 做法：在浏览器里进入关卡，用场景 API 直接放置若干防御塔，
 * 然后以 3 倍速 + 手动多次固定步进推进模拟，直到出现胜利/失败。
 *
 * 只断言"结算发生且数据合理"，不预设必须胜利——失败路径同样是核心功能。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const URL_TO_TEST = process.argv[2] || 'http://127.0.0.1:5173/';
const LEVEL = process.argv[3] || '1-1';
const OUT = path.resolve('.assets-cache/shots');

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((res) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); res(true); });
      s.once('error', () => res(false));
      setTimeout(() => { s.destroy(); res(false); }, 300);
    });
    if (ok) return true;
    await delay(220);
  }
  return false;
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else if (m.method) {
        for (const fn of this.listeners.get(m.method) ?? []) fn(m.params);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }
      }, 180000);
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
  }
}

const browserPath = CANDIDATES.find((p) => fs.existsSync(p));
if (!browserPath) throw new Error('未找到浏览器');

const port = 9366;
const userDataDir = path.resolve(`.assets-cache/sim-profile-${Date.now()}`);
const proc = spawn(browserPath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--disable-extensions', '--window-size=1440,900',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--mute-audio',
  'about:blank',
], { stdio: 'ignore' });

await waitForPort(port);
await delay(700);

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const cdp = new CDP(ws);

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

const errors = [];
cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
cdp.on('Runtime.consoleAPICalled', (p) => {
  const text = (p.args ?? []).map((x) => x.value ?? x.description ?? x.type).join(' ');
  if (p.type === 'error') errors.push(`[console.error] ${text}`);
  else console.log(`   [page:${p.type}] ${text}`);
});
cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push(p.entry.text); });

await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('Log.enable', {}, sessionId);
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

const evaluate = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const shoot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
};

console.log(`→ 打开 ${URL_TO_TEST}，目标关卡 ${LEVEL}`);
await cdp.send('Page.navigate', { url: URL_TO_TEST }, sessionId);
await delay(4500);

// 直接调用 App 暴露的入口：通过主菜单 → 关卡选择 → 指定关卡
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('开始游戏')); if(b) b.click(); })()`);
await delay(1500);
await evaluate(`(() => {
  const cards=[...document.querySelectorAll('.level-card')];
  const target=${JSON.stringify(LEVEL)};
  const [ch, idx] = target.split('-').map(Number);
  // 章节标签先切到目标章节
  const tabs=[...document.querySelectorAll('.chapter-tab')];
  if (tabs[ch-1]) tabs[ch-1].click();
  return true;
})()`);
await delay(900);
const entered = await evaluate(`(() => {
  const target=${JSON.stringify(LEVEL)};
  const [ch, idx] = target.split('-').map(Number);
  const cards=[...document.querySelectorAll('.level-card')];
  if (cards[idx-1]) { cards[idx-1].click(); return true; }
  return false;
})()`);
console.log('  进入关卡:', entered);
// 关卡按顺序解锁，测试指定关卡时需要先补齐前置进度。
// 这是测试脚手架行为，不是游戏逻辑——直接标记前置关卡已通关。
const unlocked = await evaluate(`(() => {
  const target = ${JSON.stringify(LEVEL)};
  const [ch, idx] = target.split('-').map(Number);
  const store = window.__PTD_PROGRESS__;
  if (!store) return 'no-store';
  for (let c = 1; c <= ch; c++) {
    for (let i = 1; i <= 10; i++) {
      if (c === ch && i >= idx) break;
      store.clearLevel(c + '-' + i);
    }
  }
  return store.isLevelUnlocked(target);
})()`);
console.log('  关卡已解锁:', unlocked);
await delay(600);

// 重新进入关卡选择（进度变化后需要重渲染）
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('返回')); if(b) b.click(); })()`);
await delay(900);
await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('开始游戏')); if(b) b.click(); })()`);
await delay(1200);
await evaluate(`(() => { const tabs=[...document.querySelectorAll('.chapter-tab')]; if(tabs[${Number(LEVEL.split('-')[0])-1}]) tabs[${Number(LEVEL.split('-')[0])-1}].click(); })()`);
await delay(900);
await evaluate(`(() => { const cards=[...document.querySelectorAll('.level-card')]; const i=${Number(LEVEL.split('-')[1])-1}; if(cards[i]) cards[i].click(); })()`);
await delay(6500);

const hasScene = await evaluate(`!!window.__PTD__`);
console.log('  场景就绪:', hasScene);
if (!hasScene) { console.log('✗ 场景未就绪，中止'); process.exit(2); }

// 放置防御塔。
// 目的：验证"胜利 → 结算 → 星级 → 存档"这条完整链路，因此这里直接给足金币，
// 把重点放在机制正确性上；关卡数值平衡由 test:logic 的数据断言单独覆盖。
const buildResult = await evaluate(`(async () => {
  const s = window.__PTD__;
  const ids = s.level.availableTowers;

  // 沿路径收集所有可建造格（按路径顺序），保证防御沿全程铺开而非挤在入口
  const collect = () => {
    const used = new Set(s.towers.map(t => t.gridX + ',' + t.gridY));
    const out = [];
    const path = s.level.path;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let k = 0; k <= steps; k++) {
        const px = Math.round(a.x + (b.x - a.x) * k / steps);
        const py = Math.round(a.y + (b.y - a.y) * k / steps);
        for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const gx = px + dx, gy = py + dy;
          if (gx < 0 || gy < 0 || gx > 22 || gy > 13) continue;
          const key = gx + ',' + gy;
          if (s.blocked.has(key) || used.has(key)) continue;
          used.add(key);
          out.push([gx, gy]);
        }
      }
    }
    return out;
  };

  s.coins = 20000;           // 测试用：跳过经济积累，直接验证战斗与结算
  s.emitEconomy();

  const cands = collect();
  const want = 22;
  const placed = [];
  for (let i = 0; i < want; i++) {
    const c = cands[Math.floor(i * cands.length / want)];
    if (!c) break;
    const id = ids[i % ids.length];
    if (await s.placeTowerAt(c[0], c[1], id)) placed.push({ gx: c[0], gy: c[1], id });
  }

  // 尽量升级（无金币压力）
  let upgraded = 0;
  for (let round = 0; round < 4; round++) {
    for (const t of [...s.towers]) { if (s.tryUpgrade(t)) upgraded++; }
  }

  return { placed: placed.length, upgraded, towers: s.towers.length, coins: s.coins };
})()`);
console.log('  建塔:', JSON.stringify(buildResult));
await shoot(`sim-${LEVEL}-towers`);

// 用确定性快进推进整关：模拟与渲染解耦，结果与逐帧运行一致
let final = null;
const ROUNDS = 40;
const STEPS_PER_ROUND = 900;
for (let r = 0; r < ROUNDS; r++) {
  const ff = await evaluate(`(() => {
    const s = window.__PTD__;
    const before = s.debugState().state;
    const res = s.debugFastForward(${STEPS_PER_ROUND});
    const d = s.debugState();
    return {
      before, ...res,
      waveIndex: d.waveIndex, wavesCleared: d.wavesCleared,
      enemiesAlive: d.enemiesAlive, killed: d.enemiesKilled,
      baseHp: d.baseHp, coins: d.coins, obstaclesLeft: d.obstaclesLeft,
      totalDamage: d.towers.reduce((a,t)=>a+t.totalDamage,0),
      towers: d.towers.length,
      enemyDetail: d.enemySample.map(e => e.name + ' ' + Math.round(e.hp) + '/' + e.maxHp + ' st:' + e.statuses).join(' | '),
      aliveHpSum: d.enemySample.reduce((a,e)=>a+Math.max(0,e.hp),0),
      aliveMaxSum: d.enemySample.reduce((a,e)=>a+e.maxHp,0),
      towerDetail: d.towers.slice(0,6).map(t => '#' + t.uid + 'L' + t.level + ' ' + t.totalDamage + '伤/' + t.kills + '杀').join(' '),
      avgPerKill: d.enemiesKilled ? Math.round(d.towers.reduce((a,t)=>a+t.totalDamage,0)/d.enemiesKilled) : 0,
    };
  })()`);
  console.log(`   [${r}] t=${ff.simTime}ms 波${ff.waveIndex} 场上${ff.enemiesAlive} 击杀${ff.killed} 基地${ff.baseHp} 输出${ff.totalDamage} 均伤/杀${ff.avgPerKill} 场上血${ff.aliveHpSum}/${ff.aliveMaxSum}`);
  console.log(`        敌: ${ff.enemyDetail}`);
  console.log(`        塔: ${ff.towerDetail}`);
  if (ff.state === 'won' || ff.state === 'lost') { final = ff; break; }
  // 让出主线程，使 Phaser 处理补间/粒子回收，避免对象堆积
  await delay(250);
}

// finish() 用 scene.time.delayedCall(700) 延迟派发结算事件，需要等场景走完这段时间
await delay(3000);
await shoot(`sim-${LEVEL}-end`);

// 读取结算面板
const resultPanel = await evaluate(`(() => {
  const el = document.querySelector('.result');
  if (!el) return null;
  const stars = [...document.querySelectorAll('.result-star')].filter(s => s.classList.contains('is-on')).length;
  const stats = [...document.querySelectorAll('.rstat')].map(r => ({
    label: r.querySelector('.rstat__label')?.textContent?.trim(),
    value: r.querySelector('strong')?.textContent?.trim(),
  }));
  return { title: el.querySelector('h2')?.textContent?.trim(), stars, stats, isWin: el.classList.contains('is-win') };
})()`);
console.log('  结算面板:', JSON.stringify(resultPanel));
const bossEvents = await evaluate(`(() => {
  const log = window.__PTD_BUS__?.log ?? [];
  const counts = {};
  for (const e of log) counts[e] = (counts[e] ?? 0) + 1;
  return counts;
})()`);
console.log('  事件统计:', JSON.stringify(bossEvents));

const finishCount = await evaluate(`(() => (window.__PTD_BUS__?.log ?? []).filter(e => e === 'battle:finished').length)()`);

const busProbe = await evaluate(`(() => {
  const el = document.querySelector('.battle');
  return {
    hasBattleRoot: !!el,
    resultEls: document.querySelectorAll('.result').length,
    overlayEls: document.querySelectorAll('.overlay').length,
    sceneState: window.__PTD__ ? window.__PTD__.debugState().state : null,
    // 事件总线是否还有 battle:finished 的订阅者
    listeners: (() => {
      try { return typeof window.__PTD__.__busProbe === 'function' ? window.__PTD__.__busProbe() : null; } catch (e) { return String(e); }
    })(),
  };
})()`);
console.log('  DOM 探针:', JSON.stringify(busProbe));

// 存档是否写入
const saved = await evaluate(`(async () => {
  try {
    const dbs = await indexedDB.databases();
    return dbs.map(d => d.name);
  } catch (e) { return String(e); }
})()`);
console.log('  IndexedDB:', JSON.stringify(saved));

console.log('\n最终场景:', JSON.stringify(final));
console.log('控制台错误:', errors.length);
for (const e of errors.slice(0, 10)) console.log('  ', e);

ws.close();
try { await cdp.send('Browser.close'); } catch { /* 忽略 */ }
await delay(800);
try { proc.kill(); } catch { /* 忽略 */ }
await delay(600);
try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 忽略 */ }

const ok = final !== null && resultPanel !== null && errors.length === 0 && final.killed > 0;
console.log(ok ? '\n✓ 完整战斗流程通过' : '\n✗ 战斗流程未完成或存在错误');
process.exit(ok ? 0 : 1);
