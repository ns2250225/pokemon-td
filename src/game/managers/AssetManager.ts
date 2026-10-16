/** 单个素材加载的超时上限：超过即视为缺失并走回退显示 */
const LOAD_TIMEOUT_MS = 12000;

/**
 * 资源管理器 —— 按需加载精灵与特效纹理，带 LRU 缓存与分组预载。
 *
 * 关键约束（PRD 12.2）：
 *   - 禁止首屏加载全图鉴图片 → 只在进入具体关卡 / 打开图鉴时才加载所需精灵
 *   - 相同精灵资源复用纹理 → Phaser 纹理缓存的 key 以图鉴编号命名，天然复用
 *   - 为资源设置显存预算和 LRU 缓存策略
 */
import Phaser from 'phaser';

const ATLAS_DIR = 'assets/pokemon/atlases';
const SPRITE_DIR = 'assets/pokemon/sprites';
const PORTRAIT_DIR = 'assets/pokemon/portraits';
const SHINY_DIR = 'assets/pokemon/shiny';
const ICON_DIR = 'assets/pokemon/icons';
const EFFECT_DIR = 'assets/effects';

export interface AtlasMeta {
  key: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  durations: number[];
  totalDuration: number;
  columns: number;
  atlas: string;
}

/** 精灵可在场景中使用的三种形态 */
export type SpriteVariant = 'animated' | 'static' | 'portrait' | 'shiny' | 'icon';

export function textureKeys(id: number) {
  return {
    animated: `pkm-anim-${id}`,
    static: `pkm-static-${id}`,
    portrait: `pkm-portrait-${id}`,
    shiny: `pkm-shiny-${id}`,
    icon: `pkm-icon-${id}`,
  };
}

export function effectKey(group: string, name: string) {
  return `fx-${group}-${name}`;
}

/**
 * 加载器封装。以 Scene 为单位使用，不依赖全局单例，
 * 便于在不同 Scene 之间独立控制加载时机。
 */
export class AssetService {
  private scene: Phaser.Scene;
  private loading = new Set<string>();
  private failed = new Set<string>();
  private atlasMeta = new Map<number, AtlasMeta>();
  /** 最近使用顺序，用于 LRU 淘汰 */
  private lru: number[] = [];
  /** 显存预算：最多常驻多少张精灵纹理 */
  private budget: number;

  constructor(scene: Phaser.Scene, budget = 140) {
    this.scene = scene;
    this.budget = budget;
  }

  getAtlasMeta(id: number): AtlasMeta | null {
    return this.atlasMeta.get(id) ?? null;
  }

  isLoading(key: string): boolean {
    return this.loading.has(key);
  }

  hasFailed(key: string): boolean {
    return this.failed.has(key);
  }

  private markUsed(id: number) {
    const i = this.lru.indexOf(id);
    if (i >= 0) this.lru.splice(i, 1);
    this.lru.push(id);
    while (this.lru.length > this.budget) {
      const evict = this.lru.shift()!;
      // 只淘汰动画图集，静态图很小且复用率高
      const keys = textureKeys(evict);
      if (this.scene.textures.exists(keys.animated)) {
        this.scene.textures.remove(keys.animated);
        this.atlasMeta.delete(evict);
      }
    }
  }

