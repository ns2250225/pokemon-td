/**
 * 敌方单位（PokemonEnemy）。
 *
 * 承担：路径移动、状态效果、受击、特性行为（治疗 / 召唤 / 分裂 / 隐身 / 护盾 / 指挥官光环）。
 * 位置更新由 WaveSystem 在固定时间步长内驱动，渲染层只读取其结果。
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '../config';
import { textureKeys, type AssetService } from '../managers/AssetManager';
import type { EnemyConfig, EnemyTrait } from '../../data/pokemon/units';
import { TYPE_COLORS } from '../../data/balance/typeChart';
import { mergeStatus, summarizeStatuses, type ActiveStatus } from '../systems/CombatSystem';

export interface EnemySpawnOptions {
  config: EnemyConfig;
  /** 血量倍率（波次 / 关卡难度） */
  hpScale: number;
  /** 速度倍率 */
  speedScale: number;
  /** 金币奖励倍率 */
  rewardScale: number;
  /** 关卡难度系数，作用于伤害计算 */
  difficultyScale: number;
  /** 是否 BOSS */
  isBoss: boolean;
  /** 隐身周期（毫秒），0 表示不隐身 */
  stealthPeriodMs: number;
  /** 治疗光环范围与速率 */
  healRange: number;
  healPerSecond: number;
}

export class MovingEnemy {
  readonly id: number;
  readonly cfg: EnemyConfig;
  readonly traits: Set<EnemyTrait>;
  readonly isBoss: boolean;

  readonly maxHp: number;
  /** 治疗光环范围（像素），仅治疗型单位使用 */
  readonly healRange: number;
  /** 每秒治疗量上限（0 表示未启用） */
  readonly healPerSecond: number;
  hp: number;
  alive = true;
  reachedEnd = false;

  /** 世界坐标 */
  x = 0;
  y = 0;
  radius: number;

  /** 路径进度：已经走过的累计长度 */
  traveled = 0;
  /** 到终点的剩余距离 */
  distanceToEnd = 0;
  /** 同格邻居数，用于 mostDense 目标选择 */
  neighborCount = 0;

  /** 当前移动速度（像素/秒）。BOSS 阶段转换与加速技能会修改它。 */
  speed: number;
  /** 出生时的基础速度，用于按阶段倍率还原 */
  readonly baseSpeed: number;
  /** 速度锁定的截止模拟时间（0 表示未锁定） */
  speedLockUntil = 0;
  /** 阶段无敌截止时间（模拟毫秒） */
  invulnerableUntil = 0;
  /** 是否处于无敌（由 BOSS 阶段转换设置） */
  invulnerable = false;
  /** 隐身结束的模拟时间（0 表示使用周期性隐身） */
  stealthUntil = 0;
  readonly reward: number;
  readonly baseDamage: number;
  readonly difficultyScale: number;
  readonly armor: number;
  readonly magicResist: number;

  /** 状态效果 */
  statuses: ActiveStatus[] = [];
  /** 当前受到的易伤（由状态汇总） */
  vulnerability = 0;
  /** 隐身 */
  stealthPeriodMs = 0;
  stealthActive = false;
  /** 是否被侦测标记（被幽灵系命中后一段时间的显形） */
  revealedUntil = 0;
  /** 护盾（护盾型特性） */
  shield = 0;
  shieldMax = 0;
  /** 治疗型 / 指挥官：CD 计时 */
  private abilityCooldown = 0;
  /** 召唤型：已经召唤过的小怪数量 */
  summoned = 0;

  isFlying: boolean;
  /** 由 WaveSystem 写入的当前路径方向，仅用于渲染翻转 */
  dirX = 1;
  dirY = 0;
  /** 渲染对象 */
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
  private hpBarBg: Phaser.GameObjects.Rectangle | null = null;
  private hpBarFill: Phaser.GameObjects.Rectangle | null = null;
  private statusIcon: Phaser.GameObjects.Image | null = null;
  private auraRing: Phaser.GameObjects.Arc | null = null;

