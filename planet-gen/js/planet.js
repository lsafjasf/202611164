// Planet generation with per-chunk caching for incremental recompute.
import { Noise3D } from './noise.js';
import { buildIcosphere, buildFaceAdjacency } from './geometry.js';
import { mulberry32, hashObject, q } from './rng.js';

export const DEFAULT_PARAMS = {
  seed: 764001,
  detail: 4,          // icosphere subdivision (20 * 4^detail faces)
  seaLevel: 0.50,     // elevation threshold for ocean
  noiseScale: 1.9,    // continent frequency
  octaves: 4,
  heightAmp: 0.06,    // land height displacement
  polarCap: 0.74,     // |y| above this becomes ice
  cloudCoverage: 0.58,// cloud threshold (higher = fewer clouds)
  cloudScale: 3.0,
  cloudBands: 3,      // latitude band count
  atmoOffset: 0.015,  // atmosphere shell radius offset
  cloudOffset: 0.045, // cloud radius offset (always > atmoOffset)
  targetCount: 6,
  minTargetDist: 0.45,// min angular distance (radians) between targets
  rotationSpeed: 0.25,
};

const MIN_CLOUD_GAP = 0.01; // clouds must stay above atmosphere

export class Planet {
  constructor(params = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    if (this.params.cloudOffset < this.params.atmoOffset + MIN_CLOUD_GAP) {
      this.params.cloudOffset = this.params.atmoOffset + MIN_CLOUD_GAP;
    }
    this.geo = null;
    this.adj = null;
    this.elev = null; this.elevKey = '';
    this.chunkCache = new Map();
    this.cloudCache = null;
    this.objects = [];
    this.obstacles = [];
    this.routes = [];
    this.stats = { recomputedChunks: 0, totalChunks: 20, cloudRecomputed: false, targetsPlaced: 0 };
    this.regenerate();
  }

  // ---- deterministic sub-generators ----
  landNoise() { return new Noise3D(this.params.seed); }
  cloudNoise() { return new Noise3D((this.params.seed ^ 0x5bd1e995) >>> 0); }

  ensureGeometry() {
    const d = this.params.detail;
    if (this.geo && this.geo.detail === d) return;
    const g = buildIcosphere(d);
    this.geo = g;
    this.adj = buildFaceAdjacency(g.faces);
    this.elev = null;
    this._chunkY = null;
    this._chunkCenter = null;
    this.chunkCache.clear();
    this.cloudCache = null;
  }

