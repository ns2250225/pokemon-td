/**
 * Phaser 桩 —— 供 Node 无头仿真使用。
 *
 * 仿真路径只触及纯逻辑（移动 / 伤害 / 目标选择），不执行任何渲染代码，
 * 因此这里只需要一个可被成员访问的空对象。
 */
const stub = new Proxy({}, {
  get(_target, prop) {
    if (prop === '__esModule') return false;
    // 任意命名空间（GameObjects / Display / BlendModes ...）都返回可继续代理的对象
    return stub;
  },
  apply() { return stub; },
});
export default stub;
