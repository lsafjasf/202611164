import test from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  distance,
  hitTest,
  MAX_SCALE,
  MIN_SCALE,
  pinchView,
  pointToSegmentDistance,
  screenToWorld,
  simplifyStroke,
  worldToScreen,
  zoomAt
} from "../../src/geometry.js";

const near = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

test("screen and world transforms round-trip at arbitrary view", () => {
  const view = { x: -132.5, y: 77.25, scale: 1.75 };
  const screen = { x: 420, y: 315 };
  const roundTrip = worldToScreen(screenToWorld(screen, view), view);
  near(roundTrip.x, screen.x);
  near(roundTrip.y, screen.y);
});

test("zoom keeps the world point under the anchor fixed", () => {
  const view = { x: 30, y: -20, scale: 1 };
  const anchor = { x: 240, y: 180 };
  const before = screenToWorld(anchor, view);
  const zoomed = zoomAt(view, anchor, 2.4);
  const after = screenToWorld(anchor, zoomed);
  near(after.x, before.x);
  near(after.y, before.y);
});

test("zoom clamps boundary input without NaN", () => {
  const anchor = { x: 100, y: 120 };
  const huge = zoomAt({ x: 0, y: 0, scale: 1 }, anchor, Number.MAX_VALUE);
  const tiny = zoomAt({ x: 0, y: 0, scale: 1 }, anchor, Number.MIN_VALUE);
  assert.equal(huge.scale, MAX_SCALE);
  assert.equal(tiny.scale, MIN_SCALE);
  assert.ok(Number.isFinite(huge.x) && Number.isFinite(huge.y));
  assert.ok(Number.isFinite(tiny.x) && Number.isFinite(tiny.y));
});

test("pinch combines centroid pan and distance zoom", () => {
  const startView = { x: 20, y: 10, scale: 1 };
  const startMid = { x: 200, y: 180 };
  const currentMid = { x: 230, y: 190 };
  const result = pinchView(startView, startMid, currentMid, 2);
  assert.equal(result.scale, 2);
  const anchored = screenToWorld(startMid, startView);
  const moved = screenToWorld(currentMid, result);
  near(moved.x, anchored.x);
  near(moved.y, anchored.y);
});

test("point to segment distance handles endpoints and zero-length segments", () => {
  near(pointToSegmentDistance({ x: 5, y: 5 }, { x: 0, y: 5 }, { x: 10, y: 5 }), 0);
  near(pointToSegmentDistance({ x: 15, y: 5 }, { x: 0, y: 5 }, { x: 10, y: 5 }), 5);
  near(pointToSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
});

test("hit testing respects width and topmost shape", () => {
  const shapes = [
    { id: "under", width: 4, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    { id: "top", width: 4, points: [{ x: 50, y: -5 }, { x: 50, y: 5 }] }
  ];
  assert.equal(hitTest(shapes, { x: 50, y: 1 }, 2).id, "top");
  assert.equal(hitTest(shapes, { x: 20, y: 2 }, 2).id, "under");
  assert.equal(hitTest(shapes, { x: 20, y: 30 }, 2), null);
});

test("simplify preserves endpoints and drops duplicate noise", () => {
  const source = [
    { x: 0, y: 0 },
    { x: 0.1, y: 0.1 },
    { x: 3, y: 0 },
    { x: 6, y: 0 }
  ];
  const result = simplifyStroke(source, 1.25);
  assert.deepEqual(result[0], source[0]);
  assert.deepEqual(result[result.length - 1], source[source.length - 1]);
  assert.ok(result.length < source.length);
});

test("clamp and distance reject non-finite view values in the caller", () => {
  assert.equal(clamp(99, 0, 4), 4);
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  const view = zoomAt({ x: 0, y: 0, scale: 1 }, { x: 2, y: 3 }, Number.NaN);
  assert.equal(view.scale, 1);
});
