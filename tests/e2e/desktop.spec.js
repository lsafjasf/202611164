import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import {
  canvasBox,
  getState,
  projectPoint,
  resetApp,
  screenshot,
  waitForRender,
  writeEvidence
} from "./helpers.js";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop input scenarios");
});

test("normal input: draw, pan, zoom and isolate page scroll", async ({ page }) => {
  await resetApp(page);
  const initial = await getState(page);
  const box = await canvasBox(page);
  const start = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.35 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let index = 1; index <= 12; index += 1) {
    await page.mouse.move(start.x + index * 9, start.y + Math.sin(index / 2) * 20);
  }
  await page.mouse.up();
  await waitForRender(page);

  const afterDraw = await getState(page);
  expect(afterDraw.scene.shapes).toHaveLength(initial.scene.shapes.length + 1);
  expect(afterDraw.snapshot.counters.drawEvents).toBe(1);

  await page.evaluate(() => window.scrollTo(0, 0));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const viewBefore = afterDraw.snapshot.view;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 160);
  await waitForRender(page);
  const afterWheel = await getState(page);
  const scrollAfterCanvasWheel = await page.evaluate(() => window.scrollY);
  expect(afterWheel.snapshot.view.y).not.toBe(viewBefore.y);
  expect(afterWheel.scene.shapes).toHaveLength(afterDraw.scene.shapes.length);
  expect(scrollAfterCanvasWheel).toBe(scrollBefore);

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await waitForRender(page);
  const afterZoom = await getState(page);
  expect(afterZoom.snapshot.view.scale).toBeGreaterThan(afterWheel.snapshot.view.scale);
  expect(afterZoom.scene.shapes).toHaveLength(afterWheel.scene.shapes.length);
  expect(afterZoom.snapshot.crosshair.visible).toBe(true);
  expect(afterZoom.errors).toHaveLength(0);

  await page.mouse.move(20, 20);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);

  mkdirSync("evidence/exports", { recursive: true });
  const jsonDownloadPromise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const jsonDownload = await jsonDownloadPromise;
  await jsonDownload.saveAs("evidence/exports/after-normal.json");
  const exportedJson = JSON.parse(readFileSync("evidence/exports/after-normal.json", "utf8"));
  expect(exportedJson.shapes).toHaveLength(3);

  const pngDownloadPromise = page.waitForEvent("download");
  await page.locator("#export-png").click();
  const pngDownload = await pngDownloadPromise;
  await pngDownload.saveAs("evidence/exports/after-normal.png");
  const png = readFileSync("evidence/exports/after-normal.png");
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);

  const result = await getState(page);
  writeEvidence("after-normal-desktop", {
    scenario: "normal",
    project: "desktop",
    initial: {
      shapes: initial.scene.shapes.length,
      points: initial.snapshot.resources.points,
      listeners: initial.snapshot.resources.listeners,
      errors: initial.errors.length
    },
    final: {
      shapes: result.scene.shapes.length,
      points: result.snapshot.resources.points,
      listeners: result.snapshot.resources.listeners,
      bitmapMiB: result.snapshot.resources.bitmapMiB,
      lastRenderMs: result.snapshot.render.lastMs,
      avgRenderMs: result.snapshot.render.avgMs,
      p95RenderMs: result.snapshot.render.p95Ms,
      errors: result.errors,
      counters: result.snapshot.counters
    },
    assertions: {
      pageIsolated: scrollAfterCanvasWheel === scrollBefore,
      zoomDidNotDraw: afterZoom.scene.shapes.length === afterWheel.scene.shapes.length,
      crosshairVisible: afterZoom.snapshot.crosshair.visible,
      jsonExportShapeCount: exportedJson.shapes.length,
      pngExportSize: { width: pngWidth, height: pngHeight }
    }
  });
  await screenshot(page, "after-normal-desktop");
});

