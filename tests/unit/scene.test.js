import test from "node:test";
import assert from "node:assert/strict";
import {
  createSeedScene,
  deserializeScene,
  loadScene,
  MAX_POINTS_PER_SHAPE,
  saveScene,
  serializeScene,
  STORAGE_KEY
} from "../../src/scene.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    entries: () => [...values.entries()]
  };
}

test("normal scene survives serialization without changing shape data", () => {
  const scene = createSeedScene();
  const restored = deserializeScene(serializeScene(scene));
  assert.equal(restored.ok, true);
  assert.equal(restored.recovered, false);
  assert.deepEqual(restored.scene.shapes, scene.shapes);
  assert.deepEqual(restored.scene.view, scene.view);
});

test("invalid JSON is fatal and visibly recovers to seed scene", () => {
  const result = deserializeScene('{"version":1,"shapes":[');
  assert.equal(result.ok, false);
  assert.equal(result.fatal, true);
  assert.equal(result.recovered, true);
  assert.equal(result.issues[0].code, "JSON_INVALID");
  assert.equal(result.scene.shapes.length, createSeedScene().shapes.length);
});

test("damaged shape is dropped while valid sibling is preserved", () => {
  const raw = JSON.stringify({
    version: 1,
    view: { x: 0, y: 0, scale: 1 },
    shapes: [
      { id: "valid", type: "stroke", color: "#112233", width: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      { id: "bad-point", type: "stroke", color: "#112233", width: 2, points: [{ x: 0, y: 0 }, { x: "oops", y: 2 }] }
    ]
  });
  const result = deserializeScene(raw);
  assert.equal(result.fatal, false);
  assert.equal(result.recovered, true);
  assert.equal(result.scene.shapes.length, 1);
  assert.equal(result.scene.shapes[0].id, "valid");
  assert.ok(result.issues.some((item) => item.code === "POINT_INVALID"));
});

test("unknown version and out-of-range view recover with issues", () => {
  const raw = JSON.stringify({
    version: 99,
    view: { x: 2, y: 4, scale: 400 },
    shapes: []
  });
  const result = deserializeScene(raw);
  assert.equal(result.recovered, true);
  assert.equal(result.scene.view.scale, 4);
  assert.ok(result.issues.some((item) => item.code === "VERSION_UNKNOWN"));
  assert.ok(result.issues.some((item) => item.code === "VIEW_CLAMPED"));
});

test("oversize shape is rejected at the boundary and reported", () => {
  const raw = JSON.stringify({
    version: 1,
    view: { x: 0, y: 0, scale: 1 },
    shapes: [{
      id: "too-many",
      type: "stroke",
      points: Array.from({ length: MAX_POINTS_PER_SHAPE + 1 }, (_, index) => ({ x: index, y: index }))
    }]
  });
  const result = deserializeScene(raw);
  assert.equal(result.scene.shapes.length, 0);
  assert.ok(result.issues.some((item) => item.code === "SHAPE_TOO_LARGE"));
});

test("storage read failures and write failures are reported, never swallowed", () => {
  const broken = {
    getItem: () => { throw new Error("read denied"); },
    setItem: () => { throw new Error("quota full"); }
  };
  const loaded = loadScene(broken);
  assert.equal(loaded.recovered, true);
  assert.ok(loaded.issues.some((item) => item.code === "STORAGE_READ"));
  const saved = saveScene(broken, createSeedScene());
  assert.equal(saved.ok, false);
  assert.equal(saved.error.code, "STORAGE_WRITE");
});

test("save then load uses the canonical storage key", () => {
  const storage = memoryStorage();
  const scene = createSeedScene();
  const saved = saveScene(storage, scene, "broken-original");
  assert.equal(saved.ok, true);
  assert.ok(storage.getItem(STORAGE_KEY));
  const loaded = loadScene(storage);
  assert.equal(loaded.scene.shapes.length, scene.shapes.length);
});

test("non-object scene and oversized raw data recover deterministically", () => {
  const nonObject = deserializeScene("null");
  assert.equal(nonObject.issues[0].code, "SCENE_INVALID");
  const oversized = deserializeScene(`{"shapes":[]}${" ".repeat(2_000_001)}`);
  assert.equal(oversized.issues[0].code, "DATA_TOO_LARGE");
  assert.equal(nonObject.scene.shapes.length, oversized.scene.shapes.length);
});