  ensureElevations() {
    const p = this.params;
    const key = `${p.seed}|${p.noiseScale}|${p.octaves}|${p.detail}`;
    if (this.elev && this.elevKey === key) return;
    const noise = this.landNoise();
    const n = this.geo.verts.length;
    const elev = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = this.geo.verts[i];
      elev[i] = noise.fbm(v[0] * p.noiseScale, v[1] * p.noiseScale, v[2] * p.noiseScale, p.octaves);
    }
    this.elev = elev;
    this.elevKey = key;
    this.chunkCache.clear(); // elevations feed every chunk
  }

  // Per-VERTEX radius: adjacent faces share vertices -> no cracks.
  ensureVertRadius() {
    const p = this.params;
    const key = `${this.elevKey}|${q(p.seaLevel, 4)}|${q(p.heightAmp, 4)}`;
    if (this.vertRadius && this._vrKey === key) return;
    const n = this.geo.verts.length;
    const vr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const e = this.elev[i];
      vr[i] = e <= p.seaLevel ? 0.998 : 1 + (e - p.seaLevel) * p.heightAmp * 4;
    }
    this.vertRadius = vr;
    this._vrKey = key;
  }

  // Obstacles whose influence radius reaches this chunk (may span chunks).
  obstaclesForChunk(chunkId) {
    this.ensureChunkExtents();
    const ce = this._chunkCenter[chunkId], cr = this._chunkRadius[chunkId];
    return this.obstacles
      .filter(o => angularDist(o.pos, ce) < o.radius + cr)
      .map(o => o.id);
  }

  ensureChunkExtents() {
    if (this._chunkCenter) return;
    const n = this.geo.chunkCount;
    const sums = [];
    for (let i = 0; i < n; i++) sums.push([0, 0, 0]);
    const counts = new Float32Array(n);
    for (let f = 0; f < this.geo.faces.length; f++) {
      const c = this.geo.chunkOf[f];
      const ctr = this.faceCenter(f);
      sums[c][0] += ctr[0]; sums[c][1] += ctr[1]; sums[c][2] += ctr[2];
      counts[c]++;
    }
    this._chunkCenter = sums.map(s => {
      const l = Math.hypot(s[0], s[1], s[2]) || 1;
      return [s[0] / l, s[1] / l, s[2] / l];
    });
    this._chunkRadius = new Float32Array(n);
    for (let f = 0; f < this.geo.faces.length; f++) {
      const c = this.geo.chunkOf[f];
      for (const vi of this.geo.faces[f]) {
        const d = angularDist(this._chunkCenter[c], this.geo.verts[vi]);
        if (d > this._chunkRadius[c]) this._chunkRadius[c] = d;
      }
    }
  }

  chunkKey(chunkId) {
    const p = this.params;
    // polarCap only matters for chunks that reach polar latitudes.
    const polarRelevant = this.chunkMaxAbsY(chunkId) > p.polarCap - 0.18;
    return hashObject({
      c: chunkId,
      elevKey: this.elevKey,
      sea: q(p.seaLevel, 4),
      amp: q(p.heightAmp, 4),
      pol: polarRelevant ? q(p.polarCap, 4) : null,
      obs: this.obstaclesForChunk(chunkId),
      objs: this.objects.filter(o => o.chunk === chunkId).map(o => o.id),
    });
  }

  chunkMaxAbsY(chunkId) {
    if (!this._chunkY) {
      this._chunkY = new Float32Array(this.geo.chunkCount);
      for (let f = 0; f < this.geo.faces.length; f++) {
        const c = this.geo.chunkOf[f];
        for (const vi of this.geo.faces[f]) {
          const ay = Math.abs(this.geo.verts[vi][1]);
          if (ay > this._chunkY[c]) this._chunkY[c] = ay;
        }
      }
    }
    return this._chunkY[chunkId];
  }

  classifyFace(f) {
    const p = this.params;
    const [a, b, c] = this.geo.faces[f];
    const e = (this.elev[a] + this.elev[b] + this.elev[c]) / 3;
    const y = Math.abs((this.geo.verts[a][1] + this.geo.verts[b][1] + this.geo.verts[c][1]) / 3);
    if (this.faceBlocked(f)) return 'ocean';
    if (y > p.polarCap) return 'ice';
    if (e <= p.seaLevel) return 'ocean';
    const h = e - p.seaLevel;
    if (h < 0.012) return 'beach';
    if (h < 0.055) return 'grass';
    if (h < 0.10) return 'forest';
    if (h < 0.16) return 'rock';
    return 'snow';
  }

  faceBlocked(f) {
    if (this.obstacles.length === 0) return false;
    const c = this.faceCenter(f);
    for (const o of this.obstacles) {
      if (angularDist(c, o.pos) < o.radius) return true;
    }
    return false;
  }

  faceCenter(f) {
    const [a, b, c] = this.geo.faces[f];
    const va = this.geo.verts[a], vb = this.geo.verts[b], vc = this.geo.verts[c];
    const x = va[0] + vb[0] + vc[0], y = va[1] + vb[1] + vc[1], z = va[2] + vb[2] + vc[2];
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  }

  buildChunk(chunkId) {
    const key = this.chunkKey(chunkId);
    const cached = this.chunkCache.get(chunkId);
    if (cached && cached.key === key) return { data: cached.data, reused: true };
    const faces = [];
    for (let f = 0; f < this.geo.faces.length; f++) {
      if (this.geo.chunkOf[f] !== chunkId) continue;
      faces.push({ f, type: this.classifyFace(f) });
    }
    const objs = this.objects.filter(o => o.chunk === chunkId)
      .map(o => ({ id: o.id, pos: o.pos.map(v => q(v, 5)) }));
    const data = { faces, objs };
    const hash = hashObject({
      c: chunkId,
      faces: faces.map(x => {
        const [a, b, ci] = this.geo.faces[x.f];
        return [x.f, x.type, q(this.vertRadius[a], 5), q(this.vertRadius[b], 5), q(this.vertRadius[ci], 5)];
      }),
      objs,
    });
    this.chunkCache.set(chunkId, { key, data, hash });
    return { data, reused: false };
  }

  buildClouds() {
    const p = this.params;
    const key = hashObject({
      seed: p.seed, cov: q(p.cloudCoverage, 4), cs: q(p.cloudScale, 4),
      bands: p.cloudBands, detail: p.detail, off: q(p.cloudOffset, 4),
    });
    if (this.cloudCache && this.cloudCache.key === key) {
      return { data: this.cloudCache.data, reused: true };
    }
    const noise = this.cloudNoise();
    const faces = [];
    for (let f = 0; f < this.geo.faces.length; f++) {
      const c = this.faceCenter(f);
      const lat = Math.asin(c[1]);
      // cloud bands: modulate coverage by latitude bands
      const band = 0.5 + 0.5 * Math.sin(lat * p.cloudBands * 2.0 + 1.3);
      const v = noise.fbm(c[0] * p.cloudScale, c[1] * p.cloudScale, c[2] * p.cloudScale, 3);
      const threshold = p.cloudCoverage - band * 0.12;
      if (v > threshold) {
        const alpha = Math.min(0.85, (v - threshold) * 5 + 0.25);
        faces.push({ f, alpha: q(alpha, 3) });
      }
    }
    const data = { faces, radius: 1 + p.cloudOffset };
    this.cloudCache = { key, data, hash: hashObject(faces.map(x => [x.f, x.alpha])) };
    return { data, reused: false };
  }

  // ---- full / incremental regeneration ----
  regenerate() {
    this.ensureGeometry();
    this.ensureElevations();
    this.ensureVertRadius();
    // Targets must exist before chunks are built (chunk data embeds objects).
    if (this.objects.length !== this.params.targetCount) this.placeTargets();
    let recomputed = 0;
    this.chunks = [];
    for (let c = 0; c < this.geo.chunkCount; c++) {
      const r = this.buildChunk(c);
      if (!r.reused) recomputed++;
      this.chunks.push(r.data);
    }
    const cloud = this.buildClouds();
    this.clouds = cloud.data;
    this.stats.recomputedChunks = recomputed;
    this.stats.totalChunks = this.geo.chunkCount;
    this.stats.cloudRecomputed = !cloud.reused;
    this.computeRoutes();
    return this.stats;
  }

  // Update params; only affected chunks/layers are recomputed (cache keys decide).
  updateParams(patch) {
    Object.assign(this.params, patch);
    if (this.params.cloudOffset < this.params.atmoOffset + MIN_CLOUD_GAP) {
      this.params.cloudOffset = this.params.atmoOffset + MIN_CLOUD_GAP;
    }
    if (patch.detail !== undefined) this._chunkY = null;
    // Terrain-defining params invalidate placed targets (manual moves included).
    const terrainKeys = ['seed', 'noiseScale', 'octaves', 'seaLevel', 'detail'];
    if (terrainKeys.some(k => patch[k] !== undefined)) this.objects = [];
    return this.regenerate();
  }

  isLandFace(f) {
    const t = this.classifyFace(f);
    return t !== 'ocean';
  }

  placeTargets() {
    const p = this.params;
    const rng = mulberry32((p.seed ^ 0x7a9c3e1f) >>> 0);
    const targets = [];
    let attempts = 0;
    while (targets.length < p.targetCount && attempts < 20000) {
      attempts++;
      const f = Math.floor(rng() * this.geo.faces.length);
      if (!this.isLandFace(f)) continue;
      const pos = this.faceCenter(f);
      if (targets.some(t => angularDist(t.pos, pos) < p.minTargetDist)) continue;
      targets.push({
        id: targets.length, face: f, pos,
        chunk: this.geo.chunkOf[f],
      });
    }
    this.objects = targets;
    this.stats.targetsPlaced = targets.length;
  }

  computeRoutes() {
    this.routes = [];
    for (let i = 0; i + 1 < this.objects.length; i++) {
      const a = this.objects[i], b = this.objects[i + 1];
      const path = this.bfsPath(a.face, b.face);
      if (path) {
        this.routes.push({ segment: i, from: a.id, to: b.id, ok: true, path });
      } else {
        this.routes.push({
          segment: i, from: a.id, to: b.id, ok: false,
          blocking: this.findBlocking(a.pos, b.pos),
        });
      }
    }
  }

  bfsPath(fromFace, toFace) {
    if (!this.isLandFace(fromFace) || !this.isLandFace(toFace)) return null;
    const prev = new Map();
    const visited = new Set([fromFace]);
    const queue = [fromFace];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === toFace) {
        const path = [cur];
        let p = cur;
        while (prev.has(p)) { p = prev.get(p); path.unshift(p); }
        return path;
      }
      for (const nb of this.adj[cur]) {
        if (visited.has(nb) || !this.isLandFace(nb)) continue;
        visited.add(nb);
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
    return null;
  }

  // Identify which obstacle (or terrain gap) blocks the straight route a->b.
  findBlocking(posA, posB) {
    const samples = 64;
    for (const o of this.obstacles) {
      for (let s = 0; s <= samples; s++) {
        const p = slerp(posA, posB, s / samples);
        if (angularDist(p, o.pos) < o.radius) {
          return {
            kind: 'obstacle', obstacleId: o.id, chunk: o.chunk,
            lat: latOf(o.pos), lon: lonOf(o.pos),
            message: `障碍#${o.id} (区块${o.chunk}, 纬度${latOf(o.pos).toFixed(1)}°, 经度${lonOf(o.pos).toFixed(1)}°) 阻断了路线`,
          };
        }
      }
    }
    const mid = slerp(posA, posB, 0.5);
    return {
      kind: 'terrain', chunk: null,
      lat: latOf(mid), lon: lonOf(mid),
      message: `目标间陆地不连通（海域隔断），断点附近 纬度${latOf(mid).toFixed(1)}°, 经度${lonOf(mid).toFixed(1)}°`,
    };
  }

  addObstacle(pos, radius = 0.18) {
    // nearest face + chunk
    let best = -1, bestD = Infinity;
    for (let f = 0; f < this.geo.faces.length; f++) {
      const d = angularDist(this.faceCenter(f), pos);
      if (d < bestD) { bestD = d; best = f; }
    }
    const o = {
      id: this.obstacles.length, face: best,
      pos: this.faceCenter(best), radius,
      chunk: this.geo.chunkOf[best],
    };
    this.obstacles.push(o);
    // only the affected chunk needs recomputation
    this.chunkCache.delete(o.chunk);
    this.regenerate();
    return o;
  }

  // Move one target to a new face; only old/new chunks change hash.
  moveObject(id, newFace) {
    const obj = this.objects[id];
    if (!obj || !this.isLandFace(newFace)) return null;
    const before = this.regionHashes();
    const oldChunk = obj.chunk;
    obj.face = newFace;
    obj.pos = this.faceCenter(newFace);
    obj.chunk = this.geo.chunkOf[newFace];
    this.chunkCache.delete(oldChunk);
    this.chunkCache.delete(obj.chunk);
    this.regenerate();
    const after = this.regionHashes();
    const changed = [];
    for (let c = 0; c < after.length; c++) {
      if (before[c] !== after[c]) changed.push(c);
    }
    return { changedChunks: changed, before, after };
  }

  regionHashes() {
    const out = [];
    for (let c = 0; c < this.geo.chunkCount; c++) {
      out.push(this.chunkCache.get(c).hash);
    }
    return out;
  }

  layoutHash() {
    return hashObject({
      regions: this.regionHashes(),
      clouds: this.cloudCache.hash,
      objects: this.objects.map(o => ({ id: o.id, pos: o.pos.map(v => q(v, 5)) })),
      obstacles: this.obstacles.map(o => ({ id: o.id, pos: o.pos.map(v => q(v, 5)), r: o.radius })),
    });
  }

  ruleSummary() {
    const p = this.params;
    return `海平面=${p.seaLevel.toFixed(2)} 噪声尺度=${p.noiseScale} 倍频=${p.octaves} ` +
      `极冠|y|>${p.polarCap.toFixed(2)} 云覆盖率阈值=${p.cloudCoverage.toFixed(2)} 云带=${p.cloudBands} ` +
      `云层r=1+${p.cloudOffset.toFixed(3)}>大气r=1+${p.atmoOffset.toFixed(3)} ` +
      `目标=${p.targetCount} 最小间距=${p.minTargetDist}rad`;
  }
}

export function angularDist(a, b) {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d);
}

export function slerp(a, b, t) {
  const d = angularDist(a, b);
  if (d < 1e-9) return a.slice();
  const sa = Math.sin((1 - t) * d) / Math.sin(d);
  const sb = Math.sin(t * d) / Math.sin(d);
  return [
    a[0] * sa + b[0] * sb,
    a[1] * sa + b[1] * sb,
    a[2] * sa + b[2] * sb,
  ];
}

export function latOf(p) { return Math.asin(p[1]) * 180 / Math.PI; }
export function lonOf(p) { return Math.atan2(p[2], p[0]) * 180 / Math.PI; }
