import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const KEY_PATH = [
  "ArrowUp",
  "ArrowUp",
  "ArrowUp",
  "ArrowUp",
  "ArrowUp",
  "ArrowRight",
  "ArrowRight",
  "ArrowRight",
  "ArrowRight",
  "ArrowDown",
  "ArrowRight",
  "ArrowDown",
  "ArrowDown",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowLeft",
  "ArrowUp",
  "ArrowDown",
  "ArrowRight",
  "ArrowRight",
  "ArrowRight",
  "ArrowRight",
  "ArrowUp",
  "ArrowUp",
  "ArrowUp",
  "ArrowUp",
  "ArrowUp"
];

async function reset(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#statusLabel")).toHaveText("航行中");
}

async function gameState(page) {
  return page.evaluate(() => window.__LUMEN__.getState());
}

async function canvasData(page) {
  return page.locator("#gameCanvas").evaluate((canvas) => ({ ...canvas.dataset }));
}

async function canvasPixelDiff(page, before, after) {
  return page.evaluate(
    async ({ beforeBase64, afterBase64 }) => {
      async function decode(base64) {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
        return createImageBitmap(blob);
      }
      const [beforeImage, afterImage] = await Promise.all([
        decode(beforeBase64),
        decode(afterBase64)
      ]);
      const canvas = document.createElement("canvas");
      canvas.width = beforeImage.width;
      canvas.height = beforeImage.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(beforeImage, 0, 0);
      const beforeData = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(afterImage, 0, 0);
      const afterData = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      let max = 0;
      for (let index = 0; index < beforeData.length; index += 4) {
        const difference = Math.max(
          Math.abs(beforeData[index] - afterData[index]),
          Math.abs(beforeData[index + 1] - afterData[index + 1]),
          Math.abs(beforeData[index + 2] - afterData[index + 2]),
          Math.abs(beforeData[index + 3] - afterData[index + 3])
        );
        if (difference) {
          count += 1;
          max = Math.max(max, difference);
        }
      }
      return { count, max, width: canvas.width, height: canvas.height };
    },
    { beforeBase64: before.toString("base64"), afterBase64: after.toString("base64") }
  );
}

test("默认：键盘完成整局，读屏与视觉一致，语义层空闲时不刷屏", async ({ page }) => {
  await reset(page);
  await page.locator("#gameRegion").focus();
  await expect(page.locator("#gameSummary")).toContainText("位置：第 1 列，第 6 行");

  for (const key of KEY_PATH) {
    await page.keyboard.press(key);
  }
  await expect(page.locator("#statusLabel")).toHaveText("已完成");
  await expect(page.locator("#livePolite")).toContainText("航程完成", { timeout: 2000 });

  const state = await gameState(page);
  expect(state.status).toBe("won");
  const summary = await page.locator("#gameSummary").textContent();
  expect(summary).toBe(
    "位置：第 8 列，第 1 行。目标方向：已抵达信标。资源：碎片 3/3，能量 6/36。状态：已完成。"
  );
  await expect(page.locator("#positionValue")).toHaveText("第 8 列，第 1 行");
  await expect(page.locator("#targetDirection")).toHaveText("已抵达信标");
  await expect(page.locator("#fragmentValue")).toHaveText("3");
  await expect(page.locator("#energyChip")).toHaveText("6");

  const data = await canvasData(page);
  expect(data.position).toBe("7,0");
  expect(data.status).toBe("won");
  expect(data.fragments).toBe("3/3");
  expect(data.energy).toBe("6");
  expect(data.failureReason).toBe("");

  await page.evaluate(() => {
    window.__liveMutations = 0;
    window.__observeLive = new MutationObserver(() => {
      window.__liveMutations += 1;
    });
    window.__observeLive.observe(document.querySelector("#livePolite"), {
      childList: true,
      characterData: true,
      subtree: true
    });
    window.__observeLive.observe(document.querySelector("#liveAssertive"), {
      childList: true,
      characterData: true,
      subtree: true
    });
  });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__liveMutations)).toBe(0);

  await page.locator("#runTestsButton").click();
  await expect(page.locator("#runTestsButton")).toBeEnabled({ timeout: 15000 });
  await expect(page.locator("#testSummary")).toContainText("3/3 通过 · 成功率 100%");
  expect(
    await page.locator(".test-card").evaluateAll((cards) =>
      cards.map((card) => card.dataset.state)
    )
  ).toEqual(["pass", "pass", "pass"]);
  expect((await gameState(page)).status).toBe("won");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#statusLabel")).toHaveText("已完成");
  await expect(page.locator("#testSummary")).toContainText("3/3 通过 · 成功率 100%");
});

