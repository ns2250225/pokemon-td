/**
 * 空间网格 —— 用于快速筛选攻击目标，避免每帧遍历全部敌人（PRD 12.2）。
 * 格子边长默认等于一个地图格（64px），一个敌人只注册到其所在格。
 */
export interface GridEntity {
  x: number;
  y: number;
  alive: boolean;
}

export class SpatialGrid<T extends GridEntity> {
  private cellSize: number;
  private cols: number;
  private rows: number;
  private cells: Map<number, T[]>;

  constructor(width: number, height: number, cellSize = 64) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = new Map();
  }

  private key(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  private cellOf(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize))),
      cy: Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize))),
    };
  }

  clear() {
    this.cells.clear();
  }

  insert(entity: T) {
    if (!entity.alive) return;
    const { cx, cy } = this.cellOf(entity.x, entity.y);
    const k = this.key(cx, cy);
    const list = this.cells.get(k);
    if (list) list.push(entity);
    else this.cells.set(k, [entity]);
  }

  rebuild(entities: T[]) {
    this.clear();
    for (const e of entities) this.insert(e);
  }

  /** 查询圆形范围内所有实体 */
  queryCircle(x: number, y: number, radius: number, out: T[] = []): T[] {
    out.length = 0;
    const r2 = radius * radius;
    const min = this.cellOf(x - radius, y - radius);
    const max = this.cellOf(x + radius, y + radius);
    for (let cy = min.cy; cy <= max.cy; cy++) {
      for (let cx = min.cx; cx <= max.cx; cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const e of list) {
          if (!e.alive) continue;
          const dx = e.x - x;
          const dy = e.y - y;
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
      }
    }
    return out;
  }

  /** 查询矩形范围内所有实体（用于直线 / 锥形技能） */
  queryRect(x: number, y: number, w: number, h: number, out: T[] = []): T[] {
    out.length = 0;
    const min = this.cellOf(x, y);
    const max = this.cellOf(x + w, y + h);
    for (let cy = min.cy; cy <= max.cy; cy++) {
      for (let cx = min.cx; cx <= max.cx; cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) {
          for (const e of list) {
            if (e.alive && e.x >= x && e.x <= x + w && e.y >= y && e.y <= y + h) out.push(e);
          }
        }
      }
    }
    return out;
  }

  /** 找出距离给定点最近的实体 */
  nearest(x: number, y: number, maxRadius: number): T | null {
    let best: T | null = null;
    let bestD = maxRadius * maxRadius;
    const min = this.cellOf(x - maxRadius, y - maxRadius);
    const max = this.cellOf(x + maxRadius, y + maxRadius);
    for (let cy = min.cy; cy <= max.cy; cy++) {
      for (let cx = min.cx; cx <= max.cx; cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const e of list) {
          if (!e.alive) continue;
          const d = (e.x - x) ** 2 + (e.y - y) ** 2;
          if (d < bestD) { bestD = d; best = e; }
        }
      }
    }
    return best;
  }
}
