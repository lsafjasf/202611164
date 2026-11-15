import assert from "node:assert/strict";
import test from "node:test";

import {
  SEED_PRESETS,
  computeLayoutHash,
  deserializeScene,
  editTile,
  generateScene,
  hashToHex,
  indexOf,
  rectContains,
  serializeScene,
  updateVeinSize,
  validateScene
} from "../src/scene-core.js";

const TEST_SEEDS = ["CINDER-7341", "FROST-2196"];

function assertSceneContract(scene) {
  const { validation, objects, width, height } = scene;
  assert.equal(objects.veins.length, 3, "must generate exactly three veins");
  assert.equal(validation.targetCount, 4, "three veins plus processing station");
  assert.equal(validation.reachableCount, 4, "all targets must be reachable");
  assert.equal(validation.reachable, true);
  assert.equal(validation.boundaryValid, true);
  assert.equal(validation.objectsOverlap, false);
  assert.equal(validation.valid, true, validation.issues.join("\n"));
  assert.equal(objects.entrance.x, 0);
  assert.equal(objects.station.x, width - 1);

  for (const object of [
    objects.entrance,
    objects.station,
    ...objects.veins
  ]) {
    assert.ok(object.x >= 0 && object.x < width);
    assert.ok(object.y >= 0 && object.y < height);
  }
}

function routeMidpoint(scene) {
  const route = scene.network.routes
    .slice()
    .sort((left, right) => right.distance - left.distance)[0];
  const point = route.path[Math.floor(route.path.length * 0.55)];
  const isObject = [
    scene.objects.entrance,
    scene.objects.station,
    ...scene.objects.veins
  ].some((object) => object.x === point.x && object.y === point.y);
  assert.equal(isObject, false, "test point should be an editable tunnel");
  return point;
}

test("two fixed seeds generate valid, bounded and non-overlapping scenes", () => {
  for (const seed of TEST_SEEDS) {
    const scene = generateScene(seed);
    assertSceneContract(scene);
    assert.ok(scene.validation.issues.length === 0);
  }
});

test("same seed and parameters reproduce the exact layout hash", () => {
  for (const seed of TEST_SEEDS) {
    const first = generateScene(seed, { veinSize: 2.15, tunnelWidth: 1 });
    const second = generateScene(seed, { veinSize: 2.15, tunnelWidth: 1 });
    assert.equal(
      hashToHex(first.layoutHash),
      hashToHex(second.layoutHash),
      `${seed} must be reproducible`
    );
    assert.deepEqual(Array.from(first.grid), Array.from(second.grid));
  }
  const firstSeed = generateScene(TEST_SEEDS[0]);
  const secondSeed = generateScene(TEST_SEEDS[1]);
  assert.notEqual(firstSeed.layoutHash, secondSeed.layoutHash);
});

test("parameter snapshot reload preserves the saved layout hash", () => {
  const source = generateScene(TEST_SEEDS[0], {
    veinSize: 2.4,
    tunnelWidth: 1
  });
  const payload = serializeScene(source);
  const restored = deserializeScene(JSON.parse(JSON.stringify(payload)));
  assert.equal(restored.hashMatch, true);
  assert.equal(restored.savedHash, restored.loadedHash);
  assert.equal(restored.scene.params.veinSize, 2.4);
  assert.equal(restored.scene.layoutHash, source.layoutHash);
});

