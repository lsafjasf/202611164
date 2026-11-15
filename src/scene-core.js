export const GRID_WIDTH = 30;
export const GRID_HEIGHT = 20;

export const TILE = Object.freeze({
  ROCK: 0,
  TUNNEL: 1,
  ORE: 2
});

export const DIG_LIMIT = 8;
export const SAVE_VERSION = 1;

export const SEED_PRESETS = Object.freeze([
  { id: "cinder", seed: "CINDER-7341", label: "赤铜断层" },
  { id: "frost", seed: "FROST-2196", label: "霜晶深井" },
  { id: "verdant", seed: "VERDANT-5082", label: "翡翠裂隙" }
]);

export const VEIN_DEFS = Object.freeze([
  { id: "vein-1", name: "赤铜主脉", short: "赤铜", color: "#f4a641" },
  { id: "vein-2", name: "青金支脉", short: "青金", color: "#5ad6c8" },
  { id: "vein-3", name: "紫晶深脉", short: "紫晶", color: "#b88cff" }
]);

export const DEFAULT_PARAMS = Object.freeze({
  veinSize: 2.15,
  tunnelWidth: 1
});

const AXIS_STEPS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
];

export function indexOf(x, y, width = GRID_WIDTH) {
  return y * width + x;
}

export function coordsOf(index, width = GRID_WIDTH) {
  return { x: index % width, y: Math.floor(index / width) };
}

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function hashToHex(hash) {
  return hash.toString(16).padStart(8, "0").toUpperCase();
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAt(seed, x, y, salt) {
  return hashString(`${seed}:${x}:${y}:${salt}`) / 4294967296;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeSeed(seed) {
  const normalized = String(seed || "").trim().toUpperCase();
  return normalized || SEED_PRESETS[0].seed;
}

function seedUnit(seed, salt) {
  return hashString(`${seed}:${salt}`) / 4294967296;
}

function isWalkable(tile) {
  return tile === TILE.TUNNEL || tile === TILE.ORE;
}

function nearestVein(veins, x, y) {
  let selected = veins[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const vein of veins) {
    const nextDistance = Math.abs(vein.x - x) + Math.abs(vein.y - y);
    if (nextDistance < distance) {
      selected = vein;
      distance = nextDistance;
    }
  }
  return selected;
}

function objectLayout(seed, width, height) {
  const rng = mulberry32(hashString(`${seed}:objects`));
  const entranceY = 3 + Math.floor(rng() * (height - 6));
  const stationY = 3 + Math.floor(rng() * (height - 6));
  const laneX = [7, 15, 23];

  const veins = VEIN_DEFS.map((definition, index) => ({
    ...definition,
    x: laneX[index],
    y: clamp(4 + Math.floor(rng() * (height - 8)), 4, height - 5)
  }));

  return {
    entrance: {
      id: "entrance",
      name: "升降井入口",
      x: 0,
      y: entranceY
    },
    station: {
      id: "station",
      name: "中央加工站",
      x: width - 1,
      y: stationY
    },
    veins
  };
}

function carveCell(grid, width, height, x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }
  grid[indexOf(x, y, width)] = TILE.TUNNEL;
}

function carveCorridor(grid, width, height, start, end, rng, tunnelWidth) {
  let x = start.x;
  let y = start.y;
  let horizontalBias = rng() > 0.5;

  const carveAt = (targetX, targetY) => {
    carveCell(grid, width, height, targetX, targetY);
    if (tunnelWidth > 1) {
      carveCell(grid, width, height, targetX + 1, targetY);
      carveCell(grid, width, height, targetX, targetY + 1);
      carveCell(grid, width, height, targetX + 1, targetY + 1);
    }
  };

  carveAt(x, y);
  while (x !== end.x || y !== end.y) {
    const canMoveX = x !== end.x;
    const canMoveY = y !== end.y;
    let moveX;
    if (canMoveX && canMoveY) {
      moveX = rng() < (horizontalBias ? 0.68 : 0.32);
      if (rng() < 0.16) {
        horizontalBias = !horizontalBias;
      }
    } else {
      moveX = canMoveX;
    }

    x += moveX ? Math.sign(end.x - x) : 0;
    y += moveX ? 0 : Math.sign(end.y - y);
    carveAt(x, y);
  }
}

function connectObjects(grid, width, height, objects, seed, tunnelWidth) {
  const rng = mulberry32(hashString(`${seed}:corridors`));
  const nodes = [objects.entrance, ...objects.veins, objects.station];
  const connected = [nodes[0]];
  const pending = nodes.slice(1);

  carveCell(grid, width, height, objects.entrance.x, objects.entrance.y);
  carveCell(grid, width, height, objects.station.x, objects.station.y);

  while (pending.length > 0) {
    let best = null;
    for (const from of connected) {
      for (const to of pending) {
        const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        const jitter = rng() * 6;
        if (!best || distance + jitter < best.score) {
          best = { from, to, score: distance + jitter };
        }
      }
    }

    carveCorridor(
      grid,
      width,
      height,
      best.from,
      best.to,
      rng,
      tunnelWidth
    );
    connected.push(best.to);
    pending.splice(pending.indexOf(best.to), 1);
  }
}

export function veinBounds(vein, size = DEFAULT_PARAMS.veinSize) {
  const radius = Math.ceil(size * 1.2 + 0.55);
  return {
    left: Math.max(0, vein.x - radius),
    top: Math.max(0, vein.y - radius),
    right: Math.min(GRID_WIDTH - 1, vein.x + radius),
    bottom: Math.min(GRID_HEIGHT - 1, vein.y + radius)
  };
}

export function isVeinCell(seed, vein, x, y, size = DEFAULT_PARAMS.veinSize) {
  const dx = x - vein.x;
  const dy = y - vein.y;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const noise =
    randomAt(seed, x, y, `vein:${vein.id}`) * 0.38 +
    Math.sin(angle * 3 + hashString(vein.id) % 7) * 0.1;
  return distance <= size + noise + 0.18;
}

function growOre(grid, width, height, seed, objects, params) {
  let placed = 0;
  for (const vein of objects.veins) {
    const bounds = veinBounds(vein, params.veinSize);
    for (let y = bounds.top; y <= bounds.bottom; y += 1) {
      for (let x = bounds.left; x <= bounds.right; x += 1) {
        const index = indexOf(x, y, width);
        if (
          grid[index] === TILE.ROCK &&
          isVeinCell(seed, vein, x, y, params.veinSize)
        ) {
          grid[index] = TILE.ORE;
          placed += 1;
        }
      }
    }
  }
  return placed;
}

function targetList(objects) {
  return [
    ...objects.veins.map((vein) => ({
      id: vein.id,
      kind: "vein",
      name: vein.name,
      x: vein.x,
      y: vein.y,
      color: vein.color
    })),
    {
      id: objects.station.id,
      kind: "station",
      name: objects.station.name,
      x: objects.station.x,
      y: objects.station.y,
      color: "#8fa8c8"
    }
  ];
}

export function collectVeinFootprints(seed, objects, params) {
  const owned = new Map();
  for (const vein of objects.veins) {
    const cells = [];
    const bounds = veinBounds(vein, params.veinSize);
    for (let y = bounds.top; y <= bounds.bottom; y += 1) {
      for (let x = bounds.left; x <= bounds.right; x += 1) {
        if (isVeinCell(seed, vein, x, y, params.veinSize)) {
          cells.push(indexOf(x, y));
        }
      }
    }
    owned.set(vein.id, cells);
  }
  return owned;
}

function breadthFirst(grid, width, height, start) {
  const total = width * height;
  const distance = new Int16Array(total);
  const parent = new Int32Array(total);
  distance.fill(-1);
  parent.fill(-1);
  distance[start] = 0;
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  queue[tail] = start;
  tail += 1;

  while (head < tail) {
    const current = queue[head];
    head += 1;
    const x = current % width;
    const y = Math.floor(current / width);
    for (const [dx, dy] of AXIS_STEPS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue;
      }
      const next = indexOf(nextX, nextY, width);
      if (distance[next] !== -1 || !isWalkable(grid[next])) {
        continue;
      }
      distance[next] = distance[current] + 1;
      parent[next] = current;
      queue[tail] = next;
      tail += 1;
    }
  }

  return { distance, parent };
}

