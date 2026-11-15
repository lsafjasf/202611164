import test from "node:test";
import assert from "node:assert/strict";
import { createStudio, dispatchPointer, layerPoint, teardown, wait } from "./helpers.js";

test("默认组：载入工程、选择与无障碍标签一致", (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app, document } = studio;

  assert.equal(app.state.layers.length, 3);
  assert.equal(app.state.selection, "layer-title");
  assert.equal(app.el.layerList.querySelectorAll("[data-select-layer]").length, 3);
  assert.equal(app.el.projectNameInput.value, "海岸线的回声");
  assert.equal(document.getElementById("studioCanvas").tabIndex, 0);
  assert.match(document.getElementById("studioCanvas").getAttribute("aria-describedby"), /canvasHelp/);
  assert.equal(app.el.imageError.getAttribute("role"), "alert");
  assert.equal(app.el.announcer.getAttribute("aria-live"), "polite");
  assert.equal(app.el.successDetail.textContent, "还没有模块操作");
  assert.equal(app.el.successRate.textContent, "—");
});

test("默认组：键盘方向键移动图层且保留焦点与选择", async (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app, window } = studio;
  const layer = app.state.layers.find((item) => item.type === "rect");
  app.selectLayerById(layer.id, "测试");
  const before = layer.x;
  app.el.studioCanvas.focus();

  const event = new window.KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    cancelable: true
  });
  app.el.studioCanvas.dispatchEvent(event);

  assert.equal(app.state.layers.find((item) => item.id === layer.id).x, before + 8);
  assert.equal(app.state.selection, layer.id);
  assert.equal(studio.document.activeElement, app.el.studioCanvas);
  await wait(30);
  assert.match(app.el.announcer.textContent, /x 120|已移动/);
});

test("默认组：鼠标与触屏选择到达同一功能状态", (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app } = studio;
  const layer = app.state.layers.find((item) => item.type === "circle");
  const point = layerPoint(layer);

  app.selectLayerById(null, "测试");
  dispatchPointer(studio, "pointerdown", point, "mouse", 1);
  dispatchPointer(studio, "pointerup", point, "mouse", 1);
  const mouse = app.state.selection;

  app.selectLayerById(null, "测试");
  dispatchPointer(studio, "pointerdown", point, "touch", 2);
  dispatchPointer(studio, "pointerup", point, "touch", 2);
  const touch = app.state.selection;

  assert.equal(mouse, layer.id);
  assert.equal(touch, layer.id);
  assert.equal(mouse, touch);
  assert.equal(app.el.layerList.querySelector(`[data-layer-id="${layer.id}"]`).classList.contains("is-selected"), true);
});

test("默认组：导出后刷新恢复工程名、选择和导出记录", async (t) => {
  const first = createStudio();
  const { app, window, storage } = first;
  const nameInput = app.el.projectNameInput;
  nameInput.value = "刷新后的海面";
  nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  const textLayer = app.state.layers.find((item) => item.type === "text");
  app.selectLayerById(textLayer.id, "测试");
  app.el.layerTextInput.value = "文字也一起恢复。";
  app.el.layerTextInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  app.choosePalette("citrus");
  app.el.stepGrid.querySelector('[data-step="1"]').click();
  const target = app.state.layers.find((item) => item.type === "circle");
  app.selectLayerById(target.id, "测试");
  const exported = await app.exportAction("json", { deliver: false });
  assert.equal(exported.ok, true);
  app.persistState();
  teardown(first);

  const second = createStudio({ storage });
  t.after(() => teardown(second));
  assert.equal(second.app.state.projectName, "刷新后的海面");
  assert.equal(second.app.state.selection, target.id);
  assert.equal(second.app.state.background.palette, "citrus");
  assert.equal(second.app.state.audio.pattern[1], true);
  assert.equal(second.app.state.layers.find((item) => item.id === textLayer.id).text, "文字也一起恢复。");
  assert.equal(second.app.state.exports.length, 1);
  assert.equal(second.app.state.exports[0].status, "success");
  assert.equal(second.app.el.projectNameInput.value, "刷新后的海面");
  assert.match(second.app.el.saveStatus.textContent, /已恢复本地工程/);
  assert.match(second.app.el.exportHistory.textContent, /JSON/);
});

test("默认组：图像与导出成功写入精确统计", async (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app } = studio;
  const image = await app.applyImageAction();
  const exported = await app.exportAction("json", { deliver: false });
  const snapshot = await app.exportAction("png", { deliver: false });
  assert.equal(image.ok, true);
  assert.equal(exported.ok, true);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.value.record.format, "png");
  assert.equal(app.metrics.total.success, 3);
  assert.equal(app.metrics.total.failure, 0);
  assert.equal(app.el.successRate.textContent, "100%");
  assert.match(app.el.successDetail.textContent, /共 3 次模块操作/);
  assert.equal(app.el.metricImage.textContent, "1 / 1");
  assert.equal(app.el.metricExport.textContent, "2 / 2");
});

test("默认组：内置验收 13 项全部通过", async (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const summary = await studio.app.runAllSuites();
  assert.equal(summary.total, 13);
  assert.equal(summary.passed, 13);
  assert.equal(summary.failed, 0);
  assert.equal(studio.app.el.testSummary.textContent, "全部通过 13/13");
  assert.equal(studio.app.state.layers.length, 3);
});
