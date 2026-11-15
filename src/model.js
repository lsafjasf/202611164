export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = "prism-studio.project.v2";
export const METRICS_KEY = "prism-studio.metrics.v1";
export const CANVAS = Object.freeze({ width: 960, height: 540 });
export const LIMITS = Object.freeze({
  layers: 12,
  layerName: 36,
  text: 80,
  projectName: 48,
  exportHistory: 8
});

export const PALETTES = Object.freeze({
  tide: { label: "潮汐", colorA: "#16213e", colorB: "#ff7a59", angle: 132 },
  citrus: { label: "柑橘", colorA: "#1a2e1f", colorB: "#c8ff6a", angle: 112 },
  dusk: { label: "暮光", colorA: "#251b37", colorB: "#e9a6ff", angle: 148 },
  paper: { label: "纸张", colorA: "#e8ddc6", colorB: "#b74b32", angle: 120 }
});

const DEFAULT_LAYERS = [
  {
    id: "layer-coral",
    type: "rect",
    name: "珊瑚矩形",
    x: 112,
    y: 158,
    width: 276,
    height: 206,
    fill: "#ff7a59",
    radius: 24,
    rotation: -6,
    opacity: 0.94
  },
  {
    id: "layer-orbit",
    type: "circle",
    name: "轨道圆形",
    x: 552,
    y: 104,
    width: 242,
    height: 242,
    fill: "#8fb8ff",
    radius: 121,
    rotation: 0,
    opacity: 0.42
  },
  {
    id: "layer-title",
    type: "text",
    name: "主标题",
    x: 132,
    y: 352,
    width: 430,
    height: 104,
    text: "海岸线\n也有回声。",
    size: 52,
    fill: "#f7f0e7",
    weight: 600,
    align: "left",
    rotation: 0,
    opacity: 1
  }
];

export function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function clampText(value, max, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, max);
}

function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function createDefaultLayers() {
  return clone(DEFAULT_LAYERS);
}

export function createDefaultState(now = new Date().toISOString()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: "prism-project-793",
    projectName: "海岸线的回声",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    background: {
      palette: "tide",
      colorA: PALETTES.tide.colorA,
      colorB: PALETTES.tide.colorB,
      angle: PALETTES.tide.angle,
      grain: 18,
      vignette: 28
    },
    layers: createDefaultLayers(),
    selection: "layer-title",
    audio: {
      waveform: "triangle",
      volume: 26,
      bpm: 96,
      pattern: [true, false, true, true, false, true, false, true],
      notes: [0, 3, 7, 10, 7, 3, 5, 12]
    },
    exports: [],
    lastExportRevision: null
  };
}

export function createId(prefix, now = Date.now(), random = Math.random()) {
  return `${prefix}-${now.toString(36)}-${Math.floor(random * 1e6).toString(36)}`;
}

export function createLayer(type, state, options = {}) {
  const count = state.layers.length;
  const id = options.id || createId(type === "text" ? "text" : "shape");
  const offset = (count * 22) % 154;
  const base = {
    id,
    type,
    name: type === "text" ? `文字 ${count + 1}` : type === "circle" ? `圆形 ${count + 1}` : `矩形 ${count + 1}`,
    x: 120 + offset,
    y: 150 + offset,
    width: type === "text" ? 380 : 220,
    height: type === "text" ? 88 : 150,
    fill: type === "circle" ? "#8fb8ff" : type === "text" ? "#f7f0e7" : "#ff7a59",
    radius: type === "circle" ? 110 : 20,
    rotation: type === "rect" ? -4 : 0,
    opacity: type === "text" ? 1 : 0.92
  };
  if (type === "text") {
    Object.assign(base, {
      text: options.text || "新的文字图层",
      size: 38,
      weight: 600,
      align: "left"
    });
  }
  return base;
}

export function layerCapacityReached(state) {
  return state.layers.length >= LIMITS.layers;
}

export function addLayer(state, type, options = {}) {
  if (!["rect", "circle", "text"].includes(type)) {
    throw new Error("未知图层类型，请选择矩形、圆形或文字。");
  }
  if (layerCapacityReached(state)) {
    const error = new Error(`图层数量已达到 ${LIMITS.layers} 个上限。请先删除一个图层再添加。`);
    error.code = "LAYER_LIMIT";
    throw error;
  }
  const layer = createLayer(type, state, options);
  const next = clone(state);
  next.layers.push(layer);
  next.selection = layer.id;
  next.revision += 1;
  next.updatedAt = options.now || new Date().toISOString();
  return { state: next, layer };
}

export function removeLayer(state, id, now = new Date().toISOString()) {
  if (!state.layers.some((layer) => layer.id === id)) return clone(state);
  const next = clone(state);
  next.layers = next.layers.filter((layer) => layer.id !== id);
  if (next.selection === id) {
    next.selection = next.layers.at(-1)?.id || null;
  }
  next.revision += 1;
  next.updatedAt = now;
  return next;
}