function pathTo(target, parent, width) {
  const path = [];
  let current = target;
  while (current !== -1) {
    path.push(coordsOf(current, width));
    current = parent[current];
  }
  path.reverse();
  return path;
}

export function buildNetwork(scene) {
  const { grid, width, height, objects } = scene;
  const entranceIndex = indexOf(
    objects.entrance.x,
    objects.entrance.y,
    width
  );
  const { distance, parent } = breadthFirst(
    grid,
    width,
    height,
    entranceIndex
  );
  const targets = targetList(objects);
  const routes = [];
  const unreachableTargets = [];
  const edges = new Map();

  for (const target of targets) {
    const targetIndex = indexOf(target.x, target.y, width);
    if (distance[targetIndex] < 0) {
      unreachableTargets.push(target);
      continue;
    }
    const path = pathTo(targetIndex, parent, width);
    routes.push({
      targetId: target.id,
      targetName: target.name,
      color: target.color,
      distance: distance[targetIndex],
      path
    });
    for (let index = 1; index < path.length; index += 1) {
      const from = indexOf(path[index - 1].x, path[index - 1].y, width);
      const to = indexOf(path[index].x, path[index].y, width);
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      edges.set(key, { from, to });
    }
  }

  const reachable = new Set();
  for (let index = 0; index < distance.length; index += 1) {
    if (distance[index] >= 0) {
      reachable.add(index);
    }
  }

  return {
    routes,
    unreachableTargets,
    reachable,
    edges: [...edges.values()],
    reachableCount: routes.length,
    targetCount: targets.length,
    complete: unreachableTargets.length === 0
  };
}