  /** 加载单只精灵的全部形态 */
  async loadPokemon(id: number, variants: SpriteVariant[] = ['static', 'animated']): Promise<void> {
    const keys = textureKeys(id);
    const tasks: Promise<void>[] = [];

    const need = (variant: SpriteVariant) => variants.includes(variant);

    // ---- 静态 / 立绘 / 异色 / 图标：直接作为图片加载 ----
    const imgJobs: { variant: SpriteVariant; dir: string; ext: string }[] = [];
    if (need('static') && !this.scene.textures.exists(keys.static)) {
      imgJobs.push({ variant: 'static', dir: SPRITE_DIR, ext: 'webp' });
    }
    if (need('portrait') && !this.scene.textures.exists(keys.portrait)) {
      imgJobs.push({ variant: 'portrait', dir: PORTRAIT_DIR, ext: 'webp' });
    }
    if (need('shiny') && !this.scene.textures.exists(keys.shiny)) {
      imgJobs.push({ variant: 'shiny', dir: SHINY_DIR, ext: 'webp' });
    }
    if (need('icon') && !this.scene.textures.exists(keys.icon)) {
      imgJobs.push({ variant: 'icon', dir: ICON_DIR, ext: 'webp' });
    }

    for (const job of imgJobs) {
      const key = keys[job.variant];
      tasks.push(this.loadImageSafe(key, `${job.dir}/${id}.${job.ext}`));
    }

    // ---- 动态：先取图集元数据，再加载 webp 并注册成 spritesheet ----
    if (need('animated') && !this.scene.textures.exists(keys.animated)) {
      tasks.push(this.loadAtlas(id));
    }

    await Promise.all(tasks);
    this.markUsed(id);
  }

  /** 批量加载一组精灵，带进度回调 */
  async loadPokemonSet(
    ids: number[],
    variants: SpriteVariant[] = ['static', 'animated'],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    let done = 0;
    const total = ids.length;
    // 并发 8 个，避免移动端同时发起过多请求
    const queue = [...ids];
    const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          await this.loadPokemon(id, variants);
        } catch {
          /* 单只失败不影响整体 */
        }
        done++;
        onProgress?.(done, total);
      }
    });
    await Promise.all(workers);
  }

  private loadImageSafe(key: string, url: string): Promise<void> {
    return new Promise((resolve) => {
      if (this.scene.textures.exists(key)) {
        resolve();
        return;
      }
      this.loading.add(key);
      const onLoad = () => { this.loading.delete(key); resolve(); };
      const onError = () => {
        this.loading.delete(key);
        this.failed.add(key);
        resolve(); // 素材缺失不阻塞游戏，调用方用回退显示
      };
      this.scene.load.image(key, url);
      this.scene.load.once(`filecomplete-image-${key}`, onLoad);
      this.scene.load.once(`loaderror`, (file: Phaser.Loader.File) => {
        if (file.key === key) onError();
      });
      if (!this.scene.load.isLoading()) this.scene.load.start();
    });
  }

  /** 图集元数据通过 /assets/pokemon/atlases/<id>.json 获取 */
  private async loadAtlas(id: number): Promise<void> {
    const key = textureKeys(id).animated;
    const meta = await this.fetchAtlasMeta(id);
    if (!meta) {
      this.failed.add(key);
      return;
    }
    this.atlasMeta.set(id, meta);
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (!ok) this.failed.add(key);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);

      this.scene.load.spritesheet(key, `${ATLAS_DIR}/${id}.webp`, {
        frameWidth: meta.frameWidth,
        frameHeight: meta.frameHeight,
        endFrame: meta.frameCount - 1,
      });
      this.scene.load.once(`filecomplete-spritesheet-${key}`, () => finish(true));
      this.scene.load.once('loaderror', (file: Phaser.Loader.File) => {
        if (file.key === key) finish(false);
      });
      // 同 loadImageSafe：无条件 start()，否则并发加载时会永久挂起
      this.scene.load.start();
    });
  }

  private async fetchAtlasMeta(id: number): Promise<AtlasMeta | null> {
    const cached = this.atlasMeta.get(id);
    if (cached) return cached;
    try {
      const res = await fetch(`${ATLAS_DIR}/${id}.json`);
      if (!res.ok) return null;
      const meta = (await res.json()) as AtlasMeta;
      if (!meta.frameCount || !meta.frameWidth) return null;
      this.atlasMeta.set(id, meta);
      return meta;
    } catch {
      return null;
    }
  }

  /** 加载特效纹理分组（一次性加载全部 46 张，体积很小） */
  async loadEffects(groups: string[] = ['common']): Promise<void> {
    let atlas: { groups: Record<string, Record<string, { file: string; key: string }>> } | null = null;
    try {
      const res = await fetch(`${EFFECT_DIR}/atlas.json`);
      atlas = await res.json();
    } catch {
      return;
    }
    if (!atlas) return;

    const jobs: Promise<void>[] = [];
    for (const group of groups) {
      const items = atlas.groups[group];
      if (!items) continue;
      for (const [name, info] of Object.entries(items)) {
        const key = effectKey(group, name);
        if (this.scene.textures.exists(key)) continue;
        jobs.push(this.loadImageSafe(key, `assets/${info.file.replace(/^effects/, 'effects')}`));
      }
    }
    await Promise.all(jobs);
  }

  /** 生成精灵在该场景可用的动画（以编号 + 形态为 key，重复调用无副作用） */
  ensureSpriteAnimation(id: number, variant: SpriteVariant = 'animated'): string | null {
    const keys = textureKeys(id);
    const animKey = `${keys[variant]}-idle`;
    if (this.scene.anims.exists(animKey)) return animKey;

    if (variant === 'animated') {
      if (!this.scene.textures.exists(keys.animated)) return null;
      const meta = this.atlasMeta.get(id);
      if (!meta) return null;
      this.scene.anims.create({
        key: animKey,
        frames: this.scene.anims.generateFrameNumbers(keys.animated, { start: 0, end: meta.frameCount - 1 }),
        frameRate: Math.max(6, Math.round(1000 / (meta.durations[0] || 100))),
        repeat: -1,
      });
      return animKey;
    }

    // 静态回退：用 Tween 做待机起伏，这里返回 null 让调用方创建 Sprite
    return null;
  }

  /** 清除失败记录，允许重试 */
  resetFailures() {
    this.failed.clear();
  }
}

