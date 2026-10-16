/**
 * 设置的同步访问层。
 *
 * Phaser 场景在 update 里需要同步读取设置（不能 await），
 * 因此这里维护一份内存镜像，由 Pinia store 在变更时同步刷新。
 */
import { DEFAULT_SETTINGS, saveService, type SettingsData } from '../utils/save';

let mirror: SettingsData = { ...DEFAULT_SETTINGS };

export function getGameSettings(): SettingsData {
  return mirror;
}

export function setGameSettings(patch: Partial<SettingsData>) {
  mirror = { ...mirror, ...patch };
}

/** 从持久层加载一次，供应用启动时调用 */
export async function hydrateSettings(): Promise<SettingsData> {
  const s = await saveService.loadSettings();
  mirror = { ...s };
  return mirror;
}
