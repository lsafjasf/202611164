const SHAPE_TYPES = new Set(["rect", "ellipse", "text"]);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const textEncoder = new TextEncoder();

export const LIMITS = Object.freeze({
  width: [1, 8192],
  height: [1, 8192],
  objects: 1000,
  coordinate: 1_000_000,
  size: 2_000_000,
  textLength: 500,
  historyEntries: 120,
  historyBytes: 1_500_000,
  cacheEntries: 12,
  cacheBytes: 3_145_728,
});

export function utf8Bytes(value) {
  return textEncoder.encode(String(value)).byteLength;
}

export function cloneShape(shape) {
  return { ...shape };
}

export class EditorInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EditorInputError";
    this.code = code;
  }
}

function assertNumber(value, label, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EditorInputError("INVALID_NUMBER", `${label} 必须是有限数字`);
  }
  if (value < min || value > max) {
    throw new EditorInputError("OUT_OF_RANGE", `${label} 超出允许范围`);
  }
  return value;
}

export function validateShape(input, index = 0) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new EditorInputError("INVALID_SHAPE", `对象 ${index} 不是有效对象`);
  }
  if (typeof input.id !== "string" || !ID_PATTERN.test(input.id)) {
    throw new EditorInputError("INVALID_ID", `对象 ${index} 的 id 无效`);
  }
  if (!SHAPE_TYPES.has(input.type)) {
    throw new EditorInputError("INVALID_TYPE", `对象 ${input.id} 的类型无效`);
  }
  if (typeof input.color !== "string" || !COLOR_PATTERN.test(input.color)) {
    throw new EditorInputError("INVALID_COLOR", `对象 ${input.id} 的颜色无效`);
  }

  const shape = {
    id: input.id,
    type: input.type,
    x: assertNumber(input.x, `${input.id}.x`, -LIMITS.coordinate, LIMITS.coordinate),
    y: assertNumber(input.y, `${input.id}.y`, -LIMITS.coordinate, LIMITS.coordinate),
    width: assertNumber(input.width, `${input.id}.width`, 0.01, LIMITS.size),
    height: assertNumber(input.height, `${input.id}.height`, 0.01, LIMITS.size),
    color: input.color.toLowerCase(),
  };

  if (input.rotation !== undefined) {
    shape.rotation = assertNumber(input.rotation, `${input.id}.rotation`, -360, 360);
  }
  if (input.opacity !== undefined) {
    shape.opacity = assertNumber(input.opacity, `${input.id}.opacity`, 0.05, 1);
  }
  if (input.type === "text") {
    if (typeof input.text !== "string" || input.text.length > LIMITS.textLength) {
      throw new EditorInputError("INVALID_TEXT", `对象 ${input.id} 的文本无效`);
    }
    shape.text = input.text;
  }
  return shape;
}

