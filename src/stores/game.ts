/**
 * 设置 store —— 音量、画质、特效开关、操作偏好。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { saveService, type SettingsData } from '../utils/save';
import { setGameSettings, getGameSettings } from './settings';

export const useSettingsStore = defineStore('settings', () => {
  const bgmVolume = ref(0.5);
  const sfxVolume = ref(0.7);
  const quality = ref<SettingsData['quality']>('high');
  const screenShake = ref(true);
  const flash = ref(true);
  const damageNumbers = ref(true);
  const effectIntensity = ref(1);
  const defaultSpeed = ref<1 | 2 | 3>(1);
  const autoRotatePrompt = ref(true);
  const fullscreenOnStart = ref(false);
  const ready = ref(false);

  /** @returns 是否为首次进入（磁盘上没有已保存的设置） */
  async function init(): Promise<boolean> {
    const s = await saveService.loadSettings();
    const firstRun = !saveService.settingsExistedOnDisk;
    bgmVolume.value = s.bgmVolume;
    sfxVolume.value = s.sfxVolume;
    quality.value = s.quality;
    screenShake.value = s.screenShake;
    flash.value = s.flash;
    damageNumbers.value = s.damageNumbers;
    effectIntensity.value = s.effectIntensity;
    defaultSpeed.value = s.defaultSpeed;
    autoRotatePrompt.value = s.autoRotatePrompt;
    fullscreenOnStart.value = s.fullscreenOnStart;
    setGameSettings(s);
    ready.value = true;
    return firstRun;
  }

  function snapshot(): SettingsData {
    return {
      bgmVolume: bgmVolume.value,
      sfxVolume: sfxVolume.value,
      quality: quality.value,
      screenShake: screenShake.value,
      flash: flash.value,
      damageNumbers: damageNumbers.value,
      effectIntensity: effectIntensity.value,
      defaultSpeed: defaultSpeed.value,
      autoRotatePrompt: autoRotatePrompt.value,
      fullscreenOnStart: fullscreenOnStart.value,
    };
  }

  /** 同步到内存镜像 + 持久化 */
  function commit(patch: Partial<SettingsData> = {}) {
    const next = { ...snapshot(), ...patch };
    setGameSettings(next);
    void saveService.saveSettings(next);
  }

  function update<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    switch (key) {
      case 'bgmVolume': bgmVolume.value = value as number; break;
      case 'sfxVolume': sfxVolume.value = value as number; break;
      case 'quality': quality.value = value as SettingsData['quality']; break;
      case 'screenShake': screenShake.value = value as boolean; break;
      case 'flash': flash.value = value as boolean; break;
      case 'damageNumbers': damageNumbers.value = value as boolean; break;
      case 'effectIntensity': effectIntensity.value = value as number; break;
      case 'defaultSpeed': defaultSpeed.value = value as 1 | 2 | 3; break;
      case 'autoRotatePrompt': autoRotatePrompt.value = value as boolean; break;
      case 'fullscreenOnStart': fullscreenOnStart.value = value as boolean; break;
      default: break;
    }
    commit();
  }

  function current(): SettingsData {
    return getGameSettings();
  }

  return {
    bgmVolume, sfxVolume, quality, screenShake, flash, damageNumbers,
    effectIntensity, defaultSpeed, autoRotatePrompt, fullscreenOnStart, ready,
    init, update, commit, current, snapshot,
  };
});
