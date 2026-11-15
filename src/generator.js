export const WORLD = Object.freeze({
  width: 1280,
  height: 820,
  margin: 42,
  roadWidth: 18,
});

export const DEFAULT_PARAMS = Object.freeze({
  seed: 82419,
  density: 62,
  blockScale: 152,
});

const TARGET_COUNT = 4;
const PARK_COUNT = 2;
const BLOCKER_RADIUS = 27;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashObject(value) {
  return hashString(stableStringify(value)).toString(16).padStart(8, "0");
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function normalizeSeed(value) {
  const text = String(value ?? "").trim();
  if (/^-?\d+$/.test(text)) {
    const number = Number(text);
    return Number.isSafeInteger(number) ? (number >>> 0) : hashString(text);
  }
  if (!text) return DEFAULT_PARAMS.seed;
  return hashString(text);
}

export function createRandom(seed, salt = "") {
  let state = hashString(`${normalizeSeed(seed)}:${salt}`) || 0x9e3779b9;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function roundPoint(value) {
  return Math.round(value * 10) / 10;
}

function blockId(col, row) {
  return `R${row + 1}C${col + 1}`;
}

function nodeId(col, row) {
  return `N${col}-${row}`;
}

function makeGrid(params) {
  const usableWidth = WORLD.width - WORLD.margin * 2;
  const usableHeight = WORLD.height - WORLD.margin * 2;
  const cols = clamp(Math.round(usableWidth / params.blockScale), 5, 10);
  const rows = clamp(Math.round(usableHeight / params.blockScale), 4, 7);
  const stepX = usableWidth / cols;
  const stepY = usableHeight / rows;
  const xs = Array.from({ length: cols + 1 }, (_, index) =>
    roundPoint(WORLD.margin + index * stepX),
  );
  const ys = Array.from({ length: rows + 1 }, (_, index) =>
    roundPoint(WORLD.margin + index * stepY),
  );
  return {
    cols,
    rows,
    stepX: roundPoint(stepX),
    stepY: roundPoint(stepY),
    xs,
    ys,
    roadWidth: WORLD.roadWidth,
  };
}

function makeBlock(grid, col, row) {
  const roadEdge = grid.roadWidth / 2;
  const x = grid.xs[col] + roadEdge;
  const y = grid.ys[row] + roadEdge;
  const right = grid.xs[col + 1] - roadEdge;
  const bottom = grid.ys[row + 1] - roadEdge;
  return {
    id: blockId(col, row),
    col,
    row,
    x: roundPoint(x),
    y: roundPoint(y),
    w: roundPoint(right - x),
    h: roundPoint(bottom - y),
    inner: {
      x: roundPoint(x + 7),
      y: roundPoint(y + 7),
      w: roundPoint(right - x - 14),
      h: roundPoint(bottom - y - 14),
    },
    type: "built",
    buildings: [],
    hash: "",
  };
}

function makeGraph(grid) {
  const nodes = [];
  const nodeLookup = new Map();
  for (let row = 0; row <= grid.rows; row += 1) {
    for (let col = 0; col <= grid.cols; col += 1) {
      const id = nodeId(col, row);
      const node = { id, col, row, x: grid.xs[col], y: grid.ys[row], edges: [] };
      nodes.push(node);
      nodeLookup.set(id, node);
    }
  }

  const edges = [];
  for (let row = 0; row <= grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      edges.push(makeEdge(nodeLookup, col, row, col + 1, row, "h"));
    }
  }
  for (let col = 0; col <= grid.cols; col += 1) {
    for (let row = 0; row < grid.rows; row += 1) {
      edges.push(makeEdge(nodeLookup, col, row, col, row + 1, "v"));
    }
  }
  edges.forEach((edge) => {
    nodeLookup.get(edge.from).edges.push(edge.id);
    nodeLookup.get(edge.to).edges.push(edge.id);
  });
  const edgeLookup = new Map(edges.map((edge) => [edge.id, edge]));
  return { nodes, nodeLookup, edges, edgeLookup };
}

function makeEdge(nodeLookup, colA, rowA, colB, rowB, axis) {
  const from = nodeLookup.get(nodeId(colA, rowA));
  const to = nodeLookup.get(nodeId(colB, rowB));
  return {
    id: `${axis}:${Math.min(colA, colB)}-${Math.min(rowA, rowB)}`,
    from: from.id,
    to: to.id,
    axis,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
  };
}

function chooseTargets(graph, count) {
  const start = graph.nodeLookup.get(nodeId(0, graph.nodes.at(-1).row));
  const chosen = [];
  let candidates = graph.nodes.filter((node) => node.id !== start.id);
  while (chosen.length < count && candidates.length) {
    let best = candidates[0];
    let bestScore = -1;
    for (const node of candidates) {
      const nearest = Math.min(
        ...chosen.map((target) => Math.hypot(node.x - target.x, node.y - target.y)),
        Math.hypot(node.x - start.x, node.y - start.y),
      );
      const edgeBias = (node.col === 0 || node.row === 0 ? 0.82 : 1) * (node.edges.length ? 1 : 0);
      const score = nearest * edgeBias;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    chosen.push(best);
    candidates = candidates.filter((node) => node.id !== best.id);
  }
  return chosen;
}

function makeBuildingCells(block) {
  const columns = block.inner.w >= 138 ? 3 : block.inner.w >= 84 ? 2 : 1;
  const rows = block.inner.h >= 126 ? 3 : 2;
  const gap = 7;
  const cellWidth = (block.inner.w - gap * (columns - 1)) / columns;
  const cellHeight = (block.inner.h - gap * (rows - 1)) / rows;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      cells.push({
        index: row * columns + col,
        x: block.inner.x + col * (cellWidth + gap),
        y: block.inner.y + row * (cellHeight + gap),
        w: cellWidth,
        h: cellHeight,
      });
    }
  }
  return cells;
}

