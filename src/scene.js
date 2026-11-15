// Scene model: owns terrain, objects, route network, edit log and hashes.

import { DEFAULT_PARAMS, generateTerrain, markWater } from './terrain.js';
import { placeObjects, objectHash, validNewPosition } from './placement.js';
import { buildNetwork, recomputeIncident, verifyNetwork } from './network.js';
import { canonicalHash, combineHash } from './hash.js';

export class Scene {
  constructor(seed, params = DEFAULT_PARAMS) {
    this.seed = String(seed);
    this.params = structuredClone(params);
    this.editLog = [];
    this.generation = 0;
    this.lastBlocked = [];
    this.affectedRegion = null;
    this._replaying = false;
    this._buildFresh();
  }

  _buildFresh() {
    this.terrain = generateTerrain(this.seed, this.params);
    const { objects, failures } = placeObjects(this.seed, this.terrain, this.params);
    this.objects = objects;
    this.placementFailures = failures;
    this.edges = buildNetwork(this.terrain, this.objects);
    this.generation++;
  }

  getObject(id) {
    return this.objects.find((o) => o.id === id);
  }

  validateMove(id, x, y) {
    return validNewPosition(
      this.terrain, this.objects, x, y, this.params.minObjectSpacing, id);
  }

  moveObject(id, x, y) {
    const check = this.validateMove(id, x, y);
    if (!check.ok) return { ok: false, reason: check.reason, blocked: [], rebuiltEdges: [] };

    const obj = this.getObject(id);
    if (!obj) return { ok: false, reason: '对象不存在', blocked: [], rebuiltEdges: [] };
    const from = { x: obj.x, y: obj.y };
    const before = this._objectHashes();

    obj.x = x;
    obj.y = y;
    obj.hash = objectHash(obj);

    const result = recomputeIncident(this.terrain, this.objects, this.edges, id);
    this.lastBlocked = result.blocked;
    this.affectedRegion = boundingRegion([
      from, { x, y },
      ...this.objects.filter((o) => o.id !== id).map((o) => ({ x: o.x, y: o.y }))
        .filter((p) => Math.hypot(p.x - x, p.y - y) <= this.params.minObjectSpacing * 2),
    ], 2);

    if (!this._replaying) {
      this.editLog.push({ kind: 'move', id, from, to: { x, y }, at: this.editLog.length });
    }
    return {
      ok: true,
      changedObjects: changedKeys(before, this._objectHashes()),
      rebuiltEdges: result.rebuilt,
      blocked: result.blocked,
    };
  }

  addObstacle(cells) {
    const before = this._edgeHashes();
    const normalized = cells.map(([x, y]) => [x, y]);
    const blockedObjects = this.objects.filter((o) =>
      normalized.some(([x, y]) => x === o.x && y === o.y));
    if (blockedObjects.length) {
      return { ok: false, reason: `障碍与地点重叠: ${blockedObjects.map((o) => o.id).join(', ')}` };
    }
    markWater(this.terrain, normalized);
    const blocked = verifyNetwork(this.terrain, this.objects, this.edges);
    for (const report of blocked) report.barrierCells = normalized;
    this.lastBlocked = blocked;
    this.affectedRegion = boundingRegion(normalized.map(([x, y]) => ({ x, y })), 3);
    if (!this._replaying) {
      this.editLog.push({ kind: 'obstacle', cells: normalized, at: this.editLog.length });
    }
    return {
      ok: true,
      changedEdges: changedKeys(before, this._edgeHashes()),
      blocked,
    };
  }

  // Parameter changes only rebuild affected parts:
  // spacing/counts affect placement; coverage only changes per-object radius.
  updateParams(nextParams) {
    const before = this._objectHashes();
    const prev = this.params;
    this.params = structuredClone(nextParams);
    const placementKeys = [
      'width', 'height', 'waterLevel', 'borderMargin',
      'minObjectSpacing', 'villageCount', 'towerCount', 'supplyCount',
    ];
    const terrainChanged = placementKeys
      .some((k) => JSON.stringify(prev[k]) !== JSON.stringify(this.params[k]));

    if (terrainChanged) {
      this._buildFresh();
      this.editLog = [];
      this.affectedRegion = null;
      return { ok: true, rebuilt: 'full', changedObjects: this.objects.map((o) => o.id) };
    }

    for (const obj of this.objects) {
      obj.radius = this.params.coverage[obj.type];
    }
    if (!this._replaying) {
      this.editLog.push({ kind: 'params', params: structuredClone(this.params), at: this.editLog.length });
    }
    const changedObjects = changedKeys(before, this._objectHashes());
    return { ok: true, rebuilt: 'coverage-only', changedObjects, note: '仅覆盖半径变化，坐标与对象哈希不变' };
  }

  regenerate() {
    this.editLog = [];
    this.lastBlocked = [];
    this.affectedRegion = null;
    this._buildFresh();
    return { ok: true };
  }

  _objectHashes() {
    const map = {};
    for (const o of this.objects) map[o.id] = objectHash(o);
    return map;
  }

  _edgeHashes() {
    const map = {};
    for (const [key, edge] of this.edges) map[key] = edge.hash;
    return map;
  }

  layoutHash() {
    return combineHash([
      this.terrain.terrainHash,
      ...this.objects.map(objectHash),
      ...[...this.edges.values()].map((e) => e.hash),
      canonicalHash(this.params),
    ]);
  }

  rulesSummary() {
    const p = this.params;
    return [
      `网格 ${p.width}×${p.height}`,
      `水位阈值 ${p.waterLevel}`,
      `最小间距 ${p.minObjectSpacing}`,
      `村落×${p.villageCount}(r${p.coverage.village})`,
      `塔楼×${p.towerCount}(r${p.coverage.tower})`,
      `补给×${p.supplyCount}(r${p.coverage.supply})`,
    ].join(' · ');
  }

  targetCount() {
    return this.params.villageCount + this.params.towerCount + this.params.supplyCount;
  }

  toJSON() {
    return {
      version: 1,
      seed: this.seed,
      params: this.params,
      editLog: this.editLog,
      layoutHash: this.layoutHash(),
    };
  }

  static async fromJSON(data) {
    const scene = new Scene(data.seed, data.params);
    scene.editLog = [];
    scene._replaying = true;
    for (const edit of data.editLog) {
      if (edit.kind === 'move') {
        const result = scene.moveObject(edit.id, edit.to.x, edit.to.y);
        if (!result.ok) throw new Error(`回放移动失败: ${result.reason}`);
      } else if (edit.kind === 'obstacle') {
        const result = scene.addObstacle(edit.cells);
        if (!result.ok) throw new Error(`回放障碍失败: ${result.reason}`);
      } else if (edit.kind === 'params') {
        scene.updateParams(edit.params);
      }
    }
    scene._replaying = false;
    scene.editLog = data.editLog.map((e) => ({ ...e }));
    return { scene, restoredHash: scene.layoutHash(), savedHash: data.layoutHash };
  }
}

function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => before[k] !== after[k]);
}

function boundingRegion(points, pad) {
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs) - pad,
    maxX: Math.max(...xs) + pad,
    minY: Math.min(...ys) - pad,
    maxY: Math.max(...ys) + pad,
  };
}
