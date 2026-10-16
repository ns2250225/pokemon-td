import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, TILE } from './config';
import { blockedCells, type LevelDef, type ObstacleDef } from '../data/levels/levels';
import { joinPublicPath } from '../utils/assetPaths';

const ATLAS = 'map-world';

export function preloadMapAssets(scene: Phaser.Scene) {
  scene.load.atlas(ATLAS, joinPublicPath('assets/maps/world.png'), joinPublicPath('assets/maps/world.json'));
}

const BIOMES: Record<string, { edge: number; rim: number; shadow: number; water?: string; border: string; decor: string[] }> = {
  forest: { edge: 0x536b43, rim: 0xf3dfa3, shadow: 0x243f32, border: 'tree-forest', decor: ['grass', 'mushroom-1', 'mushroom-2', 'rock-small'] },
  beach: { edge: 0xa58154, rim: 0xffefbd, shadow: 0x685d43, water: 'water', border: 'rock', decor: ['grass', 'rock-small', 'bones'] },
  volcano: { edge: 0x3b2835, rim: 0xe8ab6a, shadow: 0x241b2a, water: 'water-volcano', border: 'rock', decor: ['rock-small', 'bones', 'stump'] },
  snow: { edge: 0x7d9da9, rim: 0xf5fcff, shadow: 0x4c6d85, border: 'tree-snow', decor: ['rock-small', 'grass'] },
  manor: { edge: 0x292c46, rim: 0xa399b8, shadow: 0x16182a, border: 'tree-manor', decor: ['bones', 'mushroom-3', 'stump'] },
  desert: { edge: 0x96704b, rim: 0xf7ddb0, shadow: 0x715443, border: 'ruin', decor: ['bones', 'rock-small', 'stump'] },
  sky: { edge: 0x819bb5, rim: 0xffffff, shadow: 0x607e9c, water: 'water-sky', border: 'rock', decor: ['grass', 'rock-small'] },
  champion: { edge: 0x424858, rim: 0xe8ce8c, shadow: 0x252a3c, border: 'ruin', decor: ['rock-small', 'grass'] },
};

function image(scene: Phaser.Scene, x: number, y: number, frame: string, width: number) {
  const sprite = scene.add.image(x, y, ATLAS, frame);
  return sprite.setScale(width / sprite.width);
}

/** The road follows the live level data, including the extra bends in later levels. */
function roadShape(scene: Phaser.Scene, level: LevelDef, width: number, color: number) {
  const graphics = scene.add.graphics().fillStyle(color, 1);
  const points = level.path.map(({ x, y }) => new Phaser.Math.Vector2(x * TILE + TILE / 2, y * TILE + TILE / 2));
  // Keep one compound path: Canvas geometry masks ignore strokes and reset on fillCircle.
  graphics.beginPath();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.y === b.y) graphics.fillRect(Math.min(a.x, b.x), a.y - width / 2, Math.abs(b.x - a.x), width);
    else graphics.fillRect(a.x - width / 2, Math.min(a.y, b.y), width, Math.abs(b.y - a.y));
  }
  for (const point of points) {
    graphics.moveTo(point.x + width / 2, point.y);
    graphics.arc(point.x, point.y, width / 2, 0, Math.PI * 2).closePath();
  }
  graphics.fillPath();
  return graphics;
}

