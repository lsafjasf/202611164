// 增量编辑：单对象修改只重建受影响区块，未受影响区块哈希保持不变。

import { GRID, DEFAULT_PARAMS } from "./config.js";
import {
  rebuildIndices,
  recomputeRoute,
  recomputeHashes,
  snapshotChunkHashes,
  changedChunks,
  placeBuoys,
  generateLayout,
} from "./layout.js";
import { cellOf, cellCenter, affectedChunks } from "./terrain.js";
import { pointInsideWorld, pointInPolygon, distance } from "./geometry.js";

function refresh(layout, beforeHashes) {
  rebuildIndices(layout);
  const route = recomputeRoute(layout);
  recomputeHashes(layout);
  return {
    changedChunks: changedChunks(beforeHashes, layout.chunkHashes),
    route,
  };
}

// 移动单个浮标到新位置；返回校验错误或受影响区块。
export function moveBuoy(layout, buoyId, x, y) {
  const buoy = layout.buoysById[buoyId];
  if (!buoy) return { ok: false, error: `浮标 ${buoyId} 不存在` };
  if (!pointInsideWorld({ x, y }, 4)) {
    return { ok: false, error: "目标位置超出场景边界" };
  }
  const cell = cellOf(x, y);
  if (layout.grid.blocked[cell.gy * GRID.cols + cell.gx]) {
    return { ok: false, error: "浮标不能放入岛屿、浅滩或障碍格" };
  }
  for (const other of layout.buoys) {
    if (other.id !== buoyId && distance(other, { x, y }) < 14) {
      return { ok: false, error: "与其他浮标距离过近（对象重叠）" };
    }
  }
  const before = snapshotChunkHashes(layout);
  const center = cellCenter(cell.gx, cell.gy);
  buoy.x = center.x;
  buoy.y = center.y;
  buoy.cell = { ...cell };
  const result = refresh(layout, before);
  return { ok: true, ...result, blockage: layout.blockage };
}

// 新增方形障碍（模拟新礁石/施工区），默认贴合一个导航格。
export function addObstacle(layout, x, y, half = 7.5) {
  if (!pointInsideWorld({ x, y }, half)) {
    return { ok: false, error: "障碍超出场景边界" };
  }
  const id = `obstacle-${layout.obstacles.length + 1}-${layout.seed}`;
  const shape = {
    id,
    kind: "obstacle",
    x,
    y,
    r: half,
    rx: half,
    ry: half,
    polygon: makeSquarePolygon(x, y, half),
  };
  if (centerInsideAny(shape, [...layout.islands, ...layout.shallows])) {
    return { ok: false, error: "障碍与岛屿或浅滩重叠" };
  }
  if (centerInsideAny(shape, layout.obstacles)) {
    return { ok: false, error: "障碍与已有障碍重叠" };
  }
  const before = snapshotChunkHashes(layout);
  layout.obstacles.push(shape);
  const result = refresh(layout, before);
  return {
    ok: true,
    id,
    ...result,
    reachable: layout.reachable,
    blockage: layout.blockage,
    affectedChunks: affectedChunks(shape),
  };
}

export function removeObstacle(layout, obstacleId) {
  const idx = layout.obstacles.findIndex((o) => o.id === obstacleId);
  if (idx === -1) return { ok: false, error: `障碍 ${obstacleId} 不存在` };
  const before = snapshotChunkHashes(layout);
  const [removed] = layout.obstacles.splice(idx, 1);
  const result = refresh(layout, before);
  return { ok: true, ...result, affectedChunks: affectedChunks(removed) };
}

function makeSquarePolygon(cx, cy, half) {
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

function centerInsideAny(shape, existing) {
  return existing.some((other) => pointInPolygon(other.polygon, shape.x, shape.y));
}

const TERRAIN_KEYS = [
  "islandSlots",
  "shallowSlots",
  "minIslandRadius",
  "maxIslandRadius",
  "minShallowRadius",
  "maxShallowRadius",
  "islandPoints",
  "margin",
];

// 参数调整：地形参数重算地形；浮标数量仅重排浮标；其它区块坐标与哈希不变。
export function updateParams(layout, newParams) {
  const before = snapshotChunkHashes(layout);
  const merged = { ...DEFAULT_PARAMS, ...layout.params, ...newParams };
  const terrainChanged = TERRAIN_KEYS.some(
    (k) => newParams[k] !== undefined && newParams[k] !== layout.params[k],
  );
  layout.params = merged;
  if (terrainChanged) return regenerateTerrainOnly(layout, before);
  if (newParams.buoyCount !== undefined) return relayoutBuoysOnly(layout, before);
  return { ok: true, changedChunks: [], route: recomputeRoute(layout) };
}

function regenerateTerrainOnly(layout, before) {
  const fresh = generateLayout(layout.seed, layout.params);
  layout.islands = fresh.islands;
  layout.shallows = fresh.shallows;
  layout.dredged = fresh.dredged;
  layout.dock = fresh.dock;
  layout.lighthouse = fresh.lighthouse;
  layout.obstacles = [];
  layout.buoys = fresh.buoys;
  const result = refresh(layout, before);
  return { ok: true, ...result, fullTerrain: true };
}

function relayoutBuoysOnly(layout, before) {
  layout.buoys = placeBuoys(layout.routeCells, layout.params.buoyCount);
  const result = refresh(layout, before);
  return { ok: true, ...result, buoysOnly: true };
}
