const fs = require("fs");
const crypto = require("crypto");
const { test, expect } = require("@playwright/test");

async function openApp(page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

async function reloadApp(page) {
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(80);
}

async function canvasHash(page, selector = "#normalCanvas") {
  const dataUrl = await page.locator(selector).evaluate((canvas) => canvas.toDataURL());
  return crypto.createHash("sha1").update(dataUrl).digest("hex");
}

test("default, boundary, and error groups report an explicit 3/3 result", async ({ page }) => {
  await openApp(page);
  const before = await page.locator(".hex-input").evaluateAll((inputs) =>
    inputs.map((input) => input.value)
  );
  await page.locator("#runAllTests").click();
  await expect(page.locator("#testPassRate")).toHaveText("3/3", { timeout: 30000 });
  await expect(page.locator("#testSummaryDetail")).toContainText("100% 通过");
  await expect(page.locator("#testFooterText")).toContainText("17/17");
  await expect(page.locator(".test-card.is-pass")).toHaveCount(3);
  const after = await page.locator(".hex-input").evaluateAll((inputs) =>
    inputs.map((input) => input.value)
  );
  expect(after).toEqual(before);

  await reloadApp(page);
  await expect(page.locator("#testPassRate")).toHaveText("3/3");
  await expect(page.locator("#testSummaryDetail")).toContainText("100% 通过");
});

test("keyboard lock updates state, focus, live region, and survives reload", async ({ page }) => {
  await openApp(page);
  const lock = page.locator('.token-row[data-token-id="series2"] .lock-button');
  await lock.focus();
  await page.keyboard.press("Enter");
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#lockedCount")).toHaveText("4");
  await expect(lock).toBeFocused();
  await expect(page.locator("#liveStatus")).toContainText("已锁定");
  await expect(page.locator("#normalCanvas")).toHaveAttribute("aria-label", /最低序列色差/);
  const visualBefore = await canvasHash(page);

  await reloadApp(page);
  const reloadedLock = page.locator('.token-row[data-token-id="series2"] .lock-button');
  await expect(reloadedLock).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#lockedCount")).toHaveText("4");
  await expect(page.locator('.token-row[data-token-id="series2"]')).toHaveClass(/is-selected/);
  const visualAfter = await canvasHash(page);
  expect(visualAfter).toBe(visualBefore);
});

test("mouse and touch reach the same lock state", async ({ page, browser }) => {
  await openApp(page);
  await page.locator('.token-row[data-token-id="series3"] .lock-button').click();
  await expect(page.locator("#lockedCount")).toHaveText("4");

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "zh-CN"
  });
  const touchPage = await context.newPage();
  await openApp(touchPage);
  await touchPage.locator("#mobileMenu").tap();
  await expect(touchPage.locator("#mobileMenu")).toHaveAttribute("aria-expanded", "true");
  await touchPage.locator('.nav-item[href="#palette-panel"]').tap();
  await touchPage.locator('.token-row[data-token-id="series3"] .lock-button').tap();
  await expect(touchPage.locator("#lockedCount")).toHaveText("4");
  await expect(
    touchPage.locator('.token-row[data-token-id="series3"] .lock-button')
  ).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test("invalid HEX is rejected with details, preserves state, and recovers", async ({ page }) => {
  await openApp(page);
  const input = page.locator('.token-row[data-token-id="series2"] .hex-input');
  const original = await input.inputValue();
  await input.fill("#12ZZ34");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".toast.is-error").last()).toContainText(`已保留原值 ${original}`);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("chromaguard:project:v1")));
  expect(stored.palette.find((token) => token.id === "series2").value).toBe(original);

  await input.fill("#D92A63");
  await input.press("Enter");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveValue("#D92A63");
  await reloadApp(page);
  await expect(page.locator('.token-row[data-token-id="series2"] .hex-input')).toHaveValue("#D92A63");
});

test("CSS and PNG exports retain a pre-export snapshot and reload safely", async ({ page }) => {
  await openApp(page);
  const paletteBefore = await page.locator(".hex-input").evaluateAll((inputs) =>
    inputs.map((input) => input.value)
  );

  const cssDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportCssTop").click();
  const cssDownload = await cssDownloadPromise;
  const css = fs.readFileSync(await cssDownload.path(), "utf8");
  expect(cssDownload.suggestedFilename()).toBe("q4-analytics-palette.css");
  expect(css).toContain("--cg-surface: #F4F1E8");
  expect(css).toContain("--cg-series1: #237A65");
  expect(css).toContain("--cg-deuteranopia-series1");

  const pngDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportPngTop").click();
  const pngDownload = await pngDownloadPromise;
  const png = fs.readFileSync(await pngDownload.path());
  expect(pngDownload.suggestedFilename()).toBe("q4-analytics-cvd-preview.png");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  await expect(page.locator("#snapshotBadge")).toContainText("快照已保留");
  await expect(page.locator("#restoreSnapshot")).toBeEnabled();

  const projectDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportProject").click();
  const projectDownload = await projectDownloadPromise;
  const project = JSON.parse(fs.readFileSync(await projectDownload.path(), "utf8"));
  expect(project.schema).toBe("chromaguard/project@1");
  expect(project.palette.find((token) => token.id === "series1").value).toBe("#237A65");
  const exportedState = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("chromaguard:project:v1"))
  );
  expect(exportedState.lastProjectExport.fileName).toBe("q4-analytics-project.json");

  await page.locator('.token-row[data-token-id="series2"] .hex-input').fill("#D92A63");
  await page.locator('.token-row[data-token-id="series2"] .hex-input').press("Enter");
  await reloadApp(page);
  await expect(page.locator('.token-row[data-token-id="series2"] .hex-input')).toHaveValue("#D92A63");
  await expect(page.locator("#snapshotBadge")).toContainText("快照已保留");
  const reloadedState = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("chromaguard:project:v1"))
  );
  expect(reloadedState.lastProjectExport.fileName).toBe("q4-analytics-project.json");
  const paletteAfterReload = await page.locator(".hex-input").evaluateAll((inputs) =>
    inputs.map((input) => input.value)
  );
  expect(paletteAfterReload).not.toEqual(paletteBefore);

  await page.locator("#restoreSnapshot").click();
  const restored = await page.locator(".hex-input").evaluateAll((inputs) =>
    inputs.map((input) => input.value)
  );
  expect(restored).toEqual(paletteBefore);
});

test("three canvas views expose metrics and a low-contrast edit reports exact risk", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("canvas")).toHaveCount(3);
  for (const canvas of await page.locator("canvas").all()) {
    await expect(canvas).toHaveAttribute("aria-label", /ΔE/);
    await expect(canvas).toHaveAttribute("aria-label", /对比度/);
  }
  const input = page.locator('.token-row[data-token-id="series2"] .hex-input');
  await input.fill("#F8F5EC");
  await input.press("Enter");
  await expect(page.locator("#riskCount")).not.toHaveText("0 项");
  await expect(page.locator("#riskList")).toContainText("对比度不足");
  await expect(page.locator("#riskList")).toContainText(":1");
  await expect(page.locator("#overallStatus")).not.toContainText("全部通过");
});
