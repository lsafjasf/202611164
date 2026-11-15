import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export async function resetApp(page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => window.__canvasDebug?.clearStorage());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__canvasDebug?.getState().snapshot));
  await page.evaluate(() => document.fonts.ready);
}

export async function getState(page) {
  return page.evaluate(() => window.__canvasDebug.getState());
}

export async function waitForRender(page, count = 1) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(Math.max(25, count * 20));
}

export function writeEvidence(name, payload) {
  const file = `evidence/runs/${name}.json`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload, null, 2));
}

export async function canvasBox(page) {
  return page.locator("#canvas").boundingBox();
}

export async function projectPoint(page, worldPoint) {
  const local = await page.evaluate(
    (point) => window.__canvasDebug.project(point),
    worldPoint
  );
  const box = await canvasBox(page);
  return { x: box.x + local.x, y: box.y + local.y, local, box };
}

export async function dispatchTouch(page, type, points) {
  const client = await page.context().newCDPSession(page);
  await sendTouch(client, type, points);
  await client.detach();
}

export async function sendTouch(client, type, points) {
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

export async function newTouchSession(page) {
  return page.context().newCDPSession(page);
}

export async function screenshot(page, name) {
  mkdirSync("evidence/screenshots", { recursive: true });
  await page.screenshot({ path: `evidence/screenshots/${name}.png`, fullPage: true });
}
