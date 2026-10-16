/**
 * 目标选择系统 —— 按属性职业与招式偏好挑选攻击目标。
 */
import type { MovingEnemy } from '../entities/Enemy';
import type { MoveDef } from '../../data/moves/moves';

export type TargetPriority = 'first' | 'last' | 'strongest' | 'weakest' | 'closest' | 'mostDense';

export interface TargetingContext {
  x: number;
  y: number;
  range: number;
  /** 能否命中飞行单位 */
  canHitFlying: boolean;
  /** 是否只能打空中 */
  airOnly: boolean;
  /** 是否具备侦测能力（可锁定隐身单位） */
  revealsStealth: boolean;
  priority: TargetPriority;
}

/** 判定单个敌人是否可作为目标 */
export function isValidTarget(enemy: MovingEnemy, ctx: TargetingContext, dx: number, dy: number): boolean {
  if (!enemy.alive) return false;
  if (enemy.reachedEnd) return false;
  if (enemy.isFlying && !ctx.canHitFlying) return false;
  if (!enemy.isFlying && ctx.airOnly) return false;
  // 隐身单位只有在具备侦测能力时才可锁定
  if (enemy.stealthActive && !ctx.revealsStealth) return false;
  const r2 = ctx.range * ctx.range;
  return dx * dx + dy * dy <= r2;
}

/**
 * 根据优先级排序候选目标。
 * distanceFromEnd 越小表示越接近终点，用于 first / last 判定。
 */
