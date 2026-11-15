// Persistence layer. Uses localStorage in the browser and falls back to
// an in-memory map otherwise (tests inject their own storage). Load
// failures never wipe existing data: they surface an error instead.

const KEY = "subtitle-scene:v1";

export function createStore(storage) {
  const backend =
    storage ||
    (typeof localStorage !== "undefined" ? localStorage : new MapStorage());
  return {
    load() {
      const raw = backend.getItem(KEY);
      if (raw == null) return null;
      return JSON.parse(raw);
    },
    save(value) {
      backend.setItem(KEY, JSON.stringify(value));
    },
    key: KEY,
  };
}

export class MapStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}
