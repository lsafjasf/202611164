const STORAGE_KEY = 'poster-editor/state/v1';
const SNAPSHOT_KEY = 'poster-editor/pre-export-snapshot/v1';

export function defaultState() {
  return {
    version: 1,
    lang: 'zh',
    shapes: [],
    selectedId: null,
    nextId: 1,
    exports: [],
    updatedAt: null
  };
}

export class Store {
  constructor(emitter) {
    this.emitter = emitter;
    this.state = defaultState();
    this.undoStack = [];
    this.redoStack = [];
    this.storageOk = true;
    this.forceFailure = false;
    this.lastError = null;
  }

  clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  load() {
    const raw = this.readStorage(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.shapes)) {
          this.state = { ...defaultState(), ...parsed };
          this.emitter.emit('status', { key: 'statusRecovered' });
          return true;
        }
      } catch (err) {
        this.lastError = err;
      }
    }
    return false;
  }

  readStorage(key) {
    if (this.forceFailure) return null;
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      this.storageOk = false;
      this.lastError = err;
      this.emitter.emit('status', { key: 'statusStorageError' });
      return null;
    }
  }

  persist() {
    if (this.forceFailure) {
      this.storageOk = false;
      this.emitter.emit('status', { key: 'statusStorageError' });
      return false;
    }
    try {
      this.state.updatedAt = new Date().toISOString();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.storageOk = true;
      return true;
    } catch (err) {
      this.storageOk = false;
      this.lastError = err;
      this.emitter.emit('status', { key: 'statusStorageError' });
      return false;
    }
  }

  snapshot() {
    return this.clone(this.state);
  }

  pushHistory() {
    this.undoStack.push(this.clone(this.state));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

 commit(mutator, status) {
    this.pushHistory();
    mutator(this.state);
    this.persist();
    this.emitter.emit('change', this.state);
    if (status) this.emitter.emit('status', status);
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.clone(this.state));
    this.state = this.undoStack.pop();
    this.persist();
    this.emitter.emit('change', this.state);
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.clone(this.state));
    this.state = this.redoStack.pop();
    this.persist();
    this.emitter.emit('change', this.state);
    return true;
  }

  setLang(lang) {
    if (lang === this.state.lang) return;
    this.commit((s) => {
      s.lang = lang;
    });
  }

  addShape(shape) {
    const id = `s${this.state.nextId++}`;
    const record = { id, ...shape };
    this.commit(
      (s) => {
        s.shapes.push(record);
        s.selectedId = id;
      },
      { key: 'statusAdded', params: { type: shape.typeLabelKey || shape.type } }
    );
    return record;
  }

  updateShape(id, patch, status) {
    this.commit((s) => {
      const target = s.shapes.find((sh) => sh.id === id);
      if (target) Object.assign(target, patch);
    }, status);
  }

  select(id) {
    if (this.state.selectedId === id) return;
    this.state.selectedId = id;
    this.persist();
    this.emitter.emit('change', this.state);
    this.emitter.emit('selection', id);
  }

  deleteSelected() {
    const id = this.state.selectedId;
    if (!id) return false;
    this.commit(
      (s) => {
        s.shapes = s.shapes.filter((sh) => sh.id !== id);
        s.selectedId = null;
      },
      { key: 'statusDeleted' }
    );
    return true;
  }

  moveSelected(dx, dy) {
    const id = this.state.selectedId;
    if (!id) return false;
    const target = this.state.shapes.find((sh) => sh.id === id);
    if (!target) return false;
    this.commit(
      (s) => {
        const sh = s.shapes.find((item) => item.id === id);
        sh.x = clamp(sh.x + dx, 0, 10000);
        sh.y = clamp(sh.y + dy, 0, 10000);
      },
      { key: 'statusMoved', params: { x: Math.round(target.x + dx), y: Math.round(target.y + dy) } }
    );
    return true;
  }

  savePreExportSnapshot() {
    try {
      window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(this.snapshot()));
      return true;
    } catch (err) {
      this.lastError = err;
      return false;
    }
  }

  recordExport(format) {
    this.commit((s) => {
      s.exports.push({ format, at: new Date().toISOString(), count: s.shapes.length });
    }, { key: 'statusExported', params: { format } });
  }

  recordExportFailure(reason) {
    this.emitter.emit('status', { key: 'statusExportFail', params: { reason } });
  }

  restorePreExportSnapshot() {
    const raw = this.readStorage(SNAPSHOT_KEY);
    if (!raw) return false;
    try {
      this.pushHistory();
      this.state = JSON.parse(raw);
      this.persist();
      this.emitter.emit('change', this.state);
      this.emitter.emit('status', { key: 'statusRestored' });
      return true;
    } catch (err) {
      this.lastError = err;
      return false;
    }
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