function buildBlockBuildings(block, params, seed) {
  const random = createRandom(seed, `buildings:${block.id}:${block.col}:${block.row}`);
  const cells = makeBuildingCells(block);
  const densityProfile = 0.82 + random() * 0.34;
  const desired = clamp(
    Math.round(cells.length * (params.density / 100) * densityProfile),
    0,
    cells.length,
  );
  const priority = shuffle(cells, random).slice(0, desired);
  const selected = new Map(priority.map((cell) => [cell.index, cell]));
  const buildings = [];

  for (const cell of cells) {
    if (!selected.has(cell.index)) continue;
    const insetX = 2 + random() * 5;
    const insetY = 2 + random() * 5;
    const width = Math.max(22, cell.w - insetX * 2 - random() * 4);
    const height = Math.max(20, cell.h - insetY * 2 - random() * 5);
    const roll = random();
    buildings.push({
      id: `B-${block.id}-${cell.index + 1}`,
      blockId: block.id,
      x: roundPoint(cell.x + insetX),
      y: roundPoint(cell.y + insetY),
      w: roundPoint(width),
      h: roundPoint(height),
      tall: Math.round(18 + random() * 46),
      tone: Math.floor(random() * 4),
      kind: roll > 0.82 ? "civic" : roll > 0.54 ? "office" : "home",
    });
  }
  return buildings;
}

function plannedBuildingCount(block, params, seed) {
  const random = createRandom(seed, `buildings:${block.id}:${block.col}:${block.row}`);
  const cells = makeBuildingCells(block);
  const densityProfile = 0.82 + random() * 0.34;
  return clamp(
    Math.round(cells.length * (params.density / 100) * densityProfile),
    0,
    cells.length,
  );
}

function makeTrees(park, seed) {
  const random = createRandom(seed, `trees:${park.id}:${park.blockId}`);
  const count = clamp(Math.round((park.w * park.h) / 720), 12, 26);
  const trees = [];
  for (let index = 0; index < count; index += 1) {
    const radius = 3.2 + random() * 4.2;
    trees.push({
      x: roundPoint(park.x + 13 + random() * (park.w - 26)),
      y: roundPoint(park.y + 13 + random() * (park.h - 26)),
      r: roundPoint(radius),
      tone: Math.floor(random() * 3),
    });
  }
  return trees;
}

function makePark(id, block, seed) {
  const park = {
    id,
    blockId: block.id,
    x: roundPoint(block.inner.x + 3),
    y: roundPoint(block.inner.y + 3),
    w: roundPoint(block.inner.w - 6),
    h: roundPoint(block.inner.h - 6),
    trees: [],
    path: null,
  };
  park.trees = makeTrees(park, seed);
  return park;
}

function makeWater(id, block, seed) {
  const random = createRandom(seed, `water:${block.id}`);
  const centerX = block.inner.x + block.inner.w / 2;
  const centerY = block.inner.y + block.inner.h / 2;
  const radiusX = block.inner.w * (0.43 + random() * 0.04);
  const radiusY = block.inner.h * (0.4 + random() * 0.06);
  const points = [];
  const pointCount = 14;
  for (let index = 0; index < pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2;
    const wobble = 0.84 + random() * 0.16;
    points.push({
      x: roundPoint(centerX + Math.cos(angle) * radiusX * wobble),
      y: roundPoint(centerY + Math.sin(angle) * radiusY * wobble),
    });
  }
  return {
    id,
    blockId: block.id,
    x: roundPoint(centerX),
    y: roundPoint(centerY),
    w: roundPoint(radiusX * 2),
    h: roundPoint(radiusY * 2),
    points,
  };
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(area) / 2;
}

