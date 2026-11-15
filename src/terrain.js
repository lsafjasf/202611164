// Terrain generation: value-noise fBm elevation, water mask, land components.

import { ValueNoise2D } from './noise.js';
import { Rng } from './rng.js';
import { fnv1aBytes, toHex } from './hash.js';

export const DEFAULT_PARAMS = Object.freeze({
  width: 96,
  height: 72,
  waterLevel: 0.4,
  borderMargin: 4,
  minObjectSpacing: 6,
  villageCount: 4,
  towerCount: 3,
  supplyCount: 3,
  coverage: Object.freeze({ village: 8, tower: 12, supply: 6 }),
});

export function generateTerrain(seed, params) {
  const { width, height, waterLevel, borderMargin } = params;
  const noise = new ValueNoise2D(new Rng(seed + ':terrain').seed, 14);
  const elevation = new Float32Array(width * height);
  const water = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      elevation[i] = noise.fbm(x, y, 4);
      water[i] = elevation[i] < waterLevel ? 1 : 0;
    }
  }

  // Force a solid land border ring so the scene boundary is always passable.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onBorder =
        x < borderMargin || y < borderMargin ||
        x >= width - borderMargin || y >= height - borderMargin;
      if (onBorder) water[y * width + x] = 0;
    }
  }

  const component = largestLandComponent(width, height, water);
  for (let i = 0; i < water.length; i++) {
    if (!water[i] && !component.has(i)) water[i] = 1;
  }

  return { width, height, water, elevation, terrainHash: hashTerrain(width, height, water) };
}

export function isWater(terrain, x, y) {
  if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) return true;
  return terrain.water[y * terrain.width + x] === 1;
}

export function hashTerrain(width, height, water) {
  const prefix = new TextEncoder().encode(`terrain:${width}x${height}:`);
  const merged = new Uint8Array(prefix.length + water.length);
  merged.set(prefix, 0);
  merged.set(water, prefix.length);
  return toHex(fnv1aBytes(merged));
}

export function markWater(terrain, cells) {
  for (const [x, y] of cells) {
    if (x >= 0 && y >= 0 && x < terrain.width && y < terrain.height) {
      terrain.water[y * terrain.width + x] = 1;
    }
  }
  terrain.terrainHash = hashTerrain(terrain.width, terrain.height, terrain.water);
}

function largestLandComponent(width, height, water) {
  const total = width * height;
  const seen = new Uint8Array(total);
  let best = new Set();
  const stack = [];
  for (let start = 0; start < total; start++) {
    if (water[start] || seen[start]) continue;
    const current = new Set();
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop();
      current.add(idx);
      const x = idx % width;
      const y = (idx - x) / width;
      const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (!water[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    if (current.size > best.size) best = current;
  }
  return best;
}