/* ------------------------------------------------------------------ */
/* 特效纹理 key 的集中声明，供 EffectSystem 使用                        */
/* ------------------------------------------------------------------ */

export const FX = {
  common: {
    dot: effectKey('common', 'dot'),
    dotSoft: effectKey('common', 'dot_soft'),
    spark: effectKey('common', 'spark'),
    streak: effectKey('common', 'streak'),
    smoke: effectKey('common', 'smoke'),
    star: effectKey('common', 'star'),
    star6: effectKey('common', 'star6'),
    ring: effectKey('common', 'ring'),
    shockwave: effectKey('common', 'shockwave'),
    nova: effectKey('common', 'nova'),
    flame: effectKey('common', 'flame'),
    shard: effectKey('common', 'shard'),
    leaf: effectKey('common', 'leaf'),
    beam: effectKey('common', 'beam'),
    crack: effectKey('common', 'crack'),
    swirl: effectKey('common', 'swirl'),
    portal: effectKey('common', 'portal'),
    orb: effectKey('common', 'orb'),
    heart: effectKey('common', 'heart'),
    fist: effectKey('common', 'fist'),
    meteor: effectKey('common', 'meteor'),
    boltA: effectKey('common', 'bolt_a'),
    boltB: effectKey('common', 'bolt_b'),
    boltC: effectKey('common', 'bolt_c'),
  },
  fire: {
    flameLarge: effectKey('fire', 'flame_large'),
    fireball: effectKey('fire', 'fireball'),
    ember: effectKey('fire', 'ember'),
  },
  water: {
    drop: effectKey('water', 'drop'),
    splash: effectKey('water', 'splash'),
    wave: effectKey('water', 'wave'),
  },
  electric: {
    boltLong: effectKey('electric', 'bolt_long'),
    sparkRing: effectKey('electric', 'spark_ring'),
  },
  ice: {
    crystal: effectKey('ice', 'crystal'),
    frost: effectKey('ice', 'frost'),
  },
  grass: {
    blade: effectKey('grass', 'blade'),
    seed: effectKey('grass', 'seed'),
    root: effectKey('grass', 'root'),
  },
  psychic: {
    psyOrb: effectKey('psychic', 'psy_orb'),
    psyWave: effectKey('psychic', 'psy_wave'),
    psyField: effectKey('psychic', 'psy_field'),
  },
  ultimate: {
    charged: effectKey('ultimate', 'charged'),
    beamCore: effectKey('ultimate', 'beam_core'),
    explosion: effectKey('ultimate', 'explosion'),
    vortex: effectKey('ultimate', 'vortex'),
    rune: effectKey('ultimate', 'rune'),
    prism: effectKey('ultimate', 'prism'),
  },
} as const;

