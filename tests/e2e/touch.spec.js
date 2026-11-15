import { test, expect } from "@playwright/test";
import {
  canvasBox,
  getState,
  newTouchSession,
  projectPoint,
  resetApp,
  screenshot,
  sendTouch,
  waitForRender,
  writeEvidence
} from "./helpers.js";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "touch", "Touch input scenarios");
});

test("touch normal: one-finger pan, pinch zoom and long-press select never draw", async ({ page }) => {
  await resetApp(page);
  const initial = await getState(page);
  const box = await canvasBox(page);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.evaluate(() => window.scrollTo(0, 0));
  const touch = await newTouchSession(page);

  await sendTouch(touch, "touchStart", [{ ...center, id: 0 }]);
  await sendTouch(touch, "touchMove", [{ x: center.x + 68, y: center.y + 22, id: 0 }]);
  await sendTouch(touch, "touchEnd", []);
  await waitForRender(page);
  const afterPan = await getState(page);
  expect(afterPan.snapshot.view.x).toBeGreaterThan(initial.snapshot.view.x + 60);
  expect(afterPan.scene.shapes).toHaveLength(initial.scene.shapes.length);
  expect(afterPan.snapshot.counters.drawEvents).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const pinchCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await sendTouch(touch, "touchStart", [
    { x: pinchCenter.x - 50, y: pinchCenter.y, id: 1 },
    { x: pinchCenter.x + 50, y: pinchCenter.y, id: 2 }
  ]);
  await sendTouch(touch, "touchMove", [
    { x: pinchCenter.x - 95, y: pinchCenter.y, id: 1 },
    { x: pinchCenter.x + 95, y: pinchCenter.y, id: 2 }
  ]);
  await sendTouch(touch, "touchEnd", []);
  await waitForRender(page);
  const afterPinch = await getState(page);
  expect(afterPinch.snapshot.view.scale).toBeGreaterThan(afterPan.snapshot.view.scale);
  expect(afterPinch.scene.shapes).toHaveLength(initial.scene.shapes.length);
  expect(afterPinch.snapshot.counters.drawEvents).toBe(0);
  expect(afterPinch.snapshot.counters.zoomEvents).toBeGreaterThan(0);

  await page.evaluate(() => window.__canvasDebug.fitView());
  await waitForRender(page);
  const target = await projectPoint(page, { x: 170, y: 250 });
  await sendTouch(touch, "touchStart", [{ x: target.x, y: target.y, id: 3 }]);
  await page.waitForTimeout(650);
  await sendTouch(touch, "touchEnd", []);
  await waitForRender(page);
  const afterHold = await getState(page);
  expect(afterHold.selected).toBe("seed-orbit");
  expect(afterHold.snapshot.counters.longPressEvents).toBe(1);
  expect(afterHold.snapshot.counters.drawEvents).toBe(0);
  expect(afterHold.scene.shapes).toHaveLength(initial.scene.shapes.length);
  expect(afterHold.errors).toHaveLength(0);
  expect(afterHold.snapshot.crosshair.visible).toBe(true);
  await touch.detach();

  writeEvidence("after-normal-touch", {
    scenario: "normal",
    project: "touch",
    initial: {
      shapes: initial.scene.shapes.length,
      points: initial.snapshot.resources.points,
      scale: initial.snapshot.view.scale
    },
    final: {
      shapes: afterHold.scene.shapes.length,
      points: afterHold.snapshot.resources.points,
      scale: afterHold.snapshot.view.scale,
      selected: afterHold.selected,
      listeners: afterHold.snapshot.resources.listeners,
      bitmapMiB: afterHold.snapshot.resources.bitmapMiB,
      render: afterHold.snapshot.render,
      counters: afterHold.snapshot.counters,
      errors: afterHold.errors
    },
    assertions: {
      singleFingerPanned: afterPan.snapshot.counters.panEvents > 0,
      pinchZoomed: afterPinch.snapshot.view.scale > afterPan.snapshot.view.scale,
      longPressSelected: afterHold.selected === "seed-orbit",
      touchNeverDrew: afterHold.snapshot.counters.drawEvents === 0,
      pageScrollIsolated: (await page.evaluate(() => window.scrollY)) === 0
    }
  });
  await screenshot(page, "after-normal-touch");
});

test("touch boundary: rotation keeps hit coordinates accurate", async ({ page }) => {
  await resetApp(page);
  const portrait = await getState(page);
  await page.setViewportSize({ width: 915, height: 412 });
  await page.waitForTimeout(180);
  await page.evaluate(() => window.__canvasDebug.fitView());
  await waitForRender(page);
  const target = await projectPoint(page, { x: 170, y: 250 });
  const rotated = await getState(page);
  expect(rotated.rect.width).not.toBe(portrait.rect.width);
  expect(rotated.rect.height).not.toBe(portrait.rect.height);

  const touch = await newTouchSession(page);
  await sendTouch(touch, "touchStart", [{ x: target.x, y: target.y, id: 7 }]);
  await page.waitForTimeout(650);
  await sendTouch(touch, "touchEnd", []);
  await touch.detach();
  await waitForRender(page);
  const selected = await getState(page);
  expect(selected.selected).toBe("seed-orbit");
  expect(selected.errors).toHaveLength(0);

  writeEvidence("after-boundary-touch", {
    scenario: "boundary",
    project: "touch",
    beforeRotation: {
      rect: portrait.rect,
      scale: portrait.snapshot.view.scale
    },
    afterRotation: {
      rect: selected.rect,
      view: selected.snapshot.view,
      selected: selected.selected,
      target,
      resources: selected.snapshot.resources,
      render: selected.snapshot.render,
      errors: selected.errors
    },
    assertions: {
      sizeChanged: selected.rect.width !== portrait.rect.width && selected.rect.height !== portrait.rect.height,
      rotatedHitSelected: selected.selected === "seed-orbit"
    }
  });
  await screenshot(page, "after-boundary-touch");
});
