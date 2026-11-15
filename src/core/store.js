import { createProject } from './model.js';
import {
  cloneProject,
  createExportEnvelope,
  normalizeProject,
  projectHash,
  toPrettyJSON,
} from './serialize.js';
import { validateEnvelope, validateProject } from './validate.js';
import { clampTime } from './engine.js';

const STORAGE_KEY = 'editor-project-v1';
const MAX_HISTORY = 50;

export class EditorStore {
  constructor(project, storage = globalThis.localStorage) {
    this.project = project || createProject();
    this.storage = storage || null;
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.lastError = null;
    this.lastImport = null;
    this.preExportSnapshot = null;
    this.pushHistory();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(reason = 'change') {
    this.project.updatedAt = new Date().toISOString();
    this.persist();
    for (const listener of this.listeners) listener(reason, this.project);
  }

  pushHistory() {
    this.undoStack.push(cloneProject(this.project));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  mutate(mutator, reason = 'change') {
    this.pushHistory();
    mutator(this.project);
    this.project.selection.currentTime = clampTime(this.project, this.project.selection.currentTime);
    this.notify(reason);
  }

  undo() {
    if (this.undoStack.length <= 1) return false;
    this.redoStack.push(this.undoStack.pop());
    this.project = cloneProject(this.undoStack[this.undoStack.length - 1]);
    this.notify('undo');
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const next = this.redoStack.pop();
    this.undoStack.push(cloneProject(next));
    this.project = cloneProject(next);
    this.notify('redo');
    return true;
  }

  selectLayer(layerId) {
    this.mutate((project) => {
      project.selection.layerId = layerId;
    }, 'select');
  }

  setCurrentTime(time) {
    this.mutate((project) => {
      project.selection.currentTime = clampTime(project, time);
    }, 'time');
  }

  addLayer(layer) {
    let created = null;
    this.mutate((project) => {
      created = layer;
      project.layers.push(layer);
      project.selection.layerId = layer.id;
    }, 'add-layer');
    return created;
  }

  updateLayer(layerId, patch) {
    this.mutate((project) => {
      const layer = project.layers.find((item) => item.id === layerId);
      if (layer) Object.assign(layer, patch);
    }, 'update-layer');
  }

  addKeyframe(layerId, keyframe) {
    this.mutate((project) => {
      const layer = project.layers.find((item) => item.id === layerId);
      if (!layer) return;
      layer.keyframes = layer.keyframes
        .filter((item) => item.time !== keyframe.time)
        .concat(keyframe)
        .sort((a, b) => a.time - b.time);
    }, 'add-keyframe');
  }

  addAsset(asset) {
    this.mutate((project) => {
      if (!project.assets.some((item) => item.id === asset.id)) project.assets.push(asset);
    }, 'add-asset');
  }

  exportProject() {
    this.preExportSnapshot = cloneProject(this.project);
    this.persist();
    const envelope = createExportEnvelope(this.project);
    return { envelope, json: toPrettyJSON(envelope) };
  }

  importJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      this.lastError = { code: 'json-parse', path: '$', message: `JSON 解析失败: ${error.message}` };
      this.lastImport = { ok: false, at: new Date().toISOString(), errors: [this.lastError] };
      return { ok: false, errors: [this.lastError] };
    }
    const isEnvelope = parsed && typeof parsed === 'object' && parsed.format === 'editor-project';
    const candidate = isEnvelope ? parsed.project : parsed;
    const result = isEnvelope ? validateEnvelope(parsed) : validateProject(parsed);
    if (!result.valid) {
      this.lastError = result.errors[0];
      this.lastImport = { ok: false, at: new Date().toISOString(), errors: result.errors };
      return { ok: false, errors: result.errors };
    }
    this.pushHistory();
    this.project = normalizeProject(candidate);
    this.project.selection.currentTime = clampTime(this.project, this.project.selection.currentTime);
    this.lastError = null;
    this.lastImport = { ok: true, at: new Date().toISOString(), errors: [] };
    this.persist();
    for (const listener of this.listeners) listener('import', this.project);
    return { ok: true, errors: [] };
  }

  async currentHash() {
    return projectHash(this.project);
  }

  persist() {
    if (!this.storage) return;
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.project));
  }

  static load(storage = globalThis.localStorage) {
    if (!storage) return new EditorStore(null, storage);
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new EditorStore(null, storage);
    try {
      const parsed = JSON.parse(raw);
      const result = validateProject(parsed);
      if (!result.valid) return new EditorStore(null, storage);
      return new EditorStore(normalizeProject(parsed), storage);
    } catch {
      return new EditorStore(null, storage);
    }
  }
}

export { STORAGE_KEY };