  constructor(options: EnemySpawnOptions) {
    const { config, hpScale, speedScale, rewardScale, difficultyScale, isBoss } = options;
    this.id = config.pokemonId;
    this.cfg = config;
    this.traits = new Set(config.traits);
    this.isBoss = isBoss;
    this.isFlying = config.isFlying;

    this.maxHp = Math.max(1, Math.round(config.hp * hpScale));
    this.hp = this.maxHp;
    this.speed = config.speed * speedScale;
    this.baseSpeed = this.speed;
    this.reward = Math.max(1, Math.round(config.reward * rewardScale));
    this.baseDamage = config.baseDamage;
    this.difficultyScale = difficultyScale;
    this.armor = config.armor;
    this.magicResist = config.magicResist;
    this.radius = 22 * config.size;

    this.stealthPeriodMs = options.stealthPeriodMs;
    // 治疗光环：仅治疗型单位实际生效，其余记录为 0
    this.healRange = this.traits.has('healer') ? options.healRange : 0;
    this.healPerSecond = this.traits.has('healer') ? options.healPerSecond : 0;
    if (this.traits.has('shielded')) {
      this.shieldMax = Math.round(this.maxHp * 0.28);
      this.shield = this.shieldMax;
    }
    // 召唤首发延迟：召唤型出场后先走一小段再放子体，避免同波所有召唤者
    // 在出生点同时爆出一轮子体（开场 10 秒 20+ 只的怪潮）
    this.abilityCooldown = this.traits.has('summoner') ? 2.5 : 0;
  }

