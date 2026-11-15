export const APP_SCHEMA = "framelab.canvas.v1";
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;
export const DEFAULT_SELECTION = "headline";

const FONT_SANS = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif';
const FONT_SERIF = '"Iowan Old Style", Baskerville, Georgia, serif';

export const DEFAULT_OPTIONS = Object.freeze({
  shadows: true,
  sorting: true,
  culling: true,
});

const primaryLayers = [
  {
    id: "backdrop",
    name: "暖纸背景",
    kind: "FRAME",
    type: "rect",
    x: 0,
    y: 0,
    w: 960,
    h: 640,
    fill: "#efe7d8",
    z: 0,
    locked: true,
    selectable: false,
  },
  {
    id: "orbit",
    name: "轨道线",
    kind: "ELLIPSE",
    type: "ellipse",
    x: 706,
    y: 53,
    w: 360,
    h: 360,
    fill: "transparent",
    stroke: "#c9bfae",
    lineWidth: 1,
    opacity: 0.8,
    z: 4,
  },
  {
    id: "halo",
    name: "橙色主球体",
    kind: "ELLIPSE",
    type: "ellipse",
    x: 653,
    y: 57,
    w: 354,
    h: 354,
    fill: "#ff6b3d",
    gradient: ["#ff8a57", "#f4562d"],
    z: 8,
    shadow: { blur: 46, offsetX: 0, offsetY: 20, color: "rgba(113, 46, 24, 0.34)" },
  },
  {
    id: "navy-panel",
    name: "深色信息板",
    kind: "RECTANGLE",
    type: "rect",
    x: 58,
    y: 65,
    w: 504,
    h: 510,
    radius: 26,
    fill: "#111827",
    z: 10,
    shadow: { blur: 34, offsetX: 0, offsetY: 18, color: "rgba(17, 24, 39, 0.22)" },
  },
  {
    id: "eyebrow",
    name: "顶部标签",
    kind: "TEXT",
    type: "text",
    x: 92,
    y: 102,
    w: 380,
    h: 20,
    text: "FRAMELAB / ISSUE 07",
    font: FONT_SANS,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 18,
    letterSpacing: 3.2,
    fill: "#a6b0c0",
    z: 20,
  },
  {
    id: "headline",
    name: "小标题",
    kind: "TEXT",
    type: "text",
    x: 88,
    y: 161,
    w: 420,
    h: 218,
    text: "CITY\nIN\nMOTION",
    font: FONT_SERIF,
    fontSize: 82,
    fontWeight: 500,
    lineHeight: 70,
    letterSpacing: -2.4,
    fill: "#f7f0e4",
    z: 20,
  },
  {
    id: "subhead",
    name: "中文副标题",
    kind: "TEXT",
    type: "text",
    x: 92,
    y: 394,
    w: 350,
    h: 26,
    text: "城市脉冲 · 声光采样",
    font: FONT_SANS,
    fontSize: 16,
    fontWeight: 500,
    lineHeight: 22,
    letterSpacing: 1.2,
    fill: "#f7f0e4",
    z: 20,
  },
  {
    id: "hairline",
    name: "分隔线",
    kind: "LINE",
    type: "rect",
    x: 92,
    y: 445,
    w: 282,
    h: 1,
    fill: "rgba(247, 240, 228, 0.28)",
    z: 20,
  },
  {
    id: "session-label",
    name: "场次标签",
    kind: "TEXT",
    type: "text",
    x: 674,
    y: 414,
    w: 200,
    h: 16,
    text: "NEXT SESSION",
    font: FONT_SANS,
    fontSize: 10,
    fontWeight: 650,
    lineHeight: 14,
    letterSpacing: 2,
    fill: "#717a88",
    z: 30,
  },
  {
    id: "session-time",
    name: "场次时间",
    kind: "TEXT",
    type: "text",
    x: 672,
    y: 442,
    w: 210,
    h: 55,
    text: "22:30",
    font: FONT_SERIF,
    fontSize: 48,
    fontWeight: 500,
    lineHeight: 52,
    letterSpacing: -1.8,
    fill: "#131b2a",
    z: 30,
  },
  {
    id: "session-caption",
    name: "场次说明",
    kind: "TEXT",
    type: "text",
    x: 674,
    y: 503,
    w: 210,
    h: 17,
    text: "EAST DOCK / PIER 03",
    font: FONT_SANS,
    fontSize: 9,
    fontWeight: 600,
    lineHeight: 12,
    letterSpacing: 1.05,
    fill: "#5e6672",
    z: 30,
  },
  {
    id: "accent-disc",
    name: "荧光圆点",
    kind: "ELLIPSE",
    type: "ellipse",
    x: 785,
    y: 88,
    w: 112,
    h: 112,
    fill: "#dcff84",
    z: 35,
    shadow: { blur: 20, offsetX: 0, offsetY: 8, color: "rgba(36, 49, 26, 0.24)" },
  },
  {
    id: "accent-number",
    name: "编号 07",
    kind: "TEXT",
    type: "text",
    x: 807,
    y: 117,
    w: 70,
    h: 54,
    text: "07",
    font: FONT_SERIF,
    fontSize: 44,
    fontWeight: 600,
    lineHeight: 48,
    letterSpacing: -1.5,
    fill: "#101827",
    z: 40,
  },
  {
    id: "info-card",
    name: "右下卡片",
    kind: "RECTANGLE",
    type: "rect",
    x: 650,
    y: 393,
    w: 252,
    h: 182,
    radius: 16,
    fill: "#f8f1e5",
    z: 25,
    shadow: { blur: 22, offsetX: 0, offsetY: 12, color: "rgba(16, 24, 39, 0.18)" },
  },
  {
    id: "footer-copy",
    name: "底部注释",
    kind: "TEXT",
    type: "text",
    x: 92,
    y: 520,
    w: 360,
    h: 16,
    text: "A STUDY OF MOVEMENT, LIGHT AND QUIET NOISE.",
    font: FONT_SANS,
    fontSize: 8,
    fontWeight: 550,
    lineHeight: 12,
    letterSpacing: 1.1,
    fill: "#7f899a",
    z: 20,
  },
  {
    id: "barcode",
    name: "条码标记",
    kind: "RECTANGLE",
    type: "rect",
    x: 92,
    y: 550,
    w: 126,
    h: 13,
    fill: "#c8c2b7",
    z: 20,
    stripes: true,
  },
];

