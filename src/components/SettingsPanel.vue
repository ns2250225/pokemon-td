<script setup lang="ts">
/**
 * 设置面板 —— 音量、画质、特效开关、操作偏好、存档导入导出。
 */
import { computed, ref } from 'vue';
import { useSettingsStore } from '../stores/game';
import { useProgressStore } from '../stores/progress';
import { audioEngine } from '../utils/audio';
import { detectDevice, getRecommendedQuality } from '../utils/device';
import { cacheStats, clearCache } from '../utils/offline';
import { ALL_IDS, TOTAL_SPECIES, coverageReport } from '../data/pokemon/pokedex';

const emit = defineEmits<{ (e: 'back'): void }>();

const settings = useSettingsStore();
const progress = useProgressStore();

const device = detectDevice();
const coverage = computed(() => coverageReport());

const importText = ref('');
const message = ref<{ text: string; tone: string } | null>(null);
const cacheInfo = ref<{ entries: number; approximateBytes: number } | null>(null);

function notify(text: string, tone = 'good') {
  message.value = { text, tone };
  setTimeout(() => { if (message.value?.text === text) message.value = null; }, 2600);
}

function setQuality(q: 'low' | 'medium' | 'high') {
  settings.update('quality', q);
  audioEngine.play('ui_click');
}

function applyRecommended() {
  settings.update('quality', getRecommendedQuality());
  notify(`已按设备能力设为「${qualityLabel(getRecommendedQuality())}」`);
}

function qualityLabel(q: string) {
  return { low: '低', medium: '中', high: '高' }[q] ?? q;
}

async function exportSave() {
  const json = await progress.exportSave();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pokemon-tower-defense-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  notify('存档已导出');
}

function importSave() {
  if (!importText.value.trim()) {
    notify('请先粘贴存档 JSON', 'warn');
    return;
  }
  const res = progress.importSave(importText.value);
  notify(res.message, res.ok ? 'good' : 'warn');
  if (res.ok) importText.value = '';
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    importText.value = await file.text();
    importSave();
  } catch {
    notify('读取文件失败', 'warn');
  }
  input.value = '';
}

async function checkCache() {
  cacheInfo.value = await cacheStats();
  notify(`已缓存 ${cacheInfo.value.entries} 项资源`);
}

async function doClearCache() {
  await clearCache();
  cacheInfo.value = { entries: 0, approximateBytes: 0 };
  notify('离线缓存已清除');
}

async function resetProgress() {
  if (!confirm('确定要清空所有通关记录、星级与解锁精灵吗？此操作不可撤销。')) return;
  await progress.reset();
  notify('进度已重置');
}

const deviceSummary = computed(() => {
  const d = device;
  return [
    d.isMobile ? '移动设备' : '桌面设备',
    `${d.cores} 核`,
    d.memoryGb !== null ? `${d.memoryGb} GB 内存` : null,
    d.hasWebGL ? 'WebGL' : 'Canvas',
    `DPR ${d.devicePixelRatio.toFixed(1)}`,
  ].filter(Boolean).join(' · ');
});
</script>

