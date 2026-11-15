import { stableStringify } from "./model.js";

function byteLength(value) {
  return new TextEncoder().encode(stableStringify(value)).length;
}

export class DependencyCache {
  constructor(name, { maxEntries = 1000 } = {}) {
    this.name = name;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.dependents = new Map();
    this.tick = 0;
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0,
      evictions: 0,
      bytes: 0,
    };
  }

  get(id, key) {
    const entry = this.entries.get(id);
    if (!entry) {
      this.stats.misses += 1;
      return { hit: false, value: null, reason: "empty" };
    }
    if (entry.key !== key) {
      this.stats.misses += 1;
      this.remove(id);
      return { hit: false, value: null, reason: "key-changed" };
    }
    this.stats.hits += 1;
    this.tick += 1;
    entry.lastUsed = this.tick;
    return { hit: true, value: entry.value, reason: "hit" };
  }

  set(id, key, value, dependencies = []) {
    this.remove(id);
    this.tick += 1;
    const entry = {
      key,
      value,
      dependencies: new Set(dependencies),
      bytes: byteLength(value),
      lastUsed: this.tick,
    };
    this.entries.set(id, entry);
    this.stats.bytes += entry.bytes;
    for (const dependency of entry.dependencies) {
      if (!this.dependents.has(dependency)) this.dependents.set(dependency, new Set());
      this.dependents.get(dependency).add(id);
    }
    this.enforceLimit();
    return entry;
  }

  has(id) {
    return this.entries.has(id);
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.stats.bytes -= entry.bytes;
    for (const dependency of entry.dependencies) {
      const ids = this.dependents.get(dependency);
      if (!ids) continue;
      ids.delete(id);
      if (ids.size === 0) this.dependents.delete(dependency);
    }
    this.entries.delete(id);
    return true;
  }

  release(ids) {
    let released = 0;
    for (const id of ids) {
      if (this.remove(id)) released += 1;
    }
    this.stats.invalidations += released;
    return released;
  }

  clear() {
    const released = this.entries.size;
    this.entries.clear();
    this.dependents.clear();
    this.stats.bytes = 0;
    this.stats.invalidations += released;
    return released;
  }

  enforceLimit() {
    while (this.entries.size > this.maxEntries) {
      let oldestId = null;
      let oldestTick = Infinity;
      for (const [id, entry] of this.entries) {
        if (entry.lastUsed < oldestTick) {
          oldestTick = entry.lastUsed;
          oldestId = id;
        }
      }
      if (oldestId === null) break;
      this.remove(oldestId);
      this.stats.evictions += 1;
    }
  }

  snapshot() {
    return {
      name: this.name,
      entries: this.entries.size,
      bytes: this.stats.bytes,
      dependencyEdges: [...this.dependents.values()].reduce((sum, ids) => sum + ids.size, 0),
      dependencyNodes: this.dependents.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      invalidations: this.stats.invalidations,
      evictions: this.stats.evictions,
    };
  }

  resetStats() {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.invalidations = 0;
    this.stats.evictions = 0;
  }
}
