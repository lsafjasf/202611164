// 确定性地形生成：固定槽位 → 归属区块 → 栅格化导航网格。

import { WORLD, GRID, CHUNK, DEFAULT_PARAMS, MAX_PLACE_TRIES } from "./config.js";
import { makeRng } from "./rng.js";
import { hashValue, toHex } from "./hash.js";
import {
  ellipsePoints,
  pointInPolygon,
  overlapsAny,
  insideWorld,
  pointInsideWorld,
  clamp,
} from "./geometry.js";

export function chunkAt(x, y) {
  const cx = clamp(Math.floor(x / CHUNK.width), 0, WORLD.chunkCols - 1);
  const cy = clamp(Math.floor(y / CHUNK.height), 0, WORLD.chunkRows - 1);
  return { cx, cy, key: `${cx}-${cy}` };
}

export function affectedChunks(shape) {
  const keys = new Set();
  const r = shape.r || Math.max(shape.rx || 0, shape.ry || 0);
  const pts = shape.polygon || [
    { x: shape.x - r, y: shape.y - r },
    { x: shape.x + r, y: shape.y + r },
    { x: shape.x - r, y: shape.y + r },
    { x: shape.x + r, y: shape.y - r },
  ];
  for (const p of pts) keys.add(chunkAt(p.x, p.y).key);
  return [...keys];
}

function slotRng(seed, kind, index) {
  return makeRng(`${seed}|${kind}|${index}`);
}

function placeSlots(seed, kind, count, params, existing) {
  const placed = [];
  for (let i = 0; i < count; i++) {
    const rng = slotRng(seed, kind, i);
    const isIsland = kind === "island";
    const minR = isIsland ? params.minIslandRadius : params.minShallowRadius;
    const maxR = isIsland ? params.maxIslandRadius : params.maxShallowRadius;
    const radius = rng.range(minR, maxR);
    let candidate = null;
    for (let tryIndex = 0; tryIndex < MAX_PLACE_TRIES; tryIndex++) {
      const x = rng.range(params.margin + radius, WORLD.width - params.margin - radius);
      const y = rng.range(params.margin + radius, WORLD.height - params.margin - radius);
      const shape = isIsland
        ? {
            id: `${kind}-${i}`,
            kind,
            x,
            y,
            polygon: ellipsePoints(x, y, radius, radius * rng.range(0.6, 0.95), params.islandPoints, 0.18, rng),
          }
        : {
            id: `${kind}-${i}`,
            kind,
            x,
            y,
            rx: radius,
            ry: radius * rng.range(0.55, 1),
            polygon: ellipsePoints(x, y, radius, radius * rng.range(0.55, 1), 12, 0.1, rng),
          };
      if (!overlapsAny(shape, existing) && insideWorld(shape, 4)) {
        candidate = shape;
        break;
      }
    }
    if (candidate) {
      placed.push(candidate);
      existing.push(candidate);
    }
  }
  return placed;
}

// 生成完整地形（岛屿、浅滩），并按区块分组。
export function generateTerrain(seed, rawParams) {
  const params = { ...DEFAULT_PARAMS, ...rawParams };
  const occupied = [];
  const islands = placeSlots(seed, "island", params.islandSlots, params, occupied);
  const shallows = placeSlots(seed, "shallow", params.shallowSlots, params, occupied);
  const chunks = makeChunks([...islands, ...shallows], []);
  return { islands, shallows, chunks, params };
}

export function makeChunks(terrainShapes, obstacles) {
  const chunks = {};
  for (let cy = 0; cy < WORLD.chunkRows; cy++) {
    for (let cx = 0; cx < WORLD.chunkCols; cx++) {
      chunks[`${cx}-${cy}`] = {
        key: `${cx}-${cy}`,
        terrain: [],
        obstacles: [],
      };
    }
  }
  for (const shape of terrainShapes) chunks[chunkAt(shape.x, shape.y).key].terrain.push(shape.id);
  for (const ob of obstacles) chunks[chunkAt(ob.x, ob.y).key].obstacles.push(ob.id);
  return chunks;
}

// 栅格化：岛屿/浅滩/用户障碍均为不可通行格。
export function buildGrid(terrainShapes, obstacles, dredgedCells = []) {
  const blocked = new Uint8Array(GRID.cols * GRID.rows);
  const owner = new Array(GRID.cols * GRID.rows).fill(null);
  const shapes = [...terrainShapes, ...obstacles];
  for (const shape of shapes) {
    for (let gy = 0; gy < GRID.rows; gy++) {
      for (let gx = 0; gx < GRID.cols; gx++) {
        const px = gx * WORLD.cell + WORLD.cell / 2;
        const py = gy * WORLD.cell + WORLD.cell / 2;
        if (pointInPolygon(shape.polygon, px, py)) {
          const idx = gy * GRID.cols + gx;
          blocked[idx] = 1;
          owner[idx] = shape.id;
        }
      }
    }
  }
  for (const cell of dredgedCells) {
    const idx = cell.gy * GRID.cols + cell.gx;
    blocked[idx] = 0;
    owner[idx] = null;
  }
  return { blocked, owner };
}

export function cellOf(x, y) {
  return {
    gx: clamp(Math.floor(x / WORLD.cell), 0, GRID.cols - 1),
    gy: clamp(Math.floor(y / WORLD.cell), 0, GRID.rows - 1),
  };
}

export function cellCenter(gx, gy) {
  return { x: gx * WORLD.cell + WORLD.cell / 2, y: gy * WORLD.cell + WORLD.cell / 2 };
}

export function isBlocked(grid, gx, gy) {
  if (gx < 0 || gy < 0 || gx >= GRID.cols || gy >= GRID.rows) return true;
  return grid.blocked[gy * GRID.cols + gx] === 1;
}

export function chunkHash(layout, key) {
  const chunk = layout.chunks[key];
  const payload = {
    key,
    terrain: chunk.terrain.map((id) => layout.shapesById[id]),
    obstacles: chunk.obstacles.map((id) => layout.obstaclesById[id]),
    dredged: layout.dredged.filter((c) => {
      const p = cellCenter(c.gx, c.gy);
      return chunkAt(p.x, p.y).key === key;
    }),
  };
  return hashValue(payload);
}

export function chunkHashHex(layout, key) {
  return toHex(chunkHash(layout, key));
}

export function findOpenCellNear(grid, gx, gy) {
  if (!pointInsideWorld(cellCenter(gx, gy), 0)) return null;
  for (let radius = 0; radius < 8; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = gx + dx;
        const ny = gy + dy;
        if (!isBlocked(grid, nx, ny)) return { gx: nx, gy: ny };
      }
    }
  }
  return null;
}