  /** 应用一次伤害，返回实际扣除的血量 */
  applyDamage(amount: number): number {
    if (!this.alive) return 0;
    let remaining = amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining <= 0) return amount - remaining;
    this.hp -= remaining;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return amount;
  }

  applyStatus(status: ActiveStatus) {
    const idx = this.statuses.findIndex((s) => s.kind === status.kind);
    if (idx >= 0) this.statuses[idx] = { ...status, stacks: 1 };
    else this.statuses.push(status);
  }

  addStatusPartial(kind: ActiveStatus['kind'], partial: Partial<ActiveStatus>) {
    const idx = this.statuses.findIndex((s) => s.kind === kind);
    if (idx >= 0) this.statuses[idx] = { ...this.statuses[idx], ...partial };
    else this.statuses.push({ kind, expiresAt: 0, dps: 0, ratio: 0, stacks: 1, pendingKnockback: 0, sourceType: 'normal', maxStacks: 1, ...partial });
  }

  mergeStatusFrom(config: Parameters<typeof mergeStatus>[1], now: number, type: ActiveStatus['sourceType']) {
    const idx = this.statuses.findIndex((s) => s.kind === config.kind);
    const existing = idx >= 0 ? this.statuses[idx] : undefined;
    const merged = mergeStatus(existing, config, now, type);
    if (idx >= 0) this.statuses[idx] = merged;
    else this.statuses.push(merged);
  }

  /** 每 tick 结算持续伤害与状态过期 */
  tickStatuses(now: number): number {
    const mods = summarizeStatuses(this.statuses, now);
    this.vulnerability = mods.vulnerability;

    // 持续伤害
    let dot = 0;
    if (mods.dotPerSecond > 0) {
      dot = mods.dotPerSecond / 60;
      this.hp -= dot;
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
      }
    }

    // 清理过期状态
    if (this.statuses.length) {
      this.statuses = this.statuses.filter((s) => s.expiresAt > now);
    }

    // 击退位移在移动逻辑里消费
    return dot;
  }

  /** 消费击退量（返回本 tick 应反向移动的像素） */
  consumeKnockback(dtSeconds: number): number {
    let total = 0;
    for (const s of this.statuses) {
      if (s.pendingKnockback <= 0) continue;
      const step = Math.min(s.pendingKnockback, 140 * dtSeconds);
      s.pendingKnockback -= step;
      total += step;
    }
    return total;
  }

  /** 隐身更新 */
  updateStealth(now: number) {
    if (!this.stealthPeriodMs) return;
    const phase = (now % this.stealthPeriodMs) / this.stealthPeriodMs;
    this.stealthActive = phase > 0.45 && now > this.revealedUntil;
  }

  get visibleForTargeting(): boolean {
    return !this.stealthActive;
  }

  /** 特性行为：治疗 / 护盾回复 / 召唤（由 WaveSystem 调用） */
  tickAbilities(dtSeconds: number, ctx: {
    heal: (enemy: MovingEnemy, amount: number) => void;
    summon: (enemy: MovingEnemy) => void;
  }) {
    if (this.abilityCooldown > 0) {
      this.abilityCooldown -= dtSeconds;
      return;
    }

    if (this.traits.has('healer')) {
      this.abilityCooldown = 2.4;
      // 治疗自身与附近敌人
      return;
    }
    if (this.traits.has('summoner') && this.summoned < 2) {
      // 召唤上限与冷却控制波次的有效血量：无上限时一只召唤者在约 30 秒的
      // 行程里能召出 6 只，一个 10 只召唤者的波次会让场上敌人数翻 3 倍。
      this.abilityCooldown = 10.5;
      this.summoned++;
      ctx.summon(this);
      return;
    }
    if (this.traits.has('shielded') && this.shield <= 0) {
      this.abilityCooldown = 9;
      this.shield = this.shieldMax;
    }
  }

  /** 是否触发治疗（供 WaveSystem 执行范围恢复） */
  wantsHeal(): boolean {
    return this.traits.has('healer');
  }

  get hpRatio(): number {
    return Math.max(0, this.hp / this.maxHp);
  }

  get speedMultiplier(): number {
    const mods = summarizeStatuses(this.statuses, this.statuses[0]?.expiresAt ?? 0);
    return mods.speedMult;
  }

  /* ---------------------------------------------------------------- */
  /* 渲染                                                              */
  /* ---------------------------------------------------------------- */

  createView(scene: Phaser.Scene, assets: AssetService) {
    const keys = textureKeys(this.id);
    if (this.cfg.spriteKey && assets.getAtlasMeta(this.cfg.spriteKey) && scene.textures.exists(keys.animated)) {
      const animKey = assets.ensureSpriteAnimation(this.cfg.spriteKey, 'animated');
      const sprite = scene.add.sprite(this.x, this.y, keys.animated);
      if (animKey) sprite.play(animKey);
      sprite.setDepth(DEPTH.enemies + (this.isFlying ? 6 : 0));
      this.sprite = sprite;
    } else if (scene.textures.exists(keys.static)) {
      const img = scene.add.image(this.x, this.y, keys.static);
      img.setDepth(DEPTH.enemies + (this.isFlying ? 6 : 0));
      this.sprite = img;
      // 静态回退：用 Tween 实现待机呼吸（PRD 13.2 第二阶段）
      scene.tweens.add({
        targets: img,
        scaleY: { from: 1, to: 0.94 },
        y: { from: this.y, to: this.y - 2 },
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    if (this.sprite) {
      const baseScale = (TILE * 0.82 / Math.max(this.sprite.width, 1)) * this.cfg.size;
      this.sprite.setScale(baseScale);
      // 敌方朝左（朝向进攻方向由 WaveSystem 按路径切线翻转）
      this.sprite.setFlipX(true);

      // 命中闪白用 tint 实现，这里预留原始 tint
      const typeColor = Phaser.Display.Color.HexStringToColor(TYPE_COLORS[this.cfg.types[0]] ?? '#ffffff').color;
      if (this.isBoss) this.sprite.setTint(typeColor);
    }

    // BOSS：全身光环
    if (this.isBoss) {
      const ring = scene.add.circle(this.x, this.y, this.radius + 12, 0x000000, 0);
      ring.setStrokeStyle(3, 0xffcc44, 0.85);
      ring.setDepth(DEPTH.enemies - 1);
      this.auraRing = ring;
      scene.tweens.add({ targets: ring, scale: { from: 1, to: 1.14 }, alpha: { from: 0.9, to: 0.4 }, duration: 900, yoyo: true, repeat: -1 });
    }

    // 血条：只在受伤后显示，BOSS 常驻
    const barW = this.isBoss ? 96 : Math.max(34, this.radius * 2.4);
    const barY = this.y - this.radius - (this.isBoss ? 18 : 10);
    const bg = scene.add.rectangle(this.x, barY, barW, 6, 0x000000, 0.6).setDepth(DEPTH.enemies + 2);
    const fill = scene.add.rectangle(this.x - barW / 2, barY, barW, 4, 0x66dd66).setOrigin(0, 0.5).setDepth(DEPTH.enemies + 3);
    bg.setVisible(this.isBoss);
    fill.setVisible(this.isBoss);
    this.hpBarBg = bg;
    this.hpBarFill = fill;
    this.hpBarWidth = barW;

    // 状态图标
    const icon = scene.add.image(this.x, this.y - this.radius - 22, `fx-common-dot`).setDepth(DEPTH.enemies + 4);
    icon.setVisible(false).setScale(0.16);
    this.statusIcon = icon;
  }

  private hpBarWidth = 40;

  /** 每帧同步渲染对象 */
  syncView(scene: Phaser.Scene, now: number) {
    if (!this.sprite) return;
    const bob = this.traits.has('flying') ? Math.sin(now / 320) * 5 : 0;
    this.sprite.setPosition(this.x, this.y + bob);
    if (this.dirX !== 0) this.sprite.setFlipX(this.dirX < 0);

    const showBar = this.isBoss || this.hpRatio < 0.999;
    if (this.hpBarBg && this.hpBarFill) {
      const barY = this.y - this.radius - (this.isBoss ? 18 : 10);
      this.hpBarBg.setPosition(this.x, barY).setVisible(showBar);
      this.hpBarFill.setPosition(this.x - this.hpBarWidth / 2, barY).setVisible(showBar);
      this.hpBarFill.width = this.hpBarWidth * this.hpRatio;
      this.hpBarFill.fillColor = this.hpRatio > 0.5 ? 0x66dd66 : this.hpRatio > 0.22 ? 0xffcc44 : 0xff5555;
    }

    if (this.auraRing) this.auraRing.setPosition(this.x, this.y);

    // 状态图标：优先显示控制类状态
    if (this.statusIcon) {
      const active = this.statuses.filter((s) => s.expiresAt > now);
      const priority: ActiveStatus['kind'][] = ['freeze', 'stun', 'burn', 'poison', 'slow', 'curse', 'armorBreak', 'weaken'];
      const pick = priority.map((k) => active.find((s) => s.kind === k)).find(Boolean);
      if (pick) {
        const map: Record<string, string> = {
          freeze: 'fx-ice-frost', stun: 'fx-electric-spark_ring', burn: 'fx-common-flame',
          poison: 'fx-common-smoke', slow: 'fx-ice-crystal', curse: 'fx-common-portal',
          armorBreak: 'fx-common-ring', weaken: 'fx-psychic-psy_field',
        };
        const key = map[pick.kind];
        if (key && scene.textures.exists(key)) {
          this.statusIcon.setTexture(key).setVisible(true);
          this.statusIcon.setTint(pick.kind === 'burn' ? 0xff8844 : pick.kind === 'poison' ? 0xaa66cc : 0xffffff);
        } else {
          this.statusIcon.setVisible(false);
        }
        this.statusIcon.setPosition(this.x, this.y - this.radius - 22);
      } else {
        this.statusIcon.setVisible(false);
      }
    }

    // 隐身半透明
    if (this.sprite) this.sprite.setAlpha(this.stealthActive ? 0.32 : 1);
  }

  destroyView() {
    this.sprite?.destroy();
    this.hpBarBg?.destroy();
    this.hpBarFill?.destroy();
    this.statusIcon?.destroy();
    this.auraRing?.destroy();
    this.sprite = null;
    this.hpBarBg = null;
    this.hpBarFill = null;
    this.statusIcon = null;
    this.auraRing = null;
  }
}
