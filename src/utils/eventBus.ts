/**
 * 轻量事件总线 —— 让 Phaser 场景与 Vue UI 双向通信，
 * 而不需要让 UI 直接持有场景引用。
 */
type Handler<T = unknown> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<never>>>();

  on<T = unknown>(event: string, handler: Handler<T>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  once<T = unknown>(event: string, handler: Handler<T>): () => void {
    const off = this.on<T>(event, ((payload: T) => {
      off();
      handler(payload);
    }) as Handler<T>);
    return off;
  }

  off<T = unknown>(event: string, handler: Handler<T>) {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<T = unknown>(event: string, payload: T) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        (h as Handler<T>)(payload);
      } catch (err) {
        console.error(`[eventBus] "${event}" 处理失败`, err);
      }
    }
  }

  clear(event?: string) {
    if (event) this.handlers.delete(event);
    else this.handlers.clear();
  }
}

export const bus = new EventBus();

// 开发构建下把总线挂到 window，便于自动化测试断言事件是否真的派发。
// 生产构建不会暴露，且仅记录事件名（不含载荷），不泄露任何玩家数据。
if (import.meta.env?.DEV) {
  const w = window as unknown as { __PTD_BUS__?: { log: string[]; bus: EventBus } };
  if (!w.__PTD_BUS__) {
    const log: string[] = [];
    const original = bus.emit.bind(bus);
    bus.emit = ((event: string, payload: unknown) => {
      log.push(event);
      if (log.length > 400) log.shift();
      return original(event, payload);
    }) as typeof bus.emit;
    w.__PTD_BUS__ = { log, bus };
  }
}
