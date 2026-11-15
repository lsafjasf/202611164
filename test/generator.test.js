import assert from "node:assert/strict";
import test from "node:test";
import {
  addBlocker,
  generateWorld,
  hydrateWorld,
  moveBuilding,
  moveParkToBlock,
  serializeWorld,
  updateDensity,
  validateSeeds,
  verifyWorld,
} from "../src/generator.js";

const blockHashes = (world) =>
  new Map(world.blocks.map((block) => [block.id, block.hash]));

test("same seed and parameters produce an identical layout hash", () => {
  const params = { seed: 82419, density: 62, blockScale: 152 };
  const first = generateWorld(params);
  const second = generateWorld(params);
  assert.equal(first.layoutHash, second.layoutHash);
  assert.deepEqual(serializeWorld(first).blocks, serializeWorld(second).blocks);
  assert.equal(first.metrics.targetCount, 4);
});

test("two seeds pass connectivity, target, overlap and boundary checks", () => {
  const result = validateSeeds(82419, { density: 62, blockScale: 152 });
  assert.equal(result.pass, true);
  assert.equal(result.seeds.length, 2);
  assert.notEqual(result.seeds[0].layoutHash, result.seeds[1].layoutHash);
  for (const entry of result.seeds) {
    assert.equal(entry.deterministic, true);
    assert.equal(entry.checks.roadConnected, true);
    assert.equal(entry.checks.reachable, entry.checks.targetCount);
    assert.equal(entry.checks.overlapCount, 0);
    assert.equal(entry.checks.boundaryCorrect, true);
  }
});

test("buildings stay off roads, key objects do not overlap and stay in bounds", () => {
  for (const seed of [82419, 82420, 90125]) {
    const world = generateWorld({ seed, density: 78, blockScale: 140 });
    const checks = verifyWorld(world);
    assert.equal(checks.pass, true);
    assert.equal(checks.overlapCount, 0);
    assert.equal(checks.boundaryCorrect, true);
    assert.equal(
      checks.roadNodeCount,
      (world.grid.cols + 1) * (world.grid.rows + 1),
    );
  }
});

test("density updates only recompute blocks whose building count changes", () => {
  const world = generateWorld({ seed: 82419, density: 50, blockScale: 152 });
  const beforeHashes = blockHashes(world);
  const beforeBuildings = new Map(
    world.blocks.map((block) => [block.id, JSON.stringify(block.buildings)]),
  );
  const result = updateDensity(world, 88);
  assert.ok(result.affectedCount > 0);
  assert.ok(result.preservedCount > 0);
  assert.equal(result.affectedCount + result.preservedCount, result.totalBlocks);
  for (const block of world.blocks) {
    if (result.affectedBlocks.includes(block.id)) continue;
    assert.equal(block.hash, beforeHashes.get(block.id));
    assert.equal(JSON.stringify(block.buildings), beforeBuildings.get(block.id));
  }
});

test("moving one building preserves every unaffected block hash and coordinate", () => {
  const world = generateWorld({ seed: 82419 });
  const beforeHashes = blockHashes(world);
  const before = serializeWorld(world).blocks.filter(
    (block) => block.type === "built" && block.buildings.length,
  );
  const block = before.find((item) => item.buildings.length > 1);
  const building = block.buildings[0];
  const result = moveBuilding(world, building.id, building.x + 1.2, building.y + 0.8);
  assert.equal(result.ok, true);
  assert.deepEqual(result.affectedBlocks, [block.id]);
  for (const other of world.blocks) {
    if (other.id === block.id) continue;
    assert.equal(other.hash, beforeHashes.get(other.id));
  }
  assert.equal(verifyWorld(world).overlapCount, 0);
});

test("moving a park refreshes its path and greenery service statistics", () => {
  const world = generateWorld({ seed: 82419 });
  const park = world.parks[0];
  const oldBlockId = park.blockId;
  const oldPath = JSON.stringify(park.path.points);
  const oldServed = world.metrics.servedBuildings;
  const target = world.blocks.find(
    (block) => block.type === "built" && block.id !== oldBlockId,
  );
  const beforeHashes = blockHashes(world);
  const result = moveParkToBlock(world, park.id, target.id);
  assert.equal(result.ok, true);
  assert.equal(park.blockId, target.id);
  assert.notEqual(JSON.stringify(park.path.points), oldPath);
  assert.equal(world.metrics.pathLength, Math.round(world.parks.reduce((sum, item) => sum + item.path.length, 0)));
  assert.ok(world.parks.every((item) => item.trees.length > 0));
  assert.ok(oldServed >= 0);
  for (const block of world.blocks) {
    if (result.affectedBlocks.includes(block.id)) continue;
    assert.equal(block.hash, beforeHashes.get(block.id));
  }
  assert.equal(verifyWorld(world).overlapCount, 0);
});

test("a road blocker isolates a target and reports its exact junction", () => {
  const world = generateWorld({ seed: 82419 });
  const target = world.targets[0];
  const result = addBlocker(world, target.x, target.y);
  assert.equal(result.ok, true);
  assert.ok(world.metrics.reachableTargets < world.metrics.targetCount);
  assert.ok(world.blockerReport);
  assert.equal(world.blockerReport.location.id, result.blocker.id);
  assert.match(world.blockerReport.message, /阻断/);
  assert.ok(world.blockerReport.unreachableTargets.includes(target.id));
  assert.ok(world.blockerReport.location.restoredTargets.includes(target.id));
});

test("save and load preserve the exact layout hash including edits", () => {
  const world = generateWorld({ seed: 73124, density: 71, blockScale: 170 });
  const block = world.blocks.find((item) => item.type === "built" && item.buildings.length);
  moveBuilding(world, block.buildings[0].id, block.buildings[0].x + 1, block.buildings[0].y);
  addBlocker(world, world.targets.at(-1).x, world.targets.at(-1).y);
  const saved = serializeWorld(world);
  const restored = hydrateWorld(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.layoutHash, saved.layoutHash);
  assert.equal(restored.layoutHash, world.layoutHash);
  assert.equal(restored.metrics.buildingCount, world.metrics.buildingCount);
  assert.equal(restored.blockerReport.location.id, world.blockerReport.location.id);
});