/** 招式配置里的 effects 字段 → 实际纹理 key 的映射 */
export const EFFECT_TEXTURE_MAP: Record<string, string> = {
  // 弹道
  fireball: FX.fire.fireball,
  fireball_big: FX.fire.fireball,
  water_drop: FX.water.drop,
  water_ring: FX.psychic.psyWave,
  hydro_jet: FX.water.wave,
  giant_wave: FX.water.wave,
  bolt: FX.common.boltA,
  lightning_chain: FX.electric.boltLong,
  sky_bolt: FX.electric.boltLong,
  volt_dash: FX.electric.boltLong,
  ice_beam: FX.common.beam,
  ice_shard: FX.ice.crystal,
  snowstorm: FX.ice.frost,
  leaf_blade: FX.grass.blade,
  seed: FX.grass.seed,
  vine_lash: FX.grass.root,
  shadow_orb: FX.common.orb,
  shadow_tongue: FX.common.swirl,
  will_o_wisp: FX.common.flame,
  dragon_pulse_small: FX.common.orb,
  dragon_wave: FX.psychic.psyField,
  dark_jaw: FX.common.fist,
  dark_fang: FX.common.fist,
  dark_pulse_wave: FX.common.portal,
  aura_orb: FX.psychic.psyOrb,
  focus_orb: FX.psychic.psyOrb,
  psy_wave: FX.psychic.psyWave,
  psy_lance: FX.common.beam,
  psy_field: FX.psychic.psyField,
  psy_nova: FX.psychic.psyField,
  bug_dart: FX.common.dot,
  x_slash: FX.common.spark,
  rock_shard: FX.common.shard,
  rock_volley: FX.common.shard,
  stone_spike: FX.common.shard,
  iron_dash: FX.common.dot,
  cannon_beam: FX.common.beam,
  solar_beam: FX.common.beam,
  hyper_beam: FX.ultimate.beamCore,
  metal_ring: FX.common.ring,
  fairy_spark: FX.common.star,
  fairy_beam: FX.common.beam,
  moon_beam: FX.ultimate.beamCore,
  play_swipe: FX.common.heart,
  star_shot: FX.common.star,
  speed_line: FX.common.streak,
  slash_wave: FX.common.spark,
  chop_wave: FX.common.spark,
  rush_fist: FX.common.fist,
  mud_ball: FX.common.dot,
  earth_burst: FX.grass.root,
  quake_wave: FX.common.crack,
  wind_slash: FX.common.streak,
  air_blade: FX.common.streak,
  hurricane_eye: FX.ultimate.vortex,
  sludge_lob: FX.common.smoke,
  poison_dart: FX.common.dot,
  spike_rain: FX.common.shard,
  seed_sprout: FX.grass.seed,
  clone_spawn: FX.ultimate.rune,
  dragon_rush: FX.common.orb,
  rage_charge: FX.common.orb,
  meteor_fall: FX.common.meteor,
  meteor_fire: FX.common.meteor,
  bang: FX.common.nova,
  boom: FX.common.nova,

  // 命中 / 范围
  hit_spark: FX.common.spark,
  fire_burst: FX.common.nova,
  fire_explosion: FX.ultimate.explosion,
  inferno: FX.ultimate.explosion,
  fire_field: FX.common.flame,
  splash: FX.water.splash,
  splash_burst: FX.water.splash,
  water_column: FX.water.wave,
  wave_crash: FX.water.wave,
  spark_burst: FX.electric.sparkRing,
  electric_burst: FX.electric.sparkRing,
  thunder_strike: FX.electric.sparkRing,
  volt_impact: FX.electric.sparkRing,
  ice_shatter: FX.ice.crystal,
  blizzard: FX.ice.frost,
  frost_bite: FX.ice.crystal,
  ice_field: FX.ice.frost,
  leaf_hit: FX.grass.blade,
  leaf_storm: FX.grass.blade,
  plant_erupt: FX.grass.root,
  shadow_explosion: FX.common.portal,
  dark_void: FX.common.portal,
  spirit_flame: FX.common.flame,
  dragon_hit: FX.common.star,
  dragon_burst: FX.common.nova,
  meteor_impact: FX.ultimate.explosion,
  rage_impact: FX.ultimate.explosion,
  crunch_hit: FX.common.spark,
  dark_explosion: FX.ultimate.explosion,
  bite_mark: FX.common.spark,
  clang: FX.common.spark,
  metal_burst: FX.ultimate.charged,
  metal_screech: FX.common.ring,
  aura_burst: FX.psychic.psyOrb,
  focus_explosion: FX.ultimate.explosion,
  chop_hit: FX.common.spark,
  multi_punch: FX.common.fist,
  psy_hit: FX.psychic.psyWave,
  psy_warp: FX.psychic.psyField,
  psy_shatter: FX.ultimate.charged,
  mind_crush: FX.ultimate.rune,
  bug_hit: FX.common.dot,
  cross_cut: FX.common.spark,
  resonance: FX.psychic.psyWave,
  rock_crash: FX.common.shard,
  rock_burst: FX.common.nova,
  spike_wall: FX.common.shard,
  spooky_hit: FX.common.portal,
  splash_hit: FX.water.splash,
  fairy_pop: FX.common.heart,
  prism_burst: FX.ultimate.prism,
  lunar_burst: FX.ultimate.rune,
  hearts_burst: FX.common.heart,
  impact_shock: FX.ultimate.explosion,
  beam_burst: FX.ultimate.explosion,
  solar_burst: FX.ultimate.explosion,
  afterimage_hit: FX.common.streak,
  hit_impact: FX.common.nova,
  wind_hit: FX.common.streak,
  air_burst: FX.common.streak,
  tornado: FX.ultimate.vortex,
  ground_crack: FX.common.crack,
  power_geyser: FX.grass.root,
  sludge_pool: FX.common.smoke,
  spike_field: FX.common.shard,

  // 蓄力
  charge_orbs: FX.ultimate.charged,
  flame_charge: FX.fire.ember,
  flame_pillar: FX.fire.flameLarge,
  water_charge: FX.water.drop,
  electric_charge: FX.electric.boltLong,
  frost_charge: FX.ice.crystal,
  leaf_charge: FX.grass.blade,
  solar_charge: FX.ultimate.charged,
  psy_charge: FX.psychic.psyOrb,
  shadow_charge: FX.common.portal,
  dragon_charge: FX.common.orb,
  dark_charge: FX.common.portal,
  metal_charge: FX.ultimate.charged,
  fairy_charge: FX.common.star6,
  moon_charge: FX.ultimate.rune,
  buzz_charge: FX.psychic.psyWave,
  wind_charge: FX.ultimate.vortex,
  ground_charge: FX.common.crack,
  rage_charge2: FX.common.orb,
  meteor_summon: FX.ultimate.rune,
  flame_stream: FX.fire.flameLarge,
  clone_spawn2: FX.ultimate.rune,

  // 拖尾
  fire_trail: FX.common.streak,
  dash_trail: FX.common.streak,

  // 自身增益
  speed_aura: FX.psychic.psyField,
  blade_aura: FX.common.spark,
  psy_aura: FX.psychic.psyField,
  armor_aura: FX.common.ring,
};

export function textureForEffect(name: string | undefined): string | null {
  if (!name) return null;
  return EFFECT_TEXTURE_MAP[name] ?? null;
}
