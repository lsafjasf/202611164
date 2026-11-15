import { WORLD } from "./config.js";

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function ellipsePoints(cx, cy, rx, ry, pointCount, jitter, rng) {
  const pts = [];
  for (let i = 0; i < pointCount; i++) {
    const angle = (i / pointCount) * Math.PI * 2;
    const k = 1 + (rng ? rng.next() * 2 - 1 : 0) * jitter;
    pts.push({
      x: cx + Math.cos(angle) * rx * k,
      y: cy + Math.sin(angle) * ry * k,
    });
  }
  return pts;
}

// 射线法判定点是否在多边形内。
export function pointInPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// 椭圆外接半径（近似）用于快速重叠预判。
function outerRadius(shape) {
  if (shape.polygon) {
    return Math.max(...shape.polygon.map((p) => Math.hypot(p.x - shape.x, p.y - shape.y)));
  }
  if (shape.rx !== undefined) return Math.max(shape.rx, shape.ry);
  return shape.r || 0;
}

// 两个地形对象（岛屿/浅滩）是否重叠：外圆快速判定 + 点包含精确判定。
export function shapesOverlap(a, b) {
  const ra = outerRadius(a);
  const rb = outerRadius(b);
  if (distance(a, b) > ra + rb) return false;
  const aPts = a.polygon || [{ x: a.x + a.rx, y: a.y }];
  const bPts = b.polygon || [{ x: b.x + b.rx, y: b.y }];
  if (bPts.some((p) => pointInPolygon(aPts, p.x, p.y))) return true;
  if (aPts.some((p) => pointInPolygon(bPts, p.x, p.y))) return true;
  return distance(a, b) < Math.min(ra, rb) * 0.5;
}

// 标记与既有地形重叠。
export function overlapsAny(shape, existing) {
  return existing.some((other) => shapesOverlap(shape, other));
}

// 整个对象（含外接半径）是否位于场景边界内。
export function insideWorld(shape, margin = 0) {
  const r = outerRadius(shape);
  return (
    shape.x - r >= margin &&
    shape.y - r >= margin &&
    shape.x + r <= WORLD.width - margin &&
    shape.y + r <= WORLD.height - margin
  );
}

// 关键点（码头/灯塔/浮标）是否在边界内。
export function pointInsideWorld(p, margin = 0) {
  return (
    p.x >= margin &&
    p.y >= margin &&
    p.x <= WORLD.width - margin &&
    p.y <= WORLD.height - margin
  );
}
