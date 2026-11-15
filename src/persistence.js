// 参数与场景的可复现保存/载入；载入后重算并核对布局哈希。

import { stableStringify, hashValue } from "./hash.js";
import { generateLayout, rebuildIndices, recomputeRoute, recomputeHashes } from "./layout.js";

export function serializeState(layout) {
  const state = {
    version: layout.version,
    seed: layout.seed,
    params: layout.params,
    obstacles: layout.obstacles.map((o) => ({
      id: o.id,
      kind: o.kind,
      x: o.x,
      y: o.y,
      r: o.r,
    })),
    buoys: layout.buoys.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
    })),
    layoutHash: layout.layoutHash,
    chunkHashes: layout.chunkHashes,
  };
  return stableStringify(state);
}

// 从保存数据重建场景：先生成基底，再恢复障碍与浮标，最后核对哈希。
export function deserializeState(text) {
  const state = JSON.parse(text);
  const layout = generateLayout(state.seed, state.params);
  layout.obstacles = (state.obstacles || []).map((o) => ({
    ...o,
    rx: o.r,
    ry: o.r,
    polygon: squarePolygon(o.x, o.y, o.r),
  }));
  for (const saved of state.buoys || []) {
    const buoy = layout.buoysById[saved.id];
    if (buoy) {
      buoy.x = saved.x;
      buoy.y = saved.y;
      const gx = Math.floor(saved.x / 16);
      const gy = Math.floor(saved.y / 16);
      buoy.cell = { gx, gy };
    }
  }
  rebuildIndices(layout);
  recomputeRoute(layout);
  recomputeHashes(layout);
  return {
    layout,
    hashMatched: layout.layoutHash === state.layoutHash,
    savedHash: state.layoutHash,
    recomputedHash: layout.layoutHash,
  };
}

function squarePolygon(cx, cy, half) {
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

export function stateFingerprint(stateOrText) {
  const text = typeof stateOrText === "string" ? stateOrText : stableStringify(stateOrText);
  return hashValue(JSON.parse(text));
}
