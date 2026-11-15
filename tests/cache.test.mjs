import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  MAX_NODES,
  SceneLoader,
  collectSubtreeIds,
  countNodes,
  findNode,
  hashValue,
  validateScene,
} from "../src/core/model.js";
import { CacheEngine, exportScene } from "../src/core/engine.js";
import {
  CORRUPTED_INPUTS,
  VIEWPORT,
  applyModification,
  buildBoundaryScene,
  buildNormalScene,
} from "../src/core/scenarios.js";
import { compareVerificationRuns, runVerification } from "../src/core/verify.js";

const MODIFICATIONS = ["size", "font", "hidden"];

test("fixed cache matches uncached reference for size, font, and visibility changes", () => {
  for (const modification of MODIFICATIONS) {
    const scene = buildNormalScene();
    validateScene(scene);
    const engine = new CacheEngine({ mode: "fixed" });
    const initial = engine.render(scene, { viewport: VIEWPORT });
    assert.ok(initial.metrics.hits + initial.metrics.misses > 0);
    engine.resetStats();

    const target = applyModification(scene, modification);
    const invalidation = engine.invalidateSubtree(target);
    const modified = engine.render(scene, { viewport: VIEWPORT });
    const reference = new CacheEngine({ mode: "fixed" })
      .render(scene, { viewport: VIEWPORT, bypassCache: true });

    assert.equal(modified.checksum, reference.checksum, `${modification} should match reference`);
    assert.equal(invalidation.scope, "subtree");
    assert.ok(invalidation.ids.length > 1, "descendant ids are invalidated");
    assert.ok(invalidation.layoutReleased > 0);
    assert.ok(modified.metrics.recomputes > 0);
    assert.ok(modified.metrics.layoutRecomputes > 0);
    assert.ok(modified.metrics.hitRate >= 0 && modified.metrics.hitRate <= 1);
    assert.ok(modified.metrics.cacheBytes > 0);
  }
});

test("legacy cache reproduces stale results for all three mutations", () => {
  for (const modification of MODIFICATIONS) {
    const scene = buildNormalScene();
    const engine = new CacheEngine({ mode: "legacy" });
    engine.render(scene, { viewport: VIEWPORT });
    const target = applyModification(scene, modification);
    const invalidation = engine.invalidateSubtree(target);
    const result = engine.render(scene, { viewport: VIEWPORT });
    const reference = new CacheEngine({ mode: "fixed" })
      .render(scene, { viewport: VIEWPORT, bypassCache: true });

    assert.equal(invalidation.scope, "node");
    assert.equal(invalidation.ids.length, 1);
    assert.notEqual(result.checksum, reference.checksum, `${modification} should reproduce stale output`);
  }
});

test("cache-only rerender reports hits and zero recomputes", () => {
  const scene = buildNormalScene();
  const engine = new CacheEngine({ mode: "fixed" });
  engine.render(scene, { viewport: VIEWPORT });
  const second = engine.render(scene, { viewport: VIEWPORT });

  assert.equal(second.metrics.recomputes, 0);
  assert.equal(second.metrics.hitRate, 1);
  assert.ok(second.metrics.hits > 0);
  assert.equal(second.metrics.layoutRecomputes, 0);
  assert.equal(second.metrics.renderRecomputes, 0);
  assert.ok(second.metrics.cacheEntries > 0);
  assert.ok(second.metrics.dependencyEdges > second.metrics.cacheEntries);
});

test("invalidation preserves caches outside the affected subtree", () => {
  const scene = buildNormalScene();
  const engine = new CacheEngine({ mode: "fixed" });
  engine.render(scene, { viewport: VIEWPORT });
  const target = findNode(scene.root, "body-card");
  const targetIds = new Set(collectSubtreeIds(target));
  const unaffected = findNode(scene.root, "sidebar");
  const unaffectedIds = collectSubtreeIds(unaffected);

  engine.invalidateSubtree(target);

  for (const id of targetIds) {
    assert.equal(engine.layoutCache.has(id), false);
    assert.equal(engine.renderCache.has(id), false);
  }
  for (const id of unaffectedIds) {
    assert.equal(engine.layoutCache.has(id), true);
    assert.equal(engine.renderCache.has(id), true);
  }
  assert.equal(engine.resources().dependencyNodes > 0, true);
});

