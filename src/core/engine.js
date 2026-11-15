import { clone, collectSubtreeIds, findNode, findParent, hashValue } from "./model.js";
import { DependencyCache } from "./cache.js";

const DEFAULT_FONT = Object.freeze({
  family: "Inter, ui-sans-serif, system-ui, sans-serif",
  size: 16,
  weight: 400,
  color: "#172033",
  align: "left",
  lineHeight: 1.35,
});

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function resolveLength(value, basis) {
  if (typeof value === "number") return value;
  return (basis * Number.parseFloat(value)) / 100;
}

function layoutFields(node) {
  return {
    type: node.type,
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width,
    height: node.height,
    font: node.font ?? null,
    visible: node.visible !== false,
  };
}

function paintFields(node) {
  return {
    type: node.type,
    text: node.text ?? "",
    fill: node.fill ?? null,
    stroke: node.stroke ?? null,
    strokeWidth: node.strokeWidth ?? 1,
    radius: node.radius ?? 0,
    opacity: node.opacity ?? 1,
  };
}

function mergeFont(parentFont, nodeFont = {}) {
  return {
    family: nodeFont.family ?? parentFont.family,
    size: nodeFont.size ?? parentFont.size,
    weight: nodeFont.weight ?? parentFont.weight,
    color: nodeFont.color ?? parentFont.color,
    align: nodeFont.align ?? parentFont.align,
    lineHeight: nodeFont.lineHeight ?? parentFont.lineHeight,
  };
}

function makeLayout(node, x, y, width, height, font, hidden, depth) {
  return {
    id: node.id,
    type: node.type,
    x,
    y,
    width,
    height,
    font,
    hidden,
    depth,
  };
}

function makeCommands(node, layout) {
  if (layout.hidden || layout.width <= 0 || layout.height <= 0) return [];
  const opacity = node.opacity ?? 1;
  if (node.type === "text") {
    return [{
      kind: "text",
      id: node.id,
      x: layout.x,
      y: layout.y + layout.font.size,
      width: layout.width,
      height: layout.height,
      text: node.text ?? "",
      font: layout.font,
      fill: node.fill ?? layout.font.color,
      opacity,
      align: layout.font.align,
    }];
  }
  return [{
    kind: "rect",
    id: node.id,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    fill: node.fill ?? "transparent",
    stroke: node.stroke ?? null,
    strokeWidth: node.strokeWidth ?? 1,
    radius: node.radius ?? 0,
    opacity,
  }];
}

export class CacheEngine {
  constructor({ mode = "fixed", maxEntries = 1000, clock = now } = {}) {
    this.mode = mode;
    this.clock = clock;
    this.layoutCache = new DependencyCache("layout", { maxEntries });
    this.renderCache = new DependencyCache("render", { maxEntries });
    this.invalidatedEntries = 0;
    this.releasedNodeCount = 0;
  }

  setMode(mode) {
    if (mode !== "fixed" && mode !== "legacy") throw new Error(`Unknown cache mode: ${mode}`);
    this.mode = mode;
  }

  clear() {
    const layout = this.layoutCache.clear();
    const render = this.renderCache.clear();
    return layout + render;
  }

  resetStats() {
    this.layoutCache.resetStats();
    this.renderCache.resetStats();
    this.invalidatedEntries = 0;
    this.releasedNodeCount = 0;
  }

  ancestryKey(path) {
    return path.map((node) => ({ id: node.id, fields: layoutFields(node) }));
  }

  dependenciesFor(path, includeAncestry) {
    const ids = path.map((node) => node.id);
    return includeAncestry ? ids : [ids[ids.length - 1]];
  }

  layoutKey(node, path, viewport) {
    const key = {
      kind: "layout",
      node: layoutFields(node),
    };
    if (this.mode === "fixed") {
      key.ancestry = this.ancestryKey(path.slice(0, -1));
      key.viewport = { width: viewport.width, height: viewport.height };
    }
    return hashValue(key);
  }

  renderKey(node, layoutKeyValue) {
    const key = { kind: "render", paint: paintFields(node) };
    if (this.mode === "fixed") key.layout = layoutKeyValue;
    return hashValue(key);
  }

  render(scene, { viewport = { width: 960, height: 640 }, bypassCache = false } = {}) {
    const start = this.clock();
    const before = this.snapshotCacheStats();
    const commands = [];
    const layouts = new Map();
    let visited = 0;
    let visible = 0;
    const rootFont = mergeFont(DEFAULT_FONT);

    const visit = (node, parentLayout, path, inheritedFont, inheritedHidden, depth) => {
      visited += 1;
      const pathNodes = [...path, node];
      const basisWidth = parentLayout?.width ?? viewport.width;
      const basisHeight = parentLayout?.height ?? viewport.height;
      const x = (parentLayout?.x ?? 0) + resolveLength(node.x ?? 0, basisWidth);
      const y = (parentLayout?.y ?? 0) + resolveLength(node.y ?? 0, basisHeight);
      const width = resolveLength(node.width, basisWidth);
      const height = resolveLength(node.height, basisHeight);
      const font = mergeFont(inheritedFont, node.font);
      const hidden = this.mode === "fixed"
        ? inheritedHidden || node.visible === false
        : node.visible === false;
      const key = this.layoutKey(node, pathNodes, viewport);
      const deps = this.dependenciesFor(pathNodes, this.mode === "fixed");
      let layout;

      if (bypassCache) {
        layout = makeLayout(node, x, y, width, height, font, hidden, depth);
      } else {
        const cached = this.layoutCache.get(node.id, key);
        if (cached.hit) {
          layout = cached.value;
        } else {
          layout = makeLayout(node, x, y, width, height, font, hidden, depth);
          this.layoutCache.set(node.id, key, layout, deps);
        }
      }
      layouts.set(node.id, layout);

      if (hidden && this.mode === "fixed") return;

      let nodeCommands = [];
      if (!hidden) {
        const visualKey = this.renderKey(node, key);
        if (bypassCache) {
          nodeCommands = makeCommands(node, layout);
        } else {
          const cached = this.renderCache.get(node.id, visualKey);
          if (cached.hit) {
            nodeCommands = cached.value;
          } else {
            nodeCommands = makeCommands(node, layout);
            this.renderCache.set(node.id, visualKey, nodeCommands, deps);
          }
        }
      }
      if (nodeCommands.length > 0) {
        visible += 1;
        commands.push(...nodeCommands);
      }

      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) {
        visit(child, layout, pathNodes, layout.font, hidden, depth + 1);
      }
    };