export function createInitialProject() {
  return {
    id: "city-pulse-07",
    schema: APP_SCHEMA,
    name: "城市脉冲 / City Pulse",
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    revision: 1,
    decorSeed: 794,
    layers: structuredClone(primaryLayers),
  };
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDecorObjects(project) {
  const random = mulberry32(project.decorSeed);
  const objects = [];
  const count = 92;
  for (let index = 0; index < count; index += 1) {
    const side = index % 5;
    const outside = index % 4 === 0;
    const x = outside
      ? random() * 1260 - 150
      : 24 + random() * (CANVAS_WIDTH - 48);
    const y = outside
      ? random() * 930 - 145
      : 20 + random() * (CANVAS_HEIGHT - 40);
    const vertical = side % 2 === 0;
    const length = 2 + Math.floor(random() * 9);
    objects.push({
      id: `decor-${index}`,
      type: "rect",
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      w: vertical ? 0.7 : length,
      h: vertical ? length : 0.7,
      fill: index % 6 === 0 ? "#ff6b3d" : "#a39e92",
      opacity: index % 6 === 0 ? 0.2 : 0.13,
      z: 2,
      decorIndex: index,
      selectable: false,
    });
  }
  return objects;
}

export function getLayer(project, id) {
  return project.layers.find((layer) => layer.id === id) || null;
}

export function getSelectableLayers(project) {
  return [...project.layers]
    .filter((layer) => layer.selectable !== false)
    .sort((left, right) => right.z - left.z);
}

export function layerBounds(layer) {
  return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
}

export function intersects(left, right) {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

export function buildRenderPlan(project, options, viewport = { x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT }) {
  const decor = createDecorObjects(project);
  const all = [...decor, ...project.layers.map((layer, index) => ({ ...layer, order: index }))];

  let objects;
  if (options.sorting) {
    objects = all.toSorted((left, right) => {
      if (left.z !== right.z) return left.z - right.z;
      return (left.decorIndex ?? left.order ?? 0) - (right.decorIndex ?? right.order ?? 0);
    });
  } else {
    objects = all.toSorted((left, right) => {
      if (left.z !== right.z) return left.z - right.z;
      return (left.decorIndex ?? left.order ?? 0) - (right.decorIndex ?? right.order ?? 0);
    });
  }

  const visible = options.culling
    ? objects.filter((object) => intersects(layerBounds(object), viewport))
    : objects;
  const visibleSelectable = visible.filter((object) => project.layers.includes(project.layers.find((layer) => layer.id === object.id)));

  return {
    objects,
    visible,
    totalObjects: objects.length,
    visibleObjects: visible.length,
    visibleSelectable,
    culledObjects: objects.length - visible.length,
  };
}

export function hitTest(project, x, y) {
  const candidates = project.layers
    .filter((layer) => layer.selectable !== false)
    .toSorted((left, right) => right.z - left.z);
  return candidates.find((layer) => {
    if (layer.type === "ellipse") {
      const rx = layer.w / 2;
      const ry = layer.h / 2;
      const dx = (x - (layer.x + rx)) / rx;
      const dy = (y - (layer.y + ry)) / ry;
      return dx * dx + dy * dy <= 1;
    }
    return x >= layer.x && x <= layer.x + layer.w && y >= layer.y && y <= layer.y + layer.h;
  }) || null;
}

export function clampLayerPosition(project, layer, x, y) {
  const margin = 36;
  return {
    x: Math.max(margin - layer.w, Math.min(project.width - margin, x)),
    y: Math.max(margin - layer.h, Math.min(project.height - margin, y)),
  };
}

export function cloneProject(project) {
  return structuredClone(project);
}
