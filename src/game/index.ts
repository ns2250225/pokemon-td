/**
 * Phaser 实例的创建与生命周期管理。
 *
 * 关键点：
 *  - Vue 负责所有菜单 / HUD / 图鉴 UI，Phaser 只负责战场渲染
 *  - 画布按容器尺寸自适应缩放，保持 16:9 逻辑分辨率
 *  - 竖屏兜底（CSS 旋转）时同步重映射触控坐标
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, SCENE_KEYS } from './config';
import { BattleScene } from './scenes/BattleScene';
import { isMobileDevice } from './config';
import { remapPointerForRotation } from '../composables/useOrientation';
import { getGameSettings } from '../stores/settings';
import { getRecommendedScale } from '../utils/device';

export interface GameHandle {
  game: Phaser.Game;
  destroy: () => void;
  setPaused: (paused: boolean) => void;
}

let currentGame: Phaser.Game | null = null;

export function getGame(): Phaser.Game | null {
  return currentGame;
}

export function createGame(parent: HTMLElement): GameHandle {
  if (currentGame) {
    currentGame.destroy(true);
    currentGame = null;
  }

  const settings = getGameSettings();
  const scale = getRecommendedScale();

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0d1117',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      zoom: scale,
    },
    render: {
      // 素材是像素精灵，NEAREST 采样才能在缩放后保持锐利。
      // 早先写反了（高质量反而关掉 pixelArt），导致最高画质下精灵最模糊。
      pixelArt: true,
      antialias: false,
      roundPixels: false,
      powerPreference: isMobileDevice() ? 'low-power' : 'high-performance',
    },
    fps: {
      target: 60,
      min: 30,
      forceSetTimeOut: false,
      smoothStep: true,
    },
    input: {
      activePointers: 3, // 支持双指缩放 / 拖动
      touch: { capture: true },
    },
    dom: { createContainer: false },
    scene: [BattleScene],
    audio: { disableWebAudio: false, noAudio: true },
    banner: false,
  };

  const game = new Phaser.Game(config);
  currentGame = game;

  // 兜底：CSS 旋转模式下重新映射指针坐标
  const remap = (pointer: Phaser.Input.Pointer) => {
    if (!document.body.classList.contains('css-rotated')) return;
    const mapped = remapPointerForRotation(pointer.x, pointer.y);
    pointer.x = mapped.x;
    pointer.y = mapped.y;
  };
  game.events.once(Phaser.Core.Events.READY, () => {
    // InputManager 通过 PluginManager 暴露事件 API，这里取场景级入口做坐标兜底
    const battle = game.scene.getScene(SCENE_KEYS.BATTLE);
    battle?.input?.on('pointerdown', remap);
    battle?.input?.on('pointermove', remap);
  });

  // 页面失焦时自动暂停（移动端切后台）
  const onVisibility = () => {
    if (document.hidden) {
      const scene = game.scene.getScene(SCENE_KEYS.BATTLE) as BattleScene | null;
      scene?.togglePause?.();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    game,
    setPaused: (paused: boolean) => {
      if (paused) game.loop.sleep();
      else game.loop.wake();
    },
    destroy: () => {
      document.removeEventListener('visibilitychange', onVisibility);
      game.destroy(true);
      currentGame = null;
    },
  };
}