test("输入等价：键盘、鼠标与触屏到达相同状态并更新焦点/读屏信息", async ({
  page,
  browser
}, testInfo) => {
  await reset(page);
  await page.keyboard.press("ArrowUp");
  const keyboardState = await gameState(page);
  const keyboardFingerprint = await page.evaluate(() => window.__LUMEN__.fingerprint());
  await expect(page.locator("#livePolite")).toContainText("位置第 1 列，第 5 行");

  await reset(page);
  await page.locator('[data-move="up"]').click();
  const mouseState = await gameState(page);
  expect(mouseState.player).toEqual(keyboardState.player);
  expect(mouseState.energy).toBe(keyboardState.energy);
  await expect(page.locator("#gameRegion")).toHaveAttribute("data-last-input", "mouse");
  expect(await page.evaluate(() => document.activeElement?.dataset.move)).toBe("up");
  await expect(page.locator("#livePolite")).toContainText("向北移动");

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: "reduce"
  });
  const touchPage = await context.newPage();
  await touchPage.goto(`${testInfo.project.use.baseURL}/`);
  await touchPage.evaluate(() => localStorage.clear());
  await touchPage.reload({ waitUntil: "networkidle" });
  await touchPage.locator('[data-move="up"]').tap();
  const touchState = await gameState(touchPage);
  expect(touchState.player).toEqual(keyboardState.player);
  expect(touchState.energy).toBe(keyboardState.energy);
  expect(
    await touchPage.evaluate(() => window.__LUMEN__.fingerprint())
  ).not.toBe("");
  expect(
    await touchPage.locator("#gameRegion").getAttribute("data-last-input")
  ).toBe("touch");
  await expect(touchPage.locator("#livePolite")).toContainText("位置第 1 列，第 5 行");
  expect(keyboardFingerprint).toBe(await page.evaluate(() => window.__LUMEN__.fingerprint()));
  await context.close();
});

test("错误恢复：能量耗尽给出具体原因，键盘撤回恢复并同步 HUD", async ({ page }) => {
  await reset(page);
  await page.evaluate(() => window.__LUMEN__.loadScenario("error"));
  await page.locator("#gameRegion").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#statusLabel")).toHaveText("能量耗尽");
  await expect(page.locator("#liveAssertive")).toContainText("能量耗尽", { timeout: 2000 });
  await expect(page.locator("#eventMessage")).toContainText("没有剩余能量");

  const failed = await gameState(page);
  expect(failed.status).toBe("failed");
  expect(failed.failureReason).toContain("能量耗尽");
  const failedSummary = await page.locator("#gameSummary").textContent();
  expect(failedSummary).toContain("失败原因：能量耗尽：最后一步后没有剩余能量");
  expect(failedSummary).not.toBe("操作失败");
  await expect(page.locator("#undoButton")).toBeEnabled();

  await page.keyboard.press("z");
  await expect(page.locator("#statusLabel")).toHaveText("航行中");
  const recovered = await gameState(page);
  expect(recovered.status).toBe("playing");
  expect(recovered.player).toEqual({ x: 0, y: 5 });
  expect(recovered.energy).toBe(1);
  expect(recovered.failureReason).toBe("");
  await expect(page.locator("#positionValue")).toHaveText("第 1 列，第 6 行");
  await expect(page.locator("#gameSummary")).not.toContainText("失败原因");
  expect((await canvasData(page)).status).toBe("playing");
});

test("边界：地图边缘错误明确，失败不移动、不耗能并可继续恢复", async ({ page }) => {
  await reset(page);
  await page.locator("#gameRegion").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#liveAssertive")).toContainText("地图边界", { timeout: 2000 });
  await expect(page.locator("#eventStrip")).toHaveAttribute("data-tone", "error");
  const blocked = await gameState(page);
  expect(blocked.player).toEqual({ x: 0, y: 5 });
  expect(blocked.energy).toBe(22);
  expect(blocked.failureReason).toContain("地图边界：向西移动会越界");
  await expect(page.locator("#gameSummary")).toContainText("失败原因：地图边界");

  await page.keyboard.press("ArrowUp");
  const recovered = await gameState(page);
  expect(recovered.player).toEqual({ x: 0, y: 4 });
  expect(recovered.energy).toBe(21);
  expect(recovered.failureReason).toBe("");
  await expect(page.locator("#gameSummary")).not.toContainText("失败原因");
});

