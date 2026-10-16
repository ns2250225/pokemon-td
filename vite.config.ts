import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  json: {
    // pokedex.json 需要被解析成对象，不能被 tree-shake 成字符串
    stringify: false,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          if (id.includes('node_modules/vue') || id.includes('node_modules/pinia')) return 'vue';
          if (id.includes('src/data/pokemon/pokedex.json')) return 'pokedex';
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    watch: {
      // 构建缓存与浏览器调试 profile 不需要被监听；
      // Windows 上监听 .assets-cache 会偶发 EBUSY 导致 dev server 崩溃。
      ignored: ['**/.assets-cache/**', '**/dist/**', '**/.git/**'],
    },
  },
});
