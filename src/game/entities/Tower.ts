/**
 * 防御单位（PokemonTower）。
 *
 * 承担：攻击循环、等级成长、进化、技能释放、自身增益。
 * 攻击判定走 TargetingSystem + CombatSystem，渲染表现交给 EffectSystem。
 */
import Phaser from 'phaser';
import { DEPTH, QUALITY_CONFIG, TILE } from '../config';
import { getGameSettings } from '../../stores/settings';
import { textureKeys, type AssetService, FX } from '../managers/AssetManager';
import type { TowerConfig } from '../../data/pokemon/units';
import type { MoveDef } from '../../data/moves/moves';
import { attackAtLevel } from '../systems/CombatSystem';
import { TYPE_COLORS } from '../../data/balance/typeChart';
import type { MovingEnemy } from './Enemy';

export interface TowerBuff {
  kind: 'attackSpeed' | 'damage' | 'range' | 'multiShot';
  ratio: number;
  expiresAt: number;
}

export class PokemonTower {
  readonly uid: number;
  /** 当前形态对应的图鉴编号（进化后会变化） */
  pokemonId: number;
  config: TowerConfig;

  /** 所在格子 */
  readonly gridX: number;
  readonly gridY: number;
  x: number;
  y: number;

  level = 1;
  /** 累计投入的金币，用于出售时返还 */
  invested = 0;

  /** 攻击计时（毫秒，固定步长累加） */
  private cooldown = 0;
  private castLockUntil = 0;

  buffs: TowerBuff[] = [];
  /** 已经解锁的招式（按等级） */
  unlockedMoves: MoveDef[] = [];
  /** 当前主招式索引（玩家可在 UI 里切换） */
  activeMoveIndex = 0;

  /** 击杀统计，用于 UI 展示 */
  kills = 0;
  totalDamage = 0;

  /** 效果回调，由 BattleScene 注入 */
  onFire: ((tower: PokemonTower, move: MoveDef) => void) | null = null;

  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
  private levelBadge: Phaser.GameObjects.Container | null = null;
  private auraRing: Phaser.GameObjects.Arc | null = null;

  constructor(uid: number, config: TowerConfig, gridX: number, gridY: number) {
    this.uid = uid;
    this.config = config;
    this.pokemonId = config.pokemonId;
    this.gridX = gridX;
    this.gridY = gridY;
    this.x = gridX * TILE + TILE / 2;
    this.y = gridY * TILE + TILE / 2;
    this.invested = config.cost;
    this.refreshMoves();
  }

  get isEvolved(): boolean {
    return this.pokemonId !== this.config.pokemonId;
  }

  /* ---------------------------------------------------------------- */
  /* 数值                                                              */
  /* ---------------------------------------------------------------- */

  private buffMultiplier(kind: TowerBuff['kind']): number {
    let mult = 1;
    for (const b of this.buffs) {
      if (b.kind === kind) mult *= 1 + b.ratio;
    }
    return mult;
  }

  get attackPower(): number {
    return attackAtLevel(this.config.damage, this.level, this.config.growth.damage) * this.buffMultiplier('damage');
  }

  get attackInterval(): number {
    const base = this.config.attackIntervalMs * (1 - this.config.growth.attackSpeed * (this.level - 1));
    // 攻速增益直接缩短间隔
    return Math.max(160, base / this.buffMultiplier('attackSpeed'));
  }

  get range(): number {
    return this.config.range * (1 + this.config.growth.range * (this.level - 1)) * this.buffMultiplier('range');
  }

  get cost(): number {
    return this.config.cost;
  }

  /** 升级到下一级需要的金币 */
  get upgradeCost(): number {
    if (this.level >= this.config.maxLevel) return 0;
    const factor = 0.62 + this.level * 0.24;
    return Math.round((this.config.cost * factor) / 5) * 5;
  }

  /** 出售返还（70% 投入） */
  get sellValue(): number {
    return Math.round(this.invested * 0.7);
  }

  get canEvolve(): boolean {
    return !this.isEvolved && !!this.config.evolution && this.level >= 3;
  }

  get evolutionCost(): number {
    return this.config.evolution?.cost ?? 0;
  }

  /* ---------------------------------------------------------------- */
  /* 操作                                                              */
  /* ---------------------------------------------------------------- */

