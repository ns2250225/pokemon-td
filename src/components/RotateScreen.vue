<script setup lang="ts">
/**
 * 竖屏引导界面（PRD 8.3）。
 *
 * 三级降级的第二级：浏览器拒绝锁定横屏时，引导用户旋转设备。
 * 第三级兜底由父组件通过 force-css 事件启用 CSS 旋转。
 */
import { computed, ref } from 'vue';
import { useOrientation } from '../composables/useOrientation';

const emit = defineEmits<{ (e: 'force-css'): void }>();

const orientation = useOrientation();
const trying = ref(false);
const tried = ref(false);

const guideText = computed(() => {
  if (tried.value && orientation.lockFailed.value) {
    return '当前浏览器不支持自动锁定横屏，请手动旋转设备，或使用下方的兜底模式。';
  }
  return '旋转手机，获得完整的宝可梦塔防体验';
});

async function tryLandscape() {
  trying.value = true;
  await orientation.startLandscapeGame();
  tried.value = true;
  trying.value = false;
}
</script>

<template>
  <div class="rotate-guide">
    <div class="rotate-guide__content">
      <div class="rotate-guide__phone" aria-hidden="true">
        <span class="rotate-guide__phone-body" />
        <span class="rotate-guide__arrow">↻</span>
      </div>

      <h2>请横屏游玩</h2>
      <p>{{ guideText }}</p>
      <p class="rotate-guide__sub">建议开启系统的自动旋转</p>

      <div class="rotate-guide__actions">
        <button class="btn btn--primary" :disabled="trying" @click="tryLandscape">
          {{ trying ? '正在尝试…' : '尝试进入横屏' }}
        </button>

        <button
          v-if="orientation.isMobile.value"
          class="btn btn--ghost btn--sm"
          @click="emit('force-css')"
        >
          使用旋转显示模式（兜底）
        </button>
      </div>

      <p v-if="!orientation.fullscreenSupported.value" class="rotate-guide__note">
        当前浏览器不支持全屏 API，游戏仍可正常进行。
      </p>
    </div>
  </div>
</template>

<style scoped>
.rotate-guide {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
}

.rotate-guide__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 420px;
}

.rotate-guide__phone {
  position: relative;
  width: 110px;
  height: 70px;
  margin-bottom: 10px;
}

.rotate-guide__phone-body {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  border: 4px solid var(--brand);
  background: linear-gradient(180deg, #1b2432, #0d1117);
  animation: tilt 1.8s ease-in-out infinite;
}

@keyframes tilt {
  0%, 30% { transform: rotate(-72deg) scale(0.82); }
  60%, 100% { transform: rotate(0deg) scale(1); }
}

.rotate-guide__arrow {
  position: absolute;
  right: -32px;
  top: 12px;
  font-size: 30px;
  color: var(--brand);
  animation: spin-arrow 1.8s ease-in-out infinite;
}

@keyframes spin-arrow {
  0%, 30% { transform: rotate(-90deg); opacity: 0.4; }
  60%, 100% { transform: rotate(0); opacity: 1; }
}

.rotate-guide h2 {
  margin: 0;
  font-size: 22px;
  letter-spacing: 2px;
}

.rotate-guide p {
  margin: 0;
  font-size: 13px;
  color: var(--text-1);
  line-height: 1.65;
}

.rotate-guide__sub {
  color: var(--text-2) !important;
  font-size: 11.5px !important;
}

.rotate-guide__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
  width: 100%;
}

.rotate-guide__note {
  font-size: 11px !important;
  color: var(--warn) !important;
  margin-top: 6px !important;
}
</style>