test("boundary input: scale clamps, edge draw and rotation remain accurate", async ({ page }) => {
  await resetApp(page);
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 1, box.y + 1);
  await page.mouse.down();
  await page.mouse.move(box.x + 12, box.y + 18);
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.up();
  await waitForRender(page);
  const afterEdgeDraw = await getState(page);
  expect(afterEdgeDraw.scene.shapes).toHaveLength(3);

  await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    const rect = canvas.getBoundingClientRect();
    for (let index = 0; index < 30; index += 1) {
      canvas.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -1200,
        ctrlKey: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true
      }));
    }
  });
  await waitForRender(page);
  const atMaximum = await getState(page);
  expect(atMaximum.snapshot.view.scale).toBe(4);

  await page.evaluate(() => {
    const canvas = document.querySelector("#canvas");
    const rect = canvas.getBoundingClientRect();
    for (let index = 0; index < 40; index += 1) {
      canvas.dispatchEvent(new WheelEvent("wheel", {
        deltaY: 1200,
        ctrlKey: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true
      }));
    }
  });
  await waitForRender(page);
  const atMinimum = await getState(page);
  expect(atMinimum.snapshot.view.scale).toBe(0.25);
  expect(atMinimum.scene.shapes).toHaveLength(3);

  await page.setViewportSize({ width: 860, height: 920 });
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__canvasDebug.fitView());
  await page.waitForTimeout(100);
  await page.locator('[data-tool="select"]').click();
  const target = await projectPoint(page, { x: 330, y: 150 });
  await page.mouse.click(target.x, target.y);
  await waitForRender(page);
  const afterRotation = await getState(page);
  expect(afterRotation.selected).toBe("seed-orbit");
  expect(afterRotation.rect.width).not.toBe(box.width);
  expect(afterRotation.errors).toHaveLength(0);

  writeEvidence("after-boundary-desktop", {
    scenario: "boundary",
    project: "desktop",
    final: {
      scale: afterRotation.snapshot.view.scale,
      shapes: afterRotation.scene.shapes.length,
      selected: afterRotation.selected,
      rect: afterRotation.rect,
      errors: afterRotation.errors,
      resources: afterRotation.snapshot.resources,
      render: afterRotation.snapshot.render
    },
    assertions: {
      maxClamp: atMaximum.snapshot.view.scale === 4,
      minClamp: atMinimum.snapshot.view.scale === 0.25,
      rotatedClickSelected: afterRotation.selected === "seed-orbit"
    }
  });
  await screenshot(page, "after-boundary-desktop");
});

test("corrupt input: recovery is visible and repeatable", async ({ page }) => {
  await resetApp(page);
  const key = "crosshair-canvas.scene.v1";
  const corrupt = '{"version":1,"shapes":[{"id":"broken","type":"stroke","points":[{"x":0,"y":NaN}]}';
  await page.addInitScript(({ key, corrupt }) => {
    try {
      localStorage.setItem(key, corrupt);
    } catch {
    }
  }, { key, corrupt });
  const states = [];
  for (let run = 0; run < 2; run += 1) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__canvasDebug?.getState().snapshot));
    const state = await getState(page);
    expect(state.banner).toContain("检测到");
    expect(state.errors.some((error) => error.code === "JSON_INVALID")).toBe(true);
    expect(state.scene.shapes).toHaveLength(2);
    expect(state.snapshot.resources.points).toBe(12);
    states.push({
      banner: state.banner,
      errors: state.errors.map((error) => error.code),
      shapes: state.scene.shapes.length,
      points: state.snapshot.resources.points,
      listeners: state.snapshot.resources.listeners,
      bitmapBytes: state.snapshot.resources.bitmapBytes,
      storageBytes: state.storageBytes
    });
  }
  expect(states[1].errors).toEqual(states[0].errors);
  expect(states[1].shapes).toBe(states[0].shapes);
  expect(states[1].points).toBe(states[0].points);
  expect(states[1].listeners).toBe(states[0].listeners);
  writeEvidence("after-corrupt-desktop", {
    scenario: "corrupt",
    project: "desktop",
    repeatable: true,
    runs: states
  });
  await screenshot(page, "after-corrupt-desktop");
});