export function drawMapTerrain(scene: Phaser.Scene, level: LevelDef) {
  const key = level.theme.key;
  const biome = BIOMES[key];
  const rng = new Phaser.Math.RandomDataGenerator([`${level.id}-landscape`]);
  const pathCells = blockedCells(level.path);
  const occupied = new Set(level.obstacles.map(({ x, y }) => `${x},${y}`));

  scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, ATLAS, `ground-${key}`)
    .setOrigin(0).setDepth(DEPTH.background).setName('map-ground');

  // Broad, translucent patches soften the repeated texture without revealing a grid.
  const patches = scene.add.graphics().setDepth(DEPTH.background + 1);
  for (let i = 0; i < 45; i++) {
    patches.fillStyle(i % 3 ? biome.shadow : 0xffffff, i % 3 ? 0.025 : 0.035);
    patches.fillEllipse(rng.between(0, GAME_WIDTH), rng.between(100, 760), rng.between(90, 260), rng.between(45, 110));
  }

  if (biome.water) {
    for (const [y, height] of [[0, 128], [720, 176]]) {
      const water = scene.add.tileSprite(0, y, GAME_WIDTH, height, ATLAS, biome.water)
        .setOrigin(0).setDepth(DEPTH.background + 2);
      scene.tweens.add({ targets: water, tilePositionX: 64, duration: 16000, repeat: -1 });
      scene.add.tileSprite(0, y === 0 ? 96 : 704, GAME_WIDTH, 64, ATLAS, `shore-${y === 0 ? 'top' : 'bottom'}-${key}`)
        .setOrigin(0).setDepth(DEPTH.background + 3);
      const ripples = scene.add.graphics().setDepth(DEPTH.background + 3);
      for (let i = 0; i < 32; i++) {
        const x = rng.between(0, GAME_WIDTH);
        const ry = y === 0 ? rng.between(35, 90) : rng.between(762, 876);
        ripples.fillStyle(key === 'volcano' ? 0xffe18b : 0xe1fff9, rng.realInRange(0.1, 0.25));
        ripples.fillRoundedRect(x, ry, rng.between(8, 24), 2, 1);
      }
      scene.tweens.add({ targets: ripples, alpha: 0.4, x: 14, duration: 4000, yoyo: true, repeat: -1 });
    }
  }

  // Only the non-playable margins have large scenery; the buildable field stays clear.
  for (const bottom of [false, true]) {
    const step = biome.border.startsWith('tree') ? 74 : 100;
    for (let x = -40; x < GAME_WIDTH + 100; x += step) {
      if (!biome.border.startsWith('tree') && rng.frac() > 0.6) continue;
      const y = bottom ? rng.between(862, 904) : rng.between(114, 128);
      const width = biome.border.startsWith('tree') ? rng.between(90, 122) : rng.between(45, 76);
      const frame = biome.border.startsWith('tree') ? biome.border : `${biome.border}-${key}`;
      image(scene, x + rng.between(-14, 14), y, frame, width)
        .setOrigin(0.5, 1).setFlipX(rng.frac() > 0.5).setDepth(DEPTH.background + 4);
    }
  }

  // Small ground details sit at cell edges, away from tower feet and obstacles.
  for (let y = 2; y <= 10; y++) {
    for (let x = 0; x < 24; x++) {
      if (pathCells.has(`${x},${y}`) || occupied.has(`${x},${y}`) || rng.frac() > 0.28) continue;
      const detail = rng.pick(biome.decor);
      const frame = detail === 'grass' || detail === 'rock-small' ? `${detail}-${key}` : detail;
      image(scene, x * TILE + rng.between(10, 22), y * TILE + rng.between(43, 56), frame, rng.between(13, 23))
        .setOrigin(0.5, 1).setAlpha(0.7).setDepth(DEPTH.background + 5);
    }
  }

  roadShape(scene, level, 65, biome.shadow).setAlpha(0.3).setPosition(0, 5).setDepth(DEPTH.path - 2);
  roadShape(scene, level, 64, biome.edge).setDepth(DEPTH.path - 1);
  roadShape(scene, level, 58, biome.rim).setDepth(DEPTH.path);
  const maskShape = roadShape(scene, level, 51, 0xffffff).setVisible(false);
  const road = scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, ATLAS, `path-${key}`)
    .setOrigin(0).setDepth(DEPTH.path + 1).setName('map-path');
  const mask = maskShape.createGeometryMask();
  road.setMask(mask);
  scene.events.once('shutdown', () => { road.clearMask(); mask.destroy(); });

  const edging = scene.add.graphics().setDepth(DEPTH.path + 2);
  for (const cell of pathCells) {
    const [gx, gy] = cell.split(',').map(Number);
    if (gx < 0 || gx > 23) continue;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (pathCells.has(`${gx + dx},${gy + dy}`) || rng.frac() > 0.43) continue;
      const px = gx * TILE + 32 + dx * 30;
      const py = gy * TILE + 32 + dy * 30;
      edging.fillStyle(biome.rim, 0.3).fillEllipse(px, py, rng.between(4, 8), rng.between(2, 4));
    }
  }

  // Dappled light remains below combatants, so it never obscures projectiles or targets.
  const light = scene.add.graphics().setDepth(DEPTH.path + 3);
  light.fillGradientStyle(0xffffff, 0xffffff, biome.shadow, biome.shadow, 0.04, 0.04, 0.10, 0.10);
  light.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
}

