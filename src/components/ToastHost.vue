<script setup lang="ts">
/**
 * 全局浮层消息 —— 成就解锁等跨界面提示。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { bus } from '../utils/eventBus';

interface Item { id: number; title: string; body: string; tone: string }

const items = ref<Item[]>([]);
let seq = 1;
const offs: (() => void)[] = [];

function push(title: string, body: string, tone = 'good') {
  const id = seq++;
  items.value = [...items.value, { id, title, body, tone }].slice(-3);
  setTimeout(() => { items.value = items.value.filter((i) => i.id !== id); }, 3600);
}

onMounted(() => {
  offs.push(
    bus.on<{ name: string; description: string }>('progress:achievement', (a) => {
      push(`🏅 成就解锁：${a.name}`, a.description);
    }),
    bus.on<number[]>('progress:unlocked', (ids) => {
      push('✨ 解锁新精灵', `新增 ${ids.length} 只可使用的宝可梦`, 'info');
    }),
  );
});

onBeforeUnmount(() => { for (const o of offs) o(); });
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="pop">
      <div v-for="i in items" :key="i.id" class="toast" :class="`tone-${i.tone}`">
        <strong>{{ i.title }}</strong>
        <span>{{ i.body }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: calc(12px + var(--safe-top));
  right: calc(12px + var(--safe-right));
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: min(340px, 80vw);
}

.toast {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: rgba(21, 27, 36, 0.97);
  border: 1px solid var(--line);
  border-left: 4px solid var(--good);
  box-shadow: var(--shadow-lg);
}

.toast strong { font-size: 13px; }
.toast span { font-size: 11.5px; color: var(--text-2); line-height: 1.5; }
.toast.tone-info { border-left-color: var(--accent); }
.toast.tone-warn { border-left-color: var(--warn); }
</style>
