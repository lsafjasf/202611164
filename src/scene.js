import { clamp, DEFAULT_VIEW, MAX_SCALE, MIN_SCALE } from "./geometry.js";

export const STORAGE_KEY = "crosshair-canvas.scene.v1";
export const QUARANTINE_KEY = "crosshair-canvas.quarantine.v1";
export const MAX_RAW_BYTES = 2_000_000;
export const MAX_SHAPES = 250;
export const MAX_POINTS_PER_SHAPE = 12_000;
export const MAX_TOTAL_POINTS = 80_000;
export const MAX_COORDINATE = 1_000_000;
export const DEFAULT_COLOR = "#25324a";

export function createSeedScene() {
  return {
    version: 1,
    view: { ...DEFAULT_VIEW, x: 90, y: 80, scale: 1 },
    shapes: [
      {
        id: "seed-orbit",
        type: "stroke",
        color: "#e2573d",
        width: 5,
        createdAt: 1,
        points: [
          { x: 170, y: 250 },
          { x: 230, y: 170 },
          { x: 330, y: 150 },
          { x: 410, y: 220 },
          { x: 390, y: 320 },
          { x: 280, y: 350 },
          { x: 170, y: 250 }
        ]
      },
      {
        id: "seed-wave",
        type: "stroke",
        color: "#2e6f68",
        width: 4,
        createdAt: 2,
        points: [
          { x: 150, y: 420 },
          { x: 230, y: 390 },
          { x: 300, y: 445 },
          { x: 370, y: 405 },
          { x: 450, y: 450 }
        ]
      }
    ]
  };
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function sanitizePoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) return null;
  return { x: point.x, y: point.y };
}

function sanitizeView(value, issues) {
  if (!value || typeof value !== "object") {
    issues.push(issue("VIEW_MISSING", "视图数据缺失，已重置为默认视图。"));
    return { ...DEFAULT_VIEW };
  }
  const scale = clamp(Number(value.scale), MIN_SCALE, MAX_SCALE);
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) {
    issues.push(issue("VIEW_INVALID", "视图包含非有限数值，已重置为默认视图。"));
    return { ...DEFAULT_VIEW };
  }
  if (scale !== value.scale) {
    issues.push(issue("VIEW_CLAMPED", `缩放值已限制到 ${MIN_SCALE}–${MAX_SCALE}。`));
  }
  return { x, y, scale };
}

function sanitizeShape(shape, index, seenIds, issues, budget) {
  if (!shape || typeof shape !== "object") {
    issues.push(issue("SHAPE_INVALID", `第 ${index + 1} 个图形不是对象，已丢弃。`, { index }));
    return null;
  }
  if (budget.total >= MAX_TOTAL_POINTS) {
    issues.push(issue("POINT_BUDGET", "图形总点数达到上限，后续图形已丢弃。", { index }));
    return null;
  }
  if (shape.type !== "stroke") {
    issues.push(issue("SHAPE_TYPE", `第 ${index + 1} 个图形类型未知，已丢弃。`, { index }));
    return null;
  }
  if (!Array.isArray(shape.points) || shape.points.length < 2) {
    issues.push(issue("SHAPE_POINTS", `第 ${index + 1} 个图形点数不足，已丢弃。`, { index }));
    return null;
  }
  if (shape.points.length > MAX_POINTS_PER_SHAPE) {
    issues.push(issue("SHAPE_TOO_LARGE", `第 ${index + 1} 个图形超过点数上限，已丢弃。`, { index }));
    return null;
  }
  const points = shape.points.map(sanitizePoint);
  if (points.some((point) => point === null)) {
    issues.push(issue("POINT_INVALID", `第 ${index + 1} 个图形含无效坐标，已丢弃。`, { index }));
    return null;
  }
  budget.total += points.length;
  let id = typeof shape.id === "string" && shape.id.trim() ? shape.id.trim().slice(0, 120) : "";
  if (!id) {
    id = `recovered-${index + 1}`;
    issues.push(issue("SHAPE_ID", `第 ${index + 1} 个图形缺少 ID，已生成恢复 ID。`, { index }));
  }
  if (seenIds.has(id)) {
    issues.push(issue("SHAPE_DUPLICATE", `图形 ID ${id} 重复，已丢弃后一项。`, { index }));
    return null;
  }
  seenIds.add(id);
  const color = typeof shape.color === "string" && /^#[0-9a-f]{6}$/i.test(shape.color)
    ? shape.color
    : DEFAULT_COLOR;
  if (color !== shape.color) {
    issues.push(issue("SHAPE_COLOR", `第 ${index + 1} 个图形颜色无效，已使用默认颜色。`, { index }));
  }
  const width = Number(shape.width);
  const safeWidth = Number.isFinite(width) && width >= 0.5 && width <= 48 ? width : 2;
  if (safeWidth !== shape.width) {
    issues.push(issue("SHAPE_WIDTH", `第 ${index + 1} 个图形笔宽无效，已使用默认笔宽。`, { index }));
  }
  return {
    id,
    type: "stroke",
    color,
    width: safeWidth,
    createdAt: Number.isFinite(shape.createdAt) ? shape.createdAt : Date.now(),
    points
  };
}

