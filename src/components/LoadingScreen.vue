<script setup lang="ts">
/**
 * 加载页 —— 首次进入时读取存档与资源索引。
 */
defineProps<{ message: string }>();
</script>

<template>
  <div class="loading">
    <div class="loading__ball">
      <span class="loading__ball-top" />
      <span class="loading__ball-bottom" />
      <span class="loading__ball-center" />
    </div>
    <h1>宝可梦守卫战</h1>
    <p>{{ message }}</p>
    <div class="loading__bar"><div class="loading__bar-fill" /></div>
  </div>
</template>

<style scoped>
.loading {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  background: radial-gradient(circle at 50% 40%, #1b2432 0%, var(--bg-0) 70%);
  z-index: 300;
}

.loading__ball {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  overflow: hidden;
  border: 5px solid #2b3340;
  box-shadow: var(--shadow-lg);
  animation: spin 1.4s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0); }
  to { transform: rotate(360deg); }
}

.loading__ball-top {
  position: absolute;
  inset: 0 0 50% 0;
  background: #ee4444;
}

.loading__ball-bottom {
  position: absolute;
  inset: 50% 0 0 0;
  background: #f5f5f5;
}

.loading__ball-center {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #f5f5f5;
  border: 5px solid #2b3340;
}

.loading h1 {
  margin: 6px 0 0;
  font-size: 24px;
  letter-spacing: 4px;
  background: linear-gradient(180deg, #fff3b0, var(--brand));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.loading p {
  margin: 0;
  font-size: 12px;
  color: var(--text-2);
}

.loading__bar {
  width: 180px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--bg-2);
  overflow: hidden;
}

.loading__bar-fill {
  width: 40%;
  height: 100%;
  background: var(--brand);
  border-radius: var(--radius-pill);
  animation: slide 1.1s ease-in-out infinite;
}

@keyframes slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
</style>
