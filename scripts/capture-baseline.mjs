import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4320";
const fixture = `${baseURL}/tests/fixtures/legacy-canvas.html`;
const output = "evidence/before";
mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices["Pixel 7"] });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

async function state() {
  return page.evaluate(() => window.__baselineDebug.getState());
}

async function reset() {
  await page.goto(fixture, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__baselineDebug));
}

async function send(client, type, points) {
  await client.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point, index) => ({
      x: point.x,
      y: point.y,
      id: point.id ?? index,
      radiusX: 4,
      radiusY: 4,
      force: 1
    }))
  });
}

async function screenshot(name) {
  mkdirSync("evidence/screenshots", { recursive: true });
  await page.screenshot({ path: `evidence/screenshots/${name}.png`, fullPage: true });
}

await reset();
const initial = await state();
const normalBox = await page.locator("#canvas").boundingBox();
const normalCenter = { x: normalBox.x + normalBox.width / 2, y: normalBox.y + normalBox.height / 2 };
const touch = await context.newCDPSession(page);
await send(touch, "touchStart", [{ ...normalCenter, id: 0 }]);
await send(touch, "touchMove", [{ x: normalCenter.x + 68, y: normalCenter.y + 22, id: 0 }]);
await send(touch, "touchEnd", []);
await page.waitForTimeout(100);
const afterSingleTouch = await state();

await send(touch, "touchStart", [
  { x: normalCenter.x - 50, y: normalCenter.y, id: 1 },
  { x: normalCenter.x + 50, y: normalCenter.y, id: 2 }
]);
await send(touch, "touchMove", [
  { x: normalCenter.x - 95, y: normalCenter.y, id: 1 },
  { x: normalCenter.x + 95, y: normalCenter.y, id: 2 }
]);
await send(touch, "touchEnd", []);
await touch.detach();
await page.waitForTimeout(100);
const afterPinch = await state();

await page.evaluate(() => window.scrollTo(0, 0));
await page.mouse.move(normalCenter.x, normalCenter.y);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(150);
const normalFinal = await state();
const scrollAfterWheel = await page.evaluate(() => window.scrollY);
const normal = {
  scenario: "normal",
  project: "touch",
  initial: {
    shapes: initial.resources.shapes,
    points: initial.resources.points,
    bitmapBytes: initial.resources.bitmapBytes
  },
  final: {
    shapes: normalFinal.resources.shapes,
    points: normalFinal.resources.points,
    listeners: normalFinal.resources.listeners,
    bitmapBytes: normalFinal.resources.bitmapBytes,
    view: normalFinal.scene.view,
    pageScrollY: scrollAfterWheel,
    errors: [...normalFinal.errors, ...consoleErrors]
  },
  assertions: {
    singleFingerDrew: afterSingleTouch.resources.shapes > initial.resources.shapes,
    pinchDrew: afterPinch.resources.shapes > afterSingleTouch.resources.shapes,
    viewChanged: JSON.stringify(normalFinal.scene.view) !== JSON.stringify(initial.scene.view),
    pageScrollLeaked: scrollAfterWheel > 0
  }
};
writeFileSync(`${output}/before-normal-touch.json`, JSON.stringify(normal, null, 2));
await screenshot("before-normal-touch");

consoleErrors.length = 0;
await reset();
const portrait = await state();
await page.setViewportSize({ width: 915, height: 412 });
await page.waitForTimeout(180);
const afterRotate = await state();
const currentBox = await page.locator("#canvas").boundingBox();
const visualX = 330 * (currentBox.width / portrait.rect.width);
const visualY = 150 * (currentBox.height / portrait.rect.height);
await page.mouse.click(currentBox.x + visualX, currentBox.y + visualY);
await page.waitForTimeout(80);
const afterRotatedClick = await state();
const boundary = {
  scenario: "boundary",
  project: "touch",
  beforeRotation: { rect: portrait.rect, cachedRect: portrait.cachedRect },
  afterRotation: {
    rect: afterRotate.rect,
    cachedRect: afterRotate.cachedRect,
    selected: afterRotatedClick.selected,
    visualTarget: { x: visualX, y: visualY },
    shapes: afterRotatedClick.resources.shapes,
    points: afterRotatedClick.resources.points,
    listeners: afterRotatedClick.resources.listeners,
    bitmapBytes: afterRotatedClick.resources.bitmapBytes,
    errors: [...afterRotatedClick.errors, ...consoleErrors]
  },
  assertions: {
    rotatedClickMissedSeed: afterRotatedClick.selected !== "seed-orbit",
    cachedRectStale:
      afterRotate.rect.width !== afterRotate.cachedRect.width ||
      afterRotate.rect.height !== afterRotate.cachedRect.height ||
      afterRotate.rect.left !== afterRotate.cachedRect.left ||
      afterRotate.rect.top !== afterRotate.cachedRect.top
  }
};
writeFileSync(`${output}/before-boundary-touch.json`, JSON.stringify(boundary, null, 2));
await screenshot("before-boundary-touch");

consoleErrors.length = 0;
await page.addInitScript(({ key, corrupt }) => {
  try {
    localStorage.setItem(key, corrupt);
  } catch {
  }
}, {
  key: "crosshair-canvas.scene.v1",
  corrupt: '{"version":1,"shapes":[{"id":"broken","type":"stroke","points":[{"x":0,"y":NaN}]}'
});
const corruptRuns = [];
for (let run = 0; run < 2; run += 1) {
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__baselineDebug));
  await page.waitForTimeout(150);
  const result = await state();
  corruptRuns.push({
    shapes: result.resources.shapes,
    points: result.resources.points,
    listeners: result.resources.listeners,
    bitmapBytes: result.resources.bitmapBytes,
    errors: [...result.errors, ...consoleErrors]
  });
}
const corrupt = {
  scenario: "corrupt",
  project: "touch",
  repeatable: true,
  runs: corruptRuns
};
writeFileSync(`${output}/before-corrupt-touch.json`, JSON.stringify(corrupt, null, 2));
await screenshot("before-corrupt-touch");

await browser.close();
console.log(`Baseline evidence written to ${output}`);
