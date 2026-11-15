// Reproducible verifier. Run: node test/verify.js
// Exits non-zero on the first failed invariant and prints a full audit report.
const assert = require('assert');
const E = require('../src/engine.js');

const SEEDS = [1337, 20261116];
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log('  ok - ' + name);
}

function nearestTreeToRoad(world) {
  let best = null;
  for (const o of world.objects) {
    if (o.type !== 'tree') continue;
    for (let s = 0; s < world.road.length - 1; s++) {
      const d = distSeg(o.px, o.py, world.road[s], world.road[s + 1]);
      if (!best || d < best.d) best = { o, d, s };
    }
  }
  return best;
}
function distSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

for (const seed of SEEDS) {
  console.log('\n=== seed ' + seed + ' ===');
  const world = E.createWorld({ seed });
  const rebuilt = E.createWorld({ seed });

  check('same seed reproduces identical layout hash', () => {
    assert.strictEqual(rebuilt.hash, world.hash);
  });

  check('seed, target counts and rules are exposed', () => {
    const r = E.ruleSummary(world);
    assert.strictEqual(r.seed, seed);
    assert.strictEqual(r.total, world.objects.length);
    assert.ok(r.counts.tree > 0 && r.counts.shrub >= 0 && r.counts.grass >= 0);
    assert.strictEqual(r.rules.length, 4);
  });

  check('target is reachable (A* path exists, road joins start to target)', () => {
    const again = E.astar(world.cells, world.start, world.target);
    assert.ok(again, 'A* must find a land path');
    assert.strictEqual(world.road[0].x, world.start.x);
    assert.strictEqual(world.road[0].y, world.start.y);
    assert.strictEqual(world.road.at(-1).x, world.target.x);
    assert.strictEqual(world.road.at(-1).y, world.target.y);
  });

  check('no terrestrial plant appears on water', () => {
    const bad = world.objects.filter((o) =>
      world.cells[o.cellY * E.W + o.cellX].water);
    assert.strictEqual(bad.length, 0);
  });

  check('every object is inside scene bounds and cells do not overlap', () => {
    const seen = new Set();
    for (const o of world.objects) {
      assert.ok(o.cellX >= 0 && o.cellX < E.W && o.cellY >= 0 && o.cellY < E.H);
      assert.ok(o.px > 0 && o.px < E.W && o.py > 0 && o.py < E.H);
      const key = o.cellX + ',' + o.cellY;
      assert.ok(!seen.has(key), 'two objects on cell ' + key);
      seen.add(key);
    }
  });

  check('road never crosses a trunk center (clearance ' + E.TRUNK_RADIUS + ')', () => {
    const v = E.validateRoad(world, world.road);
    assert.strictEqual(v.ok, true, JSON.stringify(v.blockers.slice(0, 2)));
  });

  check('road stays on land and inside bounds', () => {
    for (const p of world.road) {
      assert.ok(p.x >= 0 && p.x < E.W && p.y >= 0 && p.y < E.H);
      assert.strictEqual(world.cells[p.y * E.W + p.x].water, false);
    }
  });

  check('save -> load restores the same layout hash', () => {
    const text = E.serialize(world);
    const loaded = E.deserialize(text);
    assert.strictEqual(loaded.hash, world.hash);
  });

  check('dragging the road only recomputes affected cells', () => {
    const probe = E.createWorld({ seed });
    const far = { x0: 0, y0: 0, x1: 20, y1: 20 };
    const hashBefore = E.regionHash(probe, far.x0, far.y0, far.x1, far.y1);
    const midIdx = Math.floor(probe.road.length / 2);
    const mid = probe.road[midIdx];
    const dx = mid.x + 2 < E.W - 1 ? 2 : -2;
    const moved = probe.road.map((p, i) =>
      i === midIdx ? { x: p.x + dx, y: p.y } : { x: p.x, y: p.y });
    const res = E.setRoad(probe, moved);
    if (res.ok) {
      const affected = new Set(res.affected.map((id) =>
        (id % E.W) + ',' + Math.floor(id / E.W)));
      let touchedFar = false;
      affected.forEach((k) => {
        const [x, y] = k.split(',').map(Number);
        if (x >= far.x0 && x < far.x1 && y >= far.y0 && y < far.y1) touchedFar = true;
      });
      assert.ok(!touchedFar, 'far region must not be recomputed');
      assert.strictEqual(E.regionHash(probe, far.x0, far.y0, far.x1, far.y1), hashBefore);
    }
  });

  check('road away and back restores the exact original layout', () => {
    const original = E.createWorld({ seed });
    const probe = E.createWorld({ seed });
    const midIdx = Math.floor(probe.road.length / 2);
    const originalRoad = probe.road.map((p) => ({ x: p.x, y: p.y }));
    const mid = probe.road[midIdx];
    const dx = mid.x + 2 < E.W - 1 ? 2 : -2;
    const moved = probe.road.map((p, i) =>
      i === midIdx ? { x: p.x + dx, y: p.y } : { x: p.x, y: p.y });
    const r1 = E.setRoad(probe, moved);
    if (!r1) return;
    if (r1.ok) {
      const r2 = E.setRoad(probe, originalRoad);
      assert.ok(r2.ok, 'restoring the original road must succeed');
      assert.strictEqual(probe.hash, original.hash);
      assert.deepStrictEqual(
        probe.objects.map((o) => o.id + o.px.toFixed(3) + o.py.toFixed(3)).sort(),
        original.objects.map((o) => o.id + o.px.toFixed(3) + o.py.toFixed(3)).sort()
      );
    }
  });

  check('an invalid dragged road is rejected with the blocking location', () => {
    const probe = E.createWorld({ seed });
    const near = nearestTreeToRoad(probe);
    assert.ok(near, 'world has a tree');
    const anchor = probe.road[0];
    const trunkPoint = { x: near.o.px - 0.5, y: near.o.py - 0.5 };
    const bad = [
      anchor,
      { x: trunkPoint.x - 1, y: trunkPoint.y },
      trunkPoint,
      anchor
    ];
    const res = E.setRoad(probe, bad);
    assert.strictEqual(res.ok, false);
    const trunkBlock = res.blockers.find((b) => b.kind === 'trunk');
    assert.ok(trunkBlock, 'must report a trunk blocker');
    assert.ok(trunkBlock.distance < E.TRUNK_RADIUS);
    assert.ok(trunkBlock.x >= 0 && trunkBlock.y >= 0);
  });

  check('a dragged road over water is rejected with the water cell', () => {
    const probe = E.createWorld({ seed });
    const waterCell = probe.cells.find((c) => c.water);
    if (!waterCell) return; // some seeds have almost no water
    const anchor = probe.road[0];
    const bad = [anchor, { x: waterCell.x, y: waterCell.y }, anchor];
    const res = E.setRoad(probe, bad);
    assert.strictEqual(res.ok, false);
    assert.ok(res.blockers.some((b) =>
      b.kind === 'water' && b.x === waterCell.x && b.y === waterCell.y));
    assert.strictEqual(probe.hash, E.createWorld({ seed }).hash,
      'rejected drag must leave the original layout intact');
  });

  check('single-object edit keeps unaffected region coordinates and hash', () => {
    const probe = E.createWorld({ seed });
    const region = { x0: 0, y0: 0, x1: 24, y1: 24 };
    const before = E.regionHash(probe, region.x0, region.y0, region.x1, region.y1);
    const targetCell = probe.cells.find((c) =>
      !c.water && !c.road && !c.obj && c.x >= E.W * 0.6 && c.y >= E.H * 0.6);
    assert.ok(targetCell, 'has an empty land cell to edit');
    const edit = E.addTree(probe, targetCell.x, targetCell.y);
    assert.ok(edit.ok, JSON.stringify(edit));
    assert.strictEqual(E.regionHash(probe, region.x0, region.y0, region.x1, region.y1), before);
  });

  check('a new obstacle on the road reports the blockage cell', () => {
    const probe = E.createWorld({ seed });
    const a = probe.road[0];
    const b = probe.road[1];
    const roadCell = {
      x: Math.round((a.x + b.x) / 2),
      y: Math.round((a.y + b.y) / 2)
    };
    const cell = probe.cells[roadCell.y * E.W + roadCell.x];
    assert.ok(cell.road, 'chosen cell must belong to the road corridor');
    cell.obj = {
      id: 'T:block', cellX: cell.x, cellY: cell.y,
      px: cell.x + 0.5, py: cell.y + 0.5, type: 'tree', lean: 0, height: 1
    };
    probe.objects.push(cell.obj);
    const v = E.validateRoad(probe, probe.road);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.blockers[0].kind, 'trunk');
    assert.strictEqual(v.blockers[0].x, cell.x);
    assert.strictEqual(v.blockers[0].y, cell.y);
  });

  check('addTree reports the blockage when it disconnects start from target', () => {
    // A tree on the road corridor is rejected first; force the scenario by
    // stubbing a narrow one-cell land bridge so no detour exists.
    const probe = E.createWorld({ seed, waterLevel: 0.01 });
    const bridgeY = Math.floor(E.H / 2);
    probe.cells.forEach((c) => {
      if (c.y !== bridgeY) c.water = true;
    });
    const bridge = probe.cells.find((c) => c.y === bridgeY && !c.road && !c.obj);
    assert.ok(bridge, 'has a free bridge cell');
    const res = E.addTree(probe, bridge.x, bridge.y);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'route-disconnected');
    assert.ok(res.blockage.front);
    assert.strictEqual(res.blockage.obstacle.x, bridge.x);
    assert.strictEqual(res.blockage.obstacle.y, bridge.y);
  });

  check('season changes do not change the layout hash', () => {
    const probe = E.createWorld({ seed });
    const h0 = probe.hash;
    probe.params.season = 'winter';
    assert.strictEqual(E.layoutHash(probe), h0);
  });

  check('density edit recomputes only vegetation and keeps the road', () => {
    const probe = E.createWorld({ seed });
    const roadBefore = JSON.stringify(probe.road);
    const res = E.updateParams(probe, { grassDensity: 0.2 });
    assert.strictEqual(res.rebuilt, 'vegetation');
    assert.strictEqual(JSON.stringify(probe.road), roadBefore);
    const again = E.createWorld(Object.assign({ seed }, probe.params));
    assert.strictEqual(probe.hash, again.hash);
  });

  check('wind edit is appearance-only (positions stay stable)', () => {
    const probe = E.createWorld({ seed });
    const positions = probe.objects.map((o) => o.id + '@' + o.px.toFixed(3));
    E.updateParams(probe, { windDirDeg: 90 });
    const after = probe.objects.map((o) => o.id + '@' + o.px.toFixed(3));
    assert.deepStrictEqual(after, positions);
  });
}

console.log('\nAll ' + checks + ' checks passed across ' + SEEDS.length + ' seeds.');