export function deserializeScene(raw) {
  const issues = [];
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw).byteLength : 0;
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      ok: false,
      fatal: true,
      recovered: true,
      scene: createSeedScene(),
      issues: [issue("EMPTY_DATA", "没有可恢复的画布数据，已载入示例画布。")],
      bytes
    };
  }
  if (bytes > MAX_RAW_BYTES) {
    return {
      ok: false,
      fatal: true,
      recovered: true,
      scene: createSeedScene(),
      issues: [issue("DATA_TOO_LARGE", `数据超过 ${MAX_RAW_BYTES} 字节，已隔离并载入示例画布。`)],
      bytes
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      fatal: true,
      recovered: true,
      scene: createSeedScene(),
      issues: [issue("JSON_INVALID", `JSON 解析失败：${error.message}`)],
      bytes
    };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.shapes)) {
    return {
      ok: false,
      fatal: true,
      recovered: true,
      scene: createSeedScene(),
      issues: [issue("SCENE_INVALID", "场景结构无效，已载入示例画布。")],
      bytes
    };
  }
  if (parsed.version !== 1) {
    issues.push(issue("VERSION_UNKNOWN", `未知数据版本 ${String(parsed.version)}，已按 v1 尝试恢复。`));
  }
  let sourceShapes = parsed.shapes;
  if (sourceShapes.length > MAX_SHAPES) {
    issues.push(issue("SHAPE_BUDGET", `图形数量超过 ${MAX_SHAPES}，超出部分已丢弃。`));
    sourceShapes = sourceShapes.slice(0, MAX_SHAPES);
  }
  const seenIds = new Set();
  const budget = { total: 0 };
  const shapes = sourceShapes
    .map((shape, index) => sanitizeShape(shape, index, seenIds, issues, budget))
    .filter(Boolean);
  const view = sanitizeView(parsed.view, issues);
  return {
    ok: issues.length === 0,
    fatal: false,
    recovered: issues.length > 0,
    scene: { version: 1, view, shapes },
    issues,
    bytes
  };
}

export function serializeScene(scene) {
  return JSON.stringify({
    version: 1,
    view: {
      x: Number(scene.view.x.toFixed(3)),
      y: Number(scene.view.y.toFixed(3)),
      scale: Number(scene.view.scale.toFixed(4))
    },
    shapes: scene.shapes.map((shape) => ({
      id: shape.id,
      type: "stroke",
      color: shape.color,
      width: shape.width,
      createdAt: shape.createdAt,
      points: shape.points
    }))
  });
}

export function loadScene(storage) {
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return {
      ...deserializeScene(null),
      issues: [issue("STORAGE_READ", `无法读取本地存储：${error.message}`)]
    };
  }
  return { ...deserializeScene(raw), raw };
}

export function saveScene(storage, scene, quarantineRaw = null) {
  const payload = serializeScene(scene);
  try {
    storage.setItem(STORAGE_KEY, payload);
    if (quarantineRaw) storage.setItem(QUARANTINE_KEY, quarantineRaw.slice(0, 200_000));
    return { ok: true, bytes: new TextEncoder().encode(payload).byteLength };
  } catch (error) {
    return {
      ok: false,
      bytes: 0,
      error: issue("STORAGE_WRITE", `无法保存画布：${error.message}`)
    };
  }
}