export function computeLayoutHash(scene, region = null) {
  const { width, height, grid, objects, seed, params } = scene;
  const left = region ? Math.max(0, region.left) : 0;
  const top = region ? Math.max(0, region.top) : 0;
  const right = region ? Math.min(width - 1, region.right) : width - 1;
  const bottom = region ? Math.min(height - 1, region.bottom) : height - 1;
  const rows = [];
  for (let y = top; y <= bottom; y += 1) {
    const start = indexOf(left, y, width);
    rows.push(grid.slice(start, start + (right - left + 1)).join(""));
  }
  const objectKey = [
    objectKeyOf(objects.entrance),
    objectKeyOf(objects.station),
    ...objects.veins.map(objectKeyOf)
  ].join(";");
  const payload = [
    SAVE_VERSION,
    seed,
    width,
    height,
    Number(params.veinSize).toFixed(3),
    params.tunnelWidth,
    left,
    top,
    right,
    bottom,
    objectKey,
    rows.join("/")
  ].join("|");
  return hashString(payload);
}

function objectKeyOf(object) {
  return `${object.id}@${object.x},${object.y}`;
}

export function rectContains(rect, x, y) {
  return (
    rect &&
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  );
}

export function mergeRects(rects) {
  if (rects.length === 0) {
    return null;
  }
  return rects.reduce((combined, rect) => ({
    left: Math.min(combined.left, rect.left),
    top: Math.min(combined.top, rect.top),
    right: Math.max(combined.right, rect.right),
    bottom: Math.max(combined.bottom, rect.bottom)
  }));
}

