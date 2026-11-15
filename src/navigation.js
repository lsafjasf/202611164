// 4 连通网格寻路与可达性校验。

import { GRID, WORLD } from "./config.js";
import { isBlocked, cellOf, cellCenter } from "./terrain.js";

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function index(gx, gy) {
  return gy * GRID.cols + gx;
}

// BFS：返回可达标记数组与来源表。
export function floodFill(grid, start) {
  const seen = new Uint8Array(GRID.cols * GRID.rows);
  const cameFrom = new Int32Array(GRID.cols * GRID.rows).fill(-1);
  const queue = [start];
  seen[index(start.gx, start.gy)] = 1;
  while (queue.length) {
    const cur = queue.shift();
    for (const d of DIRS) {
      const nx = cur.gx + d.dx;
      const ny = cur.gy + d.dy;
      if (isBlocked(grid, nx, ny)) continue;
      const ni = index(nx, ny);
      if (seen[ni]) continue;
      seen[ni] = 1;
      cameFrom[ni] = index(cur.gx, cur.gy);
      queue.push({ gx: nx, gy: ny });
    }
  }
  return { seen, cameFrom };
}

export function isReachable(grid, fromCell, toCell) {
  if (isBlocked(grid, fromCell.gx, fromCell.gy) || isBlocked(grid, toCell.gx, toCell.gy)) {
    return false;
  }
  const { seen } = floodFill(grid, fromCell);
  return seen[index(toCell.gx, toCell.gy)] === 1;
}

// A*：返回格子路径（含起点终点），不可达返回 null。
export function findPath(grid, startCell, goalCell) {
  if (isBlocked(grid, startCell.gx, startCell.gy) || isBlocked(grid, goalCell.gx, goalCell.gy)) {
    return null;
  }
  const size = GRID.cols * GRID.rows;
  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const startIdx = index(startCell.gx, startCell.gy);
  const goalIdx = index(goalCell.gx, goalCell.gy);
  gScore[startIdx] = 0;
  const open = [startIdx];
  const heuristic = (i) => {
    const gx = i % GRID.cols;
    const gy = Math.floor(i / GRID.cols);
    return Math.abs(gx - goalCell.gx) + Math.abs(gy - goalCell.gy);
  };
  while (open.length) {
    let bestPos = 0;
    for (let i = 1; i < open.length; i++) {
      if (gScore[open[i]] + heuristic(open[i]) < gScore[open[bestPos]] + heuristic(open[bestPos])) {
        bestPos = i;
      }
    }
    const current = open.splice(bestPos, 1)[0];
    if (current === goalIdx) return reconstruct(cameFrom, current);
    closed[current] = 1;
    const cgx = current % GRID.cols;
    const cgy = Math.floor(current / GRID.cols);
    for (const d of DIRS) {
      const nx = cgx + d.dx;
      const ny = cgy + d.dy;
      if (isBlocked(grid, nx, ny)) continue;
      const ni = index(nx, ny);
      if (closed[ni]) continue;
      const tentative = gScore[current] + 1;
      if (tentative < gScore[ni]) {
        cameFrom[ni] = current;
        gScore[ni] = tentative;
        if (!open.includes(ni)) open.push(ni);
      }
    }
  }
  return null;
}

function reconstruct(cameFrom, current) {
  const cells = [];
  while (current !== -1) {
    cells.push({ gx: current % GRID.cols, gy: Math.floor(current / GRID.cols) });
    current = cameFrom[current];
  }
  cells.reverse();
  return cells;
}

export function pathToPoints(cells) {
  return cells.map((c) => cellCenter(c.gx, c.gy));
}

// 评定航点链：以码头为起点做一次 BFS，要求每个浮标按顺序都在可达域内。
// 浮标被移入封闭浅水区时会从可达域消失，由此给出首个断链浮标与阻断位置。
export function evaluateWaypoints(grid, waypointCells) {
  const start = waypointCells[0];
  const { seen } = floodFill(grid, start);
  let brokenAt = null;
  for (let i = 1; i < waypointCells.length; i++) {
    const cell = waypointCells[i];
    if (isBlocked(grid, cell.gx, cell.gy) || !seen[index(cell.gx, cell.gy)]) {
      brokenAt = {
        segment: i - 1,
        from: waypointCells[i - 1],
        to: cell,
        blockPoint: nearestBlockedCell(grid, waypointCells[i - 1], cell),
      };
      break;
    }
  }
  return {
    connected: brokenAt === null,
    segments: waypointCells.slice(1).map((to, i) => ({ from: waypointCells[i], to })),
    brokenAt,
  };
}

// 用 BFS 可达域边界找出最靠近目标的阻塞格，作为阻断位置。
export function nearestBlockedCell(grid, startCell, goalCell) {
  const { seen } = floodFill(grid, startCell);
  let best = null;
  let bestDist = Infinity;
  for (let gy = 0; gy < GRID.rows; gy++) {
    for (let gx = 0; gx < GRID.cols; gx++) {
      const i = index(gx, gy);
      if (seen[i]) continue;
      let frontier = false;
      for (const d of DIRS) {
        const nIdx = index(gx + d.dx, gy + d.dy);
        if (nIdx >= 0 && nIdx < seen.length && seen[nIdx]) frontier = true;
      }
      if (!frontier) continue;
      const dist = Math.abs(gx - goalCell.gx) + Math.abs(gy - goalCell.gy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { gx, gy };
      }
    }
  }
  return best ? cellCenter(best.gx, best.gy) : null;
}

// 疏浚：从离目标最近的可达格出发，贪心走向目标，清理阻挡格（仅作用于网格）。
export function dredgePath(grid, startCell, goalCell) {
  const { seen } = floodFill(grid, startCell);
  if (seen[index(goalCell.gx, goalCell.gy)]) return [];
  let cur = nearestReachableTowards(seen, goalCell);
  if (!cur) return [];
  const cleared = [];
  const guard = GRID.cols * GRID.rows * 2;
  let steps = 0;
  while (!(cur.gx === goalCell.gx && cur.gy === goalCell.gy) && steps++ < guard) {
    let next = null;
    for (const d of DIRS) {
      const candidate = { gx: cur.gx + d.dx, gy: cur.gy + d.dy };
      if (candidate.gx < 0 || candidate.gy < 0 || candidate.gx >= GRID.cols || candidate.gy >= GRID.rows) continue;
      if (!next || manhattan(candidate, goalCell) < manhattan(next, goalCell)) next = candidate;
    }
    if (!next) break;
    if (isBlocked(grid, next.gx, next.gy)) {
      cleared.push({ gx: next.gx, gy: next.gy });
      grid.blocked[index(next.gx, next.gy)] = 0;
      grid.owner[index(next.gx, next.gy)] = null;
    }
    cur = next;
  }
  return cleared;
}

function manhattan(a, b) {
  return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
}

function nearestReachableTowards(seen, goalCell) {
  let best = null;
  let bestDist = Infinity;
  for (let gy = 0; gy < GRID.rows; gy++) {
    for (let gx = 0; gx < GRID.cols; gx++) {
      if (!seen[index(gx, gy)]) continue;
      const dist = manhattan({ gx, gy }, goalCell);
      if (dist < bestDist) {
        bestDist = dist;
        best = { gx, gy };
      }
    }
  }
  return best;
}

export { cellOf, WORLD };