test("vein-size change recomputes only vein regions and keeps outside hash stable", () => {
  const source = generateScene(TEST_SEEDS[0]);
  const result = updateVeinSize(source, 2.7, { at: "2026-11-16T00:00:00Z" });
  assert.equal(result.ok, true);
  assert.equal(result.scene.validation.valid, true);
  assert.equal(result.proof.unaffectedStable, true);
  assert.equal(
    result.proof.unaffectedHashBefore,
    result.proof.unaffectedHashAfter
  );
  assert.equal(result.proof.affectedRects.length, 3);
  assert.ok(result.proof.recomputedCells < result.proof.totalCells);
  assert.ok(result.proof.regionRatio < 0.5);

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const affected = result.proof.affectedRects.some((rect) =>
        rectContains(rect, x, y)
      );
      if (!affected) {
        const index = indexOf(x, y, source.width);
        assert.equal(
          source.grid[index],
          result.scene.grid[index],
          `unaffected cell ${x},${y} changed`
        );
      }
    }
  }

  const payload = serializeScene(result.scene);
  const restored = deserializeScene(JSON.parse(JSON.stringify(payload)));
  assert.equal(restored.hashMatch, true);
  assert.equal(restored.loadedHash, hashToHex(result.scene.layoutHash));
  assert.equal(restored.scene.params.veinSize, 2.7);
});

test("single obstacle breaks the route, reports its coordinate, and digging repairs it", () => {
  const source = generateScene(TEST_SEEDS[0]);
  const point = routeMidpoint(source);
  const sealed = editTile(source, point.x, point.y, "seal", {
    at: "2026-11-16T00:00:00Z"
  });

  assert.equal(sealed.ok, true);
  assert.equal(sealed.scene.validation.reachable, false);
  assert.ok(sealed.disconnectedTargets.length > 0);
  assert.equal(sealed.blockers.length, 1);
  assert.equal(sealed.blockers[0].x, point.x);
  assert.equal(sealed.blockers[0].y, point.y);
  assert.deepEqual(
    sealed.scene.blockedMarkers.map((marker) => `${marker.x},${marker.y}`),
    [`${point.x},${point.y}`]
  );
  assert.equal(sealed.proof.unaffectedStable, true);
  assert.equal(sealed.proof.changedCount, 1);
  assert.ok(
    sealed.proof.unaffectedCount === source.width * source.height - 1
  );

  const repaired = editTile(
    sealed.scene,
    sealed.blockers[0].x,
    sealed.blockers[0].y,
    "dig",
    { at: "2026-11-16T00:01:00Z" }
  );
  assert.equal(repaired.ok, true);
  assert.equal(repaired.scene.validation.reachable, true);
  assert.equal(repaired.disconnectedTargets.length, 0);
  assert.deepEqual(repaired.scene.blockedMarkers, []);
  assert.equal(repaired.scene.digUsed, 1);
});

test("validation detects an out-of-bounds object and overlapping targets", () => {
  const scene = generateScene(TEST_SEEDS[1]);
  const broken = {
    ...scene,
    objects: {
      ...scene.objects,
      station: { ...scene.objects.station, x: scene.width + 2 },
      veins: scene.objects.veins.map((vein, index) =>
        index === 1
          ? { ...vein, x: scene.objects.veins[0].x, y: scene.objects.veins[0].y }
          : { ...vein }
      )
    }
  };
  const validation = validateScene(broken);
  assert.equal(validation.valid, false);
  assert.equal(validation.boundaryValid, false);
  assert.equal(validation.objectsOverlap, true);
  assert.ok(validation.issues.some((issue) => issue.includes("越界")));
  assert.ok(validation.issues.some((issue) => issue.includes("重叠")));
});

test("layout hash is a pure function of seed, params, objects and grid", () => {
  const scene = generateScene(TEST_SEEDS[0]);
  const clone = {
    ...scene,
    params: { ...scene.params },
    grid: scene.grid.slice(),
    objects: {
      entrance: { ...scene.objects.entrance },
      station: { ...scene.objects.station },
      veins: scene.objects.veins.map((vein) => ({ ...vein }))
    }
  };
  assert.equal(computeLayoutHash(clone), scene.layoutHash);
  clone.grid[indexOf(1, 1, clone.width)] =
    clone.grid[indexOf(1, 1, clone.width)] === 0 ? 1 : 0;
  assert.notEqual(computeLayoutHash(clone), scene.layoutHash);
});