export function parseDocument(input) {
  let value = input;
  try {
    if (typeof input === "string") value = JSON.parse(input);
  } catch (error) {
    throw new EditorInputError("INVALID_JSON", `JSON 解析失败: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EditorInputError("INVALID_DOCUMENT", "文档必须是 JSON 对象");
  }
  if (value.version !== 1) {
    throw new EditorInputError("INVALID_VERSION", "仅支持 version: 1 的文档");
  }
  if (
    !Number.isInteger(value.width) ||
    value.width < LIMITS.width[0] ||
    value.width > LIMITS.width[1]
  ) {
    throw new EditorInputError("INVALID_WIDTH", "画布宽度无效");
  }
  if (
    !Number.isInteger(value.height) ||
    value.height < LIMITS.height[0] ||
    value.height > LIMITS.height[1]
  ) {
    throw new EditorInputError("INVALID_HEIGHT", "画布高度无效");
  }
  if (!Array.isArray(value.objects)) {
    throw new EditorInputError("INVALID_OBJECTS", "objects 必须是数组");
  }
  if (value.objects.length > LIMITS.objects) {
    throw new EditorInputError("TOO_MANY_OBJECTS", "对象数量超过限制");
  }

  const ids = new Set();
  const objects = value.objects.map((item, index) => {
    const shape = validateShape(item, index);
    if (ids.has(shape.id)) {
      throw new EditorInputError("DUPLICATE_ID", `对象 id 重复: ${shape.id}`);
    }
    ids.add(shape.id);
    return shape;
  });
  return { version: 1, width: value.width, height: value.height, objects };
}

export function stableHash(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return (
    (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0")
  );
}

export class SceneModel {
  constructor(document = { version: 1, width: 1200, height: 760, objects: [] }) {
    const parsed = parseDocument(document);
    this.version = parsed.version;
    this.width = parsed.width;
    this.height = parsed.height;
    this.objects = parsed.objects.map(cloneShape);
    this.selected = new Set();
    this.revision = 0;
  }

  replace(document) {
    const parsed = parseDocument(document);
    this.width = parsed.width;
    this.height = parsed.height;
    this.objects = parsed.objects.map(cloneShape);
    this.selected.clear();
    this.revision += 1;
    return parsed;
  }

  find(id) {
    return this.objects.find((shape) => shape.id === id);
  }

  add(shape, index = this.objects.length) {
    if (this.find(shape.id)) {
      throw new EditorInputError("DUPLICATE_ID", `对象 id 重复: ${shape.id}`);
    }
    const safeIndex = Math.max(0, Math.min(index, this.objects.length));
    this.objects.splice(safeIndex, 0, cloneShape(shape));
    this.revision += 1;
    return safeIndex;
  }

  remove(ids) {
    const selected = new Set(ids);
    const removed = [];
    this.objects = this.objects.filter((shape, index) => {
      if (!selected.has(shape.id)) return true;
      removed.push({ index, shape: cloneShape(shape) });
      return false;
    });
    for (const shape of removed) this.selected.delete(shape.shape.id);
    this.revision += 1;
    return removed;
  }

  insertRemoved(items) {
    for (const item of [...items].sort((a, b) => a.index - b.index)) {
      if (this.find(item.shape.id)) continue;
      const index = Math.min(item.index, this.objects.length);
      this.objects.splice(index, 0, cloneShape(item.shape));
    }
    this.revision += 1;
  }

  patch(id, patch) {
    const shape = this.find(id);
    if (!shape) throw new EditorInputError("MISSING_SHAPE", `对象不存在: ${id}`);
    Object.assign(shape, patch);
    const normalized = validateShape(shape);
    Object.keys(shape).forEach((key) => delete shape[key]);
    Object.assign(shape, normalized);
    this.revision += 1;
    return shape;
  }

  select(ids) {
    this.selected = new Set(ids.filter((id) => Boolean(this.find(id))));
    return this.selected;
  }

  clearSelection() {
    this.selected.clear();
  }

  toDocument() {
    return {
      version: 1,
      width: this.width,
      height: this.height,
      objects: this.objects.map(cloneShape),
    };
  }

  serialized() {
    return JSON.stringify(this.toDocument());
  }

  estimatedBytes() {
    return utf8Bytes(this.serialized());
  }
}

function commandBytes(data) {
  return utf8Bytes(JSON.stringify(data)) + 48;
}

export class DeltaHistory {
  constructor({ maxEntries = LIMITS.historyEntries, maxBytes = LIMITS.historyBytes } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  record(data) {
    const command = { data, bytes: commandBytes(data) };
    this.undoStack.push(command);
    this.bytes += command.bytes;
    while (
      this.undoStack.length > this.maxEntries ||
      (this.bytes > this.maxBytes && this.undoStack.length > 1)
    ) {
      this.bytes -= this.undoStack.shift().bytes;
    }
    for (const item of this.redoStack) this.bytes -= item.bytes;
    this.redoStack = [];
    return command;
  }

  undo(model) {
    const command = this.undoStack.pop();
    if (!command) return null;
    this.bytes -= command.bytes;
    applyCommand(model, command.data, "undo");
    this.redoStack.push(command);
    this.bytes += command.bytes;
    return command.data;
  }

  redo(model) {
    const command = this.redoStack.pop();
    if (!command) return null;
    this.bytes -= command.bytes;
    applyCommand(model, command.data, "redo");
    this.undoStack.push(command);
    this.bytes += command.bytes;
    return command.data;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  snapshot() {
    return {
      undoEntries: this.undoStack.length,
      redoEntries: this.redoStack.length,
      entries: this.undoStack.length + this.redoStack.length,
      bytes: this.bytes,
    };
  }
}

function applyCommand(model, command, direction) {
  if (command.kind === "add") {
    if (direction === "undo") model.remove([command.shape.id]);
    else model.add(command.shape, command.index);
    return;
  }
  if (command.kind === "delete") {
    if (direction === "undo") model.insertRemoved(command.items);
    else model.remove(command.items.map((item) => item.shape.id));
    return;
  }
  if (command.kind === "update") {
    const patchKey = direction === "undo" ? "before" : "after";
    for (const change of command.changes) model.patch(change.id, change[patchKey]);
    return;
  }
  throw new Error(`未知撤销命令: ${command.kind}`);
}

export class ErrorJournal {
  constructor(capacity = 50) {
    this.capacity = capacity;
    this.entries = [];
    this.nextId = 1;
  }

  record(error, operation = "unknown") {
    const entry = {
      id: this.nextId++,
      at: new Date().toISOString(),
      operation,
      name: error?.name || "Error",
      code: error?.code || "UNEXPECTED",
      message: error?.message || String(error),
      stack: error?.stack || null,
    };
    this.entries.push(entry);
    while (this.entries.length > this.capacity) this.entries.shift();
    return entry;
  }

  list() {
    return this.entries.map((entry) => ({ ...entry }));
  }

  sanitized() {
    return this.list().map(({ operation, name, code, message }) => ({
      operation,
      name,
      code,
      message,
    }));
  }

  clear() {
    this.entries = [];
  }
}

function defaultCanvasFactory(width, height) {
  if (typeof document === "undefined") {
    throw new Error("当前环境没有 document，请注入 createCanvas");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class ResourceBroker {
  constructor({
    createCanvas = defaultCanvasFactory,
    maxCacheEntries = LIMITS.cacheEntries,
    maxCacheBytes = LIMITS.cacheBytes,
    now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  } = {}) {
    this.createCanvasFactory = createCanvas;
    this.maxCacheEntries = maxCacheEntries;
    this.maxCacheBytes = maxCacheBytes;
    this.now = now;
    this.canvases = new Map();
    this.listeners = new Map();
    this.cache = new Map();
    this.cacheBytes = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.nextResourceId = 1;
    this.disposed = false;
  }

  assertActive() {
    if (this.disposed) throw new Error("资源容器已关闭");
  }

  registerCanvas(canvas, { label = "canvas", release = null } = {}) {
    this.assertActive();
    if (!canvas || typeof canvas !== "object") throw new Error("画布对象无效");
    if (this.canvases.has(canvas)) return this.canvases.get(canvas);
    const width = Number(canvas.width) || 0;
    const height = Number(canvas.height) || 0;
    const record = {
      id: this.nextResourceId++,
      canvas,
      label,
      width,
      height,
      bytes: width * height * 4,
      release,
      createdAt: this.now(),
    };
    this.canvases.set(canvas, record);
    return record;
  }

  createCanvas(width, height, label = "offscreen") {
    this.assertActive();
    const canvas = this.createCanvasFactory(width, height);
    canvas.width = width;
    canvas.height = height;
    this.registerCanvas(canvas, { label });
    return canvas;
  }

  releaseCanvas(canvas) {
    const record = this.canvases.get(canvas);
    if (!record) return false;
    this.canvases.delete(canvas);
    record.width = Number(canvas.width) || 0;
    record.height = Number(canvas.height) || 0;
    try {
      if (record.release) record.release(canvas);
      else {
        canvas.width = 0;
        canvas.height = 0;
      }
    } catch {
      // Releasing an already-detached canvas must not block other cleanup.
    }
    return true;
  }

  listen(target, type, handler, options) {
    this.assertActive();
    if (!target || typeof target.addEventListener !== "function") {
      throw new Error("事件目标无效");
    }
    target.addEventListener(type, handler, options);
    const id = this.nextResourceId++;
    this.listeners.set(id, { id, target, type, handler, options });
    return id;
  }

  unlisten(id) {
    const record = this.listeners.get(id);
    if (!record) return false;
    this.listeners.delete(id);
    try {
      record.target.removeEventListener(record.type, record.handler, record.options);
    } catch {
      // The target may have been destroyed by its host.
    }
    return true;
  }

  cacheGet(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.cacheMisses += 1;
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.cacheHits += 1;
    return entry.canvas;
  }

  cacheSet(key, canvas, { bytes = null } = {}) {
    this.assertActive();
    this.cacheDelete(key);
    const record = this.canvases.get(canvas);
    const size =
      bytes ?? record?.bytes ?? (Number(canvas.width) || 0) * (Number(canvas.height) || 0) * 4;
    if (size > this.maxCacheBytes) return false;
    while (
      this.cache.size > 0 &&
      (this.cache.size >= this.maxCacheEntries || this.cacheBytes + size > this.maxCacheBytes)
    ) {
      const oldestKey = this.cache.keys().next().value;
      this.cacheDelete(oldestKey);
    }
    this.cache.set(key, { canvas, bytes: size, createdAt: this.now() });
    this.cacheBytes += size;
    return true;
  }

  cacheDelete(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.cache.delete(key);
    this.cacheBytes = Math.max(0, this.cacheBytes - entry.bytes);
    this.releaseCanvas(entry.canvas);
    return true;
  }

  cacheDeleteByPrefix(prefix) {
    let count = 0;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix) && this.cacheDelete(key)) count += 1;
    }
    return count;
  }

  clearCache() {
    const count = this.cache.size;
    for (const canvas of [...this.cache.values()].map((entry) => entry.canvas)) {
      this.releaseCanvas(canvas);
    }
    this.cache.clear();
    this.cacheBytes = 0;
    return count;
  }

  snapshot() {
    let canvasBytes = 0;
    const canvasLabels = {};
    for (const record of this.canvases.values()) {
      const live = this.canvases.get(record.canvas);
      if (live !== record) continue;
      const bytes =
        (Number(record.canvas.width) || record.width) *
        (Number(record.canvas.height) || record.height) *
        4;
      canvasBytes += bytes;
      canvasLabels[record.label] = (canvasLabels[record.label] || 0) + 1;
    }
    return {
      disposed: this.disposed,
      canvases: this.canvases.size,
      canvasBytes,
      canvasLabels,
      listeners: this.listeners.size,
      cacheEntries: this.cache.size,
      cacheBytes: this.cacheBytes,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  dispose() {
    if (this.disposed) return this.snapshot();
    for (const id of [...this.listeners.keys()]) this.unlisten(id);
    this.clearCache();
    for (const canvas of [...this.canvases.keys()]) this.releaseCanvas(canvas);
    this.disposed = true;
    return this.snapshot();
  }
}

export class OperationMetrics {
  constructor(capacity = 40) {
    this.capacity = capacity;
    this.entries = [];
    this.counts = {};
    this.last = null;
  }

  record(name, elapsedMs, success = true) {
    const entry = {
      name,
      elapsedMs: Math.max(0, Number(elapsedMs) || 0),
      success,
      at: Date.now(),
    };
    this.last = entry;
    this.entries.push(entry);
    while (this.entries.length > this.capacity) this.entries.shift();
    this.counts[name] = (this.counts[name] || 0) + 1;
    return entry;
  }

  snapshot() {
    return {
      last: this.last ? { ...this.last } : null,
      counts: { ...this.counts },
      samples: this.entries.length,
    };
  }
}

function emptyDocument(width = 1200, height = 760) {
  return { version: 1, width, height, objects: [] };
}

export class EditorSession {
  constructor({
    initialDocument = emptyDocument(),
    stageCanvas = null,
    overlayCanvas = null,
    createCanvas = defaultCanvasFactory,
    now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    historyLimit = LIMITS.historyEntries,
    historyBytes = LIMITS.historyBytes,
    cacheEntries = LIMITS.cacheEntries,
    cacheBytes = LIMITS.cacheBytes,
  } = {}) {
    this.model = new SceneModel(initialDocument);
    this.history = new DeltaHistory({ maxEntries: historyLimit, maxBytes: historyBytes });
    this.errors = new ErrorJournal();
    this.operations = new OperationMetrics();
    this.stageCanvas = stageCanvas;
    this.externalOverlayCanvas = overlayCanvas;
    this.canvasFactory = createCanvas;
    this.now = now;
    this.cacheEntries = cacheEntries;
    this.cacheBytes = cacheBytes;
    this.resources = null;
    this.overlayCanvas = null;
    this.state = "closed";
    this.mode = "full";
    this.openedAt = 0;
    this.accumulatedMs = 0;
    this.lastOperationMs = 0;
    this.lastOperationName = null;
    this.recoverySuggestion =
      "资源状态正常。导入损坏数据会原子拒绝，当前画布保持不变。";
    this.lastCloseReport = null;
    this.nextShapeId = 1;
  }

  static open(options = {}) {
    return new EditorSession(options).open();
  }

  createResources() {
    return new ResourceBroker({
      createCanvas: this.canvasFactory,
      maxCacheEntries: this.cacheEntries,
      maxCacheBytes: this.cacheBytes,
      now: this.now,
    });
  }

  open() {
    if (this.state === "open") return this;
    this.resources = this.createResources();
    const width = this.model.width;
    const height = this.model.height;
    if (!this.stageCanvas) {
      this.stageCanvas = this.resources.createCanvas(width, height, "stage");
    } else {
      this.resources.registerCanvas(this.stageCanvas, { label: "stage" });
    }
    if (!this.externalOverlayCanvas) {
      this.overlayCanvas = this.resources.createCanvas(width, height, "overlay");
    } else {
      this.overlayCanvas = this.externalOverlayCanvas;
      this.resources.registerCanvas(this.overlayCanvas, { label: "overlay" });
    }
    this.state = "open";
    this.openedAt = this.now();
    this.lastCloseReport = null;
    return this;
  }

  bindInput(target, handlers) {
    this.assertOpen("bindInput");
    const ids = [];
    for (const [type, handler] of Object.entries(handlers)) {
      if (typeof handler !== "function") continue;
      ids.push(this.resources.listen(target, type, handler, { passive: false }));
    }
    return ids;
  }

  assertOpen(operation) {
    if (this.state !== "open") {
      throw new EditorInputError("SESSION_CLOSED", `${operation}: 编辑器未打开`);
    }
  }

  elapsedMs() {
    const current = this.state === "open" ? this.now() - this.openedAt : 0;
    return Math.max(0, this.accumulatedMs + current);
  }

  setMode(mode) {
    if (mode !== "full" && mode !== "reduced" && mode !== "recovery") {
      throw new EditorInputError("INVALID_MODE", `未知渲染模式: ${mode}`);
    }
    this.mode = mode;
  }

  perform(operation, task) {
    const started = this.now();
    try {
      const result = task();
      this.lastOperationMs = Math.max(0, this.now() - started);
      this.lastOperationName = operation;
      this.operations.record(operation, this.lastOperationMs, true);
      this.recoverySuggestion = "上一个操作已完成；可继续编辑、撤销或导出。";
      return result;
    } catch (error) {
      this.lastOperationMs = Math.max(0, this.now() - started);
      this.lastOperationName = operation;
      this.operations.record(operation, this.lastOperationMs, false);
      this.errors.record(error, operation);
      this.recoverySuggestion =
        operation === "import"
          ? "输入未应用，当前画布未修改。检查 JSON 的 version、尺寸、对象字段后重试。"
          : "操作失败，画布保持在上一有效状态。可撤销、导出或关闭后重新打开。";
      throw error;
    }
  }

  invalidateShapeCache(id) {
    this.resources?.cacheDeleteByPrefix(`${id}:`);
  }

  addShape(input = {}) {
    return this.perform("addShape", () => {
      this.assertOpen("addShape");
      const shape = validateShape({
        id: input.id || `shape-${this.nextShapeId++}`,
        type: input.type || "rect",
        x: input.x ?? 80,
        y: input.y ?? 80,
        width: input.width ?? 160,
        height: input.height ?? 100,
        color: input.color || "#6ee7b7",
        ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
        ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
        ...(input.type === "text" ? { text: input.text || "文本" } : {}),
      });
      const index = this.model.add(shape);
      this.history.record({ kind: "add", index, shape: cloneShape(shape) });
      this.model.select([shape.id]);
      this.invalidateShapeCache(shape.id);
      return cloneShape(shape);
    });
  }

  updateObject(id, patch) {
    return this.perform("updateObject", () => {
      this.assertOpen("updateObject");
      const current = this.model.find(id);
      if (!current) throw new EditorInputError("MISSING_SHAPE", `对象不存在: ${id}`);
      const merged = validateShape({ ...current, ...patch, id: current.id });
      const fields = new Set([...Object.keys(current), ...Object.keys(merged)]);
      fields.delete("id");
      const changes = [];
      for (const field of fields) {
        if (current[field] === merged[field]) continue;
        changes.push({
          id,
          before: { [field]: current[field] },
          after: { [field]: merged[field] },
        });
      }
      if (changes.length === 0) return cloneShape(current);
      this.model.patch(id, merged);
      this.history.record({ kind: "update", changes });
      this.invalidateShapeCache(id);
      return cloneShape(this.model.find(id));
    });
  }

  translateSelection(dx, dy) {
    return this.perform("translateSelection", () => {
      this.assertOpen("translateSelection");
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        throw new EditorInputError("INVALID_MOVE", "位移必须是有限数字");
      }
      const changes = [];
      for (const id of this.model.selected) {
        const current = this.model.find(id);
        if (!current) continue;
        const merged = validateShape({
          ...current,
          x: current.x + dx,
          y: current.y + dy,
        });
        const before = {};
        const after = {};
        if (merged.x !== current.x) {
          before.x = current.x;
          after.x = merged.x;
        }
        if (merged.y !== current.y) {
          before.y = current.y;
          after.y = merged.y;
        }
        if (Object.keys(after).length > 0) changes.push({ id, before, after });
      }
      if (changes.length === 0) return [];
      for (const change of changes) this.model.patch(change.id, change.after);
      this.history.record({ kind: "update", changes });
      for (const change of changes) this.invalidateShapeCache(change.id);
      return changes;
    });
  }

  deleteSelected() {
    return this.perform("deleteSelected", () => {
      this.assertOpen("deleteSelected");
      const ids = [...this.model.selected];
      if (ids.length === 0) return [];
      const items = this.model.remove(ids);
      this.history.record({ kind: "delete", items });
      for (const item of items) this.invalidateShapeCache(item.shape.id);
      return items.map((item) => cloneShape(item.shape));
    });
  }

  undo() {
    return this.perform("undo", () => {
      this.assertOpen("undo");
      const command = this.history.undo(this.model);
      this.resources.clearCache();
      return command;
    });
  }

  redo() {
    return this.perform("redo", () => {
      this.assertOpen("redo");
      const command = this.history.redo(this.model);
      this.resources.clearCache();
      return command;
    });
  }

  importDocument(input) {
    return this.perform("import", () => {
      this.assertOpen("import");
      const parsed = parseDocument(input);
      this.model.replace(parsed);
      this.history.clear();
      this.resources.clearCache();
      return parsed;
    });
  }

  exportDocument() {
    return this.model.toDocument();
  }

  exportSignature() {
    return stableHash(this.model.serialized());
  }

  getPreview(shape, draw, { width = 96, height = 64 } = {}) {
    this.assertOpen("getPreview");
    const key = `${shape.id}:${stableHash(shape)}`;
    const cached = this.resources.cacheGet(key);
    if (cached) return cached;
    const canvas = this.resources.createCanvas(width, height, "preview");
    try {
      draw(canvas, shape);
      if (!this.resources.cacheSet(key, canvas)) this.resources.releaseCanvas(canvas);
      return canvas;
    } catch (error) {
      this.resources.releaseCanvas(canvas);
      this.errors.record(error, "preview");
      throw error;
    }
  }

  memorySnapshot() {
    const resources = this.resources?.snapshot() || {
      disposed: true,
      canvases: 0,
      canvasBytes: 0,
      canvasLabels: {},
      listeners: 0,
      cacheEntries: 0,
      cacheBytes: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
    const history = this.history.snapshot();
    const modelBytes = this.model.estimatedBytes();
    const overhead = (resources.listeners + resources.cacheEntries) * 256 + 1024;
    const cacheRequests = resources.cacheHits + resources.cacheMisses;
    return {
      sessionState: this.state,
      mode: this.mode,
      activeObjects: this.model.objects.length,
      selectedObjects: this.model.selected.size,
      canvases: resources.canvases,
      canvasBytes: resources.canvasBytes,
      canvasLabels: { ...resources.canvasLabels },
      listeners: resources.listeners,
      cacheEntries: resources.cacheEntries,
      cacheBytes: resources.cacheBytes,
      cacheHits: resources.cacheHits,
      cacheMisses: resources.cacheMisses,
      cacheHitRate: cacheRequests ? resources.cacheHits / cacheRequests : 0,
      historyEntries: history.entries,
      undoEntries: history.undoEntries,
      redoEntries: history.redoEntries,
      historyBytes: history.bytes,
      modelBytes,
      memoryEstimateBytes: resources.canvasBytes + modelBytes + history.bytes + overhead,
      elapsedMs: this.elapsedMs(),
      lastOperationMs: this.lastOperationMs,
      lastOperationName: this.lastOperationName,
      errorCount: this.errors.entries.length,
      recoverySuggestion: this.recoverySuggestion,
    };
  }

  close() {
    if (this.state === "closed") return this.lastCloseReport;
    const before = this.memorySnapshot();
    this.model.clearSelection();
    this.accumulatedMs += Math.max(0, this.now() - this.openedAt);
    const released = this.resources.dispose();
    this.state = "closed";
    this.recoverySuggestion =
      "画布、监听器与预览缓存已释放；对象与增量撤销状态保留，可重新打开继续。";
    const after = this.memorySnapshot();
    this.lastCloseReport = { before, after, released };
    return this.lastCloseReport;
  }
}
