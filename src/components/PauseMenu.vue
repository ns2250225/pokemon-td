<script setup lang="ts">
/**
 * 暂停菜单 —— 暂停时停止战斗模拟与技能动画（PRD 8.5）。
 */
import { useOrientation } from '../composables/useOrientation';

defineProps<{ levelName: string }>();
const emit = defineEmits<{
  (e: 'resume'): void;
  (e: 'restart'): void;
  (e: 'exit'): void;
}>();

// PRD 8.4：暂停菜单提供全屏按钮（首页之外的第二入口）
const orientation = useOrientation();
</script>

<template>
  <div class="overlay">
    <div class="pause panel">
      <h2>已暂停</h2>
      <p class="pause__level">{{ levelName }}</p>
      <div class="pause__actions">
        <button class="btn btn--primary btn--lg" @click="emit('resume')">继续战斗</button>
        <button class="btn btn--ghost" @click="emit('restart')">重新开始</button>
        <button
          v-if="orientation.fullscreenSupported.value"
          class="btn btn--ghost"
          @click="orientation.toggleFullscreen()"
        >
          {{ orientation.isFullscreen.value ? '退出全屏' : '进入全屏' }}
        </button>
        <button class="btn btn--ghost" @click="emit('exit')">返回关卡选择</button>
      </div>
      <p class="pause__hint">
        快捷键：空格暂停 · 1/2/3 切换速度 · U 升级 · E 进化 · S 出售 · ESC 返回
      </p>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  background: rgba(6, 9, 13, 0.78);
  backdrop-filter: blur(4px);
}

.pause {
  width: min(380px, 88vw);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: center;
  animation: float-up 0.2s ease;
}

.pause h2 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 2px;
}

.pause__level {
  margin: 0;
  font-size: 13px;
  color: var(--text-2);
}

.pause__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}

.pause__hint {
  margin: 4px 0 0;
  font-size: 10.5px;
  color: var(--text-2);
  line-height: 1.6;
}
</style>