export function validateScene(scene) {
  const { width, height, grid, objects } = scene;
  const issues = [];
  const allObjects = [objects.entrance, objects.station, ...objects.veins];

  const outOfBounds = allObjects.filter(
    (object) =>
      object.x < 0 ||
      object.x >= width ||
      object.y < 0 ||
      object.y >= height
  );
  if (outOfBounds.length > 0) {
    issues.push(`对象越界: ${outOfBounds.map((object) => object.id).join(", ")}`);
  }

  for (const vein of objects.veins) {
    const radius = Math.ceil(scene.params.veinSize * 1.2 + 0.55);
    if (
      vein.x - radius < 0 ||
      vein.y - radius < 0 ||
      vein.x + radius >= width ||
      vein.y + radius >= height
    ) {
      issues.push(`矿脉边界越界: ${vein.name}`);
    }
  }

  if (objects.entrance.x !== 0) {
    issues.push("入口未位于左边界");
  }
  if (objects.station.x !== width - 1) {
    issues.push("加工站未位于右边界");
  }
  if (objects.veins.length !== 3) {
    issues.push(`矿脉数量应为 3，实际为 ${objects.veins.length}`);
  }

  const footprints = collectVeinFootprints(
    scene.seed,
    objects,
    scene.params
  );
  const occupied = new Map();
  const addFootprint = (owner, cells) => {
    for (const cell of cells) {
      if (occupied.has(cell)) {
        issues.push(
          `关键对象重叠: ${occupied.get(cell)} / ${owner} @ ${coordsOf(
            cell,
            width
          ).x},${coordsOf(cell, width).y}`
        );
      } else {
        occupied.set(cell, owner);
      }
    }
  };

  addFootprint("entrance", [
    indexOf(objects.entrance.x, objects.entrance.y, width)
  ]);
  addFootprint("station", [
    indexOf(objects.station.x, objects.station.y, width)
  ]);
  for (const vein of objects.veins) {
    const cells = footprints.get(vein.id);
    const center = indexOf(vein.x, vein.y, width);
    addFootprint(vein.id, cells.includes(center) ? cells : cells.concat(center));
  }

  const network = buildNetwork(scene);
  if (network.unreachableTargets.length > 0) {
    issues.push(
      `目标不可达: ${network.unreachableTargets
        .map((target) => target.name)
        .join(", ")}`
    );
  }

  return {
    valid: issues.length === 0,
    issues,
    boundaryValid:
      outOfBounds.length === 0 &&
      !issues.some((issue) => issue.includes("越界")),
    objectsOverlap: issues.some((issue) => issue.includes("重叠")),
    targetCount: objects.veins.length + 1,
    reachableCount: network.reachableCount,
    reachable: network.complete,
    network
  };
}

export function generateScene(seedInput, paramsInput = DEFAULT_PARAMS) {
  const seed = normalizeSeed(seedInput);
  const params = {
    veinSize: clamp(Number(paramsInput.veinSize) || 2.15, 1.4, 2.8),
    tunnelWidth: clamp(
      Math.round(Number(paramsInput.tunnelWidth) || 1),
      1,
      2
    )
  };
  const width = GRID_WIDTH;
  const height = GRID_HEIGHT;
  const objects = objectLayout(seed, width, height);
  const grid = new Uint8Array(width * height);

  connectObjects(grid, width, height, objects, seed, params.tunnelWidth);
  growOre(grid, width, height, seed, objects, params);
  grid[indexOf(objects.entrance.x, objects.entrance.y, width)] = TILE.TUNNEL;
  grid[indexOf(objects.station.x, objects.station.y, width)] = TILE.TUNNEL;

  const scene = {
    version: SAVE_VERSION,
    seed,
    width,
    height,
    params,
    grid,
    objects,
    editLog: [],
    digUsed: 0,
    digLimit: DIG_LIMIT,
    revision: 0,
    blockedMarkers: []
  };
  scene.layoutHash = computeLayoutHash(scene);
  scene.validation = validateScene(scene);
  scene.network = scene.validation.network;
  return scene;
}

