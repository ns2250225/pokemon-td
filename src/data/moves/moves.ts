/**
 * 技能（招式）数据库 —— 数据驱动，战斗逻辑只读取此表，不硬编码任何招式行为。
 *
 * 每个招式带完整特效编排（PRD 5.4）：
 *   Idle → CastStart(蓄力) → Projectile/Area(弹道/范围) → Impact(命中)
 *        → Damage/Status(伤害与状态) → Dissipate(消散)
 *
 * targeting 取值：
 *   single   单体
 *   chain    连锁弹射
 *   pierce   直线穿透
 *   area     圆形范围
 *   cone     锥形范围（朝向目标）
 *   line     矩形直线范围
 *   multi    多目标齐射
 *   global   全屏随机
 *   aura     自身周围持续场
 *
 * effectTier: common 普通 / enhanced 强化 / epic 史诗 / legendary 传说
 */
import type { PokemonType } from '../balance/typeChart';

export type TargetingMode =
  | 'single' | 'chain' | 'pierce' | 'area' | 'cone' | 'line' | 'multi' | 'global' | 'aura';

export type EffectTier = 'common' | 'enhanced' | 'epic' | 'legendary';

export interface StatusEffectConfig {
  kind: 'burn' | 'slow' | 'freeze' | 'stun' | 'poison' | 'curse' | 'armorBreak' | 'knockback' | 'weaken' | 'mark';
  durationMs: number;
  /** 每秒伤害（持续伤害类）或每层数值 */
  value?: number;
  /** 减速比例 0–1 */
  ratio?: number;
  /** 击退距离（像素） */
  distance?: number;
  /** 最大叠加层数 */
  maxStacks?: number;
}

export interface MoveEffects {
  cast?: string;
  projectile?: string;
  impact?: string;
  dissipate?: string;
  trail?: string;
  screenShake?: number;
  flash?: number;
  hitStopMs?: number;
  particles?: number;
  qualityScaling?: boolean;
  /** 特效主色，留空则由属性色决定 */
  color?: string;
  /** 弹道速度（像素/秒），0 表示瞬发 */
  speed?: number;
  /** 蓄力时长（毫秒） */
  castMs?: number;
}

export interface MoveDef {
  id: string;
  name: string;
  nameEn: string;
  type: PokemonType;
  category: 'physical' | 'special' | 'status';
  /** 伤害倍率，作用于精灵的基础攻击力 */
  damageMultiplier: number;
  cooldownMs: number;
  targeting: TargetingMode;
  effectTier: EffectTier;
  /** 连锁目标数 */
  maxTargets?: number;
  /** 连锁跳跃距离 */
  chainRange?: number;
  /** 范围半径（像素） */
  radius?: number;
  /** 锥形张角（度） */
  coneAngle?: number;
  /** 直线长度 */
  length?: number;
  /** 直线宽度 */
  width?: number;
  /** 多段命中段数 */
  hits?: number;
  /** 段与段之间的间隔 */
  hitIntervalMs?: number;
  /** 是否穿透护甲（钢系 / 格斗系特性） */
  ignoreArmor?: boolean;
  /** 是否可命中隐身单位 */
  revealsStealth?: boolean;
  /** 是否对空 */
  canHitFlying?: boolean;
  /** 是否只能对空 */
  airOnly?: boolean;
  /** 目标优先级偏好 */
  preferTarget?: 'first' | 'last' | 'strongest' | 'weakest' | 'closest' | 'mostDense';
  status?: StatusEffectConfig;
  /** 自身增益（妖精系增益、影子分身等多重攻击） */
  selfBuff?: {
    kind: 'attackSpeed' | 'damage' | 'range' | 'multiShot';
    ratio: number;
    durationMs: number;
  };
  effects: MoveEffects;
  description: string;
}

const M = (def: MoveDef): MoveDef => def;

