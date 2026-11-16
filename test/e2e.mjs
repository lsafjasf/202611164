import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ARTIFACTS = join(ROOT, "artifacts");
const DOWNLOADS = join(ARTIFACTS, "test-downloads");
const SCREENSHOTS = join(ARTIFACTS, "screenshots");
const PLAYWRIGHT_CACHE = [
  join(homedir(), ".cache", "ms-playwright"),
  join("/home", userInfo().username, ".cache", "ms-playwright"),
].find((candidate) => existsSync(candidate));
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && PLAYWRIGHT_CACHE) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_CACHE;
}
const { chromium } = await import("playwright");

const results = [];
const startedAt = new Date();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n实际: ${a}\n期望: ${b}`);
}

function coreSnapshot(state) {
  return {
    project: state.project,
    tool: state.tool,
    zoom: state.zoom,
    cursor: state.cursor,
    selectedId: state.selectedId,
    style: state.style,
  };
}

function normalizedGeometry(object) {
  if (!object) return null;
  const geometry = { type: object.type, color: object.color, strokeWidth: object.strokeWidth };
  for (const key of ["x1", "y1", "x2", "y2", "x", "y", "width", "height", "cx", "cy", "rx", "ry", "text"]) {
    if (object[key] !== undefined && typeof object[key] !== "string") geometry[key] = Math.round(object[key] * 10) / 10;
  }
  if (Array.isArray(object.points)) {
    geometry.points = object.points.map((point) => [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10]);
  }
  return geometry;
}

async function run(group, id, name, fn) {
  const start = performance.now();
  try {
    const detail = await fn();
    const duration = Math.round(performance.now() - start);
    results.push({ group, id, name, status: "passed", duration, detail: detail || null });
    console.log(`PASS  ${group}/${id}  ${name} (${duration} ms)`);
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    const reason = (error?.stack || error?.message || String(error)).split("\n").slice(0, 8).join("\n");
    results.push({ group, id, name, status: "failed", duration, reason });
    console.error(`FAIL  ${group}/${id}  ${name} (${duration} ms)\n      ${reason.replaceAll("\n", "\n      ")}`);
  }
}

async function withPage(callback, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    acceptDownloads: true,
    hasTouch: true,
    locale: "zh-CN",
    reducedMotion: options.reducedMotion || "no-preference",
  });
  if (options.initData) {
    await context.addInitScript((data) => {
      localStorage.setItem("focus-canvas.project.v1", data.current);
      localStorage.setItem("focus-canvas.project.backup.v1", data.backup);
    }, options.initData);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.evaluate(() => document.fonts.ready);
    const result = await callback(page, context);
    assert(errors.length === 0, `页面运行时错误：${errors.join(" | ")}`);
    return result;
  } finally {
    await context.close();
  }
}

async function getState(page) {
  return page.evaluate(() => window.__focusCanvas.getState());
}

async function getUi(page) {
  return page.evaluate(() => window.__focusCanvas.getUiSnapshot());
}

async function pressMany(page, key, count) {
  for (let index = 0; index < count; index += 1) await page.keyboard.press(key);
}

async function drawRectKeyboard(page) {
  await page.locator("#drawing-canvas").focus();
  await page.keyboard.press("r");
  await page.keyboard.press("Space");
  await pressMany(page, "ArrowRight", 6);
  await pressMany(page, "ArrowDown", 4);
  await page.keyboard.press("Space");
}

async function waitForStatus(page, text) {
  await page.waitForFunction(
    (value) => document.querySelector("#canvas-status")?.textContent.includes(value),
    text,
  );
}

function checkPng(buffer) {
  assert(buffer.length > 100, "PNG 文件为空或过小");
  same([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "PNG 文件签名不正确");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  same({ width, height }, { width: 2400, height: 1600 }, "PNG 尺寸应为 2400×1600");
  return { bytes: buffer.length, width, height };
}

async function saveDownload(download, name) {
  const target = join(DOWNLOADS, name);
  await download.saveAs(target);
  return target;
}

let browser;
let baseUrl;
let serverHandle;

async function defaultGroup() {
  await run("default", "D1", "页面以可访问默认状态载入，Tab 可到达画布", async () => {
    return withPage(async (page) => {
      const state = await getState(page);
      const ui = await getUi(page);
      same(state.project.objects, [], "新工程不应包含对象");
      same(state.tool, "pen", "默认工具应为画笔");
      same(ui.pressedTool, "pen", "工具栏画笔应呈按下状态");
      same(ui.hudTool, "P 画笔", "Canvas HUD 应显示当前工具");
      assert((await page.locator(".tool-button").count()) === 7, "应有 7 个工具按钮");
      assert((await page.locator("#drawing-canvas").getAttribute("role")) === "application", "画布应使用 application 角色");
      assert(await page.locator("#export-svg").isVisible(), "SVG 导出按钮应可见");
      assert(await page.locator("#export-png").isVisible(), "PNG 导出按钮应可见");

      let reached = false;
      for (let index = 0; index < 24; index += 1) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(() => document.activeElement?.id === "drawing-canvas")) {
          reached = true;
          break;
        }
      }
      assert(reached, "仅使用 Tab 键应在 24 步内到达绘图画布");
      const focusStyle = await page.locator("#drawing-canvas").evaluate((canvas) => {
        const style = getComputedStyle(canvas);
        return { boxShadow: style.boxShadow, focusVisible: canvas.matches(":focus-visible") };
      });
      assert(focusStyle.focusVisible, "画布应匹配 :focus-visible");
      assert(focusStyle.boxShadow !== "none", "画布焦点环应清晰可见");
      assert((await getUi(page)).canvasLabel.includes("当前工具：画笔"), "画布读屏名称应包含当前工具");
      return { tabSteps: "≤24", focusRing: focusStyle.boxShadow };
    });
  });

  await run("default", "D2", "纯键盘选择矩形、移动焦点并绘制", async () => {
    return withPage(async (page) => {
      await drawRectKeyboard(page);
      await waitForStatus(page, "已创建矩形");
      const state = await getState(page);
      const ui = await getUi(page);
      same(state.project.objects.length, 1, "应创建一个对象");
      const rect = state.project.objects[0];
      same(
        { type: rect.type, x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        { type: "rect", x: 600, y: 400, width: 60, height: 40 },
        "键盘矩形几何数据不正确",
      );
      same(state.tool, "rect", "当前工具应保持为矩形");
      same(state.cursor, { x: 660, y: 440 }, "焦点坐标应随方向键更新");
      same(ui.pressedTool, "rect", "工具栏状态应与键盘工具选择一致");
      same(ui.hudTool, "R 矩形", "Canvas HUD 工具应更新");
      same(ui.hudFocus, "焦点 660, 440", "Canvas HUD 焦点应更新");
      assert(ui.canvasLabel.includes("焦点 660, 440"), "读屏画布名称应更新焦点坐标");
      assert(ui.canvasLabel.includes("共 1 个对象"), "读屏画布名称应更新对象数量");
      assert(ui.saveState.includes("已自动保存"), "绘制后应显示自动保存状态");
      same(state.selectedId, rect.id, "新对象应自动选中");
      return { rect, liveStatus: ui.liveStatus };
    });
  });

  await run("default", "D3", "键盘撤销与重做恢复同一对象", async () => {
    return withPage(async (page) => {
      await drawRectKeyboard(page);
      const created = await getState(page);
      await page.keyboard.press("Control+z");
      await waitForStatus(page, "已撤销");
      const undone = await getState(page);
      same(undone.project.objects.length, 0, "撤销后对象应为 0");
      same(undone.redoCount, 1, "撤销后应有 1 条重做记录");
      await page.keyboard.press("Control+Shift+z");
      await waitForStatus(page, "已重做");
      const redone = await getState(page);
      same(redone.project.objects.length, 1, "重做后对象应恢复");
      same(redone.project.objects[0].id, created.project.objects[0].id, "重做应恢复同一对象");
      same(redone.undoCount, 1, "重做后撤销栈应恢复");
      assert(!(await page.locator("#undo-button").isDisabled()), "撤销与重做后撤销按钮应可用");
      return { undoCount: redone.undoCount, redoCount: redone.redoCount };
    });
  });

  await run("default", "D4", "键盘缩放、HUD、读屏名称与保存状态同步", async () => {
    return withPage(async (page) => {
      await page.locator("#drawing-canvas").focus();
      const focusedBefore = await page.evaluate(() => document.activeElement?.id);
      await page.keyboard.press("+");
      await waitForStatus(page, "缩放 125%");
      let state = await getState(page);
      let ui = await getUi(page);
      same(state.zoom, 1.25, "加号键应放大到 125%");
      same(ui.zoom, "125%", "缩放输出应显示 125%");
      assert(ui.canvasLabel.includes("缩放 125%"), "读屏画布名称应包含缩放比例");
      assert(ui.focusSummary.includes("缩放 125%"), "状态面板应包含缩放比例");
      same(await page.evaluate(() => document.activeElement?.id), focusedBefore, "缩放后键盘焦点不应跳走");
      await page.keyboard.press("0");
      await waitForStatus(page, "缩放 100%");
      state = await getState(page);
      same(state.zoom, 1, "数字 0 应恢复 100%");
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("focus-canvas.project.v1")));
      same(persisted.zoom, 1, "缩放选择应立即写入本机工程");
      return { zoom: state.zoom, focusRetained: focusedBefore };
    });
  });

  await run("default", "D5", "纯键盘打开文字对话框并插入文字对象", async () => {
    return withPage(async (page) => {
      await page.locator("#drawing-canvas").focus();
      await page.keyboard.press("t");
      await page.keyboard.press("Space");
      await page.locator("#text-dialog").waitFor({ state: "visible" });
      same(await page.evaluate(() => document.activeElement?.id), "text-input", "文字对话框应自动聚焦输入框");
      assert((await getState(page)).project.objects.length === 0, "打开对话框不应提前写入对象");
      await page.keyboard.type("键盘与读屏文字");
      await page.keyboard.press("Tab");
      same(await page.evaluate(() => document.activeElement?.id), "text-cancel", "Tab 应到达取消按钮");
      await page.keyboard.press("Tab");
      assert(
        await page.evaluate(() => document.activeElement?.matches("#text-form button[type='submit']")),
        "第二次 Tab 应到达插入按钮",
      );
      await page.keyboard.press("Enter");
      await page.locator("#text-dialog").waitFor({ state: "hidden" });
      await waitForStatus(page, "已创建文字");
      const state = await getState(page);
      const text = state.project.objects[0];
      same(state.project.objects.length, 1, "应创建一个文字对象");
      same(text.type, "text", "对象类型应为文字");
      same(text.text, "键盘与读屏文字", "文字内容应准确保存");
      assert(
        (await page.locator("#object-list button").getAttribute("aria-label")).includes("键盘与读屏文字"),
        "对象列表读屏名称应包含文字内容",
      );
      const ui = await getUi(page);
      assert(ui.liveStatus.includes("已创建文字"), "实时状态应播报文字创建结果");
      return { text, liveStatus: ui.liveStatus };
    });
  });

  await run("default", "D6", "键盘、鼠标、触屏生成同一功能状态的直线", async () => {
    const variant = async (method) => withPage(async (page) => {
      await page.keyboard.press("l");
      if (method === "keyboard") {
        await page.locator("#drawing-canvas").focus();
        await page.keyboard.press("Space");
        await pressMany(page, "ArrowRight", 5);
        await pressMany(page, "ArrowDown", 5);
        await page.keyboard.press("Space");
      } else {
        const rect = await page.locator("#drawing-canvas").boundingBox();
        const startX = rect.x + rect.width / 2;
        const startY = rect.y + rect.height / 2;
        const scale = rect.width / 1200;
        const endX = startX + 50 * scale;
        const endY = startY + 50 * scale;
        if (method === "mouse") {
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          await page.mouse.move(endX, endY, { steps: 8 });
          await page.mouse.up();
        } else {
          await page.evaluate(({ startX, startY, endX, endY }) => {
            const canvas = document.querySelector("#drawing-canvas");
            const event = (type, x, y) => new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 17,
              pointerType: "touch",
              isPrimary: true,
              clientX: x,
              clientY: y,
            });
            canvas.dispatchEvent(event("pointerdown", startX, startY));
            canvas.dispatchEvent(event("pointermove", (startX + endX) / 2, (startY + endY) / 2));
            canvas.dispatchEvent(event("pointermove", endX, endY));
            canvas.dispatchEvent(event("pointerup", endX, endY));
          }, { startX, startY, endX, endY });
        }
      }
      await page.waitForFunction(() => window.__focusCanvas.getState().project.objects.length === 1);
      const state = await getState(page);
      const ui = await getUi(page);
      return {
        geometry: normalizedGeometry(state.project.objects[0]),
        tool: state.tool,
        objectCount: state.project.objects.length,
        hudTool: ui.hudTool,
        hudFocus: ui.hudFocus,
      };
    });
    const keyboard = await variant("keyboard");
    const mouse = await variant("mouse");
    const touch = await variant("touch");
    same(mouse, keyboard, "鼠标与键盘应生成相同工具、几何与 HUD 状态");
    same(touch, keyboard, "触屏与键盘应生成相同工具、几何与 HUD 状态");
    same(keyboard.tool, "line", "三种输入方式应保持直线工具");
    return { geometry: keyboard.geometry, channels: ["keyboard", "mouse", "touch"] };
  });

  await run("default", "D7", "键盘导出 SVG/PNG，且导出前工程状态保持不变", async () => {
    return withPage(async (page) => {
      await drawRectKeyboard(page);
      await page.locator("#drawing-canvas").focus();
      await page.keyboard.press("t");
      await page.keyboard.press("Space");
      await page.locator("#text-input").fill('文字 & <导出> "');
      await page.locator("#text-form button[type='submit']").click();
      await page.locator("#text-dialog").waitFor({ state: "hidden" });
      await page.keyboard.press("+");
      await page.keyboard.press("v");
      const before = await getState(page);

      await page.locator("#export-svg").focus();
      const [svgDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.keyboard.press("Enter"),
      ]);
      const svgPath = await saveDownload(svgDownload, "export-default.svg");
      await page.locator("#export-png").focus();
      const [pngDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.keyboard.press("Enter"),
      ]);
      const pngPath = await saveDownload(pngDownload, "export-default.png");

      const after = await getState(page);
      same(coreSnapshot(after), coreSnapshot(before), "成功导出不得改动工程、工具、缩放、焦点、选择或样式");
      same(after.lastExport.format, "png", "最近导出记录应更新为 PNG");
      same(after.lastExport.objectCount, 2, "导出记录应包含对象数");
      const { readFile } = await import("node:fs/promises");
      const svg = await readFile(svgPath, "utf8");
      assert(svg.includes("<svg"), "SVG 应包含根元素");
      assert(svg.includes("<rect"), "SVG 应包含矩形对象");
      assert(svg.includes("<text"), "SVG 应包含文字对象");
      assert(svg.includes("&amp;"), "SVG 应转义文字中的 & 符号");
      assert(svg.includes("&lt;导出&gt;"), "SVG 应转义文字中的尖括号");
      const png = checkPng(await readFile(pngPath));
      same(after.project.objects.length, 2, "导出后对象数应保持 2");
      return { svgBytes: Buffer.byteLength(svg), png, lastExport: after.lastExport };
    });
  });

  await run("default", "D8", "刷新后恢复文字、工具、缩放、选择、样式和导出记录", async () => {
    return withPage(async (page) => {
      await drawRectKeyboard(page);
      await page.locator("#drawing-canvas").focus();
      await page.keyboard.press("t");
      await page.keyboard.press("Space");
      await page.locator("#text-input").fill("刷新后仍然存在");
      await page.locator("#text-form button[type='submit']").click();
      await page.locator("#text-dialog").waitFor({ state: "hidden" });
      await page.keyboard.press("v");
      await page.keyboard.press("+");
      await page.locator("#stroke-width").focus();
      await page.keyboard.press("ArrowRight");
      await page.locator("#drawing-canvas").focus();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#export-svg").focus().then(() => page.keyboard.press("Enter")),
      ]);
      await saveDownload(download, "export-before-reload.svg");
      const before = await getState(page);
      assert(before.project.objects.some((object) => object.text === "刷新后仍然存在"), "导出前应存在文字");

      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      await page.evaluate(() => document.fonts.ready);
      const after = await getState(page);
      const ui = await getUi(page);
      same(coreSnapshot(after), coreSnapshot(before), "刷新后工程、工具、缩放、焦点、选择和样式应完全恢复");
      same(after.lastExport, before.lastExport, "刷新后最近导出记录不得重置");
      same(after.undoCount, before.undoCount, "刷新后撤销历史应恢复");
      same(ui.pressedTool, "select", "刷新后用户选择的工具不得重置");
      same(ui.zoom, "125%", "刷新后缩放不得重置");
      assert(ui.saveState.includes("已从本机恢复"), "刷新后应明确显示从本机恢复");
      assert(
        await page.locator("#object-list button[aria-current='true']").count() === 1,
        "刷新后所选对象应在对象列表中保持选中",
      );
      return { objects: after.project.objects.length, selectedId: after.selectedId, lastExport: after.lastExport };
    });
  });
}

async function boundaryGroup() {
  await run("boundary", "B1", "光标在画布四边精确钳制，HUD 与读屏名称同步", async () => {
    return withPage(async (page) => {
      await page.locator("#drawing-canvas").focus();
      await pressMany(page, "ArrowUp", 45);
      await pressMany(page, "ArrowLeft", 65);
      let state = await getState(page);
      let ui = await getUi(page);
      same(state.cursor, { x: 0, y: 0 }, "光标左上角应钳制为 0,0");
      assert(ui.hudFocus.includes("0, 0"), "左上角 HUD 应显示 0, 0");
      assert(ui.canvasLabel.includes("焦点 0, 0"), "左上角读屏名称应更新");
      await pressMany(page, "ArrowDown", 85);
      await pressMany(page, "ArrowRight", 125);
      state = await getState(page);
      ui = await getUi(page);
      same(state.cursor, { x: 1200, y: 800 }, "光标右下角应钳制为 1200,800");
      assert(ui.hudFocus.includes("1200, 800"), "右下角 HUD 应显示 1200, 800");
      assert(ui.canvasLabel.includes("焦点 1200, 800"), "右下角读屏名称应更新");
      return { topLeft: { x: 0, y: 0 }, bottomRight: state.cursor };
    });
  });

  await run("boundary", "B2", "键盘缩放在 50%–400% 边界钳制并给出明确播报", async () => {
    return withPage(async (page) => {
      await page.locator("#drawing-canvas").focus();
      await pressMany(page, "-", 30);
      let state = await getState(page);
      assert(state.zoom === 0.5, `最小缩放应为 0.5，实际 ${state.zoom}`);
      await waitForStatus(page, "最小值 50%");
      await pressMany(page, "+", 40);
      state = await getState(page);
      assert(state.zoom === 4, `最大缩放应为 4，实际 ${state.zoom}`);
      await waitForStatus(page, "最大值 400%");
      assert((await getUi(page)).zoom === "400%", "HUD 缩放应显示 400%");
      const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("focus-canvas.project.v1")));
      same(persisted.zoom, 4, "边界缩放值应持久化");
      return { min: 0.5, max: state.zoom };
    });
  });

  await run("boundary", "B3", "零尺寸图形被拒绝，移动后可恢复并完成绘制", async () => {
    return withPage(async (page) => {
      await page.locator("#drawing-canvas").focus();
      await page.keyboard.press("r");
      await page.keyboard.press("Space");
      await page.keyboard.press("Enter");
      await waitForStatus(page, "尺寸过小");
      let state = await getState(page);
      same(state.project.objects.length, 0, "零尺寸矩形不得写入工程");
      assert(state.draft !== null, "被拒绝的草稿应保留以便继续调整");
      await pressMany(page, "ArrowRight", 3);
      await pressMany(page, "ArrowDown", 3);
      await page.keyboard.press("Enter");
      state = await getState(page);
      same(state.project.objects.length, 1, "调整尺寸后应能完成矩形");
      same(state.draft, null, "完成后草稿应清空");
      assert(!(await page.locator("#empty-hint").isVisible()), "有对象后空画布提示应隐藏");
      return { rejected: "zero-size", recoveredObject: normalizedGeometry(state.project.objects[0]) };
    });
  });

  await run("boundary", "B4", "双指缩放达到边界且不产生误绘对象", async () => {
    return withPage(async (page) => {
      const rect = await page.locator("#drawing-canvas").boundingBox();
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      await page.evaluate(({ cx, cy }) => {
        const canvas = document.querySelector("#drawing-canvas");
        const event = (type, id, x, y) => new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 1,
          clientX: x,
          clientY: y,
        });
        canvas.dispatchEvent(event("pointerdown", 1, cx - 50, cy));
        canvas.dispatchEvent(event("pointerdown", 2, cx + 50, cy));
        canvas.dispatchEvent(event("pointermove", 2, cx + 450, cy));
        canvas.dispatchEvent(event("pointerup", 2, cx + 450, cy));
        canvas.dispatchEvent(event("pointerup", 1, cx - 50, cy));
      }, { cx, cy });
      await page.waitForFunction(() => window.__focusCanvas.getState().zoom === 4);
      const state = await getState(page);
      same(state.project.objects.length, 0, "缩放操作不应写入误绘对象");
      assert(state.zoom === 4, "大幅双指放大应钳制到 400%");
      assert((await getUi(page)).zoom === "400%", "双指缩放后 HUD 应显示 400%");
      return { zoom: state.zoom, objects: state.project.objects.length };
    });
  });

  await run("boundary", "B5", "空工程可导出有效 SVG 与 PNG", async () => {
    return withPage(async (page) => {
      assert((await getState(page)).project.objects.length === 0, "边界导出应从空工程开始");
      const [svgDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#export-svg").click(),
      ]);
      const svgPath = await saveDownload(svgDownload, "boundary-empty.svg");
      const [pngDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#export-png").click(),
      ]);
      const pngPath = await saveDownload(pngDownload, "boundary-empty.png");
      const { readFile } = await import("node:fs/promises");
      const svg = await readFile(svgPath, "utf8");
      assert(svg.includes('width="1200" height="800"'), "空 SVG 应保留完整视口");
      const png = checkPng(await readFile(pngPath));
      same((await getState(page)).project.objects.length, 0, "导出空工程不得修改工程");
      return { svgBytes: Buffer.byteLength(svg), png };
    });
  });
}

async function errorGroup() {
  await run("error", "E1", "导出故障显示具体原因，重试成功且工程未被修改", async () => {
    return withPage(async (page) => {
      await drawRectKeyboard(page);
      const before = await getState(page);
      await page.evaluate(() => window.__focusCanvas.injectFault("export"));
      await page.locator("#export-png").focus();
      await page.keyboard.press("Enter");
      await page.locator("#error-banner").waitFor({ state: "visible" });
      const message = await page.locator("#error-message").textContent();
      assert(message.includes("模拟导出故障"), "错误提示应包含具体失败原因");
      assert(message.includes("工程和导出前状态均未更改"), "错误提示应说明状态保护结果");
      same(coreSnapshot(await getState(page)), coreSnapshot(before), "导出失败不得修改工程状态");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#error-action").focus().then(() => page.keyboard.press("Enter")),
      ]);
      await saveDownload(download, "error-retry.png");
      await page.locator("#error-banner").waitFor({ state: "hidden" });
      const after = await getState(page);
      same(coreSnapshot(after), coreSnapshot(before), "重试成功不得改动工程");
      same(after.lastExport.format, "png", "重试成功后应记录 PNG 导出");
      assert((await page.locator("#export-result").textContent()).includes("已导出"), "重试成功应显示明确文件名");
      return { failureReason: message, retryFormat: after.lastExport.format };
    });
  });

  await run("error", "E2", "空文字失败后保留工程并可输入有效文字恢复", async () => {
    return withPage(async (page) => {
      await page.locator("#drawing-canvas").focus();
      await page.keyboard.press("t");
      await page.keyboard.press("Space");
      await page.locator("#text-dialog").waitFor({ state: "visible" });
      const before = await getState(page);
      await page.locator("#text-form button[type='submit']").focus();
      await page.keyboard.press("Enter");
      await page.locator("#text-error").waitFor({ state: "visible" });
      assert((await page.locator("#text-error").textContent()).includes("请输入至少一个字符"), "空文字应显示具体错误");
      same(coreSnapshot(await getState(page)), coreSnapshot(before), "空文字失败不得写入工程");
      await page.locator("#text-input").fill("错误恢复成功");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.locator("#text-dialog").waitFor({ state: "hidden" });
      const after = await getState(page);
      same(after.project.objects.length, 1, "恢复输入后应插入文字");
      same(after.project.objects[0].text, "错误恢复成功", "恢复后的文字内容应正确");
      assert(await page.locator("#error-banner").isHidden(), "恢复后不应残留错误提示");
      return { recoveredText: after.project.objects[0].text };
    });
  });

  await run("error", "E3", "损坏当前存储时从有效备份恢复并显示原因", async () => {
    const storage = await withPage(async (page) => {
      await drawRectKeyboard(page);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#export-svg").click(),
      ]);
      await saveDownload(download, "backup-source.svg");
      await page.locator("#drawing-canvas").focus();
      await page.keyboard.press("+");
      return page.evaluate(() => window.__focusCanvas.getStorage());
    });
    assert(storage.current && storage.backup, "应同时存在当前工程和备份");
    const result = await withPage(async (page) => {
      await page.locator("#error-banner").waitFor({ state: "visible" });
      const message = await page.locator("#error-message").textContent();
      assert(message.includes("已从最近有效备份恢复"), "应明确播报从备份恢复");
      assert(
        /JSON|property|position|unexpected|token/i.test(message),
        `错误原因应包含具体解析失败信息，实际：${message}`,
      );
      const state = await getState(page);
      same(state.project.objects.length, 1, "备份中的对象应恢复");
      same(state.tool, "rect", "备份中的工具选择应恢复");
      same(state.lastExport?.format, "svg", "备份中的导出记录应恢复");
      await page.locator("#error-action").focus();
      await page.keyboard.press("Enter");
      await page.locator("#error-banner").waitFor({ state: "hidden" });
      const repaired = await page.evaluate(() => JSON.parse(localStorage.getItem("focus-canvas.project.v1")));
      same(repaired.project.objects.length, 1, "恢复后应用有效工程覆盖损坏的当前存储");
      return { message, objects: state.project.objects.length, lastExport: state.lastExport };
    }, {
      initData: { current: "{corrupt-json", backup: storage.backup },
    });
    await result;
    return result;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function summarize() {
  const total = results.length;
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = total - passed;
  const successRate = total ? (passed / total) * 100 : 0;
  return { total, passed, failed, successRate: Math.round(successRate * 100) / 100 };
}

async function writeReports() {
  const finishedAt = new Date();
  const finalStats = summarize();
  const groups = ["default", "boundary", "error"].map((group) => {
    const items = results.filter((result) => result.group === group);
    return {
      group,
      total: items.length,
      passed: items.filter((result) => result.status === "passed").length,
      failed: items.filter((result) => result.status === "failed").length,
    };
  });
  const report = {
    app: "焦点画布 Focus Canvas",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    finalStats,
    groups,
    results,
  };
  await writeFile(join(ARTIFACTS, "test-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const groupLabels = { default: "默认", boundary: "边界", error: "错误" };
  const markdown = [
    "# 焦点画布 · 可重复验收报告",
    "",
    `- 运行时间：${finishedAt.toLocaleString("zh-CN", { hour12: false })}`,
    `- 最终统计：**${finalStats.total} 项，通过 ${finalStats.passed}，失败 ${finalStats.failed}，成功率 ${finalStats.successRate.toFixed(2)}%**`,
    `- 三组覆盖：默认 ${groups[0].passed}/${groups[0].total} · 边界 ${groups[1].passed}/${groups[1].total} · 错误 ${groups[2].passed}/${groups[2].total}`,
    "",
    "## 测试结果",
    "",
    "| 组 | ID | 验证项 | 结果 | 耗时 |",
    "| --- | --- | --- | --- | --- |",
    ...results.map((result) => `| ${groupLabels[result.group]} | ${result.id} | ${result.name} | ${result.status === "passed" ? "通过" : "失败"} | ${result.duration} ms |`),
    "",
    "## 失败原因",
    "",
    ...(finalStats.failed
      ? results.filter((result) => result.status === "failed").flatMap((result) => [
        `### ${result.id} · ${result.name}`,
        "",
        "```text",
        result.reason,
        "```",
        "",
      ])
      : ["无失败。所有验证项均提供了可复现的通过结果。", ""]),
    "## 复现",
    "",
    "```bash",
    "npm install",
    "npx playwright install chromium",
    "npm test",
    "```",
    "",
  ].join("\n");
  await writeFile(join(ARTIFACTS, "test-report.md"), markdown);

  const rows = results.map((result) => `
      <tr>
        <td>${escapeHtml(groupLabels[result.group])}</td>
        <td>${escapeHtml(result.id)}</td>
        <td>${escapeHtml(result.name)}</td>
        <td><span class="status ${result.status}">${result.status === "passed" ? "通过" : "失败"}</span></td>
        <td>${result.duration} ms</td>
      </tr>`).join("");
  const failures = finalStats.failed
    ? results.filter((result) => result.status === "failed").map((result) => `
      <section>
        <h2>${escapeHtml(result.id)} · ${escapeHtml(result.name)}</h2>
        <pre>${escapeHtml(result.reason)}</pre>
      </section>`).join("")
    : "<p class=\"ok\">无失败。所有验证项均有明确通过结果。</p>";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>焦点画布测试报告</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", "Noto Sans SC", sans-serif; }
    body { max-width: 1040px; margin: 0 auto; padding: 32px 20px; color: #20242c; background: #f5f1e8; }
    h1, h2 { font-family: Georgia, serif; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 18px; background: #fffdf8; border: 1px solid #d6d0c3; border-radius: 12px; }
    .summary strong { display: block; font-size: 26px; }
    table { width: 100%; margin-top: 20px; border-collapse: collapse; background: #fffdf8; }
    th, td { padding: 10px; border: 1px solid #d6d0c3; text-align: left; font-size: 13px; }
    th { background: #ece7dc; }
    .status { font-weight: 700; }
    .passed, .ok { color: #0d7068; }
    .failed { color: #ae352d; }
    pre { padding: 12px; overflow: auto; white-space: pre-wrap; background: #fae4df; border-radius: 8px; }
    a { color: #07544e; }
  </style>
</head>
<body>
  <h1>焦点画布 · 可重复验收报告</h1>
  <p>运行时间：${escapeHtml(finishedAt.toLocaleString("zh-CN", { hour12: false }))} · <a href="a11y-summary.html">查看无障碍检查摘要</a></p>
  <div class="summary">
    <div><span>验证项</span><strong>${finalStats.total}</strong></div>
    <div><span>通过 / 失败</span><strong>${finalStats.passed} / ${finalStats.failed}</strong></div>
    <div><span>成功率</span><strong>${finalStats.successRate.toFixed(2)}%</strong></div>
  </div>
  <table>
    <caption>默认、边界和错误三组验证结果</caption>
    <thead><tr><th>组</th><th>ID</th><th>验证项</th><th>结果</th><th>耗时</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>失败原因</h2>
  ${failures}
</body>
</html>
`;
  await writeFile(join(ARTIFACTS, "test-report.html"), html);
  return finalStats;
}

async function captureScreenshots() {
  const views = [
    { name: "desktop", viewport: { width: 1440, height: 1000 } },
    { name: "mobile", viewport: { width: 390, height: 844 } },
  ];
  for (const view of views) {
    const context = await browser.newContext({
      viewport: view.viewport,
      hasTouch: true,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(SCREENSHOTS, `final-${view.name}.png`), fullPage: true });
    await context.close();
  }
}

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(SCREENSHOTS, { recursive: true });
  await rm(DOWNLOADS, { recursive: true, force: true });
  await mkdir(DOWNLOADS, { recursive: true });
  serverHandle = await startServer();
  baseUrl = serverHandle.baseUrl;
  console.log(`Focus Canvas test server: ${baseUrl}`);
  browser = await chromium.launch({ headless: true });
  try {
    await defaultGroup();
    await boundaryGroup();
    await errorGroup();
    await captureScreenshots();
  } finally {
    if (browser) await browser.close();
    if (serverHandle) await serverHandle.close();
  }
  const finalStats = await writeReports();
  console.log("\n=== 最终统计 ===");
  console.log(`总计 ${finalStats.total} · 通过 ${finalStats.passed} · 失败 ${finalStats.failed} · 成功率 ${finalStats.successRate.toFixed(2)}%`);
  for (const group of ["default", "boundary", "error"]) {
    const items = results.filter((result) => result.group === group);
    console.log(`${group}: ${items.filter((result) => result.status === "passed").length}/${items.length}`);
  }
  if (finalStats.failed) {
    console.log("失败原因：");
    results.filter((result) => result.status === "failed").forEach((result) => {
      console.log(`- ${result.id} ${result.name}: ${result.reason.split("\n")[0]}`);
    });
  }
  console.log(`报告：${join(ARTIFACTS, "test-report.html")}`);
  process.exitCode = finalStats.failed ? 1 : 0;
}

await main().catch(async (error) => {
  console.error("测试运行器失败：", error);
  if (browser) await browser.close();
  if (serverHandle) await serverHandle.close();
  process.exitCode = 1;
});

// __TEST_APPEND__