export function selectLayer(state, id) {
  if (id !== null && !state.layers.some((layer) => layer.id === id)) return clone(state);
  if (state.selection === id) return clone(state);
  const next = clone(state);
  next.selection = id;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function getSelectedLayer(state) {
  return state.layers.find((layer) => layer.id === state.selection) || null;
}

export function moveLayer(state, id, dx, dy, now = new Date().toISOString()) {
  const next = clone(state);
  const layer = next.layers.find((item) => item.id === id);
  if (!layer) return next;
  layer.x = clamp(layer.x + dx, 0, CANVAS.width - 24);
  layer.y = clamp(layer.y + dy, 0, CANVAS.height - 24);
  next.revision += 1;
  next.updatedAt = now;
  return next;
}

export function updateLayer(state, id, patch, now = new Date().toISOString()) {
  const next = clone(state);
  const layer = next.layers.find((item) => item.id === id);
  if (!layer) return next;
  if ("name" in patch) layer.name = clampText(patch.name, LIMITS.layerName, layer.name) || "未命名图层";
  if ("fill" in patch) layer.fill = safeColor(patch.fill, layer.fill);
  if ("rotation" in patch) layer.rotation = clamp(patch.rotation, -180, 180, layer.rotation);
  if ("opacity" in patch) layer.opacity = clamp(patch.opacity, 0.05, 1, layer.opacity);
  if ("x" in patch) layer.x = clamp(patch.x, 0, CANVAS.width - 24, layer.x);
  if ("y" in patch) layer.y = clamp(patch.y, 0, CANVAS.height - 24, layer.y);
  if (layer.type === "text") {
    if ("text" in patch) layer.text = clampText(patch.text, LIMITS.text, layer.text);
    if ("size" in patch) layer.size = clamp(patch.size, 20, 96, layer.size);
  } else {
    if ("width" in patch) layer.width = clamp(patch.width, 48, 520, layer.width);
    if ("height" in patch) layer.height = clamp(patch.height, 48, 360, layer.height);
    if (layer.type === "circle") layer.radius = layer.width / 2;
  }
  next.revision += 1;
  next.updatedAt = now;
  return next;
}

export function updateProjectName(state, name, now = new Date().toISOString()) {
  const next = clone(state);
  next.projectName = clampText(name, LIMITS.projectName, "");
  next.updatedAt = now;
  return next;
}

export function applyPalette(state, paletteId, now = new Date().toISOString()) {
  const palette = PALETTES[paletteId];
  if (!palette) return clone(state);
  const next = clone(state);
  next.background.palette = paletteId;
  next.background.colorA = palette.colorA;
  next.background.colorB = palette.colorB;
  next.background.angle = palette.angle;
  next.updatedAt = now;
  return next;
}

export function updateBackground(state, patch, now = new Date().toISOString()) {
  const next = clone(state);
  if ("grain" in patch) next.background.grain = clamp(patch.grain, 0, 40, next.background.grain);
  if ("vignette" in patch) next.background.vignette = clamp(patch.vignette, 0, 70, next.background.vignette);
  next.updatedAt = now;
  return next;
}

export function updateAudio(state, patch) {
  const next = clone(state);
  if ("waveform" in patch && ["sine", "triangle", "sawtooth", "square"].includes(patch.waveform)) {
    next.audio.waveform = patch.waveform;
  }
  if ("volume" in patch) next.audio.volume = clamp(patch.volume, 0, 100, next.audio.volume);
  if ("bpm" in patch) next.audio.bpm = clamp(patch.bpm, 40, 200, next.audio.bpm);
  if ("pattern" in patch && Array.isArray(patch.pattern)) {
    next.audio.pattern = next.audio.pattern.map((step, index) => Boolean(patch.pattern[index] ?? step));
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function toggleAudioStep(state, index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.audio.pattern.length) return clone(state);
  const next = clone(state);
  next.audio.pattern[index] = !next.audio.pattern[index];
  next.updatedAt = new Date().toISOString();
  return next;
}

export function recordExport(state, record) {
  const next = clone(state);
  next.exports = [record, ...next.exports].slice(0, LIMITS.exportHistory);
  if (record.status === "success") next.lastExportRevision = state.revision;
  next.updatedAt = record.at || new Date().toISOString();
  return next;
}

function sanitizeLayer(raw, index) {
  const type = ["rect", "circle", "text"].includes(raw?.type) ? raw.type : "rect";
  const fallback = createDefaultLayers()[0];
  const layer = {
    id: typeof raw?.id === "string" && raw.id ? raw.id : `restored-layer-${index + 1}`,
    type,
    name: clampText(raw?.name, LIMITS.layerName, `${type === "text" ? "文字" : "图形"} ${index + 1}`),
    x: clamp(raw?.x, 0, CANVAS.width - 24, 100),
    y: clamp(raw?.y, 0, CANVAS.height - 24, 100),
    width: clamp(raw?.width, 48, 520, fallback.width),
    height: clamp(raw?.height, 48, 360, fallback.height),
    fill: safeColor(raw?.fill, fallback.fill),
    radius: clamp(raw?.radius, 0, 260, 18),
    rotation: clamp(raw?.rotation, -180, 180, 0),
    opacity: clamp(raw?.opacity, 0.05, 1, 0.94)
  };
  if (type === "text") {
    layer.text = clampText(raw?.text, LIMITS.text, "恢复的文字");
    layer.size = clamp(raw?.size, 20, 96, 38);
    layer.weight = clamp(raw?.weight, 300, 800, 600);
    layer.align = raw?.align === "center" ? "center" : "left";
  }
  return layer;
}

export function sanitizeState(raw, now = new Date().toISOString()) {
  if (!raw || typeof raw !== "object") throw new Error("工程快照不是有效对象。");
  if (!Array.isArray(raw.layers)) throw new Error("工程快照缺少图层数组。");
  const base = createDefaultState(now);
  const paletteId = PALETTES[raw.background?.palette] ? raw.background.palette : "tide";
  const pattern = Array.isArray(raw.audio?.pattern) ? raw.audio.pattern : base.audio.pattern;
  const layers = raw.layers.slice(0, LIMITS.layers).map(sanitizeLayer);
  const selection = layers.some((layer) => layer.id === raw.selection)
    ? raw.selection
    : layers.at(-1)?.id || null;
  const exports = Array.isArray(raw.exports)
    ? raw.exports
        .filter((item) => item && typeof item === "object")
        .slice(0, LIMITS.exportHistory)
        .map((item) => ({
          id: clampText(item.id, 80, createId("export")),
          format: item.format === "png" ? "png" : "json",
          projectName: clampText(item.projectName, LIMITS.projectName, "未命名作品"),
          revision: clamp(item.revision, 1, 999999, 1),
          status: item.status === "success" ? "success" : "failure",
          at: typeof item.at === "string" ? item.at : now,
          bytes: clamp(item.bytes, 0, 99999999, 0),
          reason: clampText(item.reason, 160, "")
        }))
    : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: clampText(raw.projectId, 80, base.projectId) || base.projectId,
    projectName: clampText(raw.projectName, LIMITS.projectName, base.projectName),
    revision: clamp(raw.revision, 1, 999999, 1),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    background: {
      palette: paletteId,
      colorA: safeColor(raw.background?.colorA, PALETTES[paletteId].colorA),
      colorB: safeColor(raw.background?.colorB, PALETTES[paletteId].colorB),
      angle: clamp(raw.background?.angle, 0, 360, PALETTES[paletteId].angle),
      grain: clamp(raw.background?.grain, 0, 40, 18),
      vignette: clamp(raw.background?.vignette, 0, 70, 28)
    },
    layers,
    selection,
    audio: {
      waveform: ["sine", "triangle", "sawtooth", "square"].includes(raw.audio?.waveform)
        ? raw.audio.waveform
        : base.audio.waveform,
      volume: clamp(raw.audio?.volume, 0, 100, 26),
      bpm: clamp(raw.audio?.bpm, 40, 200, 96),
      pattern: base.audio.pattern.map((_, index) => Boolean(pattern[index])),
      notes: base.audio.notes.map((note, index) =>
        clamp(Array.isArray(raw.audio?.notes) ? raw.audio.notes[index] : note, -12, 24, note)
      )
    },
    exports,
    lastExportRevision: raw.lastExportRevision === null
      ? null
      : clamp(raw.lastExportRevision, 1, 999999, null)
  };
}

export function loadState(storage, now = new Date().toISOString()) {
  if (!storage) return { state: createDefaultState(now), source: "new" };
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return { state: createDefaultState(now), source: "storage-error", error };
  }
  if (!raw) return { state: createDefaultState(now), source: "new" };
  try {
    const state = sanitizeState(JSON.parse(raw), now);
    return { state, source: "restored", raw };
  } catch (error) {
    return { state: createDefaultState(now), source: "corrupt", error, raw };
  }
}

export function saveState(storage, state, now = new Date().toISOString()) {
  if (!storage) return { ok: false, at: now, error: new Error("本地存储不可用。") };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true, at: now };
  } catch (error) {
    return { ok: false, at: now, error };
  }
}

export function createProjectPayload(state, now = new Date().toISOString()) {
  return {
    kind: "prism-studio-project",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    project: clone(state)
  };
}

export function cloneState(state) {
  return clone(state);
}