export const MOVES: Record<string, MoveDef> = Object.fromEntries(
  [
    /* ============================ 一般 ============================ */
    M({
      id: 'tackle', name: '撞击', nameEn: 'Tackle', type: 'normal', category: 'physical',
      damageMultiplier: 0.9, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { impact: 'hit_spark', screenShake: 0.02, particles: 6, speed: 420, qualityScaling: true },
      description: '最基础的物理攻击，数值稳定、无附加效果。',
    }),
    M({
      id: 'quickattack', name: '电光一闪', nameEn: 'Quick Attack', type: 'normal', category: 'physical',
      damageMultiplier: 0.75, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'speed_line', impact: 'hit_spark', speed: 900, particles: 8, qualityScaling: true },
      description: '高速冲刺撞击，弹道极快、冷却极短。',
    }),
    M({
      id: 'hyperbeam', name: '破坏光线', nameEn: 'Hyper Beam', type: 'normal', category: 'special',
      damageMultiplier: 3.4, cooldownMs: 6100, targeting: 'pierce', effectTier: 'legendary',
      ignoreArmor: true, length: 460, width: 34,
      effects: {
        cast: 'charge_orbs', projectile: 'hyper_beam', impact: 'beam_burst',
        screenShake: 0.34, flash: 0.5, hitStopMs: 90, particles: 64, speed: 1700, castMs: 900, qualityScaling: true,
      },
      description: '蓄力后射出贯穿全场的巨型光束，无视护甲。',
    }),
    M({
      id: 'gigaimpact', name: '终极冲击', nameEn: 'Giga Impact', type: 'normal', category: 'physical',
      damageMultiplier: 3.0, cooldownMs: 5000, targeting: 'single', effectTier: 'epic',
      effects: {
        cast: 'charge_orbs', projectile: 'dash_trail', impact: 'impact_shock',
        screenShake: 0.3, hitStopMs: 80, particles: 40, speed: 1300, castMs: 620, qualityScaling: true,
      },
      description: '高亮冲刺后单目标爆发，命中时全场停顿。',
    }),
    M({
      id: 'swift', name: '高速星星', nameEn: 'Swift', type: 'normal', category: 'special',
      damageMultiplier: 0.7, cooldownMs: 1800, targeting: 'multi', maxTargets: 3, effectTier: 'common',
      effects: { projectile: 'star_shot', impact: 'hit_spark', particles: 18, speed: 620, qualityScaling: true },
      description: '射出多枚星形飞弹，必定命中的多目标攻击。',
    }),

    /* ============================ 火 ============================ */
    M({
      id: 'ember', name: '火花', nameEn: 'Ember', type: 'fire', category: 'special',
      damageMultiplier: 1.0, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      status: { kind: 'burn', durationMs: 3000, value: 4 },
      effects: { projectile: 'fireball', impact: 'fire_burst', trail: 'fire_trail', particles: 14, speed: 520, qualityScaling: true },
      description: '小火球命中并点燃目标，造成持续伤害。',
    }),
    M({
      id: 'flamethrower', name: '喷射火焰', nameEn: 'Flamethrower', type: 'fire', category: 'special',
      damageMultiplier: 1.35, cooldownMs: 2300, targeting: 'cone', coneAngle: 46, length: 210, effectTier: 'enhanced',
      status: { kind: 'burn', durationMs: 4000, value: 7 },
      effects: {
        cast: 'flame_charge', projectile: 'flame_stream', impact: 'fire_field',
        screenShake: 0.1, flash: 0.16, particles: 42, speed: 0, castMs: 240, qualityScaling: true,
      },
      description: '向目标方向喷出锥形火焰，持续灼烧区域内的敌人。',
    }),
    M({
      id: 'fireblast', name: '大字爆炎', nameEn: 'Fire Blast', type: 'fire', category: 'special',
      damageMultiplier: 2.1, cooldownMs: 4200, targeting: 'area', radius: 96, effectTier: 'epic',
      status: { kind: 'burn', durationMs: 5000, value: 10 },
      effects: {
        cast: 'flame_charge', projectile: 'fireball_big', impact: 'fire_explosion',
        screenShake: 0.24, flash: 0.3, particles: 56, speed: 460, castMs: 420, qualityScaling: true,
      },
      description: '射出大字形火球，爆炸后在地面留下燃烧区域。',
    }),
    M({
      id: 'blastburn', name: '爆炸烈焰', nameEn: 'Blast Burn', type: 'fire', category: 'special',
      damageMultiplier: 3.1, cooldownMs: 7200, targeting: 'area', radius: 140, effectTier: 'legendary',
      effects: {
        cast: 'flame_pillar', projectile: 'meteor_fire', impact: 'inferno',
        screenShake: 0.42, flash: 0.55, hitStopMs: 100, particles: 96, speed: 700, castMs: 1100, qualityScaling: true,
      },
      description: '召唤陨火轰击大片区域，火系终极招式。',
    }),

    /* ============================ 水 ============================ */
    M({
      id: 'watergun', name: '水枪', nameEn: 'Water Gun', type: 'water', category: 'special',
      damageMultiplier: 0.95, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'water_drop', impact: 'splash', particles: 12, speed: 620, qualityScaling: true },
      description: '高压水弹，基础水系攻击。',
    }),
    M({
      id: 'waterpulse', name: '水之波动', nameEn: 'Water Pulse', type: 'water', category: 'special',
      damageMultiplier: 1.2, cooldownMs: 2500, targeting: 'pierce', length: 300, width: 30, effectTier: 'enhanced',
      effects: { projectile: 'water_ring', impact: 'splash_burst', particles: 26, speed: 760, qualityScaling: true },
      description: '射出环形水波，穿透直线上的多个敌人。',
    }),
    M({
      id: 'hydropump', name: '水炮', nameEn: 'Hydro Pump', type: 'water', category: 'special',
      damageMultiplier: 2.3, cooldownMs: 3700, targeting: 'pierce', length: 420, width: 38, effectTier: 'epic',
      status: { kind: 'knockback', durationMs: 0, distance: 34 },
      effects: {
        cast: 'water_charge', projectile: 'hydro_jet', impact: 'water_column',
        screenShake: 0.2, flash: 0.22, particles: 48, speed: 1100, castMs: 380, qualityScaling: true,
      },
      description: '高压水柱贯穿全场，并把命中的敌人推回一段距离。',
    }),
    M({
      id: 'surf', name: '冲浪', nameEn: 'Surf', type: 'water', category: 'special',
      damageMultiplier: 2.0, cooldownMs: 5500, targeting: 'line', length: 520, width: 96, effectTier: 'legendary',
      status: { kind: 'knockback', durationMs: 0, distance: 56, ratio: 0.3 },
      effects: {
        cast: 'water_charge', projectile: 'giant_wave', impact: 'wave_crash',
        screenShake: 0.36, flash: 0.3, particles: 84, speed: 520, castMs: 780, qualityScaling: true,
      },
      description: '掀起巨大水浪横扫整条道路，群体击退。',
    }),

    /* ============================ 草 ============================ */
    M({
      id: 'vinewhip', name: '藤鞭', nameEn: 'Vine Whip', type: 'grass', category: 'physical',
      damageMultiplier: 1.0, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'vine_lash', impact: 'leaf_hit', particles: 10, speed: 700, qualityScaling: true },
      description: '甩出藤鞭抽击单个目标。',
    }),
    M({
      id: 'leechseed', name: '寄生种子', nameEn: 'Leech Seed', type: 'grass', category: 'status',
      damageMultiplier: 0.5, cooldownMs: 2900, targeting: 'single', effectTier: 'enhanced',
      status: { kind: 'poison', durationMs: 6000, value: 9 },
      effects: { projectile: 'seed', impact: 'seed_sprout', particles: 22, speed: 480, qualityScaling: true },
      description: '植入种子持续吸取生命，造成长时间持续伤害。',
    }),
    M({
      id: 'leafstorm', name: '飞叶风暴', nameEn: 'Leaf Storm', type: 'grass', category: 'special',
      damageMultiplier: 1.7, cooldownMs: 3500, targeting: 'area', radius: 104, hits: 3, hitIntervalMs: 220, effectTier: 'epic',
      effects: {
        cast: 'leaf_charge', projectile: 'leaf_blade', impact: 'leaf_storm',
        screenShake: 0.16, particles: 60, speed: 660, castMs: 340, qualityScaling: true,
      },
      description: '旋转的绿色叶刃连续三段切割范围内所有敌人。',
    }),
    M({
      id: 'solarbeam', name: '阳光烈焰', nameEn: 'Solar Beam', type: 'grass', category: 'special',
      damageMultiplier: 3.3, cooldownMs: 6600, targeting: 'pierce', length: 480, width: 42, effectTier: 'legendary',
      ignoreArmor: true,
      effects: {
        cast: 'solar_charge', projectile: 'solar_beam', impact: 'solar_burst',
        screenShake: 0.3, flash: 0.5, hitStopMs: 90, particles: 72, speed: 1500, castMs: 1400, qualityScaling: true,
      },
      description: '长时间聚能后爆发光柱，蓄力越久伤害越高。',
    }),
    M({
      id: 'frenzyplant', name: '疯狂植物', nameEn: 'Frenzy Plant', type: 'grass', category: 'special',
      damageMultiplier: 2.4, cooldownMs: 6100, targeting: 'area', radius: 150, effectTier: 'legendary',
      status: { kind: 'stun', durationMs: 900 },
      effects: {
        cast: 'leaf_charge', projectile: 'root_spike', impact: 'plant_erupt',
        screenShake: 0.38, particles: 90, speed: 520, castMs: 900, qualityScaling: true,
      },
      description: '地面爆发巨型藤根，范围重创并短暂缠绕敌人。',
    }),

    /* ============================ 电 ============================ */
    M({
      id: 'thundershock', name: '电击', nameEn: 'Thunder Shock', type: 'electric', category: 'special',
      damageMultiplier: 0.95, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      status: { kind: 'stun', durationMs: 180 },
      effects: { projectile: 'bolt', impact: 'spark_burst', flash: 0.08, particles: 12, speed: 1400, qualityScaling: true },
      description: '放出微弱电流，有几率短暂麻痹。',
    }),
    M({
      id: 'thunderbolt', name: '十万伏特', nameEn: 'Thunderbolt', type: 'electric', category: 'special',
      damageMultiplier: 1.6, cooldownMs: 2500, targeting: 'chain', maxTargets: 5, chainRange: 110, effectTier: 'enhanced',
      effects: {
        cast: 'electric_charge', projectile: 'lightning_chain', impact: 'electric_burst',
        screenShake: 0.12, flash: 0.24, particles: 36, speed: 0, castMs: 200, qualityScaling: true,
      },
      description: '金色闪电在多个敌人之间弹射，适合清理密集怪群。',
    }),
    M({
      id: 'thunder', name: '打雷', nameEn: 'Thunder', type: 'electric', category: 'special',
      damageMultiplier: 2.0, cooldownMs: 4400, targeting: 'area', radius: 88, effectTier: 'epic',
      status: { kind: 'stun', durationMs: 600 },
      effects: {
        cast: 'electric_charge', projectile: 'sky_bolt', impact: 'thunder_strike',
        screenShake: 0.3, flash: 0.45, particles: 52, speed: 0, castMs: 500, qualityScaling: true,
      },
      description: '从天空落下巨雷，范围命中并麻痹敌人。',
    }),
    M({
      id: 'volttackle', name: '伏特攻击', nameEn: 'Volt Tackle', type: 'electric', category: 'physical',
      damageMultiplier: 2.2, cooldownMs: 4000, targeting: 'pierce', length: 340, width: 40, effectTier: 'epic',
      effects: {
        projectile: 'volt_dash', impact: 'volt_impact', screenShake: 0.22, flash: 0.3,
        particles: 44, speed: 1500, qualityScaling: true,
      },
      description: '全身包裹电流冲刺贯穿，沿路造成电系伤害。',
    }),

    /* ============================ 冰 ============================ */
    M({
      id: 'icebeam', name: '冰冻光束', nameEn: 'Ice Beam', type: 'ice', category: 'special',
      damageMultiplier: 1.3, cooldownMs: 2500, targeting: 'pierce', length: 320, width: 28, effectTier: 'enhanced',
      status: { kind: 'slow', durationMs: 3000, ratio: 0.4 },
      effects: { projectile: 'ice_beam', impact: 'ice_shatter', particles: 32, speed: 900, qualityScaling: true },
      description: '细长冰束贯穿敌人并使其减速。',
    }),
    M({
      id: 'blizzard', name: '暴风雪', nameEn: 'Blizzard', type: 'ice', category: 'special',
      damageMultiplier: 1.9, cooldownMs: 5000, targeting: 'area', radius: 170, effectTier: 'epic',
      status: { kind: 'freeze', durationMs: 1500, ratio: 0.65 },
      effects: {
        cast: 'frost_charge', projectile: 'snowstorm', impact: 'blizzard',
        screenShake: 0.26, flash: 0.28, particles: 88, speed: 0, castMs: 700, qualityScaling: true,
      },
      description: '大范围冰晶风暴，减速并冻结敌人。',
    }),
    M({
      id: 'icefang', name: '冰冻牙', nameEn: 'Ice Fang', type: 'ice', category: 'physical',
      damageMultiplier: 1.45, cooldownMs: 1900, targeting: 'single', effectTier: 'common',
      status: { kind: 'freeze', durationMs: 700, ratio: 0.5 },
      effects: { projectile: 'ice_shard', impact: 'frost_bite', particles: 16, speed: 640, qualityScaling: true },
      description: '寒冰利齿咬击，短时间冻结单个目标。',
    }),
    M({
      id: 'sheercold', name: '绝对零度', nameEn: 'Sheer Cold', type: 'ice', category: 'special',
      damageMultiplier: 2.8, cooldownMs: 7700, targeting: 'area', radius: 190, effectTier: 'legendary',
      status: { kind: 'freeze', durationMs: 2600, ratio: 0.8 },
      effects: {
        cast: 'frost_charge', projectile: 'absolute_zero', impact: 'ice_field',
        screenShake: 0.34, flash: 0.4, hitStopMs: 80, particles: 110, speed: 0, castMs: 1200, qualityScaling: true,
      },
      description: '超低温冲击波冻结大片战场，传说级冰系招式。',
    }),

    /* ============================ 格斗 ============================ */
    M({
      id: 'karatechop', name: '空手劈', nameEn: 'Karate Chop', type: 'fighting', category: 'physical',
      damageMultiplier: 1.05, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'chop_wave', impact: 'chop_hit', particles: 10, speed: 800, qualityScaling: true },
      description: '近身手刀劈击，出手快。',
    }),
    M({
      id: 'closecombat', name: '近身战', nameEn: 'Close Combat', type: 'fighting', category: 'physical',
      damageMultiplier: 2.4, cooldownMs: 3400, targeting: 'area', radius: 76, effectTier: 'epic',
      ignoreArmor: true,
      effects: {
        projectile: 'rush_fist', impact: 'multi_punch', screenShake: 0.26, hitStopMs: 70,
        particles: 46, speed: 1200, qualityScaling: true,
      },
      description: '连续拳击近身爆发，无视护甲。',
    }),
    M({
      id: 'aurasphere', name: '波导弹', nameEn: 'Aura Sphere', type: 'fighting', category: 'special',
      damageMultiplier: 1.8, cooldownMs: 3000, targeting: 'area', radius: 84, effectTier: 'enhanced',
      effects: { projectile: 'aura_orb', impact: 'aura_burst', particles: 34, speed: 560, qualityScaling: true },
      description: '汇聚生命波动的能量球，必定命中且范围爆炸。',
    }),
    M({
      id: 'focusblast', name: '真气弹', nameEn: 'Focus Blast', type: 'fighting', category: 'special',
      damageMultiplier: 2.6, cooldownMs: 5100, targeting: 'area', radius: 120, effectTier: 'epic',
      ignoreArmor: true,
      effects: {
        cast: 'aura_charge', projectile: 'focus_orb', impact: 'focus_explosion',
        screenShake: 0.32, flash: 0.34, particles: 58, speed: 480, castMs: 560, qualityScaling: true,
      },
      description: '凝聚全身真气投射，大范围高伤并穿透护甲。',
    }),

    /* ============================ 毒 ============================ */
    M({
      id: 'poisonsting', name: '毒针', nameEn: 'Poison Sting', type: 'poison', category: 'physical',
      damageMultiplier: 0.85, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      status: { kind: 'poison', durationMs: 4000, value: 6 },
      effects: { projectile: 'poison_dart', impact: 'poison_splash', particles: 12, speed: 700, qualityScaling: true },
      description: '射出毒针，命中后持续中毒。',
    }),
    M({
      id: 'sludgebomb', name: '污泥炸弹', nameEn: 'Sludge Bomb', type: 'poison', category: 'special',
      damageMultiplier: 1.75, cooldownMs: 3200, targeting: 'area', radius: 92, effectTier: 'enhanced',
      status: { kind: 'poison', durationMs: 6000, value: 11, maxStacks: 3 },
      effects: {
        projectile: 'sludge_lob', impact: 'sludge_pool', particles: 40, speed: 480, qualityScaling: true,
      },
      description: '抛射污泥弹，落地形成毒池并叠加中毒层数。',
    }),
    M({
      id: 'toxicspikes', name: '毒菱', nameEn: 'Toxic Spikes', type: 'poison', category: 'status',
      damageMultiplier: 1.1, cooldownMs: 3900, targeting: 'line', length: 400, width: 70, effectTier: 'epic',
      status: { kind: 'poison', durationMs: 8000, value: 13, maxStacks: 4 },
      effects: { projectile: 'spike_rain', impact: 'spike_field', particles: 50, speed: 0, qualityScaling: true },
      description: '在道路上撒布毒菱，经过的敌人持续受到毒素侵蚀。',
    }),

    /* ============================ 地面 ============================ */
    M({
      id: 'mudshot', name: '泥巴射击', nameEn: 'Mud Shot', type: 'ground', category: 'special',
      damageMultiplier: 1.0, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      status: { kind: 'slow', durationMs: 2000, ratio: 0.3 },
      effects: { projectile: 'mud_ball', impact: 'mud_splash', particles: 14, speed: 520, qualityScaling: true },
      description: '射出泥球，减速命中的敌人。',
    }),
    M({
      id: 'earthquake', name: '地震', nameEn: 'Earthquake', type: 'ground', category: 'physical',
      damageMultiplier: 2.1, cooldownMs: 4500, targeting: 'area', radius: 165, effectTier: 'epic',
      status: { kind: 'stun', durationMs: 800 },
      effects: {
        cast: 'ground_charge', projectile: 'quake_wave', impact: 'ground_crack',
        screenShake: 0.44, particles: 70, speed: 0, castMs: 520, qualityScaling: true,
      },
      description: '大地震裂，超大范围伤害并眩晕敌人，无法命中飞行单位。',
    }),
    M({
      id: 'earthpower', name: '大地之力', nameEn: 'Earth Power', type: 'ground', category: 'special',
      damageMultiplier: 1.85, cooldownMs: 3300, targeting: 'area', radius: 110, effectTier: 'enhanced',
      effects: {
        projectile: 'earth_burst', impact: 'power_geyser', particles: 42, speed: 0, qualityScaling: true,
      },
      description: '从地底喷出能量柱，范围伤害。',
    }),

    /* ============================ 飞行 ============================ */
    M({
      id: 'wingattack', name: '翅膀攻击', nameEn: 'Wing Attack', type: 'flying', category: 'physical',
      damageMultiplier: 1.05, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      canHitFlying: true,
      effects: { projectile: 'wind_slash', impact: 'wind_hit', particles: 12, speed: 820, qualityScaling: true },
      description: '风刃斩击，可命中飞行单位。',
    }),
    M({
      id: 'airslash', name: '空气斩', nameEn: 'Air Slash', type: 'flying', category: 'special',
      damageMultiplier: 1.55, cooldownMs: 2400, targeting: 'line', length: 300, width: 60, effectTier: 'enhanced',
      canHitFlying: true,
      effects: { projectile: 'air_blade', impact: 'air_burst', particles: 30, speed: 900, qualityScaling: true },
      description: '真空刀刃横切直线，对空有效。',
    }),
    M({
      id: 'hurricane', name: '暴风', nameEn: 'Hurricane', type: 'flying', category: 'special',
      damageMultiplier: 2.2, cooldownMs: 5400, targeting: 'area', radius: 150, effectTier: 'legendary',
      canHitFlying: true,
      status: { kind: 'stun', durationMs: 500 },
      effects: {
        cast: 'wind_charge', projectile: 'hurricane_eye', impact: 'tornado',
        screenShake: 0.4, particles: 92, speed: 400, castMs: 820, qualityScaling: true,
      },
      description: '召唤巨型龙卷风，卷起大范围内的敌人。',
    }),

    /* ============================ 超能力 ============================ */
    M({
      id: 'confusion', name: '念力', nameEn: 'Confusion', type: 'psychic', category: 'special',
      damageMultiplier: 1.0, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'psy_wave', impact: 'psy_hit', particles: 14, speed: 560, qualityScaling: true },
      description: '以念力冲击目标精神。',
    }),
    M({
      id: 'psychicmove', name: '精神强念', nameEn: 'Psychic', type: 'psychic', category: 'special',
      damageMultiplier: 1.9, cooldownMs: 3600, targeting: 'area', radius: 130, effectTier: 'epic',
      status: { kind: 'weaken', durationMs: 4000, ratio: 0.25 },
      effects: {
        cast: 'psy_charge', projectile: 'psy_field', impact: 'psy_warp',
        screenShake: 0.2, flash: 0.3, particles: 54, speed: 0, castMs: 460, qualityScaling: true,
      },
      description: '粉紫色扭曲光场笼罩敌人，造成伤害并削弱其抗性。',
    }),
    M({
      id: 'psystrike', name: '精神击破', nameEn: 'Psystrike', type: 'psychic', category: 'special',
      damageMultiplier: 2.5, cooldownMs: 5500, targeting: 'pierce', length: 400, width: 46, effectTier: 'epic',
      ignoreArmor: true,
      effects: {
        projectile: 'psy_lance', impact: 'psy_shatter', screenShake: 0.28, flash: 0.36,
        particles: 62, speed: 1200, qualityScaling: true,
      },
      description: '实体化精神冲击波，贯穿并穿透护甲。',
    }),
    M({
      id: 'psyshocklegend', name: '精神震荡', nameEn: 'Psywave', type: 'psychic', category: 'special',
      damageMultiplier: 2.7, cooldownMs: 7200, targeting: 'global', effectTier: 'legendary',
      status: { kind: 'stun', durationMs: 1200 },
      effects: {
        cast: 'psy_charge', projectile: 'psy_nova', impact: 'mind_crush',
        screenShake: 0.4, flash: 0.6, hitStopMs: 120, particles: 100, speed: 0, castMs: 1300, qualityScaling: true,
      },
      description: '全屏精神风暴，命中所有敌人并使其陷入混乱。',
    }),

    /* ============================ 虫 ============================ */
    M({
      id: 'bugbite', name: '虫咬', nameEn: 'Bug Bite', type: 'bug', category: 'physical',
      damageMultiplier: 1.0, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'bug_dart', impact: 'bug_hit', particles: 10, speed: 760, qualityScaling: true },
      description: '快速啃咬单个目标。',
    }),
    M({
      id: 'xscissor', name: '十字剪', nameEn: 'X-Scissor', type: 'bug', category: 'physical',
      damageMultiplier: 1.7, cooldownMs: 2600, targeting: 'line', length: 280, width: 52, effectTier: 'enhanced',
      effects: { projectile: 'x_slash', impact: 'cross_cut', particles: 32, speed: 1000, qualityScaling: true },
      description: '交叉斩击切开直线上的敌人。',
    }),
    M({
      id: 'bugbuzz', name: '虫鸣', nameEn: 'Bug Buzz', type: 'bug', category: 'special',
      damageMultiplier: 2.0, cooldownMs: 4700, targeting: 'area', radius: 140, effectTier: 'epic',
      status: { kind: 'weaken', durationMs: 5000, ratio: 0.2 },
      effects: {
        cast: 'buzz_charge', projectile: 'sound_wave', impact: 'resonance',
        screenShake: 0.24, particles: 56, speed: 0, castMs: 600, qualityScaling: true,
      },
      description: '振翅发出共鸣波，削弱范围内敌人的防御。',
    }),

    /* ============================ 岩石 ============================ */
    M({
      id: 'rockthrow', name: '落石', nameEn: 'Rock Throw', type: 'rock', category: 'physical',
      damageMultiplier: 1.05, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'rock_shard', impact: 'rock_crash', particles: 12, speed: 600, qualityScaling: true },
      description: '投掷碎石攻击目标。',
    }),
    M({
      id: 'rockblast', name: '岩石爆击', nameEn: 'Rock Blast', type: 'rock', category: 'physical',
      damageMultiplier: 1.4, cooldownMs: 2800, targeting: 'multi', maxTargets: 4, hits: 2, hitIntervalMs: 180, effectTier: 'enhanced',
      status: { kind: 'knockback', durationMs: 0, distance: 22 },
      effects: { projectile: 'rock_volley', impact: 'rock_burst', particles: 34, speed: 640, qualityScaling: true },
      description: '连续投射岩石，命中时击退敌人。',
    }),
    M({
      id: 'stoneedge', name: '尖石攻击', nameEn: 'Stone Edge', type: 'rock', category: 'physical',
      damageMultiplier: 2.3, cooldownMs: 4300, targeting: 'line', length: 320, width: 56, effectTier: 'epic',
      status: { kind: 'knockback', durationMs: 0, distance: 44 },
      effects: {
        projectile: 'stone_spike', impact: 'spike_wall', screenShake: 0.3,
        particles: 50, speed: 0, castMs: 380, qualityScaling: true,
      },
      description: '地面刺出成排尖石，强力击退敌人。',
    }),

    /* ============================ 幽灵 ============================ */
    M({
      id: 'lick', name: '舌舔', nameEn: 'Lick', type: 'ghost', category: 'physical',
      damageMultiplier: 0.95, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      revealsStealth: true,
      effects: { projectile: 'shadow_tongue', impact: 'spooky_hit', particles: 12, speed: 680, qualityScaling: true },
      description: '幽影之舌，可命中隐身单位。',
    }),
    M({
      id: 'shadowball', name: '暗影球', nameEn: 'Shadow Ball', type: 'ghost', category: 'special',
      damageMultiplier: 1.8, cooldownMs: 2900, targeting: 'area', radius: 98, effectTier: 'enhanced',
      revealsStealth: true,
      status: { kind: 'armorBreak', durationMs: 5000, ratio: 0.25 },
      effects: {
        projectile: 'shadow_orb', impact: 'shadow_explosion', particles: 44, speed: 540, qualityScaling: true,
      },
      description: '紫黑色能量球爆炸，降低敌人护甲并暴露隐身单位。',
    }),
    M({
      id: 'shadowballlegend', name: '暗影潜袭', nameEn: 'Shadow Sneak', type: 'ghost', category: 'special',
      damageMultiplier: 2.6, cooldownMs: 6100, targeting: 'area', radius: 175, effectTier: 'legendary',
      revealsStealth: true,
      status: { kind: 'curse', durationMs: 7000, value: 14, maxStacks: 2 },
      effects: {
        cast: 'shadow_charge', projectile: 'shadow_tide', impact: 'dark_void',
        screenShake: 0.36, flash: 0.3, particles: 96, speed: 0, castMs: 1000, qualityScaling: true,
      },
      description: '召唤暗影潮汐诅咒大片区域，持续抽取生命。',
    }),
    M({
      id: 'willowisp', name: '鬼火', nameEn: 'Will-O-Wisp', type: 'ghost', category: 'status',
      damageMultiplier: 1.2, cooldownMs: 3500, targeting: 'multi', maxTargets: 3, effectTier: 'enhanced',
      revealsStealth: true,
      status: { kind: 'burn', durationMs: 6000, value: 9 },
      effects: { projectile: 'will_o_wisp', impact: 'spirit_flame', particles: 36, speed: 400, qualityScaling: true },
      description: '放出多朵幽蓝鬼火，追踪并灼烧敌人。',
    }),

    /* ============================ 龙 ============================ */
    M({
      id: 'dragonbreath', name: '龙息', nameEn: 'Dragon Breath', type: 'dragon', category: 'special',
      damageMultiplier: 1.15, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      status: { kind: 'stun', durationMs: 250 },
      effects: { projectile: 'dragon_pulse_small', impact: 'dragon_hit', particles: 14, speed: 620, qualityScaling: true },
      description: '龙形吐息，有几率麻痹目标。',
    }),
    M({
      id: 'dragonpulse', name: '龙之波动', nameEn: 'Dragon Pulse', type: 'dragon', category: 'special',
      damageMultiplier: 1.95, cooldownMs: 3300, targeting: 'line', length: 360, width: 54, effectTier: 'epic',
      effects: {
        cast: 'dragon_charge', projectile: 'dragon_wave', impact: 'dragon_burst',
        screenShake: 0.22, particles: 48, speed: 860, castMs: 320, qualityScaling: true,
      },
      description: '发射龙形能量冲击波，直线范围伤害。',
    }),
    M({
      id: 'dracometeor', name: '流星群', nameEn: 'Draco Meteor', type: 'dragon', category: 'special',
      damageMultiplier: 3.2, cooldownMs: 8200, targeting: 'global', effectTier: 'legendary',
      hits: 6, hitIntervalMs: 260, ignoreArmor: true,
      effects: {
        cast: 'meteor_summon', projectile: 'meteor_fall', impact: 'meteor_impact',
        screenShake: 0.5, flash: 0.6, hitStopMs: 110, particles: 120, speed: 900, castMs: 1500, qualityScaling: true,
      },
      description: '召唤多颗陨石从天而降，全屏随机轰炸，龙系终极招式。',
    }),
    M({
      id: 'outrage', name: '逆鳞', nameEn: 'Outrage', type: 'dragon', category: 'physical',
      damageMultiplier: 2.4, cooldownMs: 4700, targeting: 'multi', maxTargets: 5, effectTier: 'epic',
      effects: {
        cast: 'rage_charge', projectile: 'dragon_rush', impact: 'rage_impact',
        screenShake: 0.32, particles: 64, speed: 1100, castMs: 420, qualityScaling: true,
      },
      description: '陷入暴怒连续冲撞多个目标。',
    }),

    /* ============================ 恶 ============================ */
    M({
      id: 'bite', name: '咬住', nameEn: 'Bite', type: 'dark', category: 'physical',
      damageMultiplier: 1.05, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'dark_jaw', impact: 'bite_mark', particles: 10, speed: 780, qualityScaling: true },
      description: '暗影利齿撕咬目标。',
    }),
    M({
      id: 'crunch', name: '咬碎', nameEn: 'Crunch', type: 'dark', category: 'physical',
      damageMultiplier: 1.8, cooldownMs: 3100, targeting: 'single', effectTier: 'enhanced',
      status: { kind: 'armorBreak', durationMs: 6000, ratio: 0.3 },
      effects: {
        projectile: 'dark_fang', impact: 'crunch_hit', screenShake: 0.16, particles: 32, speed: 820, qualityScaling: true,
      },
      description: '撕碎目标护甲，长时间降低其防御。',
    }),
    M({
      id: 'darkpulse', name: '恶之波动', nameEn: 'Dark Pulse', type: 'dark', category: 'special',
      damageMultiplier: 2.2, cooldownMs: 4600, targeting: 'area', radius: 145, effectTier: 'epic',
      effects: {
        cast: 'dark_charge', projectile: 'dark_pulse_wave', impact: 'dark_explosion',
        screenShake: 0.3, flash: 0.24, particles: 60, speed: 0, castMs: 520, qualityScaling: true,
      },
      description: '释放纯粹恶意波动，范围重创敌人。',
    }),

    /* ============================ 钢 ============================ */
    M({
      id: 'metalsound', name: '金属音', nameEn: 'Metal Sound', type: 'steel', category: 'status',
      damageMultiplier: 1.15, cooldownMs: 2500, targeting: 'area', radius: 100, effectTier: 'enhanced',
      status: { kind: 'armorBreak', durationMs: 6000, ratio: 0.35 },
      effects: { projectile: 'metal_ring', impact: 'metal_screech', particles: 30, speed: 0, qualityScaling: true },
      description: '刺耳金属共鸣削弱范围内敌人的护甲。',
    }),
    M({
      id: 'flashcannon', name: '加农光炮', nameEn: 'Flash Cannon', type: 'steel', category: 'special',
      damageMultiplier: 2.1, cooldownMs: 3900, targeting: 'pierce', length: 380, width: 36, effectTier: 'epic',
      ignoreArmor: true,
      effects: {
        cast: 'metal_charge', projectile: 'cannon_beam', impact: 'metal_burst',
        screenShake: 0.24, flash: 0.34, particles: 46, speed: 1400, castMs: 420, qualityScaling: true,
      },
      description: '发射高能钢系光束，穿透并无视护甲。',
    }),
    M({
      id: 'ironhead', name: '铁头', nameEn: 'Iron Head', type: 'steel', category: 'physical',
      damageMultiplier: 1.6, cooldownMs: 2200, targeting: 'single', effectTier: 'common',
      status: { kind: 'stun', durationMs: 400 },
      effects: { projectile: 'iron_dash', impact: 'clang', particles: 22, speed: 900, qualityScaling: true },
      description: '钢铁头锤冲撞，有几率眩晕。',
    }),

    /* ============================ 妖精 ============================ */
    M({
      id: 'fairywind', name: '妖精之风', nameEn: 'Fairy Wind', type: 'fairy', category: 'special',
      damageMultiplier: 1.0, cooldownMs: 0, targeting: 'single', effectTier: 'common',
      effects: { projectile: 'fairy_spark', impact: 'fairy_pop', particles: 14, speed: 560, qualityScaling: true },
      description: '粉色妖精之风吹拂目标。',
    }),
    M({
      id: 'dazzlinggleam', name: '魔法闪耀', nameEn: 'Dazzling Gleam', type: 'fairy', category: 'special',
      damageMultiplier: 1.8, cooldownMs: 3200, targeting: 'area', radius: 118, effectTier: 'enhanced',
      effects: {
        cast: 'fairy_charge', projectile: 'fairy_beam', impact: 'prism_burst',
        screenShake: 0.18, flash: 0.34, particles: 52, speed: 0, castMs: 320, qualityScaling: true,
      },
      description: '释放炫目光芒，范围伤害并削弱敌人命中。',
    }),
    M({
      id: 'moonblast', name: '月亮之力', nameEn: 'Moonblast', type: 'fairy', category: 'special',
      damageMultiplier: 2.4, cooldownMs: 5200, targeting: 'global', effectTier: 'legendary',
      selfBuff: { kind: 'damage', ratio: 0.15, durationMs: 8000 },
      effects: {
        cast: 'moon_charge', projectile: 'moon_beam', impact: 'lunar_burst',
        screenShake: 0.34, flash: 0.45, hitStopMs: 90, particles: 88, speed: 0, castMs: 1100, qualityScaling: true,
      },
      description: '借助月光降下全屏打击，并为己方全体增伤。',
    }),
    M({
      id: 'playrough', name: '嬉闹', nameEn: 'Play Rough', type: 'fairy', category: 'physical',
      damageMultiplier: 1.7, cooldownMs: 2900, targeting: 'cone', coneAngle: 70, length: 170, effectTier: 'enhanced',
      status: { kind: 'weaken', durationMs: 3500, ratio: 0.2 },
      effects: { projectile: 'play_swipe', impact: 'hearts_burst', particles: 38, speed: 0, qualityScaling: true },
      description: '嬉闹式连击，扇形范围内削弱敌人攻击力。',
    }),

    /* ============================ 特性 / 通用强化 ============================ */
    M({
      id: 'doubleseam', name: '影子分身', nameEn: 'Double Team', type: 'normal', category: 'status',
      damageMultiplier: 0.6, cooldownMs: 6600, targeting: 'multi', maxTargets: 4, effectTier: 'epic',
      selfBuff: { kind: 'multiShot', ratio: 2, durationMs: 6000 },
      effects: { cast: 'clone_spawn', impact: 'afterimage_hit', particles: 40, speed: 1000, qualityScaling: true },
      description: '制造残影，短时间内发动多重攻击。',
    }),
    M({
      id: 'agility', name: '高速移动', nameEn: 'Agility', type: 'psychic', category: 'status',
      damageMultiplier: 0, cooldownMs: 8200, targeting: 'aura', effectTier: 'enhanced',
      selfBuff: { kind: 'attackSpeed', ratio: 0.5, durationMs: 8000 },
      effects: { cast: 'speed_aura', particles: 26, qualityScaling: true },
      description: '提升自身攻击速度 50%，持续 8 秒。',
    }),
    M({
      id: 'swordsdance', name: '剑舞', nameEn: 'Swords Dance', type: 'normal', category: 'status',
      damageMultiplier: 0, cooldownMs: 8800, targeting: 'aura', effectTier: 'enhanced',
      selfBuff: { kind: 'damage', ratio: 0.45, durationMs: 9000 },
      effects: { cast: 'blade_aura', particles: 30, qualityScaling: true },
      description: '提升自身攻击力 45%，持续 9 秒。',
    }),
    M({
      id: 'calmmind', name: '冥想', nameEn: 'Calm Mind', type: 'psychic', category: 'status',
      damageMultiplier: 0, cooldownMs: 8800, targeting: 'aura', effectTier: 'enhanced',
      selfBuff: { kind: 'range', ratio: 0.35, durationMs: 9000 },
      effects: { cast: 'psy_aura', particles: 28, qualityScaling: true },
      description: '扩大自身攻击范围 35%，持续 9 秒。',
    }),
  ].map((m) => [m.id, m]),
);

