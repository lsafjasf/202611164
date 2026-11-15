export const MODULE_ADVICE = Object.freeze({
  image: "确认浏览器允许 Canvas 后重试，或先把颗粒调低。图层、文字与当前选择均已保留。",
  audio: "已停止并断开出错音频节点。检查设备连接或静音状态后重试；旧节点不会残留。",
  export: "请允许浏览器下载或改用另一种格式。导出前状态已保留，可恢复后重新导出。"
});

export class ResourceRegistry {
  constructor(label = "resource") {
    this.label = label;
    this.items = new Map();
  }

  add(id, dispose, metadata = {}) {
    if (this.items.has(id)) {
      throw new Error(`${this.label} 资源 ${id} 已存在，拒绝重复创建。`);
    }
    this.items.set(id, { dispose, metadata });
    return id;
  }

  has(id) {
    return this.items.has(id);
  }

  cleanup(id) {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    try {
      item.dispose?.();
    } catch {
      // Resource cleanup must never mask the original module failure.
    }
    return true;
  }

  cleanupAll() {
    const ids = [...this.items.keys()];
    for (const id of ids) this.cleanup(id);
    return ids;
  }

  get size() {
    return this.items.size;
  }
}

export class FaultInjector {
  constructor(onChange = () => {}) {
    this.armed = new Set();
    this.onChange = onChange;
  }

  arm(module) {
    this.armed.add(module);
    this.onChange(this.snapshot());
  }

  consume(module) {
    if (!this.armed.has(module)) return false;
    this.armed.delete(module);
    this.onChange(this.snapshot());
    return true;
  }

  clear() {
    this.armed.clear();
    this.onChange(this.snapshot());
  }

  snapshot() {
    return [...this.armed];
  }
}

function toStudioError(module, label, error, attempt) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  return {
    module,
    moduleLabel: label,
    name: error instanceof Error ? error.name : "ModuleError",
    message,
    advice: MODULE_ADVICE[module] || "请重试；其他模块内容不受影响。",
    at: new Date().toISOString(),
    details: error && typeof error === "object" && "context" in error ? error.context : null,
    attempt,
    retryable: true
  };
}

export class ModuleBoundary {
  constructor({ id, label, cleanup = () => {}, onChange = () => {}, now = () => new Date().toISOString() }) {
    this.id = id;
    this.label = label;
    this.cleanup = cleanup;
    this.onChange = onChange;
    this.now = now;
    this.state = {
      status: "ready",
      error: null,
      attempts: 0,
      retries: 0,
      recovered: false,
      recoveredAt: null,
      lastSuccessAt: null,
      lastFailureAt: null
    };
  }

  get isFailed() {
    return this.state.status === "error";
  }

  emit() {
    this.onChange(this.snapshot(), this);
  }

  snapshot() {
    return {
      id: this.id,
      label: this.label,
      ...this.state,
      error: this.state.error ? { ...this.state.error } : null
    };
  }

  safeCleanup() {
    try {
      this.cleanup();
    } catch {
      // Keep the original boundary error visible.
    }
  }

  async run(action, options = {}) {
    const retry = options.retry === true;
    this.state.attempts += 1;
    if (retry) {
      this.state.retries += 1;
      this.state.status = "recovering";
      this.safeCleanup();
      this.emit();
    }

    try {
      const value = await action({ retry, attempt: this.state.attempts });
      this.state.status = "ready";
      this.state.error = null;
      this.state.lastSuccessAt = this.now();
      if (retry) {
        this.state.recovered = true;
        this.state.recoveredAt = this.state.lastSuccessAt;
      }
      this.emit();
      return { ok: true, value, boundary: this.snapshot() };
    } catch (cause) {
      this.safeCleanup();
      const error = toStudioError(this.id, this.label, cause, this.state.attempts);
      error.at = this.now();
      this.state.status = "error";
      this.state.error = error;
      this.state.lastFailureAt = error.at;
      this.emit();
      return { ok: false, error, boundary: this.snapshot() };
    }
  }

  reportError(cause) {
    this.safeCleanup();
    const error = toStudioError(this.id, this.label, cause, this.state.attempts + 1);
    error.at = this.now();
    this.state.status = "error";
    this.state.error = error;
    this.state.lastFailureAt = error.at;
    this.emit();
    return error;
  }

  resetRecovery() {
    this.state.recovered = false;
    this.state.recoveredAt = null;
    this.emit();
  }

  reset() {
    this.state = {
      status: "ready",
      error: null,
      attempts: 0,
      retries: 0,
      recovered: false,
      recoveredAt: null,
      lastSuccessAt: null,
      lastFailureAt: null
    };
    this.emit();
  }
}

export function createBoundaries({ cleanup, onChange }) {
  return {
    image: new ModuleBoundary({ id: "image", label: "图像处理", cleanup: cleanup.image, onChange }),
    audio: new ModuleBoundary({ id: "audio", label: "音频合成", cleanup: cleanup.audio, onChange }),
    export: new ModuleBoundary({ id: "export", label: "导出", cleanup: cleanup.export, onChange })
  };
}
