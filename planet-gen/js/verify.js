// Scene verification: boundary, non-overlap, reachability, hash reproducibility.
import { Planet, angularDist } from './planet.js';

export function checkBoundary(planet) {
  const p = planet.params;
  const rMin = 0.99, rMax = 1 + p.heightAmp * 4 * (1 - p.seaLevel) + 1e-3;
  let bad = 0, minR = Infinity, maxR = -Infinity;
  for (const r of planet.vertRadius) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (r < rMin - 1e-6 || r > rMax + 1e-6) bad++;
  }
  let offUnit = 0;
  for (const v of planet.geo.verts) {
    const l = Math.hypot(v[0], v[1], v[2]);
    if (Math.abs(l - 1) > 1e-6) offUnit++;
  }
  const cloudR = 1 + p.cloudOffset, atmoR = 1 + p.atmoOffset;
  const layerOk = cloudR > atmoR && atmoR > 1;
  return {
    ok: bad === 0 && offUnit === 0 && layerOk,
    details: `半径范围 [${minR.toFixed(4)}, ${maxR.toFixed(4)}] ⊆ [${rMin}, ${rMax.toFixed(4)}]; ` +
      `非单位顶点=${offUnit}; 云层r=${cloudR.toFixed(3)} > 大气r=${atmoR.toFixed(3)} > 表面r=1`,
  };
}

export function checkNonOverlap(planet) {
  const objs = planet.objects;
  let minD = Infinity, pair = null;
  for (let i = 0; i < objs.length; i++) {
    for (let j = i + 1; j < objs.length; j++) {
      const d = angularDist(objs[i].pos, objs[j].pos);
      if (d < minD) { minD = d; pair = [i, j]; }
    }
  }
  const ok = objs.length < 2 || minD >= planet.params.minTargetDist - 1e-9;
  return {
    ok,
    details: objs.length < 2
      ? `目标数=${objs.length}，无需间距检查`
      : `最近目标对 #${pair[0]}-#${pair[1]} 角距=${minD.toFixed(3)}rad (要求≥${planet.params.minTargetDist})`,
  };
}

export function checkReachability(planet) {
  const broken = planet.routes.filter(r => !r.ok);
  if (broken.length === 0) {
    const hops = planet.routes.reduce((s, r) => s + r.path.length, 0);
    return { ok: true, details: `全部 ${planet.routes.length} 段路线连通，共 ${hops} 个面片` };
  }
  const msgs = broken.map(r =>
    `段${r.segment}(目标#${r.from}→#${r.to})断开: ${r.blocking.message}`);
  return { ok: false, details: msgs.join('\n'), broken };
}

// Re-generate from identical params in a fresh instance; layout hash must match.
export function checkReproducibility(planet) {
  const clone = new Planet({ ...planet.params });
  clone.obstacles = planet.obstacles.map(o => ({ ...o, pos: o.pos.slice() }));
  clone.objects = planet.objects.map(o => ({ ...o, pos: o.pos.slice() }));
  clone.chunkCache.clear();
  clone.regenerate();
  const h1 = planet.layoutHash();
  const h2 = clone.layoutHash();
  return {
    ok: h1 === h2,
    details: `当前=${h1} 重算=${h2} ${h1 === h2 ? '一致' : '不一致!'}`,
    hash: h1,
  };
}

export function runAllChecks(planet) {
  return {
    boundary: checkBoundary(planet),
    nonOverlap: checkNonOverlap(planet),
    reachability: checkReachability(planet),
    reproducibility: checkReproducibility(planet),
  };
}
