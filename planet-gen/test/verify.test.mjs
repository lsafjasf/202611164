// Reproducibility & incremental-recompute test suite (plain node run).
import { Planet } from '../js/planet.js';
import { runAllChecks } from '../js/verify.js';

let passed = 0, failed = 0;
function assert(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

const SEEDS = [764001, 924202];

console.log('== 1. 两个 seed 生成 + 全部校验 ==');
const planets = {};
for (const seed of SEEDS) {
  const p = new Planet({ seed });
  planets[seed] = p;
  const r = runAllChecks(p);
  console.log(` seed ${seed}: 目标=${p.objects.length} 布局哈希=${p.layoutHash()}`);
  assert(r.boundary.ok, `seed ${seed} 场景边界正确`, r.boundary.details);
  assert(r.nonOverlap.ok, `seed ${seed} 关键对象不重叠`, r.nonOverlap.details);
  assert(r.reachability.ok, `seed ${seed} 目标可达`, r.reachability.details);
  assert(r.reproducibility.ok, `seed ${seed} 可复现(独立实例哈希一致)`);
}

console.log('== 2. 切换 seed 大陆轮廓变化 ==');
const h1 = planets[SEEDS[0]].layoutHash();
const h2 = planets[SEEDS[1]].layoutHash();
assert(h1 !== h2, '两个 seed 布局哈希不同');
const landCount = p => p.chunks.flatMap(c => c.faces).filter(f => f.type !== 'ocean' && f.type !== 'ice').length;
console.log(`  陆地面片数: seed${SEEDS[0]}=${landCount(planets[SEEDS[0]])} seed${SEEDS[1]}=${landCount(planets[SEEDS[1]])}`);

console.log('== 3. 显式重生成哈希不变 ==');
{
  const p = planets[SEEDS[0]];
  const before = p.layoutHash();
  p.chunkCache.clear(); p.cloudCache = null;
  p.regenerate();
  assert(p.layoutHash() === before, '显式重生成后布局哈希一致');
}

console.log('== 4. 修改参数只重算受影响区域 ==');
{
  const p = new Planet({ seed: SEEDS[0] });
  p.regenerate(); // warm cache
  let s = p.updateParams({ polarCap: p.params.polarCap - 0.05 });
  assert(s.recomputedChunks < s.totalChunks && s.recomputedChunks > 0,
    `极冠参数只重算极区区块 (${s.recomputedChunks}/${s.totalChunks})`);
  assert(!s.cloudRecomputed, '极冠参数不影响云层');
  s = p.updateParams({ cloudCoverage: p.params.cloudCoverage + 0.05 });
  assert(s.recomputedChunks === 0, `云参数不重算地表区块 (${s.recomputedChunks})`);
  assert(s.cloudRecomputed, '云参数重算云层');
  const hashesBefore = p.regionHashes();
  s = p.updateParams({ cloudCoverage: p.params.cloudCoverage + 0.02 });
  assert(p.regionHashes().every((h, i) => h === hashesBefore[i]), '云参数改动后地表区块哈希全部不变');
}

console.log('== 5. 修改单个对象，未受影响区域坐标与哈希不变 ==');
{
  const p = new Planet({ seed: SEEDS[0] });
  const obj = p.objects[0];
  let newFace = -1;
  for (let f = 0; f < p.geo.faces.length; f++) {
    if (p.geo.chunkOf[f] !== obj.chunk && p.isLandFace(f)) { newFace = f; break; }
  }
  const before = p.regionHashes();
  const res = p.moveObject(0, newFace);
  assert(res !== null, '目标可移动到新陆地位置');
  const changed = res.changedChunks;
  assert(changed.length <= 2, `仅 ${changed.length} 个区块哈希变化: [${changed}]`);
  const unchangedOk = before.every((h, i) =>
    changed.includes(i) || h === res.after[i]);
  assert(unchangedOk, '未受影响区块哈希保持不变');
  assert(p.stats.recomputedChunks <= 2, `仅重算 ${p.stats.recomputedChunks} 个区块`);
}

console.log('== 6. 障碍阻断路线并报告位置 ==');
{
  const p = new Planet({ seed: SEEDS[0] });
  assert(p.routes.every(r => r.ok), '初始路线全部连通');
  const dest = p.objects[1];
  const hashesBefore = p.regionHashes();
  const o = p.addObstacle(dest.pos, 0.12);
  const broken = p.routes.filter(r => !r.ok);
  assert(broken.length > 0, `障碍后 ${broken.length} 段路线断开`);
  const b = broken[0].blocking;
  assert(b && b.kind === 'obstacle' && typeof b.lat === 'number' && typeof b.lon === 'number',
    `阻断位置已报告: ${b ? b.message : '无'}`);
  const hashesAfter = p.regionHashes();
  const changed = hashesBefore.filter((h, i) => h !== hashesAfter[i]).length;
  assert(changed >= 1 && changed <= p.stats.recomputedChunks && p.stats.recomputedChunks <= 8,
    `障碍仅重算受影响区块 (重算${p.stats.recomputedChunks}, 哈希变化${changed}, 共${p.stats.totalChunks})`);
}

console.log('== 7. 保存参数再载入，布局哈希一致 ==');
{
  const p = new Planet({ seed: SEEDS[1], targetCount: 8 });
  p.addObstacle(p.objects[0].pos, 0.15);
  const saved = JSON.stringify({
    params: p.params,
    obstacles: p.obstacles.map(o => ({ pos: o.pos, radius: o.radius })),
    objects: p.objects.map(o => ({ face: o.face, pos: o.pos })),
    layoutHash: p.layoutHash(),
  });
  const data = JSON.parse(saved);
  const q = new Planet(data.params);
  for (const o of data.obstacles) q.addObstacle(o.pos, o.radius);
  q.objects = data.objects.map((o, i) => ({ id: i, face: o.face, pos: o.pos, chunk: q.geo.chunkOf[o.face] }));
  q.chunkCache.clear();
  q.regenerate();
  assert(q.layoutHash() === data.layoutHash, `载入后哈希一致 (${q.layoutHash()})`);
}

console.log('== 8. 云层始终位于大气上方 ==');
{
  const p = new Planet({ seed: SEEDS[0], atmoOffset: 0.05, cloudOffset: 0.01 });
  assert(p.params.cloudOffset > p.params.atmoOffset,
    `云层偏移 ${p.params.cloudOffset.toFixed(3)} > 大气 ${p.params.atmoOffset.toFixed(3)} (自动修正)`);
  assert(p.clouds.radius > 1 + p.params.atmoOffset, '云半径大于大气半径');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
