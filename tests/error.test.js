import test from "node:test";
import assert from "node:assert/strict";
import { createStudio, teardown, wait } from "./helpers.js";
import { updateAudio } from "../src/model.js";

function fakeAudioContext() {
  const parameter = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {}
  });
  return {
    currentTime: 0,
    state: "running",
    destination: {},
    async resume() {},
    async close() {},
    createOscillator() {
      return {
        type: "sine",
        frequency: parameter(),
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        onended: null
      };
    },
    createGain() {
      return { gain: parameter(), connect() {}, disconnect() {} };
    }
  };
}

function flakyAudioContext() {
  let created = 0;
  const parameter = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {}
  });
  return {
    currentTime: 0,
    state: "running",
    destination: {},
    async resume() {},
    async close() {},
    createOscillator() {
      created += 1;
      if (created === 2) throw new Error("音频设备在播放中断开");
      return {
        type: "sine",
        frequency: parameter(),
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        onended: null
      };
    },
    createGain() {
      return { gain: parameter(), connect() {}, disconnect() {} };
    }
  };
}

test("错误组：图像失败保留图形文字选择，Canvas 显示恢复", async (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app, document } = studio;
  const before = {
    layers: JSON.stringify(app.state.layers),
    selection: app.state.selection,
    text: app.state.layers.find((layer) => layer.type === "text").text
  };

  app.faults.arm("image");
  const failed = await app.applyImageAction();
  assert.equal(failed.ok, false);
  assert.equal(app.boundaries.image.state.error.moduleLabel, "图像处理");
  assert.match(app.boundaries.image.state.error.advice, /图层、文字与当前选择均已保留/);
  assert.equal(app.el.imageError.hidden, false);
  assert.equal(app.el.imageHealth.textContent, "故障");
  assert.equal(app.el.imageHealth.dataset.state, "error");
  assert.equal(JSON.stringify(app.state.layers), before.layers);
  assert.equal(app.state.selection, before.selection);
  assert.equal(app.state.layers.find((layer) => layer.type === "text").text, before.text);

  await wait(20);
  assert.equal(app.el.imageError.contains(document.activeElement), true);
  assert.match(document.activeElement.id, /imageErrorTitle/);

  const recovered = await app.applyImageAction({ retry: true });
  assert.equal(recovered.ok, true);
  assert.equal(app.boundaries.image.state.recovered, true);
  assert.match(app.el.canvasStatus.textContent, /已恢复/);
  assert.equal(app.el.renderState.textContent, "已恢复");
  assert.equal(app.el.imageError.hidden, true);
  assert.equal(app.state.layers.length, 3);
});

test("错误组：音频失败停止节点，重试创建新节点且可全部释放", async (t) => {
  const studio = createStudio({ contextFactory: fakeAudioContext });
  t.after(() => teardown(studio));
  const { app } = studio;
  app.faults.arm("audio");
  const failed = await app.playAudioAction();
  assert.equal(failed.ok, false);
  assert.equal(app.audio.nodeCount, 0);
  assert.equal(app.el.audioError.hidden, false);
  assert.match(app.el.audioError.textContent, /音频合成失败/);
  assert.match(app.el.audioResources.textContent, /活动节点 0 · 资源已释放/);
  assert.equal(app.el.stopAudio.disabled, true);

  const retried = await app.playAudioAction({ retry: true });
  assert.equal(retried.ok, true);
  assert.ok(app.audio.nodeCount >= 1);
  assert.equal(app.boundaries.audio.state.recovered, true);
  assert.equal(app.el.audioError.hidden, true);
  app.audio.stopAll("test-end");
  assert.equal(app.audio.nodeCount, 0);
  assert.match(app.el.audioResources.textContent, /活动节点 0/);
});

