import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRenderPlan,
  clampLayerPosition,
  createInitialProject,
  getSelectableLayers,
  hitTest,
} from "../src/model.js";

test("fixed scene has deterministic object counts for every render path", () => {
  const project = createInitialProject();
  const baseline = buildRenderPlan(project, { shadows: false, sorting: false, culling: false });
  const optimized = buildRenderPlan(project, { shadows: false, sorting: true, culling: true });
  assert.equal(baseline.totalObjects, 108);
  assert.equal(baseline.visibleObjects, 108);
  assert.equal(optimized.totalObjects, 108);
  assert.equal(optimized.visibleObjects, 96);
  assert.equal(optimized.culledObjects, 12);
  assert.deepEqual(
    baseline.objects.map((object) => object.id),
    optimized.objects.map((object) => object.id),
  );
});

test("hit testing uses topmost selectable layer", () => {
  const project = createInitialProject();
  assert.equal(hitTest(project, 830, 190)?.id, "accent-disc");
  assert.equal(hitTest(project, 700, 300)?.id, "halo");
  assert.equal(hitTest(project, -100, -100), null);
  assert.ok(getSelectableLayers(project).length >= 15);
});

test("layer positions stay within recoverable canvas bounds", () => {
  const project = createInitialProject();
  const layer = project.layers.find((item) => item.id === "headline");
  const upper = clampLayerPosition(project, layer, 99999, -99999);
  assert.ok(Number.isFinite(upper.x));
  assert.ok(Number.isFinite(upper.y));
  assert.ok(upper.x <= project.width);
  assert.ok(upper.y >= -layer.h);
});
