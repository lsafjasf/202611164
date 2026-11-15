export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
export const DEFAULT_VIEW = Object.freeze({ x: 0, y: 0, scale: 1 });

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function screenToWorld(point, view) {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale
  };
}

export function worldToScreen(point, view) {
  return {
    x: point.x * view.scale + view.x,
    y: point.y * view.scale + view.y
  };
}

export function zoomAt(view, anchor, nextScale) {
  const scale = clamp(finiteOr(nextScale, view.scale), MIN_SCALE, MAX_SCALE);
  const world = screenToWorld(anchor, view);
  return {
    x: anchor.x - world.x * scale,
    y: anchor.y - world.y * scale,
    scale
  };
}

export function pinchView(startView, startMidpoint, currentMidpoint, distanceRatio) {
  const scale = clamp(startView.scale * finiteOr(distanceRatio, 1), MIN_SCALE, MAX_SCALE);
  const anchor = screenToWorld(startMidpoint, startView);
  return {
    x: currentMidpoint.x - anchor.x * scale,
    y: currentMidpoint.y - anchor.y * scale,
    scale
  };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(point, start);
  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq,
    0,
    1
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function shapeBounds(shape) {
  if (!shape?.points?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of shape.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function hitTest(shapes, worldPoint, tolerance = 8) {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    const shape = shapes[index];
    const radius = tolerance + (Number(shape.width) || 2) / 2;
    for (let pointIndex = 1; pointIndex < shape.points.length; pointIndex += 1) {
      const start = shape.points[pointIndex - 1];
      const end = shape.points[pointIndex];
      if (pointToSegmentDistance(worldPoint, start, end) <= radius) {
        return shape;
      }
    }
    if (shape.points.length === 1 && distance(worldPoint, shape.points[0]) <= radius) {
      return shape;
    }
  }
  return null;
}

export function simplifyStroke(points, minimumDistance = 1.25) {
  if (points.length < 3) return points.slice();
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    if (distance(points[index], result[result.length - 1]) >= minimumDistance) {
      result.push(points[index]);
    }
  }
  const last = points[points.length - 1];
  if (distance(last, result[result.length - 1]) > 0) result.push(last);
  return result;
}

export function normalizeWheel(event, viewportHeight) {
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
  return { x: event.deltaX * factor, y: event.deltaY * factor };
}

export function normalizeRect(rect) {
  return {
    left: finiteOr(rect?.left, 0),
    top: finiteOr(rect?.top, 0),
    width: Math.max(1, finiteOr(rect?.width, 1)),
    height: Math.max(1, finiteOr(rect?.height, 1))
  };
}