test("错误组：播放中异步节点失败也会进入边界并停止节点", async (t) => {
  const studio = createStudio({ contextFactory: flakyAudioContext });
  t.after(() => teardown(studio));
  const { app } = studio;
  app.state = updateAudio(app.state, { bpm: 600, pattern: [true, true, true, true, true, true, true, true] });
  app.renderAll();
  const started = await app.playAudioAction();
  assert.equal(started.ok, true);
  await wait(180);
  assert.equal(app.boundaries.audio.isFailed, true);
  assert.equal(app.boundaries.audio.state.error.moduleLabel, "音频合成");
  assert.equal(app.audio.nodeCount, 0);
  assert.equal(app.el.audioError.hidden, false);
  assert.equal(app.metrics.total.failure, 1);
  assert.match(app.el.failureReason.textContent, /音频设备在播放中断开/);

  const retried = await app.playAudioAction({ retry: true });
  assert.equal(retried.ok, true);
  assert.equal(app.boundaries.audio.state.recovered, true);
  app.audio.stopAll("test-end");
  assert.equal(app.audio.nodeCount, 0);
});

test("错误组：导出失败保留状态与快照，重试后统计明确", async (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app } = studio;
  const before = {
    layers: JSON.stringify(app.state.layers),
    selection: app.state.selection,
    revision: app.state.revision
  };

  app.faults.arm("export");
  const failed = await app.exportAction("json", { deliver: false });
  assert.equal(failed.ok, false);
  assert.equal(app.boundaries.export.state.error.moduleLabel, "导出");
  assert.equal(JSON.stringify(app.state.layers), before.layers);
  assert.equal(app.state.selection, before.selection);
  assert.equal(app.state.revision, before.revision);
  assert.equal(app.preExportSnapshot.selection, before.selection);
  assert.equal(app.preExportMeta.revision, before.revision);
  assert.ok(app.state.exports.some((item) => item.status === "failure" && item.reason));

  const other = app.state.layers.find((layer) => layer.id !== app.state.selection);
  app.selectLayerById(other.id, "测试");
  app.restorePreExportState();
  assert.equal(app.state.selection, before.selection);
  assert.equal(JSON.stringify(app.state.layers), before.layers);

  const retried = await app.exportAction("json", { deliver: false, retry: true });
  assert.equal(retried.ok, true);
  assert.equal(app.boundaries.export.state.recovered, true);
  assert.ok(app.state.exports.some((item) => item.status === "success"));
  assert.equal(app.metrics.total.failure, 1);
  assert.equal(app.metrics.total.success, 1);
  assert.equal(app.el.successRate.textContent, "50%");
  assert.match(app.el.successDetail.textContent, /成功 1 · 失败 1/);
  assert.match(app.el.failureReason.textContent, /导出/);
  assert.match(app.el.failureReason.textContent, /模拟的一次性导出故障/);
});

test("错误组：图像故障不阻断导出，其他编辑不回滚", async (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app } = studio;
  const originalLayers = JSON.stringify(app.state.layers);
  app.faults.arm("image");
  const image = await app.applyImageAction();
  assert.equal(image.ok, false);
  const exported = await app.exportAction("json", { deliver: false });
  assert.equal(exported.ok, true);
  assert.equal(JSON.stringify(app.state.layers), originalLayers);
  assert.equal(app.boundaries.image.isFailed, true);
  assert.equal(app.boundaries.export.isFailed, false);
  assert.ok(app.state.exports.some((item) => item.status === "success"));
});

test("错误组：失败原因和恢复提示进入读屏区域", async (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app } = studio;
  app.faults.arm("image");
  await app.applyImageAction();
  await wait(30);
  assert.match(app.el.announcer.textContent, /图像处理失败/);
  assert.match(app.el.announcer.textContent, /已保留/);
  assert.equal(app.el.imageError.querySelector("[data-retry='image']").getAttribute("aria-describedby"), "imageErrorTitle");
  const recovered = await app.applyImageAction({ retry: true });
  assert.equal(recovered.ok, true);
  await wait(30);
  assert.match(app.el.announcer.textContent, /图像模块已恢复/);
  assert.match(app.el.announcer.textContent, /选择均保留/);
});
