import {
  EditorInputError,
  ErrorJournal,
  ResourceBroker,
  SceneModel,
  cloneShape,
  parseDocument,
  stableHash,
  utf8Bytes,
  validateShape,
} from "./core.js";

const EMPTY_DOCUMENT = { version: 1, width: 1200, height: 760, objects: [] };

function defaultCanvasFactory(width, height) {
  if (typeof document === "undefined") throw new Error("缺少 createCanvas");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class LegacyEditorSession {
  constructor({
    initialDocument = EMPTY_DOCUMENT,
    stageCanvas = null,
    createCanvas = defaultCanvasFactory,
    now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  } = {}) {
    this.model = new SceneModel(initialDocument);
    this.canvasFactory = createCanvas;
    this.stageCanvas = stageCanvas;
    this.now = now;
    this.errors = new ErrorJournal();
    this.state = "closed";
    this.mode = "full";
    this.accumulatedMs = 0;
    this.openedAt = 0;
    this.lastOperationMs = 0;
    this.lastOperationName = null;
    this.recoverySuggestion = "旧实现未提供恢复路径。";
    this.nextShapeId = 1;
    this.resourceBrokers = [];
    this.snapshotCanvases = [];
    this.undoDocuments = [];
    this.redoDocuments = [];
    this.lastCloseReport = null;
  }

  static open(options = {}) {
    return new LegacyEditorSession(options).open();
  }

  open() {
    if (this.state === "open") return this;
    const broker = new ResourceBroker({
      createCanvas: this.canvasFactory,
      maxCacheEntries: Number.MAX_SAFE_INTEGER,
      maxCacheBytes: Number.MAX_SAFE_INTEGER,
      now: this.now,
    });
    const width = this.model.width;
    const height = this.model.height;
    if (!this.stageCanvas) {
      this.stageCanvas = broker.createCanvas(width, height, "stage");
    } else {
      this.stageCanvas.width = width;
      this.stageCanvas.height = height;
      broker.registerCanvas(this.stageCanvas, { label: "stage" });
    }
    broker.createCanvas(width, height, "overlay");
    this.resourceBrokers.push(broker);
    this.state = "open";
    this.openedAt = this.now();
    this.lastCloseReport = null;
    return this;
  }

  bindInput(target, handlers) {
    const broker = this.resourceBrokers.at(-1);
    for (const [type, handler] of Object.entries(handlers)) {
      if (typeof handler === "function") broker.listen(target, type, handler, { passive: false });
    }
  }

  elapsedMs() {
    return this.accumulatedMs + (this.state === "open" ? this.now() - this.openedAt : 0);
  }

  setMode(mode) {
    this.mode = mode;
  }

  perform(operation, task) {
    const started = this.now();
    try {
      const result = task();
      this.lastOperationMs = this.now() - started;
      this.lastOperationName = operation;
      this.recoverySuggestion = "旧实现继续运行，但资源未回收。";
      return result;
    } catch (error) {
      this.lastOperationMs = this.now() - started;
      this.lastOperationName = operation;
      this.errors.record(error, operation);
      this.recoverySuggestion = "旧实现失败后没有可靠恢复保证。";
      throw error;
    }
  }

  takeSnapshot() {
    const serialized = this.model.serialized();
    this.undoDocuments.push(serialized);
    const canvas = this.resourceBrokers.at(-1).createCanvas(320, 200, "undo-snapshot");
    this.snapshotCanvases.push(canvas);
    this.redoDocuments = [];
  }

  addShape(input = {}) {
    return this.perform("addShape", () => {
      this.takeSnapshot();
      const shape = validateShape({
        id: input.id || `shape-${this.nextShapeId++}`,
        type: input.type || "rect",
        x: input.x ?? 80,
        y: input.y ?? 80,
        width: input.width ?? 160,
        height: input.height ?? 100,
        color: input.color || "#6ee7b7",
        ...(input.type === "text" ? { text: input.text || "文本" } : {}),
      });
      this.model.add(shape);
      this.model.select([shape.id]);
      return cloneShape(shape);
    });
  }

  updateObject(id, patch) {
    return this.perform("updateObject", () => {
      const current = this.model.find(id);
      if (!current) throw new EditorInputError("MISSING_SHAPE", `对象不存在: ${id}`);
      this.takeSnapshot();
      this.model.patch(id, { ...current, ...patch, id });
      return cloneShape(this.model.find(id));
    });
  }

  translateSelection(dx, dy) {
    return this.perform("translateSelection", () => {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        throw new EditorInputError("INVALID_MOVE", "位移必须是有限数字");
      }
      if (this.model.selected.size === 0) return [];
      this.takeSnapshot();
      for (const id of this.model.selected) {
        const current = this.model.find(id);
        this.model.patch(id, { x: current.x + dx, y: current.y + dy });
      }
      return [...this.model.selected];
    });
  }

  deleteSelected() {
    return this.perform("deleteSelected", () => {
      const ids = [...this.model.selected];
      if (ids.length === 0) return [];
      this.takeSnapshot();
      return this.model.remove(ids).map((item) => item.shape);
    });
  }

  undo() {
    return this.perform("undo", () => {
      const previous = this.undoDocuments.pop();
      if (!previous) return null;
      this.redoDocuments.push(this.model.serialized());
      this.model.replace(JSON.parse(previous));
      return previous;
    });
  }

  redo() {
    return this.perform("redo", () => {
      const next = this.redoDocuments.pop();
      if (!next) return null;
      this.undoDocuments.push(this.model.serialized());
      this.model.replace(JSON.parse(next));
      return next;
    });
  }

  importDocument(input) {
    return this.perform("import", () => {
      const value = typeof input === "string" ? JSON.parse(input) : input;
      if (!value || value.version !== 1 || !Array.isArray(value.objects)) {
        throw new EditorInputError("INVALID_DOCUMENT", "文档结构无效");
      }
      this.model.width = value.width;
      this.model.height = value.height;
      this.model.objects = [];
      for (const [index, item] of value.objects.entries()) {
        const shape = validateShape(item, index);
        this.model.add(shape);
      }
      this.model.clearSelection();
      this.undoDocuments = [];
      this.redoDocuments = [];
      return parseDocument(value);
    });
  }

  exportDocument() {
    return this.model.toDocument();
  }

  exportSignature() {
    return stableHash(this.model.serialized());
  }

  getPreview(shape) {
    const broker = this.resourceBrokers.at(-1);
    const key = `${shape.id}:${stableHash(shape)}`;
    const cached = broker.cacheGet(key);
    if (cached) return cached;
    const canvas = broker.createCanvas(96, 64, "preview");
    broker.cacheSet(key, canvas);
    return canvas;
  }

  memorySnapshot() {
    let canvases = 0;
    let canvasBytes = 0;
    let listeners = 0;
    let cacheEntries = 0;
    let cacheBytes = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    for (const broker of this.resourceBrokers) {
      const stats = broker.snapshot();
      canvases += stats.canvases;
      canvasBytes += stats.canvasBytes;
      listeners += stats.listeners;
      cacheEntries += stats.cacheEntries;
      cacheBytes += stats.cacheBytes;
      cacheHits += stats.cacheHits;
      cacheMisses += stats.cacheMisses;
    }
    const historyBytes =
      this.undoDocuments.reduce((sum, doc) => sum + utf8Bytes(doc), 0) +
      this.redoDocuments.reduce((sum, doc) => sum + utf8Bytes(doc), 0);
    const modelBytes = this.model.estimatedBytes();
    const cacheRequests = cacheHits + cacheMisses;
    return {
      sessionState: this.state,
      mode: this.mode,
      activeObjects: this.model.objects.length,
      selectedObjects: this.model.selected.size,
      canvases,
      canvasBytes,
      listeners,
      cacheEntries,
      cacheBytes,
      cacheHits,
      cacheMisses,
      cacheHitRate: cacheRequests ? cacheHits / cacheRequests : 0,
      historyEntries: this.undoDocuments.length + this.redoDocuments.length,
      undoEntries: this.undoDocuments.length,
      redoEntries: this.redoDocuments.length,
      historyBytes,
      modelBytes,
      memoryEstimateBytes: canvasBytes + modelBytes + historyBytes,
      elapsedMs: this.elapsedMs(),
      lastOperationMs: this.lastOperationMs,
      lastOperationName: this.lastOperationName,
      errorCount: this.errors.entries.length,
      recoverySuggestion: this.recoverySuggestion,
    };
  }

  close() {
    const before = this.memorySnapshot();
    this.accumulatedMs += this.state === "open" ? this.now() - this.openedAt : 0;
    this.state = "closed";
    this.recoverySuggestion = "旧实现已关闭界面，但画布、监听和快照仍未释放。";
    const after = this.memorySnapshot();
    this.lastCloseReport = { before, after, released: null };
    return this.lastCloseReport;
  }
}