export const MOVE_LIST = Object.values(MOVES);

/** 按属性索引招式，供图鉴和自动配招使用 */
export const MOVES_BY_TYPE: Record<string, MoveDef[]> = (() => {
  const acc: Record<string, MoveDef[]> = {};
  for (const m of MOVE_LIST) {
    (acc[m.type] ||= []).push(m);
  }
  return acc;
})();

/** 每种属性的基础攻击招式（精灵无显式配置时按属性选取） */
export const TYPE_BASIC_MOVE: Record<string, string> = {
  normal: 'tackle', fire: 'ember', water: 'watergun', electric: 'thundershock',
  grass: 'vinewhip', ice: 'icefang', fighting: 'karatechop', poison: 'poisonsting',
  ground: 'mudshot', flying: 'wingattack', psychic: 'confusion', bug: 'bugbite',
  rock: 'rockthrow', ghost: 'lick', dragon: 'dragonbreath', dark: 'bite',
  steel: 'ironhead', fairy: 'fairywind',
};

/** 每种属性的招牌（大招）招式 */
export const TYPE_SIGNATURE_MOVE: Record<string, string> = {
  normal: 'hyperbeam', fire: 'blastburn', water: 'surf', electric: 'thunder',
  grass: 'solarbeam', ice: 'blizzard', fighting: 'closecombat', poison: 'sludgebomb',
  ground: 'earthquake', flying: 'hurricane', psychic: 'psychicmove', bug: 'bugbuzz',
  rock: 'stoneedge', ghost: 'shadowball', dragon: 'dracometeor', dark: 'darkpulse',
  steel: 'flashcannon', fairy: 'moonblast',
};

/** 每种属性的终极招式（进化后解锁） */
export const TYPE_ULTIMATE_MOVE: Record<string, string> = {
  normal: 'gigaimpact', fire: 'blastburn', water: 'surf', electric: 'thunder',
  grass: 'frenzyplant', ice: 'sheercold', fighting: 'focusblast', poison: 'toxicspikes',
  ground: 'earthquake', flying: 'hurricane', psychic: 'psyshocklegend', bug: 'bugbuzz',
  rock: 'stoneedge', ghost: 'shadowballlegend', dragon: 'dracometeor', dark: 'darkpulse',
  steel: 'flashcannon', fairy: 'moonblast',
};

export function getMove(id: string): MoveDef {
  const m = MOVES[id];
  if (!m) throw new Error(`未知招式: ${id}`);
  return m;
}
