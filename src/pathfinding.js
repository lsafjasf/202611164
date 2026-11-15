// Deterministic 4-connected grid pathfinding (A* with Manhattan heuristic).

export function euclidean(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

class MinHeap {
  constructor() {
    this.items = [];
    this.counter = 0;
  }

  push(priority, cell) {
    const node = { priority, seq: this.counter++, cell };
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(items[i], items[parent])) {
        [items[i], items[parent]] = [items[parent], items[i]];
        i = parent;
      } else break;
    }
  }

  less(a, b) {
    return a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq);
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && this.less(items[left], items[smallest])) smallest = left;
        if (right < items.length && this.less(items[right], items[smallest])) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest], items[i]];
        i = smallest;
      }
    }
    return top.cell;
  }

  get size() {
    return this.items.length;
  }
}

export function findPath(terrain, start, goal) {
  const { width, height, water } = terrain;
  if (start.x === goal.x && start.y === goal.y) return [start];
  const startIdx = start.y * width + start.x;
  const goalIdx = goal.y * width + goal.x;
  if (water[startIdx] || water[goalIdx]) return null;

  const gScore = new Float64Array(width * height).fill(Infinity);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const heap = new MinHeap();
  gScore[startIdx] = 0;
  heap.push(manhattan(start.x, start.y, goal.x, goal.y), startIdx);

  while (heap.size) {
    const current = heap.pop();
    if (current === goalIdx) return reconstruct(cameFrom, current, width);
    if (closed[current]) continue;
    closed[current] = 1;
    const cx = current % width;
    const cy = (current - cx) / width;
    const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (water[ni] || closed[ni]) continue;
      const tentative = gScore[current] + 1;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        cameFrom[ni] = current;
        heap.push(tentative + manhattan(nx, ny, goal.x, goal.y), ni);
      }
    }
  }
  return null;
}

function reconstruct(cameFrom, endIdx, width) {
  const path = [];
  let cur = endIdx;
  while (cur !== -1) {
    path.push({ x: cur % width, y: (cur - (cur % width)) / width });
    cur = cameFrom[cur];
  }
  path.reverse();
  return path;
}

export function reachable(terrain, start, goal) {
  return findPath(terrain, start, goal) !== null;
}
