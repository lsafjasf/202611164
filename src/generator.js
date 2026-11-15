import { mulberry32, randInt, weightedPick } from './rng.js';
import { ROOF_STYLES, clampRules } from './rules.js';
import { keyOf, makeCity, inBounds } from './model.js';

function corridorOffsets(width) {
  if (width <= 1) return [[0, 0]];
  if (width === 2) return [[0, 0], [1, 0], [0, 1], [1, 1]];
  return [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]];
}

function carveRoad(city, rules, x, y, occupied, offsets) {
  for (const [dx, dy] of offsets) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(rules, nx, ny)) continue;
    const k = keyOf(nx, ny);
    if (occupied.has(k)) continue;
    occupied.add(k);
    city.roadSet.add(k);
    city.cells.set(k, { x: nx, y: ny, type: 'road', floors: 0 });
  }
}

function lPath(x0, y0, x1, y1, horizontalFirst) {
  const path = [];
  if (horizontalFirst) {
    const stepX = Math.sign(x1 - x0);
    for (let x = x0; x !== x1; x += stepX) path.push([x, y0]);
    const stepY = Math.sign(y1 - y0);
    for (let y = y0; y !== y1; y += stepY) path.push([x1, y]);
  } else {
    const stepY = Math.sign(y1 - y0);
    for (let y = y0; y !== y1; y += stepY) path.push([x0, y]);
    const stepX = Math.sign(x1 - x0);
    for (let x = x0; x !== x1; x += stepX) path.push([x, y1]);
  }
  path.push([x1, y1]);
  return path;
}

// Pure deterministic generator: identical rules => identical city.
export function generateCity(rawRules, injectedRng) {
  const rules = clampRules(rawRules);
  const rng = injectedRng ?? mulberry32(rules.seed);
  const city = makeCity(rules);
  const occupied = new Set();
  const margin = rules.margin;

  // 1) Place targets with jittered farthest-point selection (spread, no overlap).
  const candidates = [];
  for (let y = margin; y < rules.height - margin; y++) {
    for (let x = margin; x < rules.width - margin; x++) candidates.push([x, y]);
  }
  if (candidates.length < rules.targetCount) {
    throw new Error('grid too small for requested target count');
  }
  const first = candidates[randInt(rng, 0, candidates.length - 1)];
  const placed = [first];
  while (placed.length < rules.targetCount) {
    let best = null;
    let bestScore = -Infinity;
    for (const [x, y] of candidates) {
      if (placed.some(([px, py]) => px === x && py === y)) continue;
      const minDist = Math.min(...placed.map(([px, py]) => Math.abs(px - x) + Math.abs(py - y)));
      const score = minDist + rng() * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
    placed.push(best);
  }
  placed.forEach(([x, y], i) => {
    const id = `T${i + 1}`;
    const k = keyOf(x, y);
    occupied.add(k);
    city.targets.push({ id, x, y });
    city.cells.set(k, { x, y, type: 'target', floors: 0, targetId: id });
  });

  // 2) Chain targets with randomized L-shaped corridors => connected road graph.
  const offsets = corridorOffsets(rules.corridorWidth);
  for (let i = 0; i < placed.length - 1; i++) {
    const [x0, y0] = placed[i];
    const [x1, y1] = placed[i + 1];
    const path = lPath(x0, y0, x1, y1, rng() < 0.5);
    for (const [x, y] of path) carveRoad(city, rules, x, y, occupied, offsets);
  }

  // 3) Fill remaining cells deterministically (row-major order).
  for (let y = 0; y < rules.height; y++) {
    for (let x = 0; x < rules.width; x++) {
      const k = keyOf(x, y);
      if (occupied.has(k)) continue;
      const inside = x >= margin && y >= margin && x < rules.width - margin && y < rules.height - margin;
      if (!inside) {
        city.cells.set(k, { x, y, type: 'green', floors: 0 });
        continue;
      }
      const type = weightedPick(rng, [
        ['building', rules.buildingWeight],
        ['plaza', rules.plazaWeight],
        ['green', rules.greenWeight],
      ]);
      if (type === 'building') {
        const floors = randInt(rng, rules.minFloors, rules.maxFloors);
        const roof = ROOF_STYLES[randInt(rng, 0, ROOF_STYLES.length - 1)];
        city.cells.set(k, { x, y, type: 'building', floors, roof });
      } else {
        city.cells.set(k, { x, y, type, floors: 0 });
      }
      occupied.add(k);
    }
  }
  return city;
}
