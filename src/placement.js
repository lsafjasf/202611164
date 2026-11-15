// Deterministic placement of villages, towers and supply points.

import { Rng } from './rng.js';
import { isWater } from './terrain.js';
import { euclidean, findPath } from './pathfinding.js';
import { canonicalHash } from './hash.js';

export const OBJECT_TYPES = {
  village: { color: '#e0a458', label: '村落' },
  tower: { color: '#7aa6e0', label: '塔楼' },
  supply: { color: '#6fcf97', label: '补给点' },
};

const TYPE_ORDER = ['village', 'tower', 'supply'];

export function objectHash(obj) {
  return canonicalHash({
    id: obj.id,
    type: obj.type,
    x: obj.x,
    y: obj.y,
  });
}

export function spacingValid(objects, x, y, minSpacing, ignoreId = null) {
  return objects.every(
    (o) => o.id === ignoreId || euclidean(o.x, o.y, x, y) >= minSpacing,
  );
}

function candidateCell(rng, terrain) {
  return {
    x: rng.int(0, terrain.width - 1),
    y: rng.int(0, terrain.height - 1),
  };
}

export function placeObjects(seed, terrain, params) {
  const rng = new Rng(seed + ':placement');
  const objects = [];
  const failures = [];
  let seq = 0;

  for (const type of TYPE_ORDER) {
    const count = params[`${type}Count`];
    for (let n = 0; n < count; n++) {
      const placed = tryPlace(type, rng, terrain, params, objects, seq);
      if (placed) {
        objects.push(placed);
        seq++;
      } else {
        failures.push({ type, reason: 'no valid cell after retries' });
      }
    }
  }
  return { objects, failures };
}

function tryPlace(type, rng, terrain, params, objects, seq) {
  const maxRetries = 400;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const cell = candidateCell(rng, terrain);
    if (isWater(terrain, cell.x, cell.y)) continue;
    if (!spacingValid(objects, cell.x, cell.y, params.minObjectSpacing)) continue;

    let connected = true;
    if (objects.length) {
      const anchor = objects[rng.int(0, objects.length - 1)];
      connected = findPath(terrain, cell, anchor) !== null;
    }
    if (!connected) continue;

    const obj = {
      id: `${type}-${seq}`,
      type,
      x: cell.x,
      y: cell.y,
      radius: params.coverage[type],
    };
    obj.hash = objectHash(obj);
    return obj;
  }
  return null;
}

export function validNewPosition(terrain, objects, x, y, minSpacing, movedId) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, reason: '坐标必须为整数' };
  if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) {
    return { ok: false, reason: '超出场景边界' };
  }
  if (isWater(terrain, x, y)) return { ok: false, reason: '目标位置位于水体' };
  if (!spacingValid(objects, x, y, minSpacing, movedId)) {
    return { ok: false, reason: `与其他地点间距小于 ${minSpacing}` };
  }
  return { ok: true };
}