export function generateWorld(input = {}) {
  const params = {
    seed: normalizeSeed(input.seed ?? DEFAULT_PARAMS.seed),
    density: clamp(Math.round(Number(input.density ?? DEFAULT_PARAMS.density)), 10, 100),
    blockScale: clamp(Math.round(Number(input.blockScale ?? DEFAULT_PARAMS.blockScale)), 105, 205),
  };
  const grid = makeGrid(params);
  const graph = makeGraph(grid);
  const random = createRandom(params.seed, "district-layout");
  const blocks = [];

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      blocks.push(makeBlock(grid, col, row));
    }
  }

  const featureCandidates = shuffle(
    blocks.filter((block) => block.col > 0 && block.col < grid.cols - 1),
    random,
  );
  const waterBlock = featureCandidates[0] ?? blocks[Math.floor(blocks.length / 2)];
  waterBlock.type = "water";
  const water = makeWater("W-01", waterBlock, params.seed);
  const parkBlocks = featureCandidates
    .filter((block) => block.id !== waterBlock.id)
    .slice(0, PARK_COUNT);
  while (parkBlocks.length < PARK_COUNT) {
    const fallback = blocks.find(
      (block) => block.type === "built" && !parkBlocks.some((item) => item.id === block.id),
    );
    if (!fallback) break;
    parkBlocks.push(fallback);
  }
  const parks = parkBlocks.map((block, index) => {
    block.type = "park";
    return makePark(`P-${String(index + 1).padStart(2, "0")}`, block, params.seed);
  });
  for (const block of blocks) {
    if (block.type !== "built") continue;
    block.buildings = buildBlockBuildings(block, params, params.seed);
  }

  const startNode = graph.nodeLookup.get(nodeId(0, grid.rows));
  const targets = chooseTargets(graph, TARGET_COUNT).map((node, index) => ({
    id: `T-${index + 1}`,
    label: `目标 ${index + 1}`,
    nodeId: node.id,
    x: node.x,
    y: node.y,
    reachable: false,
  }));

  const world = {
    version: 1,
    params,
    grid,
    graph,
    blocks,
    parks,
    waters: [water],
    targets,
    blockers: [],
    start: { nodeId: startNode.id, x: startNode.x, y: startNode.y },
    blockedEdges: new Set(),
    routes: [],
    metrics: {},
    blockerReport: null,
    layoutHash: "",
  };
  recomputeDerived(world);
  return world;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(px - x1, py - y1);
  const ratio = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (x1 + ratio * dx), py - (y1 + ratio * dy));
}

function blockedSetFor(world, blockers = world.blockers) {
  const blocked = new Set();
  for (const blocker of blockers) {
    const withinRadius = world.graph.edges.filter(
      (edge) =>
        distanceToSegment(blocker.x, blocker.y, edge.x1, edge.y1, edge.x2, edge.y2) <=
        blocker.radius + world.grid.roadWidth / 2,
    );
    const edgeIds = withinRadius.length
      ? withinRadius.map((edge) => edge.id)
      : blocker.blockedEdgeIds ?? [];
    edgeIds.forEach((edgeId) => blocked.add(edgeId));
  }
  return blocked;
}

function bfs(world, startId, blocked) {
  const distances = new Map([[startId, 0]]);
  const parents = new Map();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    const node = world.graph.nodeLookup.get(current);
    for (const edgeId of node.edges) {
      const edge = world.graph.edgeLookup.get(edgeId);
      if (blocked.has(edgeId)) continue;
      const next = edge.from === current ? edge.to : edge.from;
      if (distances.has(next)) continue;
      distances.set(next, distances.get(current) + Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1));
      parents.set(next, { nodeId: current, edgeId });
      queue.push(next);
    }
  }
  return { distances, parents };
}

function graphPath(world, parents, targetNodeId) {
  const points = [];
  let current = targetNodeId;
  while (current) {
    const node = world.graph.nodeLookup.get(current);
    points.push({ x: node.x, y: node.y });
    const parent = parents.get(current);
    current = parent?.nodeId;
  }
  return points.reverse();
}

