/**
 * 特效系统 —— 技能视觉表现的核心。
 *
 * 设计要点（PRD 5.4）：
 *  - 每个技能走完整阶段：CastStart → Projectile/Area → Impact → Damage/Status → Dissipate
 *  - 同一套纹理按招式配置着色 / 缩放 / 旋转，支持不同精灵复用同一技能效果
 *  - 对象池管理粒子与伤害数字，避免大量创建销毁
 *  - 提供低 / 中 / 高画质档位，移动端自动降低粒子密度
 *  - 震屏、闪白、命中停顿强度受画质与用户设置约束
 */
import Phaser from 'phaser';
import { DEPTH, QUALITY_CONFIG, type QualityLevel } from '../config';
import { FX, textureForEffect } from '../managers/AssetManager';
import { TYPE_COLORS, type PokemonType } from '../../data/balance/typeChart';
import type { MoveDef } from '../../data/moves/moves';

export interface EffectSettings {
  quality: QualityLevel;
  screenShakeEnabled: boolean;
  flashEnabled: boolean;
  damageNumbersEnabled: boolean;
  /** 用户自定义特效强度上限 0-1.5 */
  intensity: number;
}

export interface PlayMoveOptions {
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  type: PokemonType;
  move: MoveDef;
  /** 伤害回调：在命中帧触发，保证"伤害与动画同步" */
  onImpact?: () => void;
  /** 蓄力完成回调 */
  onCastComplete?: () => void;
  /** 本次播放是否跳过蓄力（例如快速连射） */
  skipCast?: boolean;
}

/** 招式特效阶段，用于 UI 与调试 */
export type EffectPhase = 'cast' | 'travel' | 'impact' | 'dissipate';

interface DamageText {
  text: Phaser.GameObjects.Text;
  createdAt: number;
  tween?: Phaser.Tweens.Tween;
}

export class EffectSystem {
  private scene: Phaser.Scene;
  private settings: EffectSettings;
  /** 当前活跃的高成本特效数，超过上限时降级 */
  private activeHeavy = 0;
  private damageTextPool: DamageText[] = [];
  private activeDamageTexts: DamageText[] = [];
  /** 共享的粒子发射器配置缓存 */
  private emitterConfigs = new Map<string, Phaser.Types.GameObjects.Particles.ParticleEmitterConfig>();

  constructor(scene: Phaser.Scene, settings: EffectSettings) {
    this.scene = scene;
    this.settings = settings;
  }

  get config() {
    return QUALITY_CONFIG[this.settings.quality];
  }