test("导出：下载工程保留导出前状态，刷新后航程、选择和导出记录不重置", async ({
  page
}) => {
  await reset(page);
  for (const key of ["ArrowUp", "ArrowUp", "ArrowRight"]) {
    await page.keyboard.press(key);
  }
  await page.locator("#routeHintToggle").setChecked(false);
  await page.locator("#contrastToggle").setChecked(true);
  await page.locator("#soundToggle").click();
  await page.waitForTimeout(200);

  const before = {
    fingerprint: await page.evaluate(() => window.__LUMEN__.fingerprint()),
    state: await gameState(page),
    summary: await page.locator("#gameSummary").textContent(),
    position: await page.locator("#positionValue").textContent(),
    target: await page.locator("#targetDirection").textContent(),
    fragments: await page.locator("#fragmentValue").textContent(),
    energy: await page.locator("#energyChip").textContent()
  };
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const canvasBefore = await page.locator("#gameCanvas").screenshot();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const download = await downloadPromise;
  const savedPath = "test-results/exported-project.json";
  await download.saveAs(savedPath);
  const exported = JSON.parse(await readFile(savedPath, "utf8"));
  expect(exported.format).toBe("lumen-relay-project");
  expect(exported.stateFingerprint).toBe(before.fingerprint);
  expect(exported.state.player).toEqual(before.state.player);
  expect(exported.settings).toEqual({
    sound: false,
    routeHint: false,
    highContrast: true
  });
  await expect(page.locator("#exportStatus")).toContainText(before.fingerprint);
  await expect(page.locator("#restoreExportButton")).toBeEnabled();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("lumen-relay.export.v1"))?.stateFingerprint)
  ).toBe(before.fingerprint);

  const afterFingerprint = await page.evaluate(() => window.__LUMEN__.fingerprint());
  expect(afterFingerprint).toBe(before.fingerprint);
  await page.waitForTimeout(300);
  const canvasAfterExport = await page.locator("#gameCanvas").screenshot();
  const exportDiff = await canvasPixelDiff(page, canvasBefore, canvasAfterExport);
  expect(exportDiff.count).toBeLessThanOrEqual(32);
  expect(exportDiff.max).toBeLessThanOrEqual(2);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#positionValue")).toHaveText(before.position);
  await expect(page.locator("#targetDirection")).toHaveText(before.target);
  await expect(page.locator("#fragmentValue")).toHaveText(before.fragments);
  await expect(page.locator("#energyChip")).toHaveText(before.energy);
  await expect(page.locator("#gameSummary")).toHaveText(before.summary);
  expect(await page.evaluate(() => window.__LUMEN__.fingerprint())).toBe(before.fingerprint);
  expect(await page.evaluate(() => window.__LUMEN__.getSettings())).toEqual({
    sound: false,
    routeHint: false,
    highContrast: true
  });
  await expect(page.locator("#routeHintToggle")).not.toBeChecked();
  await expect(page.locator("#contrastToggle")).toBeChecked();
  await expect(page.locator("#soundToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("body")).toHaveClass(/high-contrast/);
  await expect(page.locator("#exportStatus")).toContainText(before.fingerprint);
  await expect(page.locator("#restoreExportButton")).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const canvasAfterReload = await page.locator("#gameCanvas").screenshot();
  const reloadDiff = await canvasPixelDiff(page, canvasBefore, canvasAfterReload);
  expect(reloadDiff.count).toBeLessThanOrEqual(32);
  expect(reloadDiff.max).toBeLessThanOrEqual(2);

  await page.keyboard.press("ArrowUp");
  const changedFingerprint = await page.evaluate(() => window.__LUMEN__.fingerprint());
  expect(changedFingerprint).not.toBe(before.fingerprint);
  await page.locator("#restoreExportButton").click();
  await expect(page.locator("#livePolite")).toContainText("已恢复最近导出工程", {
    timeout: 2000
  });
  expect(await page.evaluate(() => window.__LUMEN__.fingerprint())).toBe(before.fingerprint);
});