function buildParkPath(world, park) {
  const block = world.blocks.find((item) => item.id === park.blockId);
  if (!block) return null;
  const centerX = park.x + park.w / 2;
  const centerY = park.y + park.h / 2;
  const sides = [
    { side: "left", distance: centerX - world.grid.xs[block.col] },
    { side: "right", distance: world.grid.xs[block.col + 1] - centerX },
    { side: "top", distance: centerY - world.grid.ys[block.row] },
    { side: "bottom", distance: world.grid.ys[block.row + 1] - centerY },
  ].sort((a, b) => a.distance - b.distance);
  const side = sides[0].side;
  let edgePoint;
  let roadPoint;
  if (side === "left" || side === "right") {
    const edgeX = side === "left" ? park.x : park.x + park.w;
    const roadX = side === "left" ? world.grid.xs[block.col] : world.grid.xs[block.col + 1];
    edgePoint = { x: edgeX, y: centerY };
    roadPoint = { x: roadX, y: centerY };
  } else {
    const edgeY = side === "top" ? park.y : park.y + park.h;
    const roadY = side === "top" ? world.grid.ys[block.row] : world.grid.ys[block.row + 1];
    edgePoint = { x: centerX, y: edgeY };
    roadPoint = { x: centerX, y: roadY };
  }
  let accessCandidates;
  if (side === "left") {
    accessCandidates = [
      { nodeId: nodeId(block.col, block.row), y: world.grid.ys[block.row] },
      { nodeId: nodeId(block.col, block.row + 1), y: world.grid.ys[block.row + 1] },
    ];
  } else if (side === "right") {
    accessCandidates = [
      { nodeId: nodeId(block.col + 1, block.row), y: world.grid.ys[block.row] },
      { nodeId: nodeId(block.col + 1, block.row + 1), y: world.grid.ys[block.row + 1] },
    ];
  } else if (side === "top") {
    accessCandidates = [
      { nodeId: nodeId(block.col, block.row), x: world.grid.xs[block.col] },
      { nodeId: nodeId(block.col + 1, block.row), x: world.grid.xs[block.col + 1] },
    ];
  } else {
    accessCandidates = [
      { nodeId: nodeId(block.col, block.row + 1), x: world.grid.xs[block.col] },
      { nodeId: nodeId(block.col + 1, block.row + 1), x: world.grid.xs[block.col + 1] },
    ];
  }
  const access = accessCandidates.sort((a, b) =>
    side === "left" || side === "right"
      ? Math.abs(a.y - centerY) - Math.abs(b.y - centerY)
      : Math.abs(a.x - centerX) - Math.abs(b.x - centerX),
  )[0];
  const length =
    Math.hypot(edgePoint.x - centerX, edgePoint.y - centerY) +
    Math.hypot(roadPoint.x - edgePoint.x, roadPoint.y - edgePoint.y);
  return {
    side,
    accessNodeId: access.nodeId,
    length: roundPoint(length),
    points: [
      { x: roundPoint(centerX), y: roundPoint(centerY) },
      { x: roundPoint(edgePoint.x), y: roundPoint(edgePoint.y) },
      { x: roundPoint(roadPoint.x), y: roundPoint(roadPoint.y) },
    ],
  };
}

function computeBlockHash(world, block) {
  const park = world.parks.find((item) => item.blockId === block.id) ?? null;
  const water = world.waters.find((item) => item.blockId === block.id) ?? null;
  return hashObject({
    id: block.id,
    x: block.x,
    y: block.y,
    w: block.w,
    h: block.h,
    type: block.type,
    buildings: block.buildings,
    park: park
      ? { id: park.id, x: park.x, y: park.y, w: park.w, h: park.h, trees: park.trees }
      : null,
    water: water
      ? { id: water.id, x: water.x, y: water.y, w: water.w, h: water.h, points: water.points }
      : null,
  });
}