  updateSettings(settings: Partial<EffectSettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  /** 粒子数量按画质与用户强度缩放 */
  private scaleParticles(base: number): number {
    const c = this.config;
    const scaled = base * c.particles * this.settings.intensity;
    // 移动端硬上限：同时存在的粒子不超过 220
    return Math.max(0, Math.round(Math.min(scaled, 64)));
  }

  private shake(intensity: number, duration = 160) {
    if (!this.settings.screenShakeEnabled) return;
    const amount = intensity * this.config.screenShake * this.settings.intensity;
    if (amount <= 0.001) return;
    this.scene.cameras.main.shake(duration, Math.min(0.02, amount * 0.02));
  }

  private flash(x: number, y: number, color: number, alpha: number, radius: number) {
    if (!this.settings.flashEnabled) return;
    const a = alpha * this.config.flash * this.settings.intensity;
    if (a <= 0.01) return;
    const img = this.scene.add.image(x, y, FX.common.dotSoft);
    img.setTint(color).setAlpha(Math.min(0.85, a)).setDepth(DEPTH.effectsUpper);
    img.setDisplaySize(radius * 2.6, radius * 2.6).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      scale: img.scale * 1.35,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => img.destroy(),
    });
  }

  /** 命中停顿：短暂把场景的物理/时间推进降到极慢，强化打击感 */
  private hitStop(ms: number) {
    if (!this.config.hitStop || ms <= 0) return;
    // 由 BattleScene 通过 timeScale 处理；这里用相机缩放微脉冲代替，
    // 避免直接改动全局时间导致伤害计算漂移（PRD 5.4 要求伤害与视觉分离）。
    const cam = this.scene.cameras.main;
    const original = cam.zoom;
    this.scene.tweens.add({
      targets: cam,
      zoom: original * 1.012,
      duration: ms * 0.35,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /* ------------------------------------------------------------------ */
  /* 主入口                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * 播放一次完整招式。
   * 返回 Promise，在消散阶段结束后 resolve，便于上层做节奏控制。
   */
  async playMove(opts: PlayMoveOptions): Promise<void> {
    const { move, type, originX, originY, targetX, targetY } = opts;
    const colorHex = move.effects.color ?? TYPE_COLORS[type];
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;

    const tierScale = { common: 0.75, enhanced: 1, epic: 1.35, legendary: 1.9 }[move.effectTier];
    const castMs = opts.skipCast ? 0 : (move.effects.castMs ?? 0) / Math.max(1, this.settings.quality === 'low' ? 2 : 1);

    /* ---- CastStart：蓄力 ---- */
    if (castMs > 0 && this.activeHeavy < this.config.maxConcurrentEffects) {
      this.activeHeavy++;
      this.playCast(move, originX, originY, color, tierScale);
      await this.wait(castMs);
      this.activeHeavy--;
    }
    opts.onCastComplete?.();

    /* ---- Projectile / Area → Impact ---- */
    const speed = move.effects.speed ?? 0;
    if (speed > 0) {
      await this.playProjectile(move, originX, originY, targetX, targetY, color, tierScale, opts.onImpact);
    } else {
      // 瞬发 / 范围技能：直接进入命中
      this.playImpactAt(move, targetX, targetY, color, tierScale);
      opts.onImpact?.();
      await this.wait(Math.min(140, 60 + (move.effects.hitStopMs ?? 0)));
    }

    /* ---- Damage / Status 的表现层 ---- */
    this.playImpactExtras(move, targetX, targetY, color, tierScale);

    /* ---- Dissipate：粒子消散 ---- */
    this.playDissipate(move, targetX, targetY, color, tierScale);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.scene.time.delayedCall(ms, resolve));
  }

  /* ------------------------------------------------------------------ */
  /* 阶段实现                                                            */
  /* ------------------------------------------------------------------ */

  private playCast(move: MoveDef, x: number, y: number, color: number, tierScale: number) {
    const texture = textureForEffect(move.effects.cast) ?? FX.common.dotSoft;
    const count = this.scaleParticles(move.effects.particles ?? 20);

    // 蓄力光环：从大到小收缩，暗示能量聚集
    const halo = this.scene.add.image(x, y, texture);
    halo.setTint(color).setDepth(DEPTH.effectsLower).setBlendMode(Phaser.BlendModes.ADD);
    halo.setDisplaySize(110 * tierScale, 110 * tierScale).setAlpha(0.9);
    this.scene.tweens.add({
      targets: halo,
      displayWidth: 34 * tierScale,
      displayHeight: 34 * tierScale,
      alpha: 0.2,
      duration: move.effects.castMs ?? 400,
      ease: 'Quad.easeIn',
      onComplete: () => halo.destroy(),
    });

    // 环绕粒子：围绕原点向内收拢
    if (count > 0) {
      const emitter = this.scene.add.particles(x, y, FX.common.dot, {
        speed: { min: 30, max: 90 },
        scale: { start: 0.32 * tierScale, end: 0.05 },
        alpha: { start: 0.95, end: 0 },
        lifespan: move.effects.castMs ?? 400,
        quantity: Math.max(1, Math.round(count / 6)),
        frequency: 40,
        tint: color,
        blendMode: Phaser.BlendModes.ADD,
        emitting: true,
      });
      emitter.setDepth(DEPTH.effectsLower);
      this.scene.time.delayedCall(move.effects.castMs ?? 400, () => {
        emitter.stop();
        this.scene.time.delayedCall(300, () => emitter.destroy());
      });
    }

    // 蓄力时脚下出现法阵
    const rune = this.scene.add.image(x, y + 8, FX.ultimate.rune);
    rune.setTint(color).setDepth(DEPTH.effectsLower - 1).setBlendMode(Phaser.BlendModes.ADD);
    rune.setDisplaySize(70 * tierScale, 70 * tierScale).setAlpha(0);
    this.scene.tweens.add({
      targets: rune,
      alpha: { from: 0, to: 0.75 },
      angle: 180,
      duration: move.effects.castMs ?? 400,
      onComplete: () => {
        this.scene.tweens.add({ targets: rune, alpha: 0, duration: 180, onComplete: () => rune.destroy() });
      },
    });
  }

  private playProjectile(
    move: MoveDef,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: number,
    tierScale: number,
    onImpact?: () => void,
  ): Promise<void> {
    const texture = textureForEffect(move.effects.projectile) ?? FX.common.dot;
    const speed = move.effects.speed ?? 600;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy) || 1;
    const duration = Math.max(60, (dist / speed) * 1000);
    const angle = Math.atan2(dy, dx);

    return new Promise((resolve) => {
      const proj = this.scene.add.image(fromX, fromY, texture);
      const baseSize = (move.targeting === 'pierce' || move.targeting === 'line' ? 46 : 34) * tierScale;
      proj.setTint(color).setDepth(DEPTH.projectiles).setBlendMode(Phaser.BlendModes.ADD);
      proj.setDisplaySize(baseSize, baseSize);
      if (move.targeting === 'pierce' || move.targeting === 'line' || move.targeting === 'cone') {
        proj.setRotation(angle);
      } else {
        proj.setRotation(angle + Math.PI / 4);
      }

      this.scene.tweens.add({
        targets: proj,
        x: toX,
        y: toY,
        duration,
        ease: 'Linear',
        onComplete: () => {
          proj.destroy();
          this.playImpactAt(move, toX, toY, color, tierScale);
          onImpact?.();
          resolve();
        },
      });

      // 拖尾
      if (this.config.trails && (move.effects.trail || move.effectTier !== 'common')) {
        const count = this.scaleParticles(8);
        if (count > 0) {
          const trail = this.scene.add.particles(fromX, fromY, FX.common.dotSoft, {
            speed: { min: 0, max: 18 },
            scale: { start: 0.28 * tierScale, end: 0.02 },
            alpha: { start: 0.7, end: 0 },
            lifespan: 260,
            quantity: 1,
            frequency: 24,
            tint: color,
            blendMode: Phaser.BlendModes.ADD,
          });
          trail.setDepth(DEPTH.projectiles - 1);
          this.scene.tweens.add({
            targets: trail,
            x: toX,
            y: toY,
            duration,
            ease: 'Linear',
            onComplete: () => {
              trail.stop();
              this.scene.time.delayedCall(320, () => trail.destroy());
            },
          });
        }
      }
    });
  }

  /** 命中瞬间的主体表现（爆炸 / 冲击波 / 闪光） */
  private playImpactAt(move: MoveDef, x: number, y: number, color: number, tierScale: number) {
    const texture = textureForEffect(move.effects.impact) ?? FX.common.nova;
    const tier = move.effectTier;

    // 冲击波圆环
    const wave = this.scene.add.image(x, y, FX.common.shockwave);
    wave.setTint(color).setDepth(DEPTH.effectsUpper).setBlendMode(Phaser.BlendModes.ADD);
    wave.setDisplaySize(24 * tierScale, 24 * tierScale).setAlpha(0.95);
    this.scene.tweens.add({
      targets: wave,
      displayWidth: 130 * tierScale,
      displayHeight: 130 * tierScale,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => wave.destroy(),
    });

    // 主命中图案
    const burst = this.scene.add.image(x, y, texture);
    burst.setTint(color).setDepth(DEPTH.effectsUpper).setBlendMode(Phaser.BlendModes.ADD);
    const burstSize = 60 * tierScale;
    burst.setDisplaySize(burstSize * 0.6, burstSize * 0.6).setAlpha(1);
    this.scene.tweens.add({
      targets: burst,
      displayWidth: burstSize,
      displayHeight: burstSize,
      alpha: 0,
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => burst.destroy(),
    });

    // 命中粒子
    const count = this.scaleParticles(move.effects.particles ?? 18);
    if (count > 0) {
      const emitter = this.scene.add.particles(x, y, FX.common.dot, {
        speed: { min: 60, max: 260 * tierScale },
        scale: { start: 0.3 * tierScale, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: { min: 220, max: 520 },
        quantity: count,
        tint: [color, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      });
      emitter.setDepth(DEPTH.effectsUpper);
      emitter.explode(count);
      this.scene.time.delayedCall(700, () => emitter.destroy());
    }

    // 闪光与震屏
    const flashAlpha = move.effects.flash ?? (tier === 'legendary' ? 0.4 : tier === 'epic' ? 0.25 : 0);
    if (flashAlpha > 0) this.flash(x, y, color, flashAlpha, 60 * tierScale);
    const shakeAmt = move.effects.screenShake ?? (tier === 'legendary' ? 0.3 : tier === 'epic' ? 0.16 : 0.05);
    this.shake(shakeAmt, tier === 'legendary' ? 260 : 160);
    if (move.effects.hitStopMs) this.hitStop(move.effects.hitStopMs);
  }

  /** 持续场：燃烧地面、毒池、冰面、暗影领域等 */
  private playImpactExtras(move: MoveDef, x: number, y: number, color: number, tierScale: number) {
    const st = move.status;
    if (!st) return;

    const radius = (move.radius ?? 70) * (move.effects.qualityScaling === false ? 1 : 1);
    const duration = Math.min(4000, Math.max(700, st.durationMs * 0.6));

    let texture = FX.common.dotSoft;
    if (st.kind === 'burn') texture = FX.common.flame;
    else if (st.kind === 'poison') texture = FX.common.smoke;
    else if (st.kind === 'freeze' || st.kind === 'slow') texture = FX.ice.frost;
    else if (st.kind === 'curse') texture = FX.common.portal;
    else if (st.kind === 'stun') texture = FX.electric.sparkRing;
    else if (st.kind === 'armorBreak') texture = FX.common.ring;
    else if (st.kind === 'weaken') texture = FX.psychic.psyField;

    const field = this.scene.add.image(x, y, texture);
    field.setTint(color).setDepth(DEPTH.effectsLower).setBlendMode(Phaser.BlendModes.ADD);
    field.setDisplaySize(radius * 1.6, radius * 1.3).setAlpha(0);
    field.setRotation(Math.random() * Math.PI);
    this.scene.tweens.add({
      targets: field,
      alpha: { from: 0, to: 0.55 },
      duration: 200,
      yoyo: true,
      hold: duration,
      onComplete: () => field.destroy(),
    });

    // 持续冒泡 / 飘升粒子
    const count = this.scaleParticles(move.effects.particles ? Math.round(move.effects.particles / 3) : 8);
    if (count > 0) {
      const emitter = this.scene.add.particles(x, y, FX.common.dot, {
        speed: { min: 8, max: 34 },
        scale: { start: 0.22 * tierScale, end: 0 },
        alpha: { start: 0.75, end: 0 },
        lifespan: { min: 400, max: 900 },
        quantity: Math.max(1, Math.round(count / 4)),
        frequency: 110,
        tint: color,
        blendMode: Phaser.BlendModes.ADD,
        emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, radius * 0.7) } as never,
      });
      emitter.setDepth(DEPTH.effectsLower);
      this.scene.time.delayedCall(duration, () => {
        emitter.stop();
        this.scene.time.delayedCall(700, () => emitter.destroy());
      });
    }
  }

  /** 消散阶段：遗留粒子上浮淡出 */
  private playDissipate(move: MoveDef, x: number, y: number, color: number, tierScale: number) {
    if (move.effectTier === 'common' && this.settings.quality !== 'high') return;
    const count = this.scaleParticles(Math.round((move.effects.particles ?? 12) / 2));
    if (count <= 0) return;

    const emitter = this.scene.add.particles(x, y, FX.common.dotSoft, {
      speed: { min: 10, max: 60 },
      scale: { start: 0.3 * tierScale, end: 0 },
      alpha: { start: 0.6, end: 0 },
      lifespan: 620,
      quantity: Math.max(1, Math.round(count / 3)),
      frequency: 90,
      tint: color,
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.setDepth(DEPTH.effectsLower);
    this.scene.time.delayedCall(420, () => {
      emitter.stop();
      this.scene.time.delayedCall(700, () => emitter.destroy());
    });
  }

  /* ------------------------------------------------------------------ */
  /* 通用表现                                                            */
  /* ------------------------------------------------------------------ */

  /** 伤害数字（对象池） */
  popDamage(x: number, y: number, amount: number, color = '#ffffff', crit = false) {
    if (!this.settings.damageNumbersEnabled) return;
    const pooled = this.damageTextPool.pop();
    const text = pooled?.text ?? this.scene.add.text(0, 0, '', {
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      fontSize: crit ? '26px' : '20px',
      fontStyle: 'bold',
      color,
      stroke: '#101418',
      strokeThickness: 4,
    });
    text.setText(crit ? `${amount}!` : String(amount));
    text.setColor(color);
    text.setFontSize(crit ? 26 : 20);
    text.setPosition(x + Phaser.Math.Between(-8, 8), y - 10);
    text.setDepth(DEPTH.damageText).setAlpha(1).setScale(crit ? 1.25 : 1).setActive(true).setVisible(true);

    const record: DamageText = { text, createdAt: this.scene.time.now };
    this.activeDamageTexts.push(record);

    this.scene.tweens.add({
      targets: text,
      y: y - 46 - (crit ? 12 : 0),
      alpha: 0,
      scale: crit ? 1.05 : 0.85,
      duration: crit ? 800 : 620,
      ease: 'Quad.easeOut',
      onComplete: () => {
        const i = this.activeDamageTexts.indexOf(record);
        if (i >= 0) this.activeDamageTexts.splice(i, 1);
        text.setVisible(false).setActive(false);
        if (this.damageTextPool.length < 60) this.damageTextPool.push({ text, createdAt: 0 });
        else text.destroy();
      },
    });
  }

  /** 状态效果图标飘字（减速 / 冻结 / 中毒等） */
  popStatus(x: number, y: number, label: string, color: string) {
    if (!this.settings.damageNumbersEnabled) return;
    const text = this.scene.add.text(x, y - 24, label, {
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      color,
      stroke: '#101418',
      strokeThickness: 3,
    });
    text.setDepth(DEPTH.damageText).setOrigin(0.5);
    this.scene.tweens.add({
      targets: text,
      y: y - 56,
      alpha: 0,
      duration: 900,
      ease: 'Quad.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  /** 精灵球登场动画（建造时播放） */
  async playSpawnAnimation(x: number, y: number, spriteKey: string, scale: number): Promise<void> {
    // 1. 精灵球落下
    const ball = this.scene.add.circle(x, y - 260, 18, 0xee4444);
    ball.setStrokeStyle(5, 0xf5f5f5).setDepth(DEPTH.effectsUpper);
    const lower = this.scene.add.rectangle(x, y - 260 - 18, 36, 18, 0xf5f5f5).setDepth(DEPTH.effectsUpper);
    lower.setOrigin(0.5, 0);

    await new Promise<void>((resolve) => {
      this.scene.tweens.add({
        targets: [ball, lower],
        y: y - 20,
        duration: 340,
        ease: 'Bounce.easeOut',
        onComplete: () => resolve(),
      });
    });

    // 2. 开球白光
    const burst = this.scene.add.image(x, y - 20, FX.common.dotSoft);
    burst.setTint(0xffffff).setDepth(DEPTH.effectsUpper).setBlendMode(Phaser.BlendModes.ADD);
    burst.setDisplaySize(20, 20).setAlpha(1);
    ball.destroy();
    lower.destroy();
    this.scene.tweens.add({
      targets: burst,
      displayWidth: 200,
      displayHeight: 200,
      alpha: 0,
      duration: 420,
      ease: 'Quad.easeOut',
      onComplete: () => burst.destroy(),
    });

    // 3. 精灵从中心弹出
    const sprite = this.scene.add.image(x, y, spriteKey);
    sprite.setScale(scale * 0.2).setAlpha(0).setDepth(DEPTH.towers);
    await new Promise<void>((resolve) => {
      this.scene.tweens.add({
        targets: sprite,
        scale,
        alpha: 1,
        duration: 360,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.tweens.add({ targets: sprite, alpha: 0, duration: 220, onComplete: () => { sprite.destroy(); resolve(); } });
        },
      });
    });
  }

  /** 升级 / 进化的光芒爆发 */
  playUpgradeFx(x: number, y: number, color: number, tier: 'level' | 'evolution' | 'ultimate') {
    const size = tier === 'evolution' ? 220 : tier === 'ultimate' ? 300 : 140;
    const ringColor = tier === 'ultimate' ? 0xffe066 : color;

    for (let i = 0; i < (tier === 'level' ? 1 : 3); i++) {
      this.scene.time.delayedCall(i * 120, () => {
        const ring = this.scene.add.image(x, y, FX.common.shockwave);
        ring.setTint(ringColor).setDepth(DEPTH.effectsUpper).setBlendMode(Phaser.BlendModes.ADD);
        ring.setDisplaySize(20, 20).setAlpha(0.9);
        this.scene.tweens.add({
          targets: ring,
          displayWidth: size,
          displayHeight: size,
          alpha: 0,
          duration: 620,
          ease: 'Cubic.easeOut',
          onComplete: () => ring.destroy(),
        });
      });
    }

    const count = this.scaleParticles(tier === 'evolution' ? 46 : tier === 'ultimate' ? 64 : 20);
    if (count > 0) {
      const emitter = this.scene.add.particles(x, y, FX.common.star6, {
        speed: { min: 60, max: 200 },
        scale: { start: 0.4, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: 800,
        quantity: count,
        tint: [ringColor, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
        rotate: { min: 0, max: 360 },
      });
      emitter.setDepth(DEPTH.effectsUpper);
      emitter.explode(count);
      this.scene.time.delayedCall(1000, () => emitter.destroy());
    }

    this.flash(x, y, ringColor, tier === 'level' ? 0.2 : 0.45, size * 0.35);
    this.shake(tier === 'level' ? 0.08 : tier === 'evolution' ? 0.24 : 0.36, 300);

    if (tier === 'evolution') {
      // 进化：白色光柱
      const pillar = this.scene.add.image(x, y - 60, FX.ultimate.beamCore);
      pillar.setTint(0xffffff).setDepth(DEPTH.effectsUpper).setBlendMode(Phaser.BlendModes.ADD);
      pillar.setDisplaySize(70, 260).setRotation(-Math.PI / 2).setAlpha(0.95);
      this.scene.tweens.add({
        targets: pillar,
        alpha: 0,
        displayWidth: 120,
        duration: 700,
        ease: 'Quad.easeOut',
        onComplete: () => pillar.destroy(),
      });
    }
  }

  /** BOSS 技能预警：地面出现警示圈 */
  playWarning(x: number, y: number, radius: number, durationMs: number, color = '#ff5c5c') {
    const ring = this.scene.add.circle(x, y, radius, 0x000000, 0);
    ring.setStrokeStyle(4, Phaser.Display.Color.HexStringToColor(color).color, 0.9);
    ring.setDepth(DEPTH.effectsLower - 1);
    const fill = this.scene.add.circle(x, y, radius, Phaser.Display.Color.HexStringToColor(color).color, 0.12);
    fill.setDepth(DEPTH.effectsLower - 2);

    this.scene.tweens.add({
      targets: [ring, fill],
      alpha: { from: 1, to: 0.25 },
      duration: 260,
      yoyo: true,
      repeat: Math.max(1, Math.floor(durationMs / 520)),
    });
    this.scene.time.delayedCall(durationMs, () => {
      ring.destroy();
      fill.destroy();
    });
  }

  /** 敌人抵达终点 / 基地受击 */
  playBaseHit(x: number, y: number) {
    this.flash(x, y, 0xff4444, 0.6, 90);
    this.shake(0.5, 320);
    const img = this.scene.add.image(x, y, FX.common.nova);
    img.setTint(0xff5555).setDepth(DEPTH.effectsUpper).setBlendMode(Phaser.BlendModes.ADD);
    img.setDisplaySize(50, 50).setAlpha(1);
    this.scene.tweens.add({
      targets: img,
      displayWidth: 200,
      displayHeight: 200,
      alpha: 0,
      duration: 420,
      onComplete: () => img.destroy(),
    });
  }

  /** 敌人死亡 */
  playDeath(x: number, y: number, types: PokemonType[], isBoss = false) {
    const color = Phaser.Display.Color.HexStringToColor(TYPE_COLORS[types[0]] ?? '#ffffff').color;
    const count = this.scaleParticles(isBoss ? 70 : 16);
    if (count > 0) {
      const emitter = this.scene.add.particles(x, y, FX.common.dot, {
        speed: { min: 40, max: isBoss ? 300 : 150 },
        scale: { start: isBoss ? 0.5 : 0.25, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: { min: 300, max: 700 },
        quantity: count,
        tint: [color, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      });
      emitter.setDepth(DEPTH.effectsUpper);
      emitter.explode(count);
      this.scene.time.delayedCall(900, () => emitter.destroy());
    }

    const puff = this.scene.add.image(x, y, FX.common.smoke);
    puff.setTint(0xffffff).setDepth(DEPTH.effectsLower).setAlpha(0.7);
    puff.setDisplaySize(isBoss ? 120 : 40, isBoss ? 120 : 40);
    this.scene.tweens.add({
      targets: puff,
      displayWidth: isBoss ? 280 : 90,
      displayHeight: isBoss ? 280 : 90,
      alpha: 0,
      duration: isBoss ? 700 : 380,
      onComplete: () => puff.destroy(),
    });

    if (isBoss) this.shake(0.5, 500);
  }

  /** 金币拾取飘字 */
  playCoin(x: number, y: number, amount: number) {
    const text = this.scene.add.text(x, y, `+${amount}`, {
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#ffd76e',
      stroke: '#4a3200',
      strokeThickness: 4,
    });
    text.setDepth(DEPTH.damageText).setOrigin(0.5);
    this.scene.tweens.add({
      targets: text,
      y: y - 40,
      alpha: 0,
      duration: 700,
      ease: 'Quad.easeOut',
      onComplete: () => text.destroy(),
    });
  }

  /** 清理所有遗留对象（离开关卡时调用，避免内存泄漏） */
  destroy() {
    for (const d of this.activeDamageTexts) d.text.destroy();
    for (const d of this.damageTextPool) d.text.destroy();
    this.activeDamageTexts = [];
    this.damageTextPool = [];
    this.emitterConfigs.clear();
  }
}
