/**
 * 音频系统 —— 使用 Web Audio API 程序化合成音效与背景音乐。
 *
 * 为什么不做素材下载：宝可梦原版音效与 BGM 受版权保护，公开可下载不等于可发布。
 * 因此这里用振荡器 + 包络合成所有声音：体积为 0、无授权风险、可随属性参数化
 * （不同属性的技能使用不同的谐波与包络，仍然具备辨识度）。
 */
import { getGameSettings } from '../stores/settings';
import type { PokemonType } from '../data/balance/typeChart';

export type SfxName =
  | 'ui_click' | 'ui_hover' | 'ui_confirm' | 'ui_cancel' | 'ui_error'
  | 'build' | 'upgrade' | 'evolve' | 'sell' | 'coin'
  | 'hit_light' | 'hit_heavy' | 'explosion' | 'cast' | 'freeze' | 'zap'
  | 'victory' | 'defeat' | 'wave_start' | 'boss_warning' | 'level_up';

/** 每种属性的音色配方：波形、基频、谐波、时长、包络 */
const TYPE_RECIPES: Record<PokemonType, { wave: OscillatorType; base: number; spread: number; duration: number; noise: number }> = {
  fire: { wave: 'sawtooth', base: 220, spread: 0.5, duration: 0.34, noise: 0.45 },
  water: { wave: 'sine', base: 380, spread: 0.7, duration: 0.3, noise: 0.3 },
  electric: { wave: 'square', base: 900, spread: 0.9, duration: 0.18, noise: 0.55 },
  grass: { wave: 'triangle', base: 300, spread: 0.4, duration: 0.28, noise: 0.25 },
  ice: { wave: 'sine', base: 1300, spread: 0.6, duration: 0.32, noise: 0.35 },
  psychic: { wave: 'sine', base: 520, spread: 0.8, duration: 0.4, noise: 0.15 },
  ghost: { wave: 'triangle', base: 180, spread: 0.6, duration: 0.45, noise: 0.2 },
  dragon: { wave: 'sawtooth', base: 160, spread: 0.7, duration: 0.4, noise: 0.35 },
  fighting: { wave: 'square', base: 260, spread: 0.5, duration: 0.2, noise: 0.4 },
  poison: { wave: 'triangle', base: 340, spread: 0.5, duration: 0.34, noise: 0.3 },
  ground: { wave: 'sawtooth', base: 120, spread: 0.3, duration: 0.42, noise: 0.5 },
  flying: { wave: 'sine', base: 700, spread: 0.8, duration: 0.26, noise: 0.5 },
  bug: { wave: 'sawtooth', base: 480, spread: 0.6, duration: 0.22, noise: 0.3 },
  rock: { wave: 'square', base: 140, spread: 0.35, duration: 0.3, noise: 0.55 },
  steel: { wave: 'square', base: 640, spread: 0.4, duration: 0.24, noise: 0.35 },
  dark: { wave: 'triangle', base: 200, spread: 0.6, duration: 0.38, noise: 0.25 },
  fairy: { wave: 'sine', base: 980, spread: 0.7, duration: 0.34, noise: 0.1 },
  normal: { wave: 'triangle', base: 440, spread: 0.4, duration: 0.22, noise: 0.2 },
};

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private unlocked = false;
  /** 同一时间允许的并发音效上限，避免大量技能导致爆音与卡顿 */
  private activeVoices = 0;
  private maxVoices = 14;
  /** 最近播放过的音效时间戳，用于节流（同名音效 60ms 内只播一次） */
  private lastPlayed = new Map<string, number>();
  private bgmNodes: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  /** 必须在用户手势中调用 */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      await this.ctx.resume();

      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = getGameSettings().sfxVolume;
      this.sfxBus.connect(this.master);

      this.bgmBus = this.ctx.createGain();
      this.bgmBus.gain.value = getGameSettings().bgmVolume * 0.35;
      this.bgmBus.connect(this.master);

      this.noiseBuffer = this.createNoiseBuffer();
      this.unlocked = true;
    } catch {
      this.unlocked = false;
    }
  }

  private createNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  get enabled() {
    return !!this.ctx;
  }

  syncVolumes() {
    const s = getGameSettings();
    if (this.sfxBus) this.sfxBus.gain.value = s.sfxVolume;
    if (this.bgmBus) this.bgmBus.gain.value = s.bgmVolume * 0.35;
  }

  /* ---------------------------------------------------------------- */
  /* 合成原语                                                          */
  /* ---------------------------------------------------------------- */

  private tone(opts: {
    freq: number;
    duration: number;
    wave?: OscillatorType;
    gain?: number;
    detune?: number;
    sweepTo?: number;
    delay?: number;
    attack?: number;
    bus?: GainNode | null;
    harmonics?: number[];
  }) {
    if (!this.ctx || !this.sfxBus) return;
    if (this.activeVoices >= this.maxVoices) return;

    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const dur = opts.duration;
    const bus = opts.bus ?? this.sfxBus;
    const gain = this.ctx.createGain();
    const peak = opts.gain ?? 0.22;
    const attack = opts.attack ?? 0.006;

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const waves = opts.harmonics ?? [1];
    const oscs: OscillatorNode[] = [];
    waves.forEach((mult, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = opts.wave ?? 'sine';
      osc.frequency.setValueAtTime(opts.freq * mult, t0);
      if (opts.sweepTo) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo * mult), t0 + dur);
      }
      if (opts.detune) osc.detune.setValueAtTime(opts.detune * (i + 1), t0);
      const hGain = this.ctx!.createGain();
      hGain.gain.value = 1 / (i + 1.5);
      osc.connect(hGain).connect(gain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      oscs.push(osc);
    });

    gain.connect(bus);
    this.activeVoices++;
    const total = dur + (opts.delay ?? 0);
    setTimeout(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); }, total * 1000 + 40);
  }

  private noise(opts: { duration: number; gain?: number; filterFreq?: number; sweepTo?: number; delay?: number; q?: number }) {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    if (this.activeVoices >= this.maxVoices) return;

    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(opts.filterFreq ?? 1200, t0);
    filter.Q.value = opts.q ?? 1.2;
    if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweepTo), t0 + opts.duration);

    const gain = this.ctx.createGain();
    const peak = opts.gain ?? 0.18;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + opts.duration + 0.02);
    this.activeVoices++;
    setTimeout(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); }, opts.duration * 1000 + 60);
  }

  private throttled(key: string, ms = 55): boolean {
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? 0;
    if (now - last < ms) return true;
    this.lastPlayed.set(key, now);
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* 音效                                                              */
  /* ---------------------------------------------------------------- */

  play(name: SfxName, opts: { type?: PokemonType; tier?: 'common' | 'enhanced' | 'epic' | 'legendary'; pitch?: number } = {}) {
    if (!this.unlocked || !this.ctx) return;
    if (this.throttled(name, name.startsWith('hit') ? 45 : 70)) return;
    const pitch = opts.pitch ?? 1;

    switch (name) {
      case 'ui_click':
        this.tone({ freq: 660 * pitch, duration: 0.07, wave: 'triangle', gain: 0.14 });
        break;
      case 'ui_hover':
        this.tone({ freq: 880 * pitch, duration: 0.04, wave: 'sine', gain: 0.06 });
        break;
      case 'ui_confirm':
        this.tone({ freq: 520 * pitch, duration: 0.1, wave: 'triangle', gain: 0.16 });
        this.tone({ freq: 780 * pitch, duration: 0.14, wave: 'triangle', gain: 0.14, delay: 0.08 });
        break;
      case 'ui_cancel':
        this.tone({ freq: 420 * pitch, duration: 0.09, wave: 'triangle', gain: 0.13, sweepTo: 240 });
        break;
      case 'ui_error':
        this.tone({ freq: 200 * pitch, duration: 0.16, wave: 'square', gain: 0.12, sweepTo: 120 });
        break;
      case 'build':
        this.tone({ freq: 300, duration: 0.16, wave: 'triangle', gain: 0.2, sweepTo: 620 });
        this.tone({ freq: 900, duration: 0.14, wave: 'sine', gain: 0.12, delay: 0.14 });
        break;
      case 'upgrade':
        [0, 0.07, 0.14].forEach((d, i) => this.tone({ freq: 520 * (1 + i * 0.25), duration: 0.14, wave: 'triangle', gain: 0.16, delay: d }));
        break;
      case 'evolve':
        [0, 0.1, 0.2, 0.32].forEach((d, i) => this.tone({ freq: 380 * Math.pow(1.3, i), duration: 0.26, wave: 'sine', gain: 0.16, delay: d, harmonics: [1, 2, 3] }));
        this.noise({ duration: 0.6, gain: 0.1, filterFreq: 400, sweepTo: 2400 });
        break;
      case 'level_up':
        [0, 0.06, 0.12].forEach((d, i) => this.tone({ freq: 700 * (1 + i * 0.2), duration: 0.12, wave: 'sine', gain: 0.14, delay: d }));
        break;
      case 'sell':
        this.tone({ freq: 620, duration: 0.1, wave: 'triangle', gain: 0.14, sweepTo: 340 });
        break;
      case 'coin':
        this.tone({ freq: 1180, duration: 0.08, wave: 'sine', gain: 0.1 });
        this.tone({ freq: 1560, duration: 0.12, wave: 'sine', gain: 0.08, delay: 0.05 });
        break;
      case 'hit_light':
        this.noise({ duration: 0.09, gain: 0.13, filterFreq: 2400, q: 0.9 });
        break;
      case 'hit_heavy':
        this.noise({ duration: 0.18, gain: 0.2, filterFreq: 1400, sweepTo: 300, q: 0.7 });
        this.tone({ freq: 110, duration: 0.16, wave: 'sawtooth', gain: 0.16, sweepTo: 60 });
        break;
      case 'explosion':
        this.noise({ duration: 0.5, gain: 0.28, filterFreq: 900, sweepTo: 90, q: 0.6 });
        this.tone({ freq: 90, duration: 0.42, wave: 'sawtooth', gain: 0.22, sweepTo: 40 });
        break;
      case 'freeze':
        this.tone({ freq: 1800, duration: 0.3, wave: 'sine', gain: 0.12, sweepTo: 600, harmonics: [1, 1.5, 2.2] });
        this.noise({ duration: 0.3, gain: 0.1, filterFreq: 5200, sweepTo: 1800 });
        break;
      case 'zap': {
        const r = TYPE_RECIPES.electric;
        this.tone({ freq: r.base, duration: r.duration, wave: r.wave, gain: 0.16, sweepTo: r.base * 0.4, harmonics: [1, 1.5] });
        this.noise({ duration: 0.14, gain: 0.14, filterFreq: 4200, q: 2.4 });
        break;
      }
      case 'cast': {
        const type = opts.type ?? 'normal';
        const r = TYPE_RECIPES[type];
        this.tone({ freq: r.base * pitch, duration: r.duration, wave: r.wave, gain: 0.16, sweepTo: r.base * pitch * (0.5 + r.spread * 0.3), harmonics: [1, 2] });
        if (r.noise > 0.2) this.noise({ duration: r.duration * 0.8, gain: 0.12 * r.noise, filterFreq: r.base * 4, sweepTo: r.base });
        break;
      }
      case 'wave_start':
        [0, 0.12, 0.24].forEach((d, i) => this.tone({ freq: 300 + i * 110, duration: 0.3, wave: 'triangle', gain: 0.14, delay: d }));
        break;
      case 'boss_warning':
        [0, 0.26, 0.52].forEach((d) => this.tone({ freq: 160, duration: 0.32, wave: 'sawtooth', gain: 0.2, delay: d, harmonics: [1, 1.5, 2] }));
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, duration: 0.42, wave: 'triangle', gain: 0.18, delay: i * 0.14, harmonics: [1, 2] }));
        break;
      case 'defeat':
        [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, duration: 0.46, wave: 'sawtooth', gain: 0.15, delay: i * 0.17 }));
        break;
      default:
        break;
    }
  }

  /** 技能音效：按属性 + 特效等级选择音色，史诗 / 传说级额外叠一层低频 */
  playMove(type: PokemonType, tier: 'common' | 'enhanced' | 'epic' | 'legendary') {
    if (!this.unlocked) return;
    this.play('cast', { type, tier });
    if (tier === 'epic' || tier === 'legendary') {
      setTimeout(() => this.play('hit_heavy'), 90);
    }
    if (tier === 'legendary') {
      setTimeout(() => this.play('explosion'), 160);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 背景音乐                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 程序化 BGM：以五行循环的和声进行铺底，音高随章节变化。
   * 使用很低的音量与长淡入，避免干扰战斗音效。
   */
  startBgm(chapter = 1) {
    if (!this.unlocked || !this.ctx || !this.bgmBus) return;
    this.stopBgm();

    const scaleRoot = 220 * Math.pow(2, ((chapter - 1) % 8) / 12 * 2);
    const progression = [0, 3, 5, 7, 10].map((semi) => scaleRoot * Math.pow(2, semi / 12));

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.bgmBus);
    gain.gain.linearRampToValueAtTime(0.16, this.ctx.currentTime + 3);

    const oscs: OscillatorNode[] = [];
    // 铺底和弦（两个八度）
    for (const freq of [progression[0] / 2, progression[0], progression[2]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(g).connect(gain);
      osc.start();
      oscs.push(osc);
    }

    let step = 0;
    const playNote = () => {
      if (!this.ctx) return;
      const freq = progression[step % progression.length] * (step % 4 === 0 ? 2 : 1);
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      const t0 = this.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
      osc.connect(g).connect(gain);
      osc.start(t0);
      osc.stop(t0 + 2.6);
      step++;
    };

    this.bgmTimer = setInterval(playNote, 2200);
    playNote();
    this.bgmNodes = { osc: oscs, gain };
  }

  stopBgm() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (this.bgmNodes && this.ctx) {
      try {
        this.bgmNodes.gain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.4);
        for (const o of this.bgmNodes.osc) {
          setTimeout(() => { try { o.stop(); } catch { /* 已停止 */ } }, 500);
        }
      } catch {
        /* 忽略 */
      }
      this.bgmNodes = null;
    }
  }

  /** 暂停（页面切后台） */
  async suspend() {
    try { await this.ctx?.suspend(); } catch { /* 忽略 */ }
  }

  async resume() {
    try { await this.ctx?.resume(); } catch { /* 忽略 */ }
  }
}

export const audioEngine = new AudioEngine();
