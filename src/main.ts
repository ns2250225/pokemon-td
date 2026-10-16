/**
 * 应用入口 —— 挂载 Vue，初始化存档与设置，注册全局样式。
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles/main.css';
import { useProgressStore } from './stores/progress';
import { useSettingsStore } from './stores/game';
import { registerPwaLikeCache } from './utils/offline';
import { getRecommendedQuality } from './utils/device';
import { installDevBridge } from './stores/devBridge';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

async function bootstrap() {
  const settings = useSettingsStore(pinia);
  const progress = useProgressStore(pinia);
  // 先初始化存档再决定画质：老玩家的选择必须被保留，只有首次进入才推荐
  const [firstRun] = await Promise.all([settings.init(), progress.init()]);
  if (firstRun) settings.update('quality', getRecommendedQuality());
  installDevBridge(pinia);
  registerPwaLikeCache();
  app.mount('#app');
}

void bootstrap();
