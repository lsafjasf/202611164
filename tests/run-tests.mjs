import assert from 'node:assert/strict';
import { generateCity } from '../src/generator.js';
import { verifySeeds, verifyReproducibility } from '../src/verify.js';
import { serializeCity, deserializeCity, layoutFingerprint, cellHash, keyOf, inBounds } from '../src/model.js';
import { editCell } from '../src/edit.js';
import { findPath, targetReachability, connectedComponents, findBlockingBuildings } from '../src/path.js';
import { paintOrder, sceneBounds, project, roofRise } from '../src/geometry.js';
import { shortHash } from '../src/hash.js';
import { clampView, clampRules } from '../src/rules.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err.stack);
    process.exitCode = 1;
  }
}

const SEEDS = [20261116, 777, 4242];
const cities = new Map();

console.log('1. Fixed-seed reproducibility across multiple seeds');
for (const seed of SEEDS) {
  test(`seed ${seed}: reproducible hash, reachable targets, no overlap, in bounds`, () => {
    const report = verifyReproducibility({ seed });
    cities.set(seed, generateCity({ seed }));
    assert.equal(report.reproducible, true);
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.equal(report.allTargetsReachable, true);
    assert.deepEqual(report.overlapIssues, []);
    assert.equal(report.targetCount, clampRules({ seed }).targetCount);
  });
}

console.log('2. Different seeds produce different layouts');
test('two seeds diverge', () => {
  const a = shortHash(layoutFingerprint(cities.get(777)));
  const b = shortHash(layoutFingerprint(cities.get(4242)));
  assert.notEqual(a, b);
});

console.log('3. Depth ordering is correct for iso occlusion');
test('paint order sorted by x+y then x', () => {
  const city = cities.get(777);
  const order = paintOrder(city);
  for (let i = 1; i < order.length; i++) {
    const prev = order[i - 1];
    const cur = order[i];
    assert.ok(prev.x + prev.y <= cur.x + cur.y);
    if (prev.x + prev.y === cur.x + cur.y) assert.ok(prev.x <= cur.x);
  }
});

console.log('4. Scene bounds contain every projected point');
test('bounds envelope all vertices', () => {
  const city = cities.get(777);
  const view = clampView({});
  const bounds = sceneBounds(city, view);
  for (const cell of city.cells.values()) {
    const top = cell.type === 'building' ? cell.floors + roofRise(cell) : 0;
    for (const z of [0, top]) {
      for (const [cx, cy] of [[cell.x, cell.y], [cell.x + 1, cell.y + 1]]) {
        const p = project(cx, cy, z, view);
        assert.ok(p.x >= bounds.minX && p.x <= bounds.maxX);
        assert.ok(p.y >= bounds.minY && p.y <= bounds.maxY);
      }
    }
  }
  assert.ok(bounds.width > 0 && bounds.height > 0);
});

console.log('5. Single-object edit changes only that cell');
test('editing one building keeps every other cell hash identical', () => {
  const city = cities.get(777);
  const before = [...city.cells.values()].map((c) => [keyOf(c.x, c.y), cellHash(c)]);
  const target = [...city.cells.values()].find((c) => c.type === 'plaza' || c.type === 'green');
  assert.ok(target);
  const { city: edited, changed } = editCell(city, target.x, target.y, { kind: 'building', floors: 5, roof: 'gable' });
  assert.notEqual(changed[0], changed[1]);
  let changedCount = 0;
  for (const [k, hash] of before) {
    const now = cellHash(edited.cells.get(k));
    if (now !== hash) {
      changedCount++;
      assert.equal(k, keyOf(target.x, target.y));
    }
  }
  assert.equal(changedCount, 1);
  // Original city object stays untouched (immutable edit).
  assert.equal(city.cells.get(keyOf(target.x, target.y)).type, target.type);
});

test('roof/floor edit of a building preserves neighbor coordinates', () => {
  const city = cities.get(4242);
  const building = [...city.cells.values()].find((c) => c.type === 'building');
  const neighborKeys = [...city.cells.values()]
    .filter((c) => !(c.x === building.x && c.y === building.y))
    .map((c) => cellHash(c));
  const { city: edited } = editCell(city, building.x, building.y, { kind: 'building', floors: building.floors + 1, roof: 'pyramid' });
  const afterKeys = [...edited.cells.values()]
    .filter((c) => !(c.x === building.x && c.y === building.y))
    .map((c) => cellHash(c));
  assert.deepEqual(afterKeys, neighborKeys);
  const editedCell = edited.cells.get(keyOf(building.x, building.y));
  assert.equal(editedCell.floors, building.floors + 1);
  assert.equal(editedCell.roof, 'pyramid');
});

console.log('6. View parameters do not change layout hashes');
test('floorHeight / hideBelow leave semantic layout hash intact', () => {
  const city = cities.get(777);
  const h = shortHash(layoutFingerprint(city));
  const tall = clampView({ floorHeight: 60, hideBelow: 3 });
  const small = clampView({ floorHeight: 8, hideBelow: 0 });
  assert.equal(shortHash(layoutFingerprint(city)), h);
  assert.notDeepEqual(sceneBounds(city, tall), sceneBounds(city, small));
});

console.log('7. Save then load restores identical layout hash');
test('serialize/deserialize round trip preserves fingerprint', () => {
  for (const seed of SEEDS) {
    const city = cities.get(seed);
    const text = serializeCity(city);
    const restored = deserializeCity(text);
    assert.equal(layoutFingerprint(restored), layoutFingerprint(city));
    assert.equal(shortHash(layoutFingerprint(restored)), shortHash(layoutFingerprint(city)));
    assert.deepEqual(restored.targets, city.targets);
  }
});

console.log('8. Blocking obstacle disconnects routes and is pinpointed');
test('building cut across a corridor yields broken pair + blocker coordinate', () => {
  const city = cities.get(20261116);
  // Find a road cell on the BFS path between two targets and block it.
  const t0 = city.targets[0];
  const t1 = city.targets[1];
  const path = findPath(city, t0, t1);
  assert.ok(path && path.length > 2);
  const mid = path[Math.floor(path.length / 2)];
  const { city: blocked } = editCell(city, mid.x, mid.y, { kind: 'building', floors: 9, roof: 'flat' });
  const reach = targetReachability(blocked);
  assert.ok(reach.pairs.some((p) => !p.reachable));
  assert.equal(findPath(blocked, t0, t1), null);
  const diagnosis = findBlockingBuildings(blocked);
  assert.ok(diagnosis.broken.length >= 1);
  assert.ok(diagnosis.blockers.some((b) => b.x === mid.x && b.y === mid.y));
  // Baseline city remains healthy.
  assert.ok(targetReachability(city).pairs.every((p) => p.reachable));
});

console.log('9. Every cell stays inside grid bounds after edits');
test('edited cell still in bounds, component count is finite', () => {
  const city = cities.get(4242);
  const road = [...city.cells.values()].find((c) => c.type === 'road');
  const { city: edited } = editCell(city, road.x, road.y, { kind: 'building', floors: 2, roof: 'hip' });
  for (const cell of edited.cells.values()) assert.ok(inBounds(edited.rules, cell.x, cell.y));
  assert.ok(connectedComponents(edited).length >= 1);
});

console.log(`\n${passed} checks passed`);
if (process.exitCode) console.error('SUITE FAILED');
else console.log('SUITE GREEN');