  /** 依据等级刷新可用招式列表 */
  private refreshMoves() {
    const unlocked = this.config.moves.filter((m) => m.unlockLevel <= this.level).map((m) => m.move);
    const sig = this.config.moves.find((m) => m.unlockLevel === 5)?.move;
    // 终极强化（Lv.5）额外解锁该属性的终极招式
    this.unlockedMoves = sig && this.level >= 5 && !unlocked.includes(sig) ? [...unlocked, sig] : unlocked;
    const unlockedSet = new Set(this.config.moves.filter((m) => m.unlockLevel <= this.level).map((m) => m.id));
    if (!this.unlockedMoves.length) {
      this.unlockedMoves = [this.config.moves[0].move];
      unlockedSet.add(this.config.moves[0].id);
    }
    this.activeMoveIndex = Math.min(this.activeMoveIndex, this.unlockedMoves.length - 1);
  }

  /** 升级，返回是否成功 */
  upgrade(): boolean {
    if (this.level >= this.config.maxLevel) return false;
    const cost = this.upgradeCost;
    this.level++;
    this.invested += cost;
    this.refreshMoves();
    return true;
  }

  /** 进化到新形态 */
  evolve(newConfig: TowerConfig) {
    this.config = newConfig;
    this.pokemonId = newConfig.pokemonId;
    this.refreshMoves();
    this.activeMoveIndex = this.unlockedMoves.length - 1;
  }

  addBuff(buff: TowerBuff) {
    const idx = this.buffs.findIndex((b) => b.kind === buff.kind);
    if (idx >= 0) this.buffs[idx] = buff;
    else this.buffs.push(buff);
  }

  get activeMove(): MoveDef {
    return this.unlockedMoves[Math.min(this.activeMoveIndex, this.unlockedMoves.length - 1)];
  }

  /**
   * 推进攻击循环。返回本 tick 需要释放的招式（null 表示不攻击）。
   * 伤害与视觉的时序由调用方（BattleScene）协调。
   */
  tick(dtMs: number, now: number): MoveDef | null {
    this.buffs = this.buffs.filter((b) => b.expiresAt > now);
    if (now < this.castLockUntil) return null;

    this.cooldown -= dtMs;
    if (this.cooldown > 0) return null;

    const move = this.activeMove;
    // 纯自身增益招式：无目标也能放
    const isSelfBuff = move.targeting === 'aura' && move.damageMultiplier === 0;
    this.cooldown = isSelfBuff ? move.cooldownMs : Math.max(move.cooldownMs, this.attackInterval);
    if (isSelfBuff) this.cooldown = move.cooldownMs;
    return move;
  }

  /** 释放后进入锁定（蓄力期间不再攻击） */
  lockFor(ms: number, now: number) {
    this.castLockUntil = now + ms;
  }

  /** 应用招式自带的自身增益 */
  applySelfBuff(move: MoveDef, now: number) {
    if (!move.selfBuff) return;
    this.addBuff({
      kind: move.selfBuff.kind,
      ratio: move.selfBuff.ratio,
      expiresAt: now + move.selfBuff.durationMs,
    });
  }

  registerHit(damage: number, killed: boolean) {
    this.totalDamage += damage;
    if (killed) this.kills++;
  }

  /** 该塔能否锁定隐身单位 */
  get revealsStealth(): boolean {
    return this.config.moves.some((m) => m.move.revealsStealth) ||
      this.config.types.includes('ghost') ||
      this.unlockedMoves.some((m) => m.revealsStealth);
  }

  /* ---------------------------------------------------------------- */
  /* 渲染                                                              */
  /* ---------------------------------------------------------------- */

