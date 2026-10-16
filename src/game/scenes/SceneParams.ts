/**
 * 场景启动参数。
 *
 * 为什么不用 game.registry：registry 属于 Phaser.Game，必须在 Game 构造之后才能写入，
 * 而 BattleScene 在 Game 构造时就会 create()，此时 registry 里还没有关卡 id。
 * 早先的写法是"先创建 Game 再写 registry 再 restart 场景"，但那会让
 * Vue 侧缓存的场景引用在 restart 后失效，UI（建造栏、升级面板）随之静默失效。
 *
 * 因此改为模块级变量：Vue 在创建 Game **之前** 设置关卡 id，场景 create() 时读取，
 * 且不需要 restart。
 */
let pendingLevelId: string | null = null;

export function setPendingLevelId(id: string) {
  pendingLevelId = id;
}

export function consumePendingLevelId(): string | null {
  const id = pendingLevelId;
  return id;
}

export function clearPendingLevelId() {
  pendingLevelId = null;
}

/** 兼容旧调用点的常量（部分代码仍以 key 形式引用） */
export const SCENE_PARAMS = {
  levelId: 'levelId',
  pokedexFocusId: 'pokedexFocusId',
} as const;