    visit(scene.root, null, [], rootFont, false, 0);
    const after = this.snapshotCacheStats();
    const delta = {
      hits: after.hits - before.hits,
      misses: after.misses - before.misses,
      layoutHits: after.layoutHits - before.layoutHits,
      layoutMisses: after.layoutMisses - before.layoutMisses,
      renderHits: after.renderHits - before.renderHits,
      renderMisses: after.renderMisses - before.renderMisses,
    };
    const requests = delta.hits + delta.misses;
    return {
      commands,
      layouts,
      checksum: hashValue(commands),
      visited,
      visible,
      metrics: {
        mode: this.mode,
        elapsedMs: Math.max(0, this.clock() - start),
        hits: delta.hits,
        misses: delta.misses,
        hitRate: requests === 0 ? 0 : delta.hits / requests,
        recomputes: delta.misses,
        layoutHits: delta.layoutHits,
        layoutRecomputes: delta.layoutMisses,
        renderHits: delta.renderHits,
        renderRecomputes: delta.renderMisses,
        commands: commands.length,
        cacheBytes: after.bytes,
        cacheEntries: after.entries,
        dependencyEdges: after.dependencyEdges,
      },
    };
  }

  snapshotCacheStats() {
    const layout = this.layoutCache.snapshot();
    const render = this.renderCache.snapshot();
    return {
      hits: layout.hits + render.hits,
      misses: layout.misses + render.misses,
      layoutHits: layout.hits,
      layoutMisses: layout.misses,
      renderHits: render.hits,
      renderMisses: render.misses,
      bytes: layout.bytes + render.bytes,
      entries: layout.entries + render.entries,
      dependencyEdges: layout.dependencyEdges + render.dependencyEdges,
    };
  }

  resources() {
    const layout = this.layoutCache.snapshot();
    const render = this.renderCache.snapshot();
    return {
      cacheEntries: layout.entries + render.entries,
      cacheBytes: layout.bytes + render.bytes,
      dependencyEdges: layout.dependencyEdges + render.dependencyEdges,
      dependencyNodes: new Set([
        ...this.layoutCache.dependents.keys(),
        ...this.renderCache.dependents.keys(),
      ]).size,
      layoutEntries: layout.entries,
      renderEntries: render.entries,
      layoutBytes: layout.bytes,
      renderBytes: render.bytes,
      invalidatedEntries: this.invalidatedEntries,
      releasedNodes: this.releasedNodeCount,
    };
  }

  invalidateSubtree(rootNode) {
    const ids = this.mode === "fixed"
      ? collectSubtreeIds(rootNode)
      : [rootNode.id];
    const layoutReleased = this.layoutCache.release(ids);
    const renderReleased = this.renderCache.release(ids);
    const released = layoutReleased + renderReleased;
    this.invalidatedEntries += released;
    return {
      ids,
      layoutReleased,
      renderReleased,
      released,
      scope: this.mode === "fixed" ? "subtree" : "node",
    };
  }

  invalidateNodeId(root, id) {
    const node = findNode(root, id);
    if (!node) throw new Error(`Cannot invalidate missing node "${id}"`);
    return this.invalidateSubtree(node);
  }

  deleteNode(scene, id) {
    if (id === scene.root.id) throw new Error("The root node cannot be deleted");
    const node = findNode(scene.root, id);
    if (!node) throw new Error(`Cannot delete missing node "${id}"`);
    const parent = findParent(scene.root, id);
    const ids = collectSubtreeIds(node);
    parent.children = parent.children.filter((child) => child.id !== id);
    const layoutReleased = this.layoutCache.release(ids);
    const renderReleased = this.renderCache.release(ids);
    this.releasedNodeCount += ids.length;
    return {
      ids,
      layoutReleased,
      renderReleased,
      referencesRemaining: this.countReferences(ids),
    };
  }

  countReferences(ids) {
    const targets = new Set(ids);
    let references = 0;
    for (const cache of [this.layoutCache, this.renderCache]) {
      for (const id of cache.entries.keys()) {
        if (targets.has(id)) references += 1;
      }
      for (const [dependency, dependents] of cache.dependents) {
        if (targets.has(dependency)) references += dependents.size;
        for (const id of dependents) {
          if (targets.has(id)) references += 1;
        }
      }
    }
    return references;
  }
}

export function createCacheEngine(options) {
  return new CacheEngine(options);
}

export function exportScene(scene) {
  return JSON.stringify(clone(scene), null, 2);
}