<template>
  <div class="settings">
    <header class="settings__bar">
      <button class="btn btn--ghost btn--sm" @click="audioEngine.play('ui_cancel'); emit('back')">← 返回</button>
      <h2>设置</h2>
      <span class="settings__persist">
        {{ progress.ready ? '本地存档' : '…' }}
      </span>
    </header>

    <div class="settings__body scroll">
      <Transition name="fade">
        <div v-if="message" class="settings__msg" :class="`tone-${message.tone}`">{{ message.text }}</div>
      </Transition>

      <!-- 音频 -->
      <section class="panel settings__section">
        <h3>音频</h3>
        <label class="slider">
          <span>背景音乐</span>
          <input
            type="range" min="0" max="1" step="0.05"
            :value="settings.bgmVolume"
            @input="settings.update('bgmVolume', Number(($event.target as HTMLInputElement).value)); audioEngine.syncVolumes()"
          />
          <em>{{ Math.round(settings.bgmVolume * 100) }}%</em>
        </label>
        <label class="slider">
          <span>音效</span>
          <input
            type="range" min="0" max="1" step="0.05"
            :value="settings.sfxVolume"
            @input="settings.update('sfxVolume', Number(($event.target as HTMLInputElement).value)); audioEngine.syncVolumes(); audioEngine.play('ui_click')"
          />
          <em>{{ Math.round(settings.sfxVolume * 100) }}%</em>
        </label>
        <p class="settings__note">
          音乐与音效均由 Web Audio API 实时合成（无第三方音频素材，避免授权问题）。
        </p>
      </section>

      <!-- 画质 -->
      <section class="panel settings__section">
        <h3>画质与特效</h3>
        <div class="seg">
          <button
            v-for="q in (['low', 'medium', 'high'] as const)"
            :key="q"
            class="seg__btn"
            :class="{ 'is-active': settings.quality === q }"
            :aria-pressed="settings.quality === q"
            @click="setQuality(q)"
          >
            {{ qualityLabel(q) }}
          </button>
        </div>

        <label class="slider">
          <span>特效强度</span>
          <input
            type="range" min="0.4" max="1.5" step="0.05"
            :value="settings.effectIntensity"
            @input="settings.update('effectIntensity', Number(($event.target as HTMLInputElement).value))"
          />
          <em>{{ Math.round(settings.effectIntensity * 100) }}%</em>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.screenShake" @change="settings.update('screenShake', ($event.target as HTMLInputElement).checked)" />
          <span>屏幕震动</span>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.flash" @change="settings.update('flash', ($event.target as HTMLInputElement).checked)" />
          <span>闪光与闪烁效果</span>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.damageNumbers" @change="settings.update('damageNumbers', ($event.target as HTMLInputElement).checked)" />
          <span>伤害数字</span>
        </label>

        <button class="btn btn--ghost btn--sm" @click="applyRecommended">
          按当前设备自动推荐（当前：{{ qualityLabel(getRecommendedQuality()) }}）
        </button>

        <p class="settings__note">设备信息：{{ deviceSummary }}</p>
      </section>

      <!-- 操作 -->
      <section class="panel settings__section">
        <h3>操作偏好</h3>
        <label class="switch">
          <span>默认游戏速度</span>
          <div class="seg seg--sm">
            <button
              v-for="s in ([1, 2, 3] as const)"
              :key="s"
              class="seg__btn"
              :class="{ 'is-active': settings.defaultSpeed === s }"
              @click="settings.update('defaultSpeed', s)"
            >
              {{ s }}×
            </button>
          </div>
        </label>
        <label class="switch">
          <input type="checkbox" :checked="settings.autoRotatePrompt" @change="settings.update('autoRotatePrompt', ($event.target as HTMLInputElement).checked)" />
          <span>竖屏时显示旋转引导</span>
        </label>
        <label class="switch">
          <input type="checkbox" :checked="settings.fullscreenOnStart" @change="settings.update('fullscreenOnStart', ($event.target as HTMLInputElement).checked)" />
          <span>开始游戏时尝试全屏</span>
        </label>
      </section>

      <!-- 存档 -->
      <section class="panel settings__section">
        <h3>存档（IndexedDB · 无需账号）</h3>
        <div class="kv-row">
          <div class="kv"><span>已通关</span><strong>{{ progress.clearedCount }} 关</strong></div>
          <div class="kv"><span>总星数</span><strong>{{ progress.totalStars }}</strong></div>
          <div class="kv"><span>图鉴发现</span><strong>{{ progress.discoveryRatio }}/{{ TOTAL_SPECIES }}</strong></div>
          <div class="kv"><span>可用精灵</span><strong>{{ progress.unlockedPokemon.length }}</strong></div>
          <div class="kv"><span>成就</span><strong>{{ progress.achievements.length }}</strong></div>
          <div class="kv"><span>图鉴数据</span><strong>{{ ALL_IDS.length }} 种</strong></div>
        </div>

        <div class="settings__row">
          <button class="btn btn--ghost btn--sm" @click="exportSave">导出存档 JSON</button>
          <label class="btn btn--ghost btn--sm file-btn">
            从文件导入
            <input type="file" accept="application/json,.json" @change="onFilePicked" />
          </label>
        </div>

        <textarea
          v-model="importText"
          class="settings__textarea"
          rows="3"
          placeholder="或在此粘贴存档 JSON 后点击「导入文本」"
        />
        <div class="settings__row">
          <button class="btn btn--ghost btn--sm" @click="importSave">导入文本</button>
          <button class="btn btn--danger btn--sm" @click="resetProgress">清空进度</button>
        </div>
      </section>

      <!-- 离线缓存 -->
      <section class="panel settings__section">
        <h3>离线缓存</h3>
        <p class="settings__note">
          已访问过的关卡资源会被缓存，断网后仍可继续游玩。
        </p>
        <div class="settings__row">
          <button class="btn btn--ghost btn--sm" @click="checkCache">查看缓存</button>
          <button class="btn btn--ghost btn--sm" @click="doClearCache">清除缓存</button>
        </div>
        <p v-if="cacheInfo" class="settings__note">
          缓存 {{ cacheInfo.entries }} 项，约 {{ (cacheInfo.approximateBytes / 1024 / 1024).toFixed(1) }} MB（抽样估算）
        </p>
      </section>

      <!-- 素材与授权 -->
      <section class="panel settings__section">
        <h3>素材与授权</h3>
        <p class="settings__note">
          精灵素材来自 PokeAPI/sprites（GitHub 公开仓库）。仓库代码许可不等于素材授权，
          宝可梦图像版权归 Nintendo / Creatures Inc. / GAME FOUND inc. 所有，
          <strong>本项目为非商业技术原型，未确认可商用</strong>。
          特效纹理为本项目程序化生成（CC0），音频为实时合成。
        </p>
        <div class="kv-row">
          <div class="kv"><span>图鉴条目覆盖</span><strong>{{ coverage.pokedex.covered }}/{{ coverage.pokedex.total }}</strong></div>
          <div class="kv"><span>静态素材覆盖</span><strong>{{ (coverage.staticSprite.ratio * 100).toFixed(1) }}%</strong></div>
          <div class="kv"><span>动态素材覆盖</span><strong>{{ (coverage.animatedSprite.ratio * 100).toFixed(1) }}%</strong></div>
          <div class="kv"><span>战斗配置覆盖</span><strong>{{ (coverage.battleConfig.ratio * 100).toFixed(1) }}%</strong></div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px clamp(10px, 2.4vw, 26px);
  gap: 8px;
}

