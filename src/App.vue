<script setup lang="ts">
/**
 * 应用根组件 —— 负责路由级的界面切换与全局浮层。
 *
 * 界面流：
 *   主菜单 → 关卡选择 → 战斗（HUD 覆盖在 Phaser 画布上）→ 结算
 *   主菜单 → 图鉴 / 设置 / 成就
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import MainMenu from './components/MainMenu.vue';
import LevelSelect from './components/LevelSelect.vue';
import BattleScreen from './components/BattleScreen.vue';
import Pokedex from './components/Pokedex.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import AchievementPanel from './components/AchievementPanel.vue';
import RotateScreen from './components/RotateScreen.vue';
import ToastHost from './components/ToastHost.vue';
import LoadingScreen from './components/LoadingScreen.vue';
import { useOrientation } from './composables/useOrientation';
import { audioEngine } from './utils/audio';
import { bus } from './utils/eventBus';
import { useProgressStore } from './stores/progress';
import { useSettingsStore } from './stores/game';
import { detectDevice } from './utils/device';

type Screen = 'menu' | 'levels' | 'battle' | 'pokedex' | 'settings' | 'achievements';

const screen = shallowRef<Screen>('menu');
const activeLevelId = ref<string | null>(null);
const booting = ref(true);
const bootMessage = ref('正在读取存档…');

const orientation = useOrientation();
const progress = useProgressStore();
const settings = useSettingsStore();

const device = detectDevice();

/** 竖屏且在移动端时需要显示旋转引导（CSS 旋转兜底模式除外） */
const showRotateGuide = computed(() =>
  settings.autoRotatePrompt &&
  orientation.isMobile.value
  && orientation.isPortrait.value
  && !orientation.cssRotationMode.value,
);

const ready = computed(() => progress.ready && settings.ready);

onMounted(async () => {
  bootMessage.value = '正在初始化资源索引…';
  // 等两个 store 就绪
  await Promise.all([
    new Promise<void>((r) => { if (progress.ready) r(); else { const t = setInterval(() => { if (progress.ready) { clearInterval(t); r(); } }, 40); } }),
    new Promise<void>((r) => { if (settings.ready) r(); else { const t = setInterval(() => { if (settings.ready) { clearInterval(t); r(); } }, 40); } }),
  ]);
  bootMessage.value = '准备就绪';
  setTimeout(() => { booting.value = false; }, 260);

  // 首次用户手势后解锁音频
  const unlock = async () => {
    await audioEngine.unlock();
    audioEngine.syncVolumes();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  bus.on('battle:exitRequested', () => { void goLevels(); });
});

function startLevel(levelId: string) {
  activeLevelId.value = levelId;
  screen.value = 'battle';
}

function goLevels() {
  screen.value = 'levels';
  activeLevelId.value = null;
  audioEngine.stopBgm();
}

function goMenu() {
  screen.value = 'menu';
  activeLevelId.value = null;
  audioEngine.stopBgm();
}
</script>

<template>
  <div class="app-shell">
    <LoadingScreen v-if="booting || !ready" :message="bootMessage" />

    <template v-else>
      <RotateScreen v-if="showRotateGuide" @force-css="orientation.enableCssRotation()" />

      <div
        v-else
        class="screen-host"
        :class="{ 'is-css-rotated': !!orientation.rotationTransform.value }"
        :style="orientation.rotationTransform.value ?? undefined"
      >
        <MainMenu
          v-if="screen === 'menu'"
          @play="screen = 'levels'"
          @pokedex="screen = 'pokedex'"
          @settings="screen = 'settings'"
          @achievements="screen = 'achievements'"
          @toggle-fullscreen="orientation.toggleFullscreen()"
          :is-fullscreen="orientation.isFullscreen.value"
          :fullscreen-supported="orientation.fullscreenSupported.value"
        />

        <LevelSelect
          v-else-if="screen === 'levels'"
          @back="goMenu"
          @start="startLevel"
        />

        <BattleScreen
          v-else-if="screen === 'battle' && activeLevelId"
          :key="activeLevelId"
          :level-id="activeLevelId"
          @exit="goLevels"
          @next-level="startLevel"
        />

        <Pokedex
          v-else-if="screen === 'pokedex'"
          @back="goMenu"
        />

        <SettingsPanel
          v-else-if="screen === 'settings'"
          @back="goMenu"
        />

        <AchievementPanel
          v-else-if="screen === 'achievements'"
          @back="goMenu"
        />
      </div>

      <ToastHost />
    </template>
  </div>
</template>

<style scoped>
.app-shell {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 50% 0%, #1b2432 0%, var(--bg-0) 70%);
  padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
}

.screen-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
</style>