function cloneScene(scene) {
  return {
    ...scene,
    params: { ...scene.params },
    grid: scene.grid.slice(),
    objects: {
      entrance: { ...scene.objects.entrance },
      station: { ...scene.objects.station },
      veins: scene.objects.veins.map((vein) => ({ ...vein }))
    },
    editLog: scene.editLog.map((entry) => ({ ...entry })),
    blockedMarkers: (scene.blockedMarkers || []).map((marker) => ({
      ...marker
    }))
  };
}

function cellHash(scene, excludeRects) {
  const rows = [];
  let cellCount = 0;
  for (let y = 0; y < scene.height; y += 1) {
    let row = "";
    for (let x = 0; x < scene.width; x += 1) {
      const excluded = excludeRects.some((rect) => rectContains(rect, x, y));
      if (!excluded) {
        row += scene.grid[indexOf(x, y, scene.width)];
        cellCount += 1;
      } else {
        row += ".";
      }
    }
    rows.push(row);
  }
  return {
    hash: hashString(
      [
        scene.seed,
        scene.width,
        scene.height,
        rows.join("/")
      ].join("|")
    ),
    cellCount
  };
}

export function computeUnaffectedHash(scene, excludeRects) {
  return cellHash(scene, excludeRects);
}

function protectedObjectAt(scene, x, y) {
  const objects = [
    scene.objects.entrance,
    scene.objects.station,
    ...scene.objects.veins
  ];
  return objects.find((object) => object.x === x && object.y === y) || null;
}

function changeInfo(before, after, affectedRects, changedCells) {
  const beforeUnaffected = computeUnaffectedHash(before, affectedRects);
  const afterUnaffected = computeUnaffectedHash(after, affectedRects);
  return {
    affectedRects,
    changedCells,
    changedCount: changedCells.length,
    unaffectedCount: afterUnaffected.cellCount,
    unaffectedHashBefore: hashToHex(beforeUnaffected.hash),
    unaffectedHashAfter: hashToHex(afterUnaffected.hash),
    unaffectedStable: beforeUnaffected.hash === afterUnaffected.hash
  };
}

function targetReachability(network) {
  return new Map(
    network.routes.map((route) => [route.targetId, route.distance])
  );
}

function blockersForChange(beforeScene, afterScene, changedCells) {
  const beforeReach = targetReachability(beforeScene.network);
  const afterReach = targetReachability(afterScene.network);
  const newlyBlocked = afterScene.validation.network.unreachableTargets.filter(
    (target) => beforeReach.has(target.id) && !afterReach.has(target.id)
  );
  if (newlyBlocked.length === 0) {
    return [];
  }

  const beforePathCells = new Set();
  for (const route of beforeScene.network.routes) {
    for (const point of route.path) {
      beforePathCells.add(indexOf(point.x, point.y, beforeScene.width));
    }
  }

  return changedCells
    .filter((cell) => {
      const index = indexOf(cell.x, cell.y, afterScene.width);
      return beforePathCells.has(index) && afterScene.grid[index] === TILE.ROCK;
    })
    .map((cell) => ({
      ...cell,
      targetIds: newlyBlocked.map((target) => target.id),
      reason: `新增障碍切断 ${newlyBlocked
        .map((target) => target.name)
        .join("、")} 的运输路线`
    }));
}

function reconcileBlockedMarkers(scene, newBlockers) {
  if (newBlockers.length > 0) {
    return newBlockers;
  }
  return (scene.blockedMarkers || []).filter((marker) => {
    const stillUnreachable = scene.network.unreachableTargets.some((target) =>
      marker.targetIds?.includes(target.id)
    );
    return (
      stillUnreachable &&
      scene.grid[indexOf(marker.x, marker.y, scene.width)] === TILE.ROCK
    );
  });
}

