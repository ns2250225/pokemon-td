/** Map art and interaction checks using Edge / Chrome's built-in CDP. No dependencies. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const gameUrl = process.argv.find((arg) => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:5173/';
const forceCanvas = process.argv.includes('--canvas');
const lifecycleOnly = process.argv.includes('--lifecycle-only');
const origin = new URL(gameUrl).origin;
const cache = path.resolve('.assets-cache');
const out = path.join(cache, 'shots', 'maps', forceCanvas ? 'canvas' : 'webgl', ...(lifecycleOnly ? ['lifecycle'] : []));
const themes = ['forest', 'beach', 'volcano', 'snow', 'manor', 'desert', 'sky', 'champion'];
const scenarios = [
  ...themes.map((theme, chapter) => ({ theme, chapter, level: 1 })),
  { theme: 'forest', chapter: 0, level: 10 },
  { theme: 'champion', chapter: 7, level: 10 },
];
const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((file) => fs.existsSync(file));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { url: gameUrl, renderer: forceCanvas ? 'Canvas' : 'WebGL', lifecycleOnly, checks: [], maps: [], errors: [], assetErrors: [], screenshots: [] };
const responses = new Map();
fs.mkdirSync(out, { recursive: true });

function check(ok, description) {
  report.checks.push({ ok: !!ok, description });
  console.log(`${ok ? '✓' : '✗'} ${description}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, method === 'Page.navigate' ? 60000 : 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
}

async function main() {
  if (!browser) throw new Error('Edge / Chrome was not found.');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const profile = fs.mkdtempSync(path.join(cache, 'map-smoke-profile-'));
  const proc = spawn(browser, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1440,900',
    ...(forceCanvas ? ['--disable-webgl', '--disable-gpu'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']),
    '--disable-gpu-sandbox', '--mute-audio', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserErrors = '';
  proc.stderr.on('data', (data) => { browserErrors = (browserErrors + data).slice(-8000); });
  proc.on('error', (error) => { browserErrors += `\n${error.message}`; });
  let cdp;
  let ws;

  try {
    let version;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
      catch { await delay(250); }
      if (proc.exitCode !== null && proc.exitCode !== 0) break;
    }
    if (!version) throw new Error(`Browser debugging port did not become ready. Exit: ${proc.exitCode}. ${browserErrors}`);
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    cdp = new CDP(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => cdp.send(method, params, sessionId);
    const requests = new Map();
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: error }) => {
      report.errors.push(error.exception?.description || error.text);
    });
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') report.errors.push(args.map((arg) => arg.value ?? arg.description).join(' '));
    });
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error') report.errors.push(`${entry.text} ${entry.url || ''}`.trim());
    });
    cdp.on('Network.requestWillBeSent', ({ requestId, request }) => requests.set(requestId, request.url));
    cdp.on('Network.responseReceived', ({ response }) => {
      if (!response.url.startsWith(`${origin}/`)) return;
      responses.set(new URL(response.url).pathname, response.status);
      if (response.status >= 400) report.assetErrors.push(`HTTP ${response.status}: ${response.url}`);
    });
    cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
      const url = requests.get(requestId);
      if (url?.startsWith(`${origin}/`) && errorText !== 'net::ERR_ABORTED') {
        report.assetErrors.push(`${errorText}: ${url}`);
      }
    });
    await Promise.all(['Runtime.enable', 'Log.enable', 'Page.enable', 'Network.enable'].map((method) => send(method)));
    const resize = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile,
    });
    await resize(1440, 900);
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, description, timeout = 60000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await evaluate(expression)) return;
        await delay(200);
      }
      throw new Error(`Timed out waiting for ${description}`);
    };
    const shoot = async (name) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(out, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      report.screenshots.push(file);
    };
    const clickButton = (text) => evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}));
      if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)});
      button.click();
    })()`);
    const enterLevel = async (index, level = 1) => {
      await waitFor(`document.querySelectorAll('.chapter-tab').length === 8`, 'chapter selection');
      await evaluate(`document.querySelectorAll('.chapter-tab')[${index}].click()`);
      await waitFor(`document.querySelector('.level-card__num')?.textContent.trim() === '${index + 1}-1'`, 'selected chapter');
      await evaluate(`document.querySelectorAll('.level-card')[${level - 1}].click()`);
      await waitFor(`window.__PTD__?.level?.id === '${index + 1}-${level}'`, 'battle scene');
      await waitFor(`window.__PTD__?.state === 'running'`, 'battle asset loading', 25000);
      // Keep screenshots stable while Phaser continues loading and drawing sprite animations.
      await evaluate(`window.__PTD__.speed = 0`);
      await delay(500);
    };
    const leaveBattle = async () => {
      await clickButton('暂停');
      await waitFor(`!!document.querySelector('.pause')`, 'pause menu');
      await clickButton('返回关卡选择');
      await waitFor(`!!document.querySelector('.levels')`, 'return to chapter selection');
    };

    console.log(`Checking map art at ${gameUrl}`);
    await send('Page.navigate', { url: gameUrl });
    await waitFor(`!!document.querySelector('.menu__play') && !!window.__PTD_PROGRESS__`, 'main menu and dev progress bridge');
    if (!lifecycleOnly) await evaluate(`(() => {
      for (let chapter = 1; chapter <= 8; chapter++) {
        for (let level = 1; level <= 10; level++) window.__PTD_PROGRESS__.clearLevel(chapter + '-' + level);
      }
    })()`);
    await clickButton('开始游戏');

    for (let index = 0; index < (lifecycleOnly ? 0 : scenarios.length); index++) {
      const scenario = scenarios[index];
      await enterLevel(scenario.chapter, scenario.level);
      const map = await evaluate(`(() => {
        const scene = window.__PTD__;
        const descendants = object => object ? [object, ...(object.list || []).flatMap(descendants)] : [];
        const objects = scene.children.list.flatMap(descendants);
        // TileSprite's texture/frame reference its generated canvas; these public fields retain the source atlas.
        const textureOf = object => object.displayTexture || object.texture;
        const frameOf = object => object.displayFrame || object.frame;
        const isLoadedImage = object => {
          const source = textureOf(object)?.source?.[0]?.image;
          const frame = frameOf(object);
          return textureOf(object)?.key === 'map-world' && !!frame &&
            frame.name !== '__BASE' && frame.cutWidth > 0 && frame.cutHeight > 0 &&
            object.visible && object.alpha > 0 &&
            object.displayWidth > 0 && object.displayHeight > 0 &&
            source?.complete === true && source.naturalWidth > 0;
        };
        const ground = objects.find(object => object.name === 'map-ground');
        const road = objects.find(object => object.name === 'map-path');
        const maskCommands = road?.mask?.geometryMask?.commandBuffer || [];
        // Installed Phaser Graphics commands: FILL_RECT=3 and ARC=0.
        const containsCommand = command => maskCommands.some((_, offset) =>
          command.every((value, index) => maskCommands[offset + index] === value));
        const points = scene.level.path.map(point => ({ x: point.x * 64 + 32, y: point.y * 64 + 32 }));
        const maskFollowsRoute = points.every(point =>
          containsCommand([0, point.x, point.y, 25.5, 0, Math.PI * 2])) &&
          points.slice(1).every((point, index) => {
            const previous = points[index];
            return containsCommand(previous.y === point.y
              ? [3, Math.min(previous.x, point.x), point.y - 25.5, Math.abs(point.x - previous.x), 51]
              : [3, point.x - 25.5, Math.min(previous.y, point.y), 51, Math.abs(point.y - previous.y)]);
          });
        const texture = scene.textures.get('map-world');
        const image = texture?.source?.[0]?.image;
        const pathCells = new Set();
        for (let i = 0; i < scene.level.path.length - 1; i++) {
          const a = scene.level.path[i], b = scene.level.path[i + 1];
          const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          for (let k = 0; k <= steps; k++) {
            const x = steps ? Math.round(a.x + (b.x - a.x) * k / steps) : a.x;
            const y = steps ? Math.round(a.y + (b.y - a.y) * k / steps) : a.y;
            if (x >= 0 && x < 24 && y >= 0 && y < 14) pathCells.add(x + ',' + y);
          }
        }
        const obstacles = scene.obstacles.map(obstacle => ({
          kind: obstacle.def.kind, x: obstacle.def.x, y: obstacle.def.y,
          blocked: scene.blocked.has(obstacle.def.x + ',' + obstacle.def.y),
          frames: descendants(obstacle.sprite).filter(isLoadedImage).map(object => frameOf(object).name),
        }));
        return {
          level: scene.level.id, theme: scene.level.theme.key, rendererType: scene.game.renderer.type,
          atlasLoaded: scene.textures.exists('map-world') && image?.complete === true && image.naturalWidth > 0,
          ground: !!ground && isLoadedImage(ground), groundFrame: ground ? frameOf(ground)?.name : null,
          pathArt: objects.filter(object => isLoadedImage(object) && String(frameOf(object).name).startsWith('path-')).length,
          pathNodes: scene.level.path.length, maskFollowsRoute,
          pathCells: pathCells.size, unblockedPathCells: [...pathCells].filter(cell => !scene.blocked.has(cell)),
          obstacles,
        };
      })()`);
      report.maps.push(map);
      check(map.rendererType === (forceCanvas ? 1 : 2), `${map.level}: using requested ${report.renderer} renderer`);
      check(map.theme === scenario.theme && map.atlasLoaded && map.ground && map.pathArt > 0,
        `${map.level} ${map.theme}: loaded terrain atlas, ground and path art`);
      check(map.maskFollowsRoute, `${map.level}: road artwork follows all ${map.pathNodes} live route points`);
      check(map.pathCells > 0 && map.unblockedPathCells.length === 0,
        `${map.level}: all ${map.pathCells} path cells remain blocked for building`);
      check(map.obstacles.length > 0 && map.obstacles.every((object) => object.blocked && object.frames.length > 0),
        `${map.level}: all ${map.obstacles.length} obstacles use visible image sprites and block their cells`);
      if (scenario.level === 10) {
        const first = report.maps.find((item) => item.level === `${scenario.chapter + 1}-1`);
        check(map.pathNodes > first.pathNodes, `${map.level}: later route includes extra bends (${first.pathNodes} → ${map.pathNodes} points)`);
      }
      if (forceCanvas) {
        const canvasRoad = await evaluate(`(async () => {
          const scene = window.__PTD__;
          const road = scene.children.getByName('map-path');
          const canvas = scene.game.canvas;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Expected a readable Canvas renderer');
          const camera = scene.cameras.main;
          const points = scene.level.path.map(point => ({ x: point.x * 64 + 32, y: point.y * 64 + 32 }));
          const probes = [...points.slice(1, -1), ...points.slice(1).map((point, index) =>
            ({ x: (point.x + points[index].x) / 2, y: (point.y + points[index].y) / 2 }))]
            .filter(point => point.x > 64 && point.x < 1472 && point.y >= 160 && point.y < 704)
            .map(point => ({
              x: Math.round((point.x - camera.worldView.x) * camera.zoom * canvas.width / scene.scale.gameSize.width),
              y: Math.round((point.y - camera.worldView.y) * camera.zoom * canvas.height / scene.scale.gameSize.height),
            }));
          const read = () => probes.map(point => [...context.getImageData(point.x - 4, point.y - 4, 9, 9).data]);
          const nextFrame = () => new Promise(resolve => scene.game.events.once('postrender', resolve));
          road.setVisible(false);
          await nextFrame();
          const withoutRoad = read();
          road.setVisible(true);
          await nextFrame();
          const withRoad = read();
          const differences = withRoad.map((pixels, index) => Math.round(pixels.reduce((sum, value, channel) =>
            sum + (channel % 4 === 3 ? 0 : Math.abs(value - withoutRoad[index][channel])), 0) / 81 * 100) / 100);
          return { probes: probes.length, visible: differences.filter(value => value >= 3).length, differences };
        })()`);
        map.canvasRoad = canvasRoad;
        check(canvasRoad.probes > 0 && canvasRoad.visible >= Math.ceil(canvasRoad.probes * 0.8),
          `${map.level}: Canvas road texture visibly covers ${canvasRoad.visible}/${canvasRoad.probes} route centers and bends`);
      }
      await shoot(scenario.level === 1 ? `${String(index + 1).padStart(2, '0')}-${scenario.theme}`
        : `${index + 2}-${scenario.theme}-${map.level}`);

      if (index === 0) {
        const interaction = await evaluate(`(async () => {
          const scene = window.__PTD__;
          const id = scene.level.availableTowers[0];
          scene.coins = 10000;
          scene.emitEconomy();
          const path = scene.level.path.find(point => point.x >= 0 && point.x < 24);
          const pathRejected = !(await scene.placeTowerAt(path.x, path.y, id));
          const obstacle = scene.obstacles[0];
          const cell = obstacle.def.x + ',' + obstacle.def.y;
          const obstacleRejected = !(await scene.placeTowerAt(obstacle.def.x, obstacle.def.y, id));
          let target;
          for (let y = 2; y <= 10 && !target; y++) for (let x = 1; x < 23; x++) {
            if (!scene.blocked.has(x + ',' + y)) { target = { x, y }; break; }
          }
          if (!target) throw new Error('No available cell for a forest tower');
          const placed = await scene.placeTowerAt(target.x, target.y, id);
          const tower = scene.towers.find(t => t.gridX === target.x && t.gridY === target.y);
          const source = tower?.sprite?.texture?.source?.[0]?.image;
          scene.deselectTower();
          window.__MAP_SMOKE_OBSTACLE__ = { obstacle, sprite: obstacle.sprite, cell };
          return {
            pathRejected, obstacleRejected, placed,
            towerLoaded: !!tower?.sprite?.visible && source?.complete === true && source.naturalWidth > 0,
            towerTexture: tower?.sprite?.texture?.key,
          };
        })()`);
        report.interaction = interaction;
        check(interaction.pathRejected && interaction.obstacleRejected, 'Forest: placement rejects path and obstacle cells');
        check(interaction.placed && interaction.towerLoaded, `Forest: placed tower has loaded sprite (${interaction.towerTexture})`);
        await shoot('01-forest-tower');
        const clearing = await evaluate(`(() => {
          const scene = window.__PTD__;
          const { obstacle, sprite, cell } = window.__MAP_SMOKE_OBSTACLE__;
          const before = scene.obstacles.length;
          scene.damageObstaclesInRadius(obstacle.def.x * 64 + 32, obstacle.def.y * 64 + 32, 0, 1000000);
          const result = {
            removed: scene.obstacles.length < before && !scene.obstacles.includes(obstacle),
            destroyed: !sprite.active && !sprite.scene,
            released: !scene.blocked.has(cell),
          };
          delete window.__MAP_SMOKE_OBSTACLE__;
          return result;
        })()`);
        report.clearing = clearing;
        check(clearing.removed && clearing.destroyed && clearing.released,
          'Forest: clearing destroys obstacle artwork and releases its build cell');
        await delay(500);
        await shoot('01-forest-cleared');
      }
      await leaveBattle();
    }

    await resize(844, 390, true);
    await enterLevel(0);
    await shoot('09-forest-mobile-landscape');
    const mobile = await evaluate(`(() => {
      const canvas = document.querySelector('canvas');
      const rect = canvas?.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, canvasWidth: rect?.width, canvasHeight: rect?.height,
        hasRotateOverlay: !!document.querySelector('.orientation-overlay') };
    })()`);
    report.mobile = mobile;
    check(mobile.width === 844 && mobile.height === 390 && mobile.canvasWidth > 0 && mobile.canvasHeight > 0,
      'Mobile landscape: forest renders at 844 × 390');
    await evaluate(`window.__PTD__.debugFastForward(2)`);
    await waitFor(`window.__PTD__.waves.enemies.some(enemy => enemy.alive && !window.__PTD__.loadingEnemies.has(enemy.id))`,
      'a live enemy with no pending sprite request');
    await evaluate(`(() => {
      const scene = window.__PTD__;
      const enemy = scene.waves.enemies.find(enemy => enemy.alive && !scene.loadingEnemies.has(enemy.id));
      const assets = scene.assets;
      const originalLoad = assets.loadPokemon;
      const originalCreate = enemy.createView;
      const probe = { scene, enemy, originalCreate, recreated: 0, error: null, release: null, done: null };
      enemy.createView = function (...args) { probe.recreated++; return originalCreate.apply(this, args); };
      assets.loadPokemon = () => new Promise(resolve => { probe.release = resolve; });
      try { probe.done = scene.loadEnemyAssets(enemy).catch(error => { probe.error = String(error); }); }
      finally { assets.loadPokemon = originalLoad; }
      if (!probe.release) throw new Error('Lifecycle regression did not suspend a sprite request');
      window.__MAP_SMOKE_LIFECYCLE__ = probe;
    })()`);
    await leaveBattle();
    await waitFor(`!window.__MAP_SMOKE_LIFECYCLE__.scene.sys.isActive()`, 'old Phaser scene disposal');
    report.lifecycle = await evaluate(`(async () => {
      const probe = window.__MAP_SMOKE_LIFECYCLE__;
      probe.release();
      await probe.done;
      const result = {
        recreated: probe.recreated, error: probe.error,
        sceneDisposed: !probe.scene.sys.isActive(),
        enemyViewReleased: !probe.enemy.sprite || (!probe.enemy.sprite.active && !probe.enemy.sprite.scene),
      };
      probe.enemy.createView = probe.originalCreate;
      delete window.__MAP_SMOKE_LIFECYCLE__;
      return result;
    })()`);
    check(report.lifecycle.recreated === 0 && !report.lifecycle.error && report.lifecycle.enemyViewReleased && report.lifecycle.sceneDisposed,
      'Scene lifecycle: sprite loading completed after exit without rebuilding removed enemies or throwing');
    for (const asset of ['/assets/maps/world.png', '/assets/maps/world.json']) {
      check(responses.get(asset) >= 200 && responses.get(asset) < 400, `Map atlas request succeeds: ${asset}`);
    }
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch { /* Browser may already have exited. */ }
    }
    ws?.close();
    proc.kill();
    await delay(700);
    // The profile was created directly under this workspace cache, never a user browser profile.
    if (path.dirname(profile) === cache && path.basename(profile).startsWith('map-smoke-profile-')) {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Nonfatal browser file locks. */ }
    }
  }
}