test("deleting a subtree releases cache and dependency references", () => {
  const scene = buildNormalScene();
  const engine = new CacheEngine({ mode: "fixed" });
  engine.render(scene, { viewport: VIEWPORT });
  const target = findNode(scene.root, "chart-panel");
  const ids = collectSubtreeIds(target);
  const beforeEntries = engine.resources().cacheEntries;
  const sibling = findNode(scene.root, "sidebar");

  const deleted = engine.deleteNode(scene, target.id);

  assert.equal(findNode(scene.root, target.id), null);
  assert.equal(deleted.referencesRemaining, 0);
  assert.equal(deleted.ids.length, ids.length);
  assert.ok(deleted.layoutReleased > 0);
  assert.ok(deleted.renderReleased > 0);
  assert.ok(engine.resources().cacheEntries < beforeEntries);
  assert.equal(engine.countReferences(ids), 0);
  assert.equal(engine.layoutCache.has(target.id), false);
  assert.equal(engine.renderCache.has(target.id), false);
  assert.equal(engine.layoutCache.has(sibling.id), true);
  assert.equal(JSON.stringify(scene).includes("chart-panel"), false);
});

test("boundary input renders reproducibly and fixed mode matches bypass output", () => {
  const scene = buildBoundaryScene();
  validateScene(scene);
  assert.ok(countNodes(scene.root) <= MAX_NODES);
  assert.equal(findNode(scene.root, "edge-text").text.length, 5000);

  const engine = new CacheEngine({ mode: "fixed" });
  const first = engine.render(scene, { viewport: VIEWPORT });
  const second = engine.render(scene, { viewport: VIEWPORT });
  const reference = new CacheEngine({ mode: "fixed" })
    .render(scene, { viewport: VIEWPORT, bypassCache: true });

  assert.equal(first.checksum, reference.checksum);
  assert.equal(second.checksum, reference.checksum);
  assert.equal(second.metrics.recomputes, 0);
  assert.equal(second.metrics.hitRate, 1);
  assert.ok(engine.resources().cacheEntries >= 494);
  assert.ok(engine.resources().cacheBytes > 0);
});

test("scene loader rejects corrupted input, logs it, and activates a safe scene", () => {
  const logs = [];
  const loader = new SceneLoader(buildNormalScene(), { error: (...args) => logs.push(args) });
  for (const fixture of CORRUPTED_INPUTS) {
    const loaded = loader.load(fixture.input);
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0].message, /./);
    validateScene(loaded.scene);
  }
  assert.equal(logs.length, CORRUPTED_INPUTS.length);
  assert.equal(loader.errors.length, CORRUPTED_INPUTS.length);
  assert.equal(loader.errors.every((entry) => entry.recovery.length > 0), true);
});

test("verification compares before/after results, logs, and resources reproducibly", () => {
  const first = runVerification();
  const second = runVerification();
  assert.equal(first.summary.normalBeforeStale, 3);
  assert.equal(first.summary.normalAfterMatching, 3);
  assert.equal(first.summary.boundaryBeforeMatches, false);
  assert.equal(first.summary.boundaryAfterMatches, true);
  assert.equal(first.summary.corruptedBeforeRecovered, false);
  assert.equal(first.summary.corruptedAfterRecovered, true);
  assert.ok(first.summary.beforeErrorCount > first.summary.afterErrorCount);
  assert.equal(first.groups.normal.after.errors.length, 0);
  assert.equal(first.groups.corrupted.after.logCount, CORRUPTED_INPUTS.length);
  assert.equal(first.groups.corrupted.after.finalResult.exportEnabled, false);
  assert.ok(first.groups.normal.after.resources.cacheEntries > 0);
  assert.ok(first.groups.normal.before.resources.cacheEntries > 0);
  assert.equal(compareVerificationRuns(first, second), true);
});

test("cache mode does not alter scene export content", () => {
  const scene = buildNormalScene();
  const legacyScene = cloneScene(scene);
  const fixed = new CacheEngine({ mode: "fixed" });
  const legacy = new CacheEngine({ mode: "legacy" });
  fixed.render(scene, { viewport: VIEWPORT });
  legacy.render(legacyScene, { viewport: VIEWPORT });
  const exported = exportScene(scene);
  const legacyExport = exportScene(legacyScene);
  const parsed = JSON.parse(exported);

  assert.equal(exported, legacyExport);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.root.id, "root");
  assert.equal(exported.includes("cacheHits"), false);
  assert.equal(exported.includes("cacheBytes"), false);
  assert.equal(exported.includes("dependencyEdges"), false);
  assert.equal(hashValue(parsed), hashValue(JSON.parse(exportScene(cloneScene(scene)))));
});

test("deleted scene objects are collectible after cache release", () => {
  const output = execFileSync(
    process.execPath,
    ["--expose-gc", "scripts/gc-check.mjs"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  assert.match(output, /GC check passed: 12 deleted node objects collected/);
});

function cloneScene(scene) {
  return JSON.parse(JSON.stringify(scene));
}
