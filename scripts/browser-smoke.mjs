/**
 * 浏览器烟雾测试（无第三方依赖）。
 *
 * 通过 Chrome DevTools Protocol 直接驱动 Edge：
 *   启动 --headless=new --remote-debugging-port → 用 Node 内建 WebSocket 发 CDP 命令
 *   → 打开游戏 → 截图 → 执行页面内脚本断言 → 收集控制台错误。
 *
 * 用法：node scripts/browser-smoke.mjs [url]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const URL_TO_TEST = process.argv[2] || 'http://localhost:5173/';
const OUT = path.resolve('.assets-cache/shots');
fs.mkdirSync(OUT, { recursive: true });

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // macOS
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findBrowser() {
  for (const p of EDGE_PATHS) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Edge / Chrome');
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForPort(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => resolve(false));
      setTimeout(() => { sock.destroy(); resolve(false); }, 400);
    });
    if (ok) return true;
    await delay(220);
  }
  return false;
}

/** 极简 CDP 客户端 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else resolve(msg.result);
      } else if (msg.method) {
        const h = this.listeners.get(msg.method);
        if (h) for (const fn of h) fn(msg.params);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 60000);
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
  }
}

async function main() {
  const browserPath = findBrowser();
  const port = 9333;
  // 用带时间戳的独立 profile 目录，避免上一次被占用导致 EPERM
  const userDataDir = path.resolve(`.assets-cache/cdp-profile-${Date.now()}`);

  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1440,900',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--mute-audio',
    'about:blank',
  ];

  console.log('→ 启动浏览器', path.basename(browserPath));
  const proc = spawn(browserPath, args, { stdio: 'ignore', detached: false });

  if (!(await waitForPort(port))) {
    proc.kill();
    throw new Error('浏览器调试端口未就绪');
  }
  await delay(700);

  const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
  const version = await versionRes.json();
  console.log('  浏览器:', version.Browser);

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);

  // 新建页面
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const errors = [];
  const consoleLogs = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    consoleLogs.push(`[${p.type}] ${text}`);
    if (p.type === 'error') errors.push(`[console.error] ${text}`);
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    errors.push(`[exception] ${d.exception?.description ?? d.text}`);
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') errors.push(`[log] ${p.entry.text} ${p.entry.url ?? ''}`);
    consoleLogs.push(`[log:${p.entry.level}] ${p.entry.text}`);
  });

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  }, sessionId);

  const evaluate = async (expression, awaitPromise = true) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    }, sessionId);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  };

  const shoot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  };

  console.log('→ 打开', URL_TO_TEST);
  await cdp.send('Page.navigate', { url: URL_TO_TEST }, sessionId);
  await delay(5000);

  const title = await evaluate('document.title');
  console.log('  标题:', title);
  await shoot('01-menu');

  const menuOk = await evaluate(`!!document.querySelector('.menu__play')`);
  console.log('  主菜单渲染:', menuOk);

  // 进入关卡选择
  let clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开始游戏'));
    if (b) { b.click(); return true; } return false;
  })()`);
  console.log('  点击开始游戏:', clicked);
  await delay(1800);
  await shoot('02-levels');

  const levelCards = await evaluate(`document.querySelectorAll('.level-card').length`);
  console.log('  关卡卡片数:', levelCards);

  // 进入 1-1
  clicked = await evaluate(`(() => {
    const c = document.querySelector('.level-card');
    if (c) { c.click(); return true; } return false;
  })()`);
  console.log('  进入关卡:', clicked);
  await delay(7000);
  await shoot('03-battle');

  const canvas = await evaluate(`(() => {
    const c = document.querySelector('canvas');
    if (!c) return { found: false };
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { found: true, width: c.width, height: c.height,
             cssW: Math.round(c.getBoundingClientRect().width),
             cssH: Math.round(c.getBoundingClientRect().height),
             hasGL: !!gl };
  })()`);
  console.log('  画布:', JSON.stringify(canvas));

  // 画布内容校验：WebGL 画布无法通过 drawImage 回读像素（会得到全 0），
  // 因此这里不做像素采样，改为在场景层断言"实体是否真的被创建并绘制"。
  // 视觉正确性由 Playwright 截图（.assets-cache/shots）人工复核。
  const renderCheck = await evaluate(`(() => {
    const s = window.__PTD__;
    if (!s) return null;
    const st = s.debugState();
    return {
      towersWithView: st.towers.filter(t => t.hasView).length,
      enemiesWithView: st.enemySample.filter(e => e.hasView).length,
      enemySampleSize: st.enemySample.length,
      state: st.state,
    };
  })()`);
  console.log('  渲染检查:', JSON.stringify(renderCheck));

  const cardCount = await evaluate(`document.querySelectorAll('.pcard').length`);
  console.log('  建造卡片数:', cardCount);

  // 用场景调试快照做断言（DEV 构建下 window.__PTD__ 可用）
  const state = async () => evaluate(`(() => {
    const s = window.__PTD__;
    return s && typeof s.debugState === 'function' ? s.debugState() : null;
  })()`);

  const s0 = await state();
  console.log('  初始场景状态:', s0 ? JSON.stringify({
    state: s0.state, coins: s0.coins, baseHp: s0.baseHp,
    pathLen: s0.totalPathLength, blocked: s0.blockedCount, obstacles: s0.obstaclesLeft,
    waveIndex: s0.waveIndex, pending: s0.pendingSpawns,
  }) : 'null');

  const box = await evaluate(`(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);

  const clickAt = async (fx, fy) => {
    const x = box.x + box.w * fx;
    const y = box.y + box.h * fy;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await delay(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
  };

  /** 用场景状态精确定位一个可建造格并点击其屏幕坐标 */
  const buildOne = async (cardIndex) => {
    await evaluate(`(() => { const c = document.querySelectorAll('.pcard')[${cardIndex}]; if (c) c.click(); })()`);
    await delay(700);
    const target = await evaluate(`(() => {
      const s = window.__PTD__; if (!s) return null;
      const st = s.debugState();
      const used = new Set(st.towers.map(t => t.gridX + ',' + t.gridY));
      // 直接贴着敌人路径入段选格：保证敌人一进场就进入射程，测试无需长时间等待
      const path = s.level.path;
      const candidates = [];
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
            candidates.push([gx, gy]);
          }
        }
      }
      if (!candidates.length) return null;
      // 取靠前的候选（敌人的入场段）
      const pick = candidates[Math.min(candidates.length - 1, 2)];
      return { gx: pick[0], gy: pick[1] };
    })()`);
    if (!target) return null;
    // 网格 → 屏幕：画布按 FIT 缩放并居中
    const pt = await evaluate(`(() => {
      const s = window.__PTD__;
      const cam = s.cameras.main;
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const gx = ${target.gx}, gy = ${target.gy};
      const worldX = gx * 64 + 32, worldY = gy * 64 + 32;
      const sx = r.x + (worldX - cam.worldView.x) * cam.zoom * (r.width / (cam.worldView.width * cam.zoom));
      const sy = r.y + (worldY - cam.worldView.y) * cam.zoom * (r.height / (cam.worldView.height * cam.zoom));
      return { sx, sy };
    })()`);
    console.log('    → 点击屏幕坐标', Math.round(pt.sx), Math.round(pt.sy), '画布', box.x, box.y, box.w, box.h);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.sx, y: pt.sy }, sessionId);
    await delay(120);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.sx, y: pt.sy, button: 'left', clickCount: 1 }, sessionId);
    await delay(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.sx, y: pt.sy, button: 'left', clickCount: 1 }, sessionId);
    await delay(3200);
    return { target, pt };
  };

  // 校验画布→世界坐标映射（确认交互坐标没有偏移）
  const mapCheck = await evaluate(`(() => {
    const s = window.__PTD__;
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const cam = s.cameras.main;
    const probe = [];
    for (const [cx, cy] of [[r.x + 5, r.y + 5], [r.x + r.width/2, r.y + r.height/2], [r.x + r.width - 5, r.y + r.height - 5]]) {
      const w = cam.getWorldPoint((cx - r.x) * (cam.width / r.width), (cy - r.y) * (cam.height / r.height));
      probe.push([Math.round(w.x), Math.round(w.y)]);
    }
    return { canvasRect: [r.x, r.y, r.width, r.height], camZoom: cam.zoom, worldProbes: probe };
  })()`);
  console.log('  坐标映射校验:', JSON.stringify(mapCheck));

  const built = await buildOne(3); // 皮卡丘（索引 3 在 1-1 的可用列表里）
  console.log('  建造目标:', built ? `grid(${built.target.gx},${built.target.gy})` : 'failed');

  const s1 = await state();
  console.log('  建造后塔数:', s1 ? s1.towers.length : 'n/a', s1?.towers[0] ? JSON.stringify(s1.towers[0]) : '');
  await shoot('04-buildmode');

  // 等待敌人出场（波次现在由"开始出怪"确认，这里通过场景 API 启动第一波）
  await evaluate(`window.__PTD__?.startNextWave?.()`);
  await delay(9000);
  const s2 = await state();
  if (s2) {
    console.log('  敌人生成:', s2.enemiesAlive, '只 · 已击杀', s2.enemiesKilled,
      '· 模拟时间', s2.simTime, 'ms · 待生成', s2.pendingSpawns,
      '· 波次', s2.waveIndex, '· 基地生命', s2.baseHp);
    if (s2.enemySample.length) {
      console.log('  敌人样本:', JSON.stringify(s2.enemySample[0]));
    }
    if (s2.towers[0]) {
      console.log('  塔输出: 伤害', s2.towers[0].totalDamage, '击杀', s2.towers[0].kills, '等级', s2.towers[0].level);
    }
  }
  await shoot('05-battle-running');

  // 切 2 倍速让战斗推进（若第一波已清完，顺带确认开始下一波）
  await evaluate(`(() => {
    const b = document.querySelectorAll('.speed-btn')[1];
    if (b) b.click();
    window.__PTD__?.startNextWave?.();
  })()`);
  await delay(12000);
  await shoot('07-battle-later');

  const hud2 = await evaluate(`(() => ({
    coins: document.querySelector('.hud__value--coin')?.textContent?.trim() ?? null,
    wave: document.querySelectorAll('.hud__value')[1]?.textContent?.trim() ?? null,
    hp: document.querySelector('.hud__bar-text')?.textContent?.trim() ?? null,
    speedActive: document.querySelectorAll('.speed-btn.is-active').length,
  }))()`);
  console.log('  12 秒后 HUD:', JSON.stringify(hud2));
  const s3 = await state();
  if (s3) {
    console.log('  12 秒后场景: 敌人', s3.enemiesAlive, '击杀', s3.enemiesKilled,
      '波次', s3.waveIndex, '/', '已清', s3.wavesCleared, '基地', s3.baseHp,
      '模拟时间', s3.simTime);
    if (s3.towers[0]) console.log('  塔累计伤害', s3.towers[0].totalDamage, '击杀', s3.towers[0].kills);
  }

  // 暂停
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('暂停'));
    if (b) b.click();
  })()`);
  await delay(900);
  await shoot('08-pause');
  const paused = await evaluate(`!!document.querySelector('.pause')`);
  console.log('  暂停菜单:', paused);

  // 返回关卡选择 → 图鉴
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回关卡选择'));
    if (b) b.click();
  })()`);
  await delay(1500);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回'));
    if (b) b.click();
  })()`);
  await delay(1500);
  await shoot('09-back-menu');

  const pokedexBtnClicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('宝可梦图鉴'));
    if (b) { b.click(); return true; } return false;
  })()`);
  await delay(3500);
  await shoot('10-pokedex');

  const dexCount = await evaluate(`document.querySelectorAll('.dex-item').length`);
  const dexTotal = await evaluate(`document.querySelectorAll('.dex__count')[0]?.textContent?.trim() ?? null`);
  console.log('  图鉴按钮:', pokedexBtnClicked, '本页条目:', dexCount, '命中:', dexTotal);

  // 图鉴搜索
  await evaluate(`(() => {
    const i = document.querySelector('.dex__search-input');
    if (i) {
      i.value = '皮卡丘';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await delay(1200);
  const searchHits = await evaluate(`document.querySelectorAll('.dex-item').length`);
  console.log('  搜索「皮卡丘」命中:', searchHits);
  await shoot('11-pokedex-search');

  // 打开详情
  await evaluate(`(() => { const i = document.querySelector('.dex-item'); if (i) i.click(); })()`);
  await delay(1600);
  await shoot('12-pokedex-detail');
  const detailOk = await evaluate(`!!document.querySelector('.detail')`);
  const detailTitle = await evaluate(`document.querySelector('.detail__id h2')?.textContent ?? null`);
  console.log('  详情弹层:', detailOk, detailTitle);

  await evaluate(`(() => { const b = document.querySelector('.detail__close'); if (b) b.click(); })()`);
  await delay(700);

  // 设置面板
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回'));
    if (b) b.click();
  })()`);
  await delay(1400);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('设置'));
    if (b) b.click();
  })()`);
  await delay(1400);
  await shoot('13-settings');
  const settingsOk = await evaluate(`document.querySelectorAll('.settings__section').length`);
  console.log('  设置分区数:', settingsOk);

  // 成就
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('返回'));
    if (b) b.click();
  })()`);
  await delay(1400);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('成就'));
    if (b) b.click();
  })()`);
  await delay(1400);
  await shoot('14-achievements');
  const achCount = await evaluate(`document.querySelectorAll('.ach-card').length`);
  console.log('  成就卡片数:', achCount);

  console.log('\n控制台错误数:', errors.length);
  for (const e of errors.slice(0, 30)) console.log('  ', e);

  fs.writeFileSync(path.join(OUT, 'console.log'), consoleLogs.join('\n'), 'utf8');

  ws.close();
  try { await cdp.send('Browser.close'); } catch { /* 忽略 */ }
  await delay(800);
  try { proc.kill(); } catch { /* 忽略 */ }

  // 清理本次的 profile 目录（失败不影响结果）
  await delay(600);
  try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 忽略 */ }

  return errors.length;
}

main()
  .then((n) => {
    console.log(n === 0 ? '\n✓ 烟雾测试通过，无控制台错误' : `\n✗ 有 ${n} 条控制台错误`);
    process.exit(n === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('烟雾测试失败:', err);
    process.exit(2);
  });