function makeLogEntry(scene, action, detail, options = {}) {
  return {
    id: `${scene.revision + 1}-${action}-${Date.now()}`,
    revision: scene.revision + 1,
    action,
    at: options.at || new Date().toISOString(),
    ...detail
  };
}

export function editTile(scene, x, y, action, options = {}) {
  if (x < 0 || x >= scene.width || y < 0 || y >= scene.height) {
    return { ok: false, reason: "坐标超出场景边界" };
  }
  if (!["dig", "seal"].includes(action)) {
    return { ok: false, reason: "未知编辑工具" };
  }

  const index = indexOf(x, y, scene.width);
  if (action === "dig" && scene.grid[index] !== TILE.ROCK) {
    return { ok: false, reason: "这里没有可删除的岩块" };
  }
  if (action === "dig" && scene.digUsed >= scene.digLimit) {
    return { ok: false, reason: "本轮挖除额度已用完" };
  }
  if (action === "seal" && scene.grid[index] === TILE.ROCK) {
    return { ok: false, reason: "目标位置已经是岩块" };
  }
  const protectedObject = protectedObjectAt(scene, x, y);
  if (action === "seal" && protectedObject) {
    return {
      ok: false,
      reason: `不能覆盖关键对象：${protectedObject.name}`
    };
  }

  const before = cloneScene(scene);
  const next = cloneScene(scene);
  next.grid[index] =
    action === "dig" ? TILE.TUNNEL : TILE.ROCK;
  if (action === "dig") {
    next.digUsed += 1;
  }
  next.revision += 1;
  next.layoutHash = computeLayoutHash(next);
  next.validation = validateScene(next);
  next.network = next.validation.network;

  const affectedRects = [{ left: x, top: y, right: x, bottom: y }];
  const proof = changeInfo(before, next, affectedRects, [{ x, y }]);
  const blockers = blockersForChange(before, next, [{ x, y }]);
  next.blockedMarkers = reconcileBlockedMarkers(next, blockers);

  next.editLog.push(
    makeLogEntry(
      before,
      action,
      {
        x,
        y,
        label: action === "dig" ? "删除岩块" : "设置障碍",
        reachable: next.validation.reachable,
        blockers,
        proof
      },
      options
    )
  );
  next.validation = validateScene(next);
  next.network = next.validation.network;
  return {
    ok: true,
    scene: next,
    proof,
    blockers,
    disconnectedTargets: next.network.unreachableTargets
  };
}

export function updateVeinSize(scene, nextSize, options = {}) {
  const size = clamp(Number(nextSize) || scene.params.veinSize, 1.4, 2.8);
  if (Math.abs(size - scene.params.veinSize) < 0.001) {
    return { ok: false, reason: "参数没有变化" };
  }

  const before = cloneScene(scene);
  const next = cloneScene(scene);
  const oldSize = next.params.veinSize;
  next.params.veinSize = size;
  const changedMap = new Map();
  const affectedRects = [];
  let recomputedCells = 0;

  for (const vein of next.objects.veins) {
    const oldBounds = veinBounds(vein, oldSize);
    const newBounds = veinBounds(vein, size);
    const rect = {
      left: Math.min(oldBounds.left, newBounds.left),
      top: Math.min(oldBounds.top, newBounds.top),
      right: Math.max(oldBounds.right, newBounds.right),
      bottom: Math.max(oldBounds.bottom, newBounds.bottom)
    };
    affectedRects.push(rect);

    for (let y = rect.top; y <= rect.bottom; y += 1) {
      for (let x = rect.left; x <= rect.right; x += 1) {
        recomputedCells += 1;
        const index = indexOf(x, y, next.width);
        const desired =
          isVeinCell(next.seed, vein, x, y, size) &&
          nearestVein(next.objects.veins, x, y).id === vein.id;
        if (desired && next.grid[index] === TILE.ROCK) {
          next.grid[index] = TILE.ORE;
          changedMap.set(index, { x, y });
        } else if (
          !desired &&
          next.grid[index] === TILE.ORE &&
          isVeinCell(next.seed, vein, x, y, oldSize) &&
          nearestVein(next.objects.veins, x, y).id === vein.id
        ) {
          next.grid[index] = TILE.ROCK;
          changedMap.set(index, { x, y });
        }
      }
    }
  }

  const changedCells = [...changedMap.values()];
  next.revision += 1;
  next.layoutHash = computeLayoutHash(next);
  next.validation = validateScene(next);
  next.network = next.validation.network;
  const proof = changeInfo(before, next, affectedRects, changedCells);
  proof.recomputedCells = recomputedCells;
  proof.totalCells = next.width * next.height;
  proof.regionRatio = recomputedCells / proof.totalCells;

  const blockers = blockersForChange(before, next, changedCells);
  next.blockedMarkers = reconcileBlockedMarkers(next, blockers);
  next.editLog.push(
    makeLogEntry(
      before,
      "param",
      {
        label: `矿脉范围 ${oldSize.toFixed(2)} → ${size.toFixed(2)}`,
        x: null,
        y: null,
        reachable: next.validation.reachable,
        blockers,
        proof
      },
      options
    )
  );
  next.validation = validateScene(next);
  next.network = next.validation.network;
  return {
    ok: true,
    scene: next,
    proof,
    blockers,
    disconnectedTargets: next.network.unreachableTargets
  };
}

