/**
 * 移动端横屏与全屏适配（PRD 第八章）。
 *
 * 三级降级策略：
 *   1. 优先：点击"横屏开始游戏" → 请求全屏 + Screen Orientation API 锁定横屏
 *   2. 降级：浏览器拒绝锁定时，显示旋转设备引导界面
 *   3. 兜底：完全不支持时提供 CSS 旋转画布模式，并重新映射触控坐标
 */
import { onMounted, onUnmounted, ref, computed } from 'vue';

export const CANVAS_W = 1536;
const CANVAS_H = 896;

type OrientationState = 'landscape' | 'portrait-guide' | 'portrait-forced' | 'unknown';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  released: boolean;
}

/** Screen Orientation API 的类型补充（部分浏览器缺失或不完整） */
interface LockableOrientation {
  lock?: (orientation: 'landscape' | 'landscape-primary' | 'landscape-secondary' | 'portrait' | 'any') => Promise<void>;
  unlock?: () => void;
  type?: string;
  angle?: number;
}

export function useOrientation() {
  const isPortrait = ref(false);
  const isFullscreen = ref(false);
  const lockSupported = ref(false);
  const fullscreenSupported = ref(false);
  const lockFailed = ref(false);
  const cssRotationMode = ref(false);
  const isTouchDevice = ref(false);
  const isMobile = ref(false);

  const state = computed<OrientationState>(() => {
    if (!isMobile.value) return 'landscape';
    if (!isPortrait.value) return 'landscape';
    if (cssRotationMode.value) return 'portrait-forced';
    return 'portrait-guide';
  });

  /**
   * 竖屏兜底模式下把游戏容器顺时针旋转 90° 的样式。
   *
   * 为什么用 matrix 而不是 rotate+translate：Phaser 的坐标换算只认 CSS 的
   * matrix(a,b,c,d,e,f)，写成 rotate/translate 组合时 Phaser 拿不到逆矩阵，
   * 点击坐标会整体错位。这里直接给出 90° 的矩阵形式：
   *   rotate 90deg  →  matrix(0, 1, -1, 0, 0, 0)
   *   translateX(W) →  平移画布宽度，使旋转后内容落在视口内
   * 其中 W 取固定的游戏画布宽度（1536），与视口尺寸解耦，
   * 逆变换因此保持为简单的 (canvasY, W - canvasX)。
   */
  const rotationTransform = computed<Record<string, string> | null>(() => {
    if (!cssRotationMode.value || !isPortrait.value) return null;
    // 竖屏视口高度决定旋转后画布能占多少宽度。
    // 画布宽高比固定为 CANVAS_W:CANVAS_H，等比缩放到"旋转后可用宽度 = 视口高度"。
    const vh = typeof window === 'undefined' ? CANVAS_H : window.innerHeight;
    const fit = vh / CANVAS_W;
    const w = CANVAS_W * fit;   // 旋转后横向占用的宽度 = 视口高度
    const h = CANVAS_H * fit;
    // 顺时针 90°： matrix(0,1,-1,0,W,0) 会把 (x,y) 映射到 (W - y, x)
    return {
      position: 'fixed',
      top: '0',
      left: '0',
      width: `${w}px`,
      height: `${h}px`,
      transform: `matrix(0, 1, -1, 0, ${w}, 0)`,
      transformOrigin: 'top left',
      // 旋转后内容落在 (0,0)-(h,w) 区域内，把它居中到竖屏视口
      marginLeft: `${(vh - h) / 2}px`,
    };
  });

  function detect() {
    if (typeof window === 'undefined') return;
    const ua = navigator.userAgent;
    isMobile.value = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua)
      || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
    isTouchDevice.value = navigator.maxTouchPoints > 0;
    isPortrait.value = window.innerHeight > window.innerWidth;
    isFullscreen.value = !!document.fullscreenElement;

    const orientation = screen.orientation as LockableOrientation | undefined;
    lockSupported.value = !!orientation?.lock;
    fullscreenSupported.value = !!(document.documentElement.requestFullscreen
      || (document.documentElement as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen);
  }

  /** 请求全屏；返回是否成功 */
  async function requestFullscreen(): Promise<boolean> {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else return false;
      isFullscreen.value = true;
      // 全屏后重新计算画布尺寸（由 Scale Manager 响应 resize 事件完成）
      window.dispatchEvent(new Event('resize'));
      return true;
    } catch {
      isFullscreen.value = false;
      return false;
    }
  }

  async function exitFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      isFullscreen.value = false;
      window.dispatchEvent(new Event('resize'));
    } catch {
      /* 退出失败保留正常游戏功能 */
    }
  }

  async function toggleFullscreen(): Promise<boolean> {
    if (isFullscreen.value) {
      await exitFullscreen();
      return false;
    }
    return requestFullscreen();
  }

  /** 尝试锁定横屏；返回是否成功 */
  async function lockLandscape(): Promise<boolean> {
    const orientation = screen.orientation as LockableOrientation | undefined;
    if (!orientation?.lock) {
      lockFailed.value = true;
      return false;
    }
    try {
      await orientation.lock('landscape');
      lockFailed.value = false;
      return true;
    } catch {
      // iOS Safari 等会直接拒绝；此时走旋转引导
      lockFailed.value = true;
      return false;
    }
  }

  function unlockOrientation() {
    const orientation = screen.orientation as LockableOrientation | undefined;
    try {
      orientation?.unlock?.();
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 一级入口：用户点击"横屏开始游戏"。
   * 依次尝试全屏 → 锁定横屏 → 失败则退回引导 / CSS 旋转。
   */
  async function startLandscapeGame(): Promise<{ fullscreen: boolean; locked: boolean }> {
    const fullscreen = await requestFullscreen();
    // 全屏请求需要用户手势，锁定必须紧跟其后
    let locked = false;
    if (isMobile.value) {
      locked = await lockLandscape();
    }
    if (!locked && isPortrait.value && lockSupported.value) {
      // 支持锁定但被拒绝 → 显示引导界面
      lockFailed.value = true;
    }
    return { fullscreen, locked };
  }

  /** 兜底：启用 CSS 旋转画布模式 */
  function enableCssRotation() {
    cssRotationMode.value = true;
    document.body.classList.add('css-rotated');
  }

  function disableCssRotation() {
    cssRotationMode.value = false;
    document.body.classList.remove('css-rotated');
  }

  let wakeLock: WakeLockSentinelLike | null = null;

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      };
      if (nav.wakeLock && !wakeLock) {
        wakeLock = await nav.wakeLock.request('screen');
      }
    } catch {
      /* 不支持或用户拒绝，忽略 */
    }
  }

  async function releaseWakeLock() {
    try {
      await wakeLock?.release();
    } catch {
      /* 忽略 */
    }
    wakeLock = null;
  }

  function onResize() {
    detect();
    // 旋转回横屏时自动退出 CSS 旋转模式
    if (!isPortrait.value && cssRotationMode.value) disableCssRotation();
  }

  function onFullscreenChange() {
    isFullscreen.value = !!document.fullscreenElement;
    window.dispatchEvent(new Event('resize'));
  }

  onMounted(() => {
    detect();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    void requestWakeLock();
  });

  onUnmounted(() => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    void releaseWakeLock();
    unlockOrientation();
  });

  return {
    state,
    isPortrait,
    isFullscreen,
    isMobile,
    isTouchDevice,
    lockSupported,
    fullscreenSupported,
    lockFailed,
    cssRotationMode,
    rotationTransform,
    startLandscapeGame,
    requestFullscreen,
    exitFullscreen,
    toggleFullscreen,
    enableCssRotation,
    disableCssRotation,
    detect,
  };
}

/**
 * 竖屏 CSS 旋转模式下，把浏览器传来的坐标反算回画布坐标。
 * 画布被顺时针旋转 90°，因此需要逆变换。
 */
export function remapPointerForRotation(
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // 旋转后画布覆盖 (0,0)-(vh,vw)
  // 逆变换：原来的 (x,y) = (clientY, vw - clientX)
  return { x: clientY, y: vw - clientX };
}
