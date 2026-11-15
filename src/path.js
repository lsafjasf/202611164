import { keyOf, inBounds } from './model.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function isWalkable(city, x, y) {
  if (!inBounds(city.rules, x, y)) return false;
  const cell = city.cells.get(keyOf(x, y));
  return !!cell && (cell.type === 'road' || cell.type === 'target');
}

// BFS shortest path between two cells; returns coordinate list or null.
export function findPath(city, start, goal) {
  const startKey = keyOf(start.x, start.y);
  const goalKey = keyOf(goal.x, goal.y);
  if (!isWalkable(city, start.x, start.y) || !isWalkable(city, goal.x, goal.y)) return null;
  const prev = new Map([[startKey, null]]);
  const queue = [startKey];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goalKey) break;
    const [cx, cy] = cur.split(',').map(Number);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(city, nx, ny)) continue;
      const nk = keyOf(nx, ny);
      if (prev.has(nk)) continue;
      prev.set(nk, cur);
      queue.push(nk);
    }
  }
  if (!prev.has(goalKey)) return null;
  const path = [];
  let node = goalKey;
  while (node !== null) {
    const [x, y] = node.split(',').map(Number);
    path.push({ x, y });
    node = prev.get(node);
  }
  return path.reverse();
}

export function connectedComponents(city) {
  const seen = new Set();
  const components = [];
  for (const cell of city.cells.values()) {
    const k = keyOf(cell.x, cell.y);
    if (seen.has(k) || !isWalkable(city, cell.x, cell.y)) continue;
    const stack = [k];
    const component = [];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop();
      component.push(cur);
      const [x, y] = cur.split(',').map(Number);
      for (const [dx, dy] of DIRS) {
        if (!isWalkable(city, x + dx, y + dy)) continue;
        const nk = keyOf(x + dx, y + dy);
        if (seen.has(nk)) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    components.push(component);
  }
  return components;
}

// All pairwise target reachability, based on BFS components.
export function targetReachability(city) {
  const components = connectedComponents(city);
  const compOf = new Map();
  components.forEach((comp, i) => comp.forEach((k) => compOf.set(k, i)));
  const pairs = [];
  const targets = city.targets;
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      pairs.push({
        from: a.id,
        to: b.id,
        reachable: compOf.get(keyOf(a.x, a.y)) === compOf.get(keyOf(b.x, b.y)),
      });
    }
  }
  return { pairs, components, compOf };
}

// Diagnose which building cells actually separate target components.
export function findBlockingBuildings(city) {
  const { pairs, components, compOf } = targetReachability(city);
  const broken = pairs.filter((p) => !p.reachable);
  if (!broken.length) return { broken: [], blockers: [] };

  const targetComps = new Set(
    city.targets.map((t) => compOf.get(keyOf(t.x, t.y))).filter((v) => v !== undefined),
  );
  const blockers = [];
  for (const cell of city.cells.values()) {
    if (cell.type !== 'building') continue;
    const adjacentComps = new Set();
    for (const [dx, dy] of DIRS) {
      const nk = keyOf(cell.x + dx, cell.y + dy);
      if (compOf.has(nk)) adjacentComps.add(compOf.get(nk));
    }
    // A blocker touches >=2 different walkable components that hold targets.
    const relevant = [...adjacentComps].filter((c) =>
      components[c].some((k) => {
        const [x, y] = k.split(',').map(Number);
        return city.cells.get(k)?.type === 'target' || targetComps.has(c);
      }),
    );
    if (relevant.length >= 2) {
      blockers.push({ x: cell.x, y: cell.y, floors: cell.floors, between: relevant.slice().sort() });
    }
  }
  return { broken, blockers };
}

// Articulation walkable cells: blocking one separates two targets.
// Used by the UI to demonstrate the disconnect + blocker diagnosis flow.
export function findCriticalRoadCell(city) {
  const targets = city.targets;
  const walkable = [];
  for (const cell of city.cells.values()) {
    if (cell.type === 'road' || cell.type === 'target') walkable.push(cell);
  }
  const targetKeySet = new Set(targets.map((t) => keyOf(t.x, t.y)));
  for (const candidate of walkable) {
    if (candidate.type === 'target') continue;
    const ck = keyOf(candidate.x, candidate.y);
    let root = null;
    for (const t of targets) {
      const tk = keyOf(t.x, t.y);
      if (tk !== ck) {
        root = t;
        break;
      }
    }
    if (!root) continue;
    const seen = new Set([ck]);
    const stack = [keyOf(root.x, root.y)];
    seen.add(stack[0]);
    while (stack.length) {
      const cur = stack.pop();
      const [x, y] = cur.split(',').map(Number);
      for (const [dx, dy] of DIRS) {
        const nk = keyOf(x + dx, y + dy);
        if (seen.has(nk) || !isWalkable(city, x + dx, y + dy)) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    const reachesAll = targets.every((t) => seen.has(keyOf(t.x, t.y)));
    if (!reachesAll && targetKeySet.size >= 2) return { x: candidate.x, y: candidate.y };
  }
  return null;
}
