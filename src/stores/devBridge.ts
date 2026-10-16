/**
 * 开发构建专用桥接 —— 把进度 store 的关键动作挂到 window，
 * 让自动化测试（scripts/battle-sim.mjs）能直接驱动进度，
 * 而不必用点击几百次的方式解锁关卡。
 *
 * 生产构建下 import.meta.env.DEV 为 false，整段逻辑不会执行，
 * window 上不会残留任何句柄。
 */
import type { Pinia } from 'pinia';
import { useProgressStore } from './progress';

/**
 * 安装开发桥接。
 *
 * 必须显式传入 pinia 实例：bootstrap 在 app.mount() 之前调用它，
 * 此时 Vue 的 active pinia 还没被组件树建立，直接调用 useProgressStore()
 * 会抛错并中断整个启动流程（表现为白屏）。
 */
export function installDevBridge(pinia: Pinia) {
  if (!import.meta.env?.DEV) return;
  try {
    const store = useProgressStore(pinia);
    (window as unknown as { __PTD_PROGRESS__?: unknown }).__PTD_PROGRESS__ = {
      recordResult: store.recordResult,
      isLevelUnlocked: store.isLevelUnlocked,
      clearLevel: (levelId: string) =>
        store.recordResult({
          levelId, victory: true, stars: 1, hpRatio: 1,
          timeMs: 1000, enemiesKilled: 1, coinsEarned: 0,
        }),
      starsFor: store.starsFor,
      achievements: () => store.achievements,
    };
  } catch {
    /* 桥接失败绝不能影响游戏启动 */
  }
}