export function drawMapObstacle(scene: Phaser.Scene, def: ObstacleDef, theme: string) {
  const container = scene.add.container(def.x * TILE + 32, def.y * TILE + 32).setDepth(DEPTH.obstacles);
  const frame = def.kind === 'chest' ? def.kind : `${def.kind}-${theme}`;
  const widths = { tree: 65, bush: 44, rock: 43, chest: 39, crystal: 35, ruin: 42 };
  const shadow = scene.add.ellipse(0, 19, def.kind === 'tree' ? 53 : 38, 14, 0x17293c, 0.22);
  const prop = image(scene, 0, 25, frame, widths[def.kind]).setOrigin(0.5, 1);
  container.add([shadow, prop]);
  if (def.kind === 'chest' || def.kind === 'crystal') {
    const sparkle = scene.add.star(10, -16, 4, 1.2, 5, def.kind === 'chest' ? 0xfff4ba : 0xcaffff, 0.9);
    container.add(sparkle);
    scene.tweens.add({ targets: sparkle, alpha: 0.2, scale: 0.5, duration: 1300, yoyo: true, repeat: -1 });
    container.once('destroy', () => scene.tweens.killTweensOf(sparkle));
  }
  return container;
}

export function drawMapEndpoints(scene: Phaser.Scene, level: LevelDef) {
  const start = level.path[0];
  const end = level.path[level.path.length - 1];
  const sx = Math.max(22, start.x * TILE + 32);
  const sy = start.y * TILE + 32;
  const ex = Math.min(GAME_WIDTH - 32, end.x * TILE + 32);
  const ey = end.y * TILE + 32;
  const portal = scene.add.ellipse(sx, sy, 36, 48, 0x29596b, 0.9)
    .setStrokeStyle(3, 0xc7f5e1).setDepth(DEPTH.path + 4);
  scene.add.ellipse(sx, sy + 17, 54, 19, 0x89f0d2, 0.25).setDepth(DEPTH.path + 3);
  scene.add.text(sx, sy, '›', { fontSize: '36px', color: '#effff5', fontStyle: 'bold' })
    .setOrigin(0.5, 0.55).setDepth(DEPTH.path + 5);
  scene.tweens.add({ targets: portal, alpha: 0.65, duration: 1600, yoyo: true, repeat: -1 });
  scene.add.ellipse(ex, ey + 21, 68, 23, 0x142536, 0.24).setDepth(DEPTH.path + 4);
  image(scene, ex, ey + 30, 'base', 61).setOrigin(0.5, 1).setDepth(DEPTH.obstacles + 1).setName('base');
  for (const [x, y, text, color] of [[sx, sy - 43, '入口', '#d5fff0'], [ex, ey - 85, '基地', '#ffebaa']] as const) {
    scene.add.text(x, y, text, {
      fontFamily: 'system-ui, sans-serif', fontSize: '14px', fontStyle: 'bold', color,
      backgroundColor: '#223a3bdd', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(DEPTH.obstacles + 2);
  }
}