export function serializeScene(scene) {
  return {
    version: SAVE_VERSION,
    seed: scene.seed,
    width: scene.width,
    height: scene.height,
    params: { ...scene.params },
    objects: {
      entrance: { ...scene.objects.entrance },
      station: { ...scene.objects.station },
      veins: scene.objects.veins.map((vein) => ({ ...vein }))
    },
    grid: Array.from(scene.grid),
    editLog: scene.editLog.map((entry) => ({ ...entry })),
    blockedMarkers: (scene.blockedMarkers || []).map((marker) => ({
      ...marker
    })),
    digUsed: scene.digUsed,
    digLimit: scene.digLimit,
    revision: scene.revision,
    layoutHash: hashToHex(computeLayoutHash(scene))
  };
}

export function deserializeScene(payload) {
  if (!payload || payload.version !== SAVE_VERSION) {
    throw new Error("不支持的存档版本");
  }
  if (
    !Array.isArray(payload.grid) ||
    payload.grid.length !== payload.width * payload.height
  ) {
    throw new Error("存档网格尺寸不正确");
  }

  const scene = {
    version: SAVE_VERSION,
    seed: normalizeSeed(payload.seed),
    width: payload.width,
    height: payload.height,
    params: {
      veinSize: Number(payload.params.veinSize),
      tunnelWidth: Number(payload.params.tunnelWidth)
    },
    objects: {
      entrance: { ...payload.objects.entrance },
      station: { ...payload.objects.station },
      veins: payload.objects.veins.map((vein) => ({ ...vein }))
    },
    grid: Uint8Array.from(payload.grid),
    editLog: (payload.editLog || []).map((entry) => ({ ...entry })),
    blockedMarkers: (payload.blockedMarkers || []).map((marker) => ({
      ...marker
    })),
    digUsed: Number(payload.digUsed) || 0,
    digLimit: Number(payload.digLimit) || DIG_LIMIT,
    revision: Number(payload.revision) || 0
  };
  scene.layoutHash = computeLayoutHash(scene);
  scene.validation = validateScene(scene);
  scene.network = scene.validation.network;
  return {
    scene,
    savedHash: payload.layoutHash,
    loadedHash: hashToHex(scene.layoutHash),
    hashMatch: payload.layoutHash === hashToHex(scene.layoutHash)
  };
}

export function rulesSummary(scene) {
  return `3 矿脉 · ${scene.params.tunnelWidth} 格通道 · 4 邻接寻路 · 挖除上限 ${scene.digLimit}`;
}
