// Pure isometric geometry: no canvas/DOM access so Node tests can use it.
export function project(x, y, z, view) {
  const halfW = view.tileSize / 2;
  const halfH = view.tileSize / 4;
  return {
    x: (x - y) * halfW,
    y: (x + y) * halfH - z * view.floorHeight,
  };
}

export function diamondPoints(x, y, z, view) {
  return [
    project(x, y, z, view),
    project(x + 1, y, z, view),
    project(x + 1, y + 1, z, view),
    project(x, y + 1, z, view),
  ];
}

// Minimal axis-aligned screen bounds of every cell (including rooftops).
export function sceneBounds(city, view) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (p) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const cell of city.cells.values()) {
    const topZ = cell.type === 'building' ? cell.floors + roofRise(cell) : 0;
    for (const p of diamondPoints(cell.x, cell.y, 0, view)) consider(p);
    for (const p of diamondPoints(cell.x, cell.y, topZ, view)) consider(p);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function roofRise(cell) {
  if (cell.type !== 'building') return 0;
  if (cell.roof === 'gable' || cell.roof === 'pyramid' || cell.roof === 'hip') return 0.9;
  return 0.18;
}

// Painter order: back (small x+y) to front; same diagonal by x then height.
export function paintOrder(city) {
  return [...city.cells.values()].sort((a, b) => {
    const da = a.x + a.y;
    const db = b.x + b.y;
    if (da !== db) return da - db;
    if (a.x !== b.x) return a.x - b.x;
    return (a.floors || 0) - (b.floors || 0);
  });
}

function roofVertices(cell, view) {
  const { x, y, floors } = cell;
  const z = floors;
  const p = (dx, dy, dz) => project(x + dx, y + dy, z + dz, view);
  const e = {
    NW: p(0, 0, 0),
    NE: p(1, 0, 0),
    SE: p(1, 1, 0),
    SW: p(0, 1, 0),
  };
  const rise = roofRise(cell);
  if (cell.roof === 'flat') {
    return { kind: 'flat', faces: [[e.NW, e.NE, e.SE, e.SW]], edge: [e.NW, e.NE, e.SE, e.SW] };
  }
  if (cell.roof === 'gable') {
    // Ridge runs along the y axis of the cell.
    const r1 = p(0.5, 0, rise);
    const r2 = p(0.5, 1, rise);
    return {
      kind: 'gable',
      faces: [[e.NW, r1, r2, e.SW], [e.NE, e.SE, r2, r1]],
      edge: [e.NW, r1, r2, e.SW, e.NW, e.NE, r1, e.NE, e.SE, r2],
    };
  }
  if (cell.roof === 'pyramid') {
    const apex = p(0.5, 0.5, rise);
    return {
      kind: 'pyramid',
      faces: [[e.NW, e.NE, apex], [e.NE, e.SE, apex], [e.SE, e.SW, apex], [e.SW, e.NW, apex]],
      edge: [e.NW, e.NE, e.SE, e.SW, e.NW],
    };
  }
  // hip roof: short ridge parallel to the y axis.
  const r1 = p(0.5, 0.25, rise);
  const r2 = p(0.5, 0.75, rise);
  return {
    kind: 'hip',
    faces: [
      [e.NW, e.NE, r1],
      [e.NE, e.SE, r2, r1],
      [e.SE, e.SW, r2],
      [e.SW, e.NW, r1, r2],
    ],
    edge: [e.NW, e.NE, e.SE, e.SW, e.NW],
  };
}

// Faces of one cell as 3D polygons; the renderer projects already-2D points.
export function cellFaces(cell, view) {
  if (cell.type !== 'building') {
    return { ground: diamondPoints(cell.x, cell.y, 0, view), walls: [], roof: null };
  }
  const { x, y, floors } = cell;
  const bottom = diamondPoints(x, y, 0, view);
  const top = diamondPoints(x, y, floors, view);
  const walls = [
    [bottom[1], bottom[2], top[2], top[1]], // right / east wall
    [bottom[2], bottom[3], top[3], top[2]], // front / south wall
  ];
  return { ground: null, walls, roof: roofVertices(cell, view) };
}

// Cells intersected by a section row (the cut plane follows grid row y).
export function sectionCells(city, rowY) {
  const out = [];
  for (let x = 0; x < city.rules.width; x++) {
    const cell = city.cells.get(key(x, rowY));
    if (cell) out.push(cell);
  }
  return out;
}

function key(x, y) {
  return `${x},${y}`;
}
