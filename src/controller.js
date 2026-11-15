// DOM-free interaction controller for the subtitle scene.
// Keyboard, mouse and touch adapters all map to the same intents, so
// every input modality reaches the same functional state. The controller
// emits announcements (aria-live) and focus targets for the view layer.

export const DEFAULT_STATE = {
  items: [
    { id: "sub-1", text: "你好，世界！这是第一条字幕。" },
    { id: "sub-2", text: "Hello world, this is the second subtitle line." },
    { id: "sub-3", text: "混合 mixed 内容 content 测试 test" },
  ],
  style: { font: "sans-serif", fontSize: 24, width: 480, align: "left" },
  selectedIndex: 0,
  scrollTop: 0,
  exports: [],
};

const KEYS = {
  ArrowUp: "focus-prev",
  ArrowDown: "focus-next",
  Home: "focus-first",
  End: "focus-last",
  Enter: "export",
  e: "export",
  s: "cycle-align",
};

export class SubtitleController {
  constructor({ store, engine, announce, onFocus, onError } = {}) {
    this.store = store;
    this.engine = engine;
    this.announce = announce || (() => {});
    this.onFocus = onFocus || (() => {});
    this.onError = onError || (() => {});
    this.state = this._load();
  }

  _load() {
    let saved = null;
    try {
      saved = this.store ? this.store.load() : null;
    } catch (err) {
      this.onError(`读取存档失败，已使用默认状态: ${err.message}`);
    }
    if (!saved || saved.schema !== 1) {
      return structuredClone(DEFAULT_STATE);
    }
    // Merge over defaults so missing fields never silently reset choices.
    return {
      ...structuredClone(DEFAULT_STATE),
      ...saved.data,
      style: { ...DEFAULT_STATE.style, ...(saved.data.style || {}) },
      exports: Array.isArray(saved.data.exports) ? saved.data.exports : [],
    };
  }

  _persist() {
    try {
      if (this.store) this.store.save({ schema: 1, data: this.state });
    } catch (err) {
      this.onError(`保存失败（状态仍保留在内存中）: ${err.message}`);
    }
  }

  // ---- intents (shared by keyboard, mouse and touch) ----
  dispatch(intent, payload = {}) {
    const handlers = {
      "focus-prev": () => this._move(-1),
      "focus-next": () => this._move(1),
      "focus-first": () => this._focus(0),
      "focus-last": () => this._focus(this.state.items.length - 1),
      "focus-index": () => this._focus(payload.index),
      "set-style": () => this._setStyle(payload.patch),
      "cycle-align": () => this._cycleAlign(),
      "edit-item": () => this._editItem(payload.index, payload.text),
      scroll: () => this._scroll(payload.scrollTop),
      export: () => this._export(),
    };
    const handler = handlers[intent];
    if (!handler) {
      this.onError(`未知操作: ${intent}`);
      return false;
    }
    handler();
    return true;
  }

  // Keyboard adapter: maps keys to the same intents as pointer input.
  handleKey(key) {
    const intent = KEYS[key];
    if (!intent) return false;
    return this.dispatch(intent);
  }

  // Mouse adapter.
  handleClick(target, payload = {}) {
    if (target === "item") return this.dispatch("focus-index", payload);
    if (target === "export") return this.dispatch("export");
    if (target === "align") return this.dispatch("cycle-align");
    return false;
  }

  // Touch adapter: taps and swipes map to the same intents.
  handleTouch(gesture, payload = {}) {
    if (gesture === "tap") return this.handleClick(payload.target, payload);
    if (gesture === "swipe-up") return this.dispatch("focus-next");
    if (gesture === "swipe-down") return this.dispatch("focus-prev");
    if (gesture === "long-press") return this.dispatch("export");
    return false;
  }

  _focus(index) {
    const max = this.state.items.length - 1;
    const clamped = Math.max(0, Math.min(max, index));
    this.state.selectedIndex = clamped;
    const item = this.state.items[clamped];
    this.onFocus(clamped);
    this.announce(`已选中第 ${clamped + 1} 条字幕，共 ${max + 1} 条: ${item.text}`);
    this._persist();
  }

  _move(delta) {
    this._focus(this.state.selectedIndex + delta);
  }

  _setStyle(patch) {
    const next = { ...this.state.style, ...patch };
    if (!(next.fontSize > 0) || !(next.width > 0)) {
      this.onError("样式无效：字号与宽度必须为正数，已保留原样式");
      return;
    }
    if (!["left", "center", "right"].includes(next.align)) {
      this.onError(`对齐方式无效: ${next.align}，已保留原样式`);
      return;
    }
    this.state.style = next;
    this.engine.invalidateStyles();
    this.announce(
      `样式已更新：字号 ${next.fontSize}，宽度 ${next.width}，对齐 ${next.align}`
    );
    this._persist();
  }

  _cycleAlign() {
    const order = ["left", "center", "right"];
    const next = order[(order.indexOf(this.state.style.align) + 1) % order.length];
    this._setStyle({ align: next });
  }

  _editItem(index, text) {
    if (index < 0 || index >= this.state.items.length) {
      this.onError(`编辑失败：字幕序号 ${index} 不存在`);
      return;
    }
    if (typeof text !== "string" || text.trim() === "") {
      this.onError("编辑失败：字幕文本不能为空");
      return;
    }
    this.state.items[index] = { ...this.state.items[index], text };
    this.announce(`第 ${index + 1} 条字幕已更新`);
    this._persist();
  }

  _scroll(scrollTop) {
    this.state.scrollTop = Math.max(0, scrollTop);
    this._persist();
  }

  // Export keeps a pre-export snapshot so state before export is preserved.
  _export() {
    const snapshot = structuredClone(this.state);
    const record = {
      id: `export-${this.state.exports.length + 1}`,
      at: new Date().toISOString(),
      items: structuredClone(this.state.items),
      style: { ...this.state.style },
      preExportState: snapshot,
    };
    this.state.exports.push(record);
    this.announce(`已导出工程 ${record.id}，共 ${record.items.length} 条字幕`);
    this._persist();
    return record;
  }
}