export function pickTarget(
  candidates: MovingEnemy[],
  ctx: TargetingContext,
  move?: MoveDef,
): MovingEnemy | null {
  if (!candidates.length) return null;

  const priority: TargetPriority = move?.preferTarget ?? ctx.priority;

  let best: MovingEnemy | null = null;
  let bestScore = -Infinity;

  for (const e of candidates) {
    const dx = e.x - ctx.x;
    const dy = e.y - ctx.y;
    if (!isValidTarget(e, ctx, dx, dy)) continue;

    let score = 0;
    switch (priority) {
      case 'first':
        // 离终点最近的优先（保卫萝卜式：防止漏怪）
        score = -e.distanceToEnd;
        break;
      case 'last':
        score = e.distanceToEnd;
        break;
      case 'strongest':
        score = e.hp;
        break;
      case 'weakest':
        score = -e.hp;
        break;
      case 'closest':
        score = -(dx * dx + dy * dy);
        break;
      case 'mostDense':
        score = e.neighborCount * 100 - (dx * dx + dy * dy) * 0.001;
        break;
      default:
        score = -e.distanceToEnd;
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** 连锁弹射：从首个目标出发逐跳寻找最近的未命中目标 */
export function chainTargets(
  first: MovingEnemy,
  all: MovingEnemy[],
  maxTargets: number,
  chainRange: number,
  ctx: TargetingContext,
): MovingEnemy[] {
  const hit = new Set<MovingEnemy>([first]);
  const result: MovingEnemy[] = [first];
  let cursor = first;

  for (let i = 1; i < maxTargets; i++) {
    let next: MovingEnemy | null = null;
    let bestD = chainRange * chainRange;
    for (const e of all) {
      if (hit.has(e)) continue;
      const dx = e.x - cursor.x;
      const dy = e.y - cursor.y;
      const d = dx * dx + dy * dy;
      if (d >= bestD) continue;
      if (!isValidTarget(e, { ...ctx, range: chainRange }, dx, dy)) continue;
      bestD = d;
      next = e;
    }
    if (!next) break;
    hit.add(next);
    result.push(next);
    cursor = next;
  }
  return result;
}

/** 直线穿透：返回沿方向落在指定矩形内的敌人，按距离排序 */
export function pierceTargets(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  length: number,
  width: number,
  all: MovingEnemy[],
  ctx: TargetingContext,
): MovingEnemy[] {
  const out: { e: MovingEnemy; t: number }[] = [];
  const halfW = width / 2;

  for (const e of all) {
    const dx = e.x - originX;
    const dy = e.y - originY;
    if (!isValidTarget(e, { ...ctx, range: length }, dx, dy)) continue;
    // 投影到方向上，得到沿射线的距离与垂直偏移
    const t = dx * dirX + dy * dirY;
    if (t < 0 || t > length) continue;
    const perp = Math.abs(dx * -dirY + dy * dirX);
    if (perp > halfW + e.radius) continue;
    out.push({ e, t });
  }
  out.sort((a, b) => a.t - b.t);
  return out.map((o) => o.e);
}

/** 锥形范围：方向两侧的扇形内的敌人 */
export function coneTargets(
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  length: number,
  coneAngleDeg: number,
  all: MovingEnemy[],
  ctx: TargetingContext,
): MovingEnemy[] {
  const halfAngle = (coneAngleDeg * Math.PI) / 360;
  const cosLimit = Math.cos(halfAngle);
  const out: MovingEnemy[] = [];

  for (const e of all) {
    const dx = e.x - originX;
    const dy = e.y - originY;
    const dist = Math.hypot(dx, dy);
    if (dist > length || dist === 0) continue;
    if (!isValidTarget(e, { ...ctx, range: length }, dx, dy)) continue;
    const dot = (dx / dist) * dirX + (dy / dist) * dirY;
    if (dot < cosLimit) continue;
    out.push(e);
  }
  out.sort((a, b) => a.distanceToEnd - b.distanceToEnd);
  return out;
}

/** 圆形范围 */
export function areaTargets(
  centerX: number,
  centerY: number,
  radius: number,
  all: MovingEnemy[],
  ctx: TargetingContext,
): MovingEnemy[] {
  const out: MovingEnemy[] = [];
  for (const e of all) {
    const dx = e.x - centerX;
    const dy = e.y - centerY;
    if (isValidTarget(e, { ...ctx, range: radius + e.radius }, dx, dy)) out.push(e);
  }
  return out;
}

/** 多目标齐射：挑选彼此分散的若干目标 */
export function multiTargets(
  candidates: MovingEnemy[],
  count: number,
  ctx: TargetingContext,
): MovingEnemy[] {
  const valid = candidates.filter((e) => {
    const dx = e.x - ctx.x;
    const dy = e.y - ctx.y;
    return isValidTarget(e, ctx, dx, dy);
  });
  if (valid.length <= count) return valid;
  // 按离终点距离排序后均匀抽取，避免全部集中在同一位置
  valid.sort((a, b) => a.distanceToEnd - b.distanceToEnd);
  const step = valid.length / count;
  const out: MovingEnemy[] = [];
  for (let i = 0; i < count; i++) out.push(valid[Math.floor(i * step)]);
  return out;
}

/** 全屏：返回所有合法目标 */
export function globalTargets(all: MovingEnemy[], ctx: TargetingContext): MovingEnemy[] {
  return all.filter((e) => {
    const dx = e.x - ctx.x;
    const dy = e.y - ctx.y;
    return isValidTarget(e, { ...ctx, range: Infinity }, dx, dy);
  });
}

/** 依据招式的 targeting 模式统一分派 */
export function resolveTargets(
  move: MoveDef,
  ctx: TargetingContext,
  all: MovingEnemy[],
  primary: MovingEnemy | null,
): MovingEnemy[] {
  if (!primary && move.targeting !== 'global' && move.targeting !== 'aura') return [];

  switch (move.targeting) {
    case 'single':
      return primary ? [primary] : [];
    case 'chain':
      return primary ? chainTargets(primary, all, move.maxTargets ?? 3, move.chainRange ?? 100, ctx) : [];
    case 'pierce': {
      if (!primary) return [];
      const dx = primary.x - ctx.x;
      const dy = primary.y - ctx.y;
      const len = Math.hypot(dx, dy) || 1;
      return pierceTargets(ctx.x, ctx.y, dx / len, dy / len, move.length ?? ctx.range, move.width ?? 30, all, ctx);
    }
    case 'cone': {
      if (!primary) return [];
      const dx = primary.x - ctx.x;
      const dy = primary.y - ctx.y;
      const len = Math.hypot(dx, dy) || 1;
      return coneTargets(ctx.x, ctx.y, dx / len, dy / len, move.length ?? ctx.range, move.coneAngle ?? 45, all, ctx);
    }
    case 'line': {
      if (!primary) return [];
      const dx = primary.x - ctx.x;
      const dy = primary.y - ctx.y;
      const len = Math.hypot(dx, dy) || 1;
      const dirX = dx / len;
      const dirY = dy / len;
      // 直线技能从防御单位前方出发，沿主目标方向延伸到固定长度
      const startX = ctx.x + dirX * 24;
      const startY = ctx.y + dirY * 24;
      return pierceTargets(startX, startY, dirX, dirY, move.length ?? ctx.range, move.width ?? 48, all, ctx);
    }
    case 'area': {
      const cx = primary ? primary.x : ctx.x;
      const cy = primary ? primary.y : ctx.y;
      return areaTargets(cx, cy, move.radius ?? 90, all, ctx);
    }
    case 'multi':
      return multiTargets(all, move.maxTargets ?? 3, ctx);
    case 'global':
      return globalTargets(all, ctx);
    case 'aura':
      return areaTargets(ctx.x, ctx.y, move.radius ?? ctx.range, all, ctx);
    default:
      return primary ? [primary] : [];
  }
}