  createView(scene: Phaser.Scene, assets: AssetService) {
    const keys = textureKeys(this.pokemonId);
    const meta = assets.getAtlasMeta(this.pokemonId);

    if (meta && scene.textures.exists(keys.animated)) {
      const animKey = assets.ensureSpriteAnimation(this.pokemonId, 'animated');
      const sprite = scene.add.sprite(this.x, this.y, keys.animated);
      if (animKey) sprite.play(animKey);
      sprite.setDepth(DEPTH.towers);
      this.sprite = sprite;
      // 防御单位面朝右
      sprite.setFlipX(false);
    } else if (scene.textures.exists(keys.static)) {
      const img = scene.add.image(this.x, this.y, keys.static);
      img.setDepth(DEPTH.towers);
      this.sprite = img;
      // 静态回退：待机起伏
      scene.tweens.add({
        targets: img,
        scaleY: { from: 1, to: 0.95 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    if (this.sprite) {
      // 防御单位比敌人略大，视觉上更"守家"
      const base = (TILE * 0.96) / Math.max(this.sprite.width, 1);
      this.sprite.setScale(base);
    }

    // 等级徽章
    this.buildLevelBadge(scene);

    // 自己的攻击范围提示环（仅选中时显示）
    const ring = scene.add.circle(this.x, this.y, this.range, 0x000000, 0);
    ring.setStrokeStyle(2, 0x8fe36b, 0.55);
    ring.setDepth(DEPTH.buildSlots);
    ring.setVisible(false);
    this.auraRing = ring;

    // 属性染色光晕，帮助在战场上辨认属性。
    // 低画质下关闭：叠加混合的光晕在低端设备上是明显的填充率负担。
    if (QUALITY_CONFIG[getGameSettings().quality].glow) {
      const glow = scene.add.image(this.x, this.y, FX.common.dotSoft);
      const color = Phaser.Display.Color.HexStringToColor(TYPE_COLORS[this.config.types[0]] ?? '#ffffff').color;
      glow.setTint(color).setAlpha(0.16).setDepth(DEPTH.towers - 1).setBlendMode(Phaser.BlendModes.ADD);
      glow.setDisplaySize(TILE * 1.2, TILE * 0.7);
      glow.setName('typeGlow');
      this.glow = glow;
    }
  }

  private glow: Phaser.GameObjects.Image | null = null;

  private buildLevelBadge(scene: Phaser.Scene) {
    const container = scene.add.container(this.x + TILE * 0.34, this.y - TILE * 0.36);
    container.setDepth(DEPTH.towers + 2);
    const bg = scene.add.circle(0, 0, 13, 0x1b2230, 0.9);
    bg.setStrokeStyle(2, 0xffd76e, 1);
    const label = scene.add.text(0, 0, `L${this.level}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffd76e',
    }).setOrigin(0.5);
    container.add([bg, label]);
    this.levelBadge = container;
  }

  refreshBadge(scene: Phaser.Scene) {
    this.levelBadge?.destroy();
    this.buildLevelBadge(scene);
    if (this.auraRing) this.auraRing.setRadius(this.range);
  }

  /** 进化时重建视图 */
  rebuildView(scene: Phaser.Scene, assets: AssetService) {
    const glow = this.glow;
    this.sprite?.destroy();
    const keys = textureKeys(this.pokemonId);
    const meta = assets.getAtlasMeta(this.pokemonId);
    if (meta && scene.textures.exists(keys.animated)) {
      const animKey = assets.ensureSpriteAnimation(this.pokemonId, 'animated');
      const sprite = scene.add.sprite(this.x, this.y, keys.animated);
      if (animKey) sprite.play(animKey);
      sprite.setDepth(DEPTH.towers);
      this.sprite = sprite;
    } else if (scene.textures.exists(keys.static)) {
      this.sprite = scene.add.image(this.x, this.y, keys.static).setDepth(DEPTH.towers);
    }
    if (this.sprite) {
      const base = (TILE * 0.96) / Math.max(this.sprite.width, 1);
      this.sprite.setScale(base * (this.isEvolved ? 1.16 : 1));
    }
    if (glow) {
      const color = Phaser.Display.Color.HexStringToColor(TYPE_COLORS[this.config.types[0]] ?? '#ffffff').color;
      glow.setTint(color);
      this.glow = glow;
    }
    this.refreshBadge(scene);
  }

  setRangeVisible(v: boolean) {
    this.auraRing?.setVisible(v);
  }

  setSelected(scene: Phaser.Scene, selected: boolean) {
    if (selected) {
      this.auraRing?.setVisible(true);
      if (this.sprite) scene.tweens.add({ targets: this.sprite, scale: this.sprite.scale * 1.1, duration: 120, yoyo: true });
    } else {
      this.auraRing?.setVisible(false);
    }
  }

  syncView(now: number) {
    if (this.sprite) {
      this.sprite.setPosition(this.x, this.y);
      // 受击 / 开火时的轻微弹跳用缩放表现（不改变碰撞逻辑）
      if (now < this.castLockUntil && this.castLockUntil - now > 0) {
        const t = (this.castLockUntil - now) / 200;
        const pulse = 1 + Math.sin(Math.min(1, t) * Math.PI) * 0.04;
        this.sprite.setScale(this.sprite.scale, this.baseScaleY * pulse);
      }
    }
    this.glow?.setPosition(this.x, this.y);
    this.levelBadge?.setPosition(this.x + TILE * 0.34, this.y - TILE * 0.36);
    this.auraRing?.setPosition(this.x, this.y);
  }

  private baseScaleY = 1;
  setBaseScaleY(v: number) { this.baseScaleY = v; }

  destroyView() {
    this.sprite?.destroy();
    this.levelBadge?.destroy();
    this.auraRing?.destroy();
    this.glow?.destroy();
    this.sprite = null;
    this.levelBadge = null;
    this.auraRing = null;
    this.glow = null;
  }
}