.settings__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.settings__bar h2 { margin: 0; font-size: 19px; letter-spacing: 1px; }

.settings__persist { margin-left: auto; font-size: 11px; color: var(--text-2); }

.settings__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  align-content: start;
  padding-right: 4px;
}

.settings__msg {
  grid-column: 1 / -1;
  padding: 8px 14px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-2);
  border-left: 4px solid var(--good);
}

.settings__msg.tone-warn { border-left-color: var(--warn); }

.settings__section {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.settings__section h3 {
  margin: 0;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--text-1);
  border-bottom: 1px solid var(--line);
  padding-bottom: 6px;
}

.slider {
  display: grid;
  grid-template-columns: 74px 1fr 44px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-1);
}

.slider input[type='range'] { accent-color: var(--brand); width: 100%; }
.slider em { font-style: normal; font-size: 11px; color: var(--text-2); text-align: right; }

.switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-1);
  cursor: pointer;
  min-height: 30px;
}

.switch input[type='checkbox'] {
  accent-color: var(--brand);
  width: 17px;
  height: 17px;
  flex: none;
}

.switch > span:first-child { flex: 1; }

.seg {
  display: flex;
  gap: 4px;
  background: var(--bg-2);
  border-radius: var(--radius-pill);
  padding: 3px;
  border: 1px solid var(--line);
}

.seg--sm { padding: 2px; }

.seg__btn {
  flex: 1;
  min-height: 30px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 800;
  color: var(--text-2);
  transition: all 0.14s ease;
}

.seg--sm .seg__btn { min-height: 26px; min-width: 40px; flex: none; padding: 0 12px; }

.seg__btn.is-active { background: var(--brand); color: #3a2c00; }

.settings__note {
  margin: 0;
  font-size: 10.5px;
  color: var(--text-2);
  line-height: 1.65;
}

.settings__note strong { color: var(--warn); }

.settings__row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.file-btn { position: relative; overflow: hidden; }
.file-btn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

.settings__textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  border: 1px solid var(--line);
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: var(--text-1);
  resize: vertical;
  outline: none;
}

.settings__textarea:focus { border-color: var(--brand); }

.kv-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 6px;
}

.kv {
  display: flex;
  flex-direction: column;
  background: var(--bg-2);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
}

.kv span { font-size: 9.5px; color: var(--text-2); }
.kv strong { font-size: 12.5px; }
</style>
