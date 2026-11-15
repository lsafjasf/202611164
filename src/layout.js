// 场景布局：固定 seed 生成、疏浚保通、浮标布置、分层哈希与增量重算。

import {
  WORLD,
  GRID,
  DEFAULT_PARAMS,
  RULE_VERSION,
  MAX_DREDGE_PASSES,
} from "./config.js";
import { hashValue, toHex, combineHashes } from "./hash.js";
import {
  generateTerrain,
  makeChunks,
  buildGrid,
  cellCenter,
  findOpenCellNear,
  chunkHash,
} from "./terrain.js";
import { findPath, isReachable, dredgePath, pathToPoints, evaluateWaypoints } from "./navigation.js";

function placeEndpoints(grid) {
  const dockCell = findOpenCellNear(grid, 1, Math.floor(GRID.rows / 2));
  const lightCell = findOpenCellNear(grid, GRID.cols - 2, Math.floor(GRID.rows / 2));
  const dock = {
    id: "dock",
    kind: "dock",
    ...cellCenter(dockCell.gx, dockCell.gy),
    cell: dockCell,
  };
  const lighthouse = {
    id: "lighthouse",
    kind: "lighthouse",
    ...cellCenter(lightCell.gx, lightCell.gy),
    cell: lightCell,
  };
  return { dock, lighthouse };
}

export function placeBuoys(routeCells, count) {
  const buoys = [];
  if (routeCells.length < 3 || count <= 0) return buoys;
  const interior = routeCells.slice(1, -1);
  const span = interior.length / (count + 1);
  const used = new Set();
  for (let i = 1; i <= count; i++) {
    const cell = interior[Math.min(interior.length - 1, Math.round(span * i) - 1)];
    const key = `${cell.gx}-${cell.gy}`;
    if (!cell || used.has(key)) continue;
    used.add(key);
    const center = cellCenter(cell.gx, cell.gy);
    buoys.push({
      id: `buoy-${i - 1}`,
      kind: "buoy",
      x: center.x,
      y: center.y,
      cell: { ...cell },
      movable: true,
    });
  }
  return buoys;
}

export function generateLayout(seed, rawParams = {}) {
  const params = { ...DEFAULT_PARAMS, ...rawParams };
  const terrain = generateTerrain(seed, params);
  let grid = buildGrid([...terrain.islands, ...terrain.shallows], []);
  const { dock, lighthouse } = placeEndpoints(grid);

  const dredged = [];
  for (let pass = 0; pass < MAX_DREDGE_PASSES; pass++) {
    if (isReachable(grid, dock.cell, lighthouse.cell)) break;
    const cleared = dredgePath(grid, dock.cell, lighthouse.cell);
    if (!cleared.length) break;
    dredged.push(...cleared);
  }
  const routeCells = findPath(grid, dock.cell, lighthouse.cell) || [];
  const buoys = placeBuoys(routeCells, params.buoyCount);

  const layout = {
    version: RULE_VERSION,
    seed: String(seed),
    params,
    islands: terrain.islands,
    shallows: terrain.shallows,
    obstacles: [],
    buoys,
    dock,
    lighthouse,
    dredged,
    routeCells,
    routePoints: pathToPoints(routeCells),
    chunks: terrain.chunks,
    grid,
    reachable: routeCells.length > 0,
    blockage: null,
  };
  rebuildIndices(layout);
  recomputeRoute(layout);
  recomputeHashes(layout);
  return layout;
}

export function rebuildIndices(layout) {
  layout.shapesById = {};
  for (const s of [...layout.islands, ...layout.shallows]) layout.shapesById[s.id] = s;
  layout.obstaclesById = {};
  for (const o of layout.obstacles) layout.obstaclesById[o.id] = o;
  layout.buoysById = {};
  for (const b of layout.buoys) layout.buoysById[b.id] = b;
  layout.grid = buildGrid([...layout.islands, ...layout.shallows], layout.obstacles, layout.dredged);
  layout.chunks = makeChunks([...layout.islands, ...layout.shallows], layout.obstacles);
}

export function recomputeRoute(layout) {
  const waypointCells = [
    layout.dock.cell,
    ...layout.buoys.map((b) => b.cell),
    layout.lighthouse.cell,
  ];
  const result = evaluateWaypoints(layout.grid, waypointCells);
  const direct = findPath(layout.grid, layout.dock.cell, layout.lighthouse.cell);
  layout.routeCells = direct || [];
  layout.routePoints = pathToPoints(layout.routeCells);
  layout.reachable = direct !== null;
  layout.waypointOk = result.connected;
  layout.blockage = result.brokenAt;
  return result;
}

export function recomputeHashes(layout) {
  const chunkHashes = {};
  const parts = [];
  for (const key of Object.keys(layout.chunks).sort()) {
    const h = chunkHash(layout, key);
    chunkHashes[key] = toHex(h);
    parts.push(h);
  }
  layout.chunkHashes = chunkHashes;
  layout.objectHashes = {};
  for (const s of [...layout.islands, ...layout.shallows, ...layout.obstacles]) {
    layout.objectHashes[s.id] = toHex(hashValue(stripRuntime(s)));
  }
  for (const b of layout.buoys) {
    layout.objectHashes[b.id] = toHex(hashValue(stripRuntime(b)));
  }
  layout.objectHashes[layout.dock.id] = toHex(hashValue(stripRuntime(layout.dock)));
  layout.objectHashes[layout.lighthouse.id] = toHex(hashValue(stripRuntime(layout.lighthouse)));
  layout.layoutHash = toHex(
    combineHashes([
      hashValue({ seed: layout.seed, params: layout.params, version: layout.version }),
      ...parts,
      hashValue(layout.dredged),
      hashValue(layout.buoys.map(stripRuntime)),
      hashValue([stripRuntime(layout.dock), stripRuntime(layout.lighthouse)]),
    ]),
  );
}

function stripRuntime(obj) {
  const { cell, movable, polygon, ...rest } = obj;
  const out = { ...rest };
  if (polygon) out.polygon = polygon.map((p) => ({ x: round(p.x), y: round(p.y) }));
  out.x = round(out.x);
  out.y = round(out.y);
  return out;
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

export function snapshotChunkHashes(layout) {
  return { ...layout.chunkHashes };
}

export function snapshotObjectHashes(layout) {
  return { ...layout.objectHashes };
}

export function changedChunks(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => before[k] !== after[k]);
}