function computeLayoutHash(world) {
  const blocks = [...world.blocks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((block) => ({ id: block.id, hash: block.hash, x: block.x, y: block.y }));
  return hashObject({
    version: world.version,
    params: world.params,
    grid: {
      cols: world.grid.cols,
      rows: world.grid.rows,
      xs: world.grid.xs,
      ys: world.grid.ys,
      roadWidth: world.grid.roadWidth,
    },
    blocks,
    targets: world.targets.map((target) => ({
      id: target.id,
      nodeId: target.nodeId,
      x: target.x,
      y: target.y,
    })),
    blockers: world.blockers.map((blocker) => ({
      id: blocker.id,
      x: blocker.x,
      y: blocker.y,
      radius: blocker.radius,
    })),
  });
}

function nearestRoadLabel(world, x, y) {
  let nearest = world.graph.nodes[0];
  let best = Infinity;
  for (const node of world.graph.nodes) {
    const distance = Math.hypot(x - node.x, y - node.y);
    if (distance < best) {
      nearest = node;
      best = distance;
    }
  }
  return `路口 ${nearest.col + 1}-${nearest.row + 1}`;
}

function buildBlockerReport(world) {
  const unreachable = world.targets.filter((target) => !target.reachable);
  if (!world.blockers.length || !unreachable.length) return null;
  const critical = [];
  for (const blocker of world.blockers) {
    const remaining = world.blockers.filter((item) => item.id !== blocker.id);
    const blocked = blockedSetFor(world, remaining);
    const search = bfs(world, world.start.nodeId, blocked);
    const restored = unreachable.filter((target) => search.distances.has(target.nodeId));
    if (restored.length) {
      critical.push({ ...blocker, restoredTargets: restored.map((target) => target.id) });
    }
  }
  const locations = (critical.length ? critical : world.blockers)
    .map((blocker) => ({
      id: blocker.id,
      x: blocker.x,
      y: blocker.y,
      label: nearestRoadLabel(world, blocker.x, blocker.y),
      restoredTargets: blocker.restoredTargets ?? [],
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  return {
    blockerId: locations[0].id,
    location: locations[0],
    locations,
    unreachableTargets: unreachable.map((target) => target.id),
    message: `${locations[0].label} (${Math.round(locations[0].x)}, ${Math.round(locations[0].y)}) 阻断，${unreachable.length} 个目标不可达`,
  };
}

export function recomputeDerived(world) {
  world.blockedEdges = blockedSetFor(world);
  const search = bfs(world, world.start.nodeId, world.blockedEdges);
  const allSearch = bfs(world, world.start.nodeId, new Set());
  world.roadConnected = allSearch.distances.size === world.graph.nodes.length;
  world.routes = [];

  for (const target of world.targets) {
    target.reachable = search.distances.has(target.nodeId);
    target.routeLength = target.reachable ? roundPoint(search.distances.get(target.nodeId)) : 0;
    if (target.reachable) {
      world.routes.push({
        targetId: target.id,
        points: graphPath(world, search.parents, target.nodeId),
      });
    }
  }

  for (const park of world.parks) {
    park.path = buildParkPath(world, park);
  }
  for (const block of world.blocks) {
    block.hash = computeBlockHash(world, block);
  }
  world.layoutHash = computeLayoutHash(world);

  const parkArea = world.parks.reduce((total, park) => total + park.w * park.h, 0);
  const treeCount = world.parks.reduce((total, park) => total + park.trees.length, 0);
  const pathLength = world.parks.reduce((total, park) => total + (park.path?.length ?? 0), 0);
  const reachableParkArea = world.parks.reduce((total, park) => {
    const nodeIdValue = park.path?.accessNodeId;
    return total + (nodeIdValue && search.distances.has(nodeIdValue) ? park.w * park.h : 0);
  }, 0);
  const servedBuildings = world.parks.reduce((total, park) => {
    const centerX = park.x + park.w / 2;
    const centerY = park.y + park.h / 2;
    return (
      total +
      world.blocks.reduce(
        (count, block) =>
          count +
          block.buildings.filter(
            (building) =>
              Math.hypot(
                building.x + building.w / 2 - centerX,
                building.y + building.h / 2 - centerY,
              ) <= 220,
          ).length,
        0,
      )
    );
  }, 0);
  world.metrics = {
    buildingCount: world.blocks.reduce((total, block) => total + block.buildings.length, 0),
    targetCount: world.targets.length,
    reachableTargets: world.targets.filter((target) => target.reachable).length,
    roadNodes: world.graph.nodes.length,
    roadEdges: world.graph.edges.length,
    blockedEdges: world.blockedEdges.size,
    parkCount: world.parks.length,
    treeCount,
    parkArea: Math.round(parkArea),
    reachableParkArea: Math.round(reachableParkArea),
    coverage: (parkArea / (WORLD.width * WORLD.height)) * 100,
    pathLength: Math.round(pathLength),
    servedBuildings,
  };
  world.blockerReport = buildBlockerReport(world);
  return world;
}

function blockHashMap(world) {
  return new Map(world.blocks.map((block) => [block.id, block.hash]));
}

function affectedSummary(world, beforeHashes, changedBlocks) {
  const preserved = world.blocks.filter((block) => beforeHashes.get(block.id) === block.hash);
  return {
    affectedBlocks: [...new Set(changedBlocks)],
    affectedCount: new Set(changedBlocks).size,
    preservedCount: preserved.length,
    totalBlocks: world.blocks.length,
    preservedHashes: preserved.map((block) => ({ id: block.id, hash: block.hash })),
  };
}

export function updateDensity(world, density) {
  const beforeHashes = blockHashMap(world);
  const changedBlocks = [];
  world.params.density = clamp(Math.round(Number(density)), 10, 100);
  for (const block of world.blocks) {
    if (block.type !== "built") continue;
    const wanted = plannedBuildingCount(block, world.params, world.params.seed);
    if (wanted === block.buildings.length) continue;
    block.buildings = buildBlockBuildings(block, world.params, world.params.seed);
    changedBlocks.push(block.id);
  }
  recomputeDerived(world);
  return affectedSummary(world, beforeHashes, changedBlocks);
}

function rectanglesOverlap(a, b, gap = 0) {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

export function moveBuilding(world, buildingId, nextX, nextY) {
  const building = world.blocks.flatMap((block) => block.buildings).find(
    (item) => item.id === buildingId,
  );
  if (!building) return { ok: false, reason: "没有找到该建筑" };
  const block = world.blocks.find((item) => item.id === building.blockId);
  const beforeHashes = blockHashMap(world);
  const x = clamp(nextX, block.inner.x, block.inner.x + block.inner.w - building.w);
  const y = clamp(nextY, block.inner.y, block.inner.y + block.inner.h - building.h);
  const candidate = { ...building, x: roundPoint(x), y: roundPoint(y) };
  const collides = block.buildings.some(
    (other) => other.id !== building.id && rectanglesOverlap(candidate, other, 3),
  );
  if (collides) return { ok: false, reason: "与同街区建筑重叠" };
  building.x = candidate.x;
  building.y = candidate.y;
  recomputeDerived(world);
  return {
    ok: true,
    blockId: block.id,
    ...affectedSummary(world, beforeHashes, [block.id]),
  };
}

export function moveParkToBlock(world, parkId, targetBlockId) {
  const park = world.parks.find((item) => item.id === parkId);
  const newBlock = world.blocks.find((block) => block.id === targetBlockId);
  if (!park || !newBlock) return { ok: false, reason: "没有找到目标街区" };
  if (park.blockId === newBlock.id) return { ok: false, reason: "公园已在目标街区" };
  if (newBlock.type === "water") return { ok: false, reason: "水系街区不能放置公园" };
  if (newBlock.type === "park") return { ok: false, reason: "该街区已有公园" };

  const oldBlock = world.blocks.find((block) => block.id === park.blockId);
  const beforeHashes = blockHashMap(world);
  const clearedBuildings = newBlock.buildings.length;
  newBlock.buildings = [];
  newBlock.type = "park";
  oldBlock.type = "built";
  oldBlock.buildings = buildBlockBuildings(oldBlock, world.params, world.params.seed);
  park.blockId = newBlock.id;
  park.x = roundPoint(newBlock.inner.x + 3);
  park.y = roundPoint(newBlock.inner.y + 3);
  park.w = roundPoint(newBlock.inner.w - 6);
  park.h = roundPoint(newBlock.inner.h - 6);
  park.trees = makeTrees(park, world.params.seed);
  recomputeDerived(world);
  return {
    ok: true,
    clearedBuildings,
    oldBlockId: oldBlock.id,
    newBlockId: newBlock.id,
    ...affectedSummary(world, beforeHashes, [oldBlock.id, newBlock.id]),
  };
}

function nearestPointOnEdge(edge, x, y) {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared
    ? clamp(((x - edge.x1) * dx + (y - edge.y1) * dy) / lengthSquared, 0, 1)
    : 0;
  return { x: edge.x1 + ratio * dx, y: edge.y1 + ratio * dy };
}

export function findRoadHit(world, x, y) {
  let nearest = null;
  let best = Infinity;
  for (const edge of world.graph.edges) {
    const point = nearestPointOnEdge(edge, x, y);
    const distance = Math.hypot(x - point.x, y - point.y);
    if (distance < best) {
      best = distance;
      nearest = { edge, point, distance };
    }
  }
  return best <= world.grid.roadWidth + 14 ? nearest : null;
}

export function addBlocker(world, x, y) {
  const hit = findRoadHit(world, x, y);
  if (!hit) return { ok: false, reason: "请点在道路上放置阻断" };
  const id = `X-${Math.round(hit.point.x)}-${Math.round(hit.point.y)}`;
  if (world.blockers.some((blocker) => blocker.id === id)) {
    return { ok: false, reason: "此处已有阻断" };
  }
  const probe = { x: roundPoint(hit.point.x), y: roundPoint(hit.point.y), radius: BLOCKER_RADIUS };
  const blockedEdgeIds = world.graph.edges
    .filter(
      (edge) =>
        distanceToSegment(probe.x, probe.y, edge.x1, edge.y1, edge.x2, edge.y2) <=
        probe.radius + world.grid.roadWidth / 2,
    )
    .map((edge) => edge.id);
  if (!blockedEdgeIds.length) blockedEdgeIds.push(hit.edge.id);
  world.blockers.push({ id, ...probe, blockedEdgeIds });
  recomputeDerived(world);
  return { ok: true, blocker: world.blockers.at(-1), report: world.blockerReport };
}

export function removeBlocker(world, blockerId) {
  const index = world.blockers.findIndex((blocker) => blocker.id === blockerId);
  if (index < 0) return false;
  world.blockers.splice(index, 1);
  recomputeDerived(world);
  return true;
}

function boundsOf(item) {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

function overlaps(a, b, gap = 0) {
  return rectanglesOverlap(a, b, gap);
}

export function verifyWorld(world) {
  const roadRects = [];
  for (const x of world.grid.xs) {
    roadRects.push({ x: x - world.grid.roadWidth / 2, y: 0, w: world.grid.roadWidth, h: WORLD.height });
  }
  for (const y of world.grid.ys) {
    roadRects.push({ x: 0, y: y - world.grid.roadWidth / 2, w: WORLD.width, h: world.grid.roadWidth });
  }
  const buildings = world.blocks.flatMap((block) => block.buildings);
  const parks = world.parks;
  const waters = world.waters;
  const waterBounds = (water) => ({
    x: water.x - water.w / 2,
    y: water.y - water.h / 2,
    w: water.w,
    h: water.h,
  });
  const overlapSamples = [];
  let overlapCount = 0;

  const checkPair = (a, b, aType, bType) => {
    if (!overlaps(boundsOf(a), boundsOf(b), 0.5)) return;
    overlapCount += 1;
    if (overlapSamples.length < 5) overlapSamples.push({ a: a.id, b: b.id, aType, bType });
  };

  for (let first = 0; first < buildings.length; first += 1) {
    for (let second = first + 1; second < buildings.length; second += 1) {
      if (buildings[first].blockId !== buildings[second].blockId) continue;
      checkPair(buildings[first], buildings[second], "building", "building");
    }
    roadRects.forEach((road, index) => checkPair(buildings[first], { id: `road-${index}`, ...road }, "building", "road"));
    parks.forEach((park) => checkPair(buildings[first], park, "building", "park"));
    waters.forEach((water) =>
      checkPair(buildings[first], { id: water.id, ...waterBounds(water) }, "building", "water"),
    );
  }
  for (let first = 0; first < parks.length; first += 1) {
    roadRects.forEach((road, index) => checkPair(parks[first], { id: `road-${index}`, ...road }, "park", "road"));
    waters.forEach((water) =>
      checkPair(parks[first], { id: water.id, ...waterBounds(water) }, "park", "water"),
    );
    for (let second = first + 1; second < parks.length; second += 1) {
      checkPair(parks[first], parks[second], "park", "park");
    }
  }
  waters.forEach((water) => {
    roadRects.forEach((road, index) =>
      checkPair(
        { id: water.id, ...waterBounds(water) },
        { id: `road-${index}`, ...road },
        "water",
        "road",
      ),
    );
  });

  const outside = [];
  const insideWorld = (item) =>
    item.x >= 0 &&
    item.y >= 0 &&
    item.x + item.w <= WORLD.width &&
    item.y + item.h <= WORLD.height;
  for (const block of world.blocks) {
    if (!insideWorld(block)) outside.push(block.id);
    for (const building of block.buildings) {
      if (!insideWorld(building)) outside.push(building.id);
    }
  }
  for (const park of parks) {
    if (!insideWorld(park)) outside.push(park.id);
    for (const tree of park.trees) {
      if (
        tree.x - tree.r < 0 ||
        tree.y - tree.r < 0 ||
        tree.x + tree.r > WORLD.width ||
        tree.y + tree.r > WORLD.height
      ) {
        outside.push(`${park.id}-tree`);
        break;
      }
    }
  }
  for (const water of waters) {
    const bounds = waterBounds(water);
    if (
      !insideWorld(bounds) ||
      water.points.some(
        (point) =>
          point.x < 0 || point.y < 0 || point.x > WORLD.width || point.y > WORLD.height,
      )
    ) {
      outside.push(water.id);
    }
  }
  for (const target of world.targets) {
    if (
      target.x < 0 ||
      target.y < 0 ||
      target.x > WORLD.width ||
      target.y > WORLD.height
    ) {
      outside.push(target.id);
    }
  }

  const reachable = world.targets.filter((target) => target.reachable).length;
  return {
    roadConnected: world.roadConnected,
    roadNodeCount: world.graph.nodes.length,
    roadEdgeCount: world.graph.edges.length,
    targetCount: world.targets.length,
    reachable,
    targetsReachable: reachable === world.targets.length,
    overlapCount,
    overlapSamples,
    boundaryCorrect: outside.length === 0,
    outside,
    pass:
      world.roadConnected &&
      reachable === world.targets.length &&
      overlapCount === 0 &&
      outside.length === 0,
  };
}

export function validateSeeds(seed, baseParams = {}) {
  const firstSeed = normalizeSeed(seed);
  const seeds = [firstSeed, normalizeSeed(firstSeed + 1)];
  const results = seeds.map((seedValue) => {
    const params = { ...DEFAULT_PARAMS, ...baseParams, seed: seedValue };
    const first = generateWorld(params);
    const second = generateWorld(params);
    const checks = verifyWorld(first);
    return {
      seed: seedValue,
      layoutHash: first.layoutHash,
      deterministic: first.layoutHash === second.layoutHash,
      checks,
      pass: checks.pass && first.layoutHash === second.layoutHash,
    };
  });
  return {
    pass: results.every((result) => result.pass),
    seeds: results,
  };
}

export function serializeWorld(world) {
  return {
    format: "blockweave-scene",
    version: 1,
    savedAt: new Date().toISOString(),
    params: { ...world.params },
    layoutHash: world.layoutHash,
    blocks: world.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      buildings: block.buildings.map((building) => ({ ...building })),
    })),
    parks: world.parks.map((park) => ({
      id: park.id,
      blockId: park.blockId,
      x: park.x,
      y: park.y,
      w: park.w,
      h: park.h,
      trees: park.trees.map((tree) => ({ ...tree })),
    })),
    waters: world.waters.map((water) => ({
      id: water.id,
      blockId: water.blockId,
      x: water.x,
      y: water.y,
      w: water.w,
      h: water.h,
      points: water.points.map((point) => ({ ...point })),
    })),
    targets: world.targets.map((target) => ({
      id: target.id,
      label: target.label,
      nodeId: target.nodeId,
      x: target.x,
      y: target.y,
    })),
    blockers: world.blockers.map((blocker) => ({
      id: blocker.id,
      x: blocker.x,
      y: blocker.y,
      radius: blocker.radius,
      blockedEdgeIds: [...blocker.blockedEdgeIds],
    })),
    metrics: { ...world.metrics },
  };
}

export function hydrateWorld(snapshot) {
  if (!snapshot || snapshot.format !== "blockweave-scene" || snapshot.version !== 1) {
    throw new Error("场景文件格式不受支持");
  }
  const params = {
    seed: normalizeSeed(snapshot.params.seed),
    density: clamp(Math.round(Number(snapshot.params.density)), 10, 100),
    blockScale: clamp(Math.round(Number(snapshot.params.blockScale)), 105, 205),
  };
  const grid = makeGrid(params);
  const graph = makeGraph(grid);
  const blocks = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      blocks.push(makeBlock(grid, col, row));
    }
  }
  const blockLookup = new Map(blocks.map((block) => [block.id, block]));
  for (const savedBlock of snapshot.blocks) {
    const block = blockLookup.get(savedBlock.id);
    if (!block) continue;
    block.type = savedBlock.type;
    block.buildings = savedBlock.buildings.map((building) => ({ ...building }));
  }
  const startNode = graph.nodeLookup.get(nodeId(0, grid.rows));
  const world = {
    version: 1,
    params,
    grid,
    graph,
    blocks,
    parks: snapshot.parks.map((park) => ({
      ...park,
      trees: park.trees.map((tree) => ({ ...tree })),
      path: null,
    })),
    waters: snapshot.waters.map((water) => ({
      ...water,
      points: water.points.map((point) => ({ ...point })),
    })),
    targets: snapshot.targets.map((target) => ({ ...target, reachable: false })),
    blockers: snapshot.blockers.map((blocker) => ({
      ...blocker,
      blockedEdgeIds: [...blocker.blockedEdgeIds],
    })),
    start: { nodeId: startNode.id, x: startNode.x, y: startNode.y },
    blockedEdges: new Set(),
    routes: [],
    metrics: {},
    blockerReport: null,
    layoutHash: "",
  };
  recomputeDerived(world);
  return world;
}