try { await main(); }
catch (error) { report.errors.push(error.stack || String(error)); }
report.errors = [...new Set(report.errors)];
report.assetErrors = [...new Set(report.assetErrors)];
check(report.errors.length === 0, `No JavaScript / browser errors (${report.errors.length})`);
check(report.assetErrors.length === 0, `No failed local asset requests (${report.assetErrors.length})`);
report.passed = report.maps.length === (lifecycleOnly ? 0 : scenarios.length) && report.checks.every((item) => item.ok);
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const summary = [
  `Map visual smoke test: ${report.passed ? 'PASS' : 'FAIL'}`,
  `Game: ${gameUrl} (${report.renderer})`,
  '',
  ...report.checks.map((item) => `${item.ok ? 'PASS' : 'FAIL'} ${item.description}`),
  '',
  ...report.errors.map((error) => `Browser error: ${error}`),
  ...report.assetErrors.map((error) => `Asset error: ${error}`),
  '',
  `Screenshots: ${out}`,
  'Screenshots still need visual review for composition and art quality.',
];
fs.writeFileSync(path.join(out, 'report.txt'), summary.join('\n'));
console.log(`\n${report.passed ? 'PASS' : 'FAIL'} — ${lifecycleOnly ? 'focused scene lifecycle check' : `${report.maps.length}/${scenarios.length} maps checked`}. Report: ${path.join(out, 'report.txt')}`);
for (const error of [...report.errors, ...report.assetErrors]) console.error(error);
process.exitCode = report.passed ? 0 : 1;
