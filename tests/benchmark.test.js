import test from "node:test";
import assert from "node:assert/strict";
import { CONFIGS, fixedActions, logicalBenchmark, structuralDigest } from "../src/benchmark.js";
import { createInitialProject } from "../src/model.js";

test("fixed action trace is deterministic and covers three configurations", () => {
  const first = fixedActions();
  const second = fixedActions();
  assert.equal(first.length, 24);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((action) => action.camera.x),
    [0, 3, 6, 9, 12, 14, 15, 16, 16, 15, 14, 12, 10, 7, 4, 1, -2, -5, -8, -11, -13, -15, -16, -16],
  );
  assert.equal(CONFIGS.length, 3);
});

test("all configuration plans have the same structural output", () => {
  const project = createInitialProject();
  const baseline = structuralDigest(project);
  for (const config of CONFIGS) {
    assert.equal(structuralDigest(project), baseline);
    assert.equal(config.options.culling, config.id !== "baseline");
  }
  const report = logicalBenchmark(project);
  assert.equal(report.parity, true);
  assert.equal(report.passRate, 1);
  assert.equal(report.results[0].drawnObjects, 108);
  assert.equal(report.results[1].drawnObjects, 96);
  assert.equal(report.results[2].drawnObjects, 96);
  assert.ok(report.results[1].drawnObjects < report.results[0].drawnObjects);
});
