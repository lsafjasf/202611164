import test from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  addLayer,
  cloneState,
  createDefaultState,
  loadState,
  removeLayer,
  saveState,
  updateLayer,
  updateProjectName
} from "../src/model.js";
import { ModuleBoundary, ResourceRegistry } from "../src/error-boundary.js";
import { AudioEngine } from "../src/audio-engine.js";
import { ExportController } from "../src/export.js";
import { createStudio, memoryStorage, teardown } from "./helpers.js";

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

const AUDIO_CONFIG = {
  waveform: "sine",
  volume: 30,
  bpm: 120,
  pattern: [true, false, true, false, true, false, true, false],
  notes: [0, 3, 7, 10, 7, 3, 5, 12]
};

test("边界组：文字、工程名和图层数量到达上限仍可解释", () => {
  let state = createDefaultState("2026-01-01T00:00:00.000Z");
  const text = state.layers.find((layer) => layer.type === "text");
  state = updateLayer(state, text.id, { text: "字".repeat(200) });
  assert.equal(state.layers.find((layer) => layer.id === text.id).text.length, LIMITS.text);

  state = updateProjectName(state, "工".repeat(120));
  assert.equal(state.projectName.length, LIMITS.projectName);

  while (state.layers.length < LIMITS.layers) state = addLayer(state, "rect").state;
  assert.throws(
    () => addLayer(state, "circle"),
    (error) => error.code === "LAYER_LIMIT" && /删除/.test(error.message)
  );
  assert.equal(state.layers.length, LIMITS.layers);
});

test("边界组：零图层、删除选择与追加图层保持一致", () => {
  let state = createDefaultState("2026-01-01T00:00:00.000Z");
  for (const layer of [...state.layers]) state = removeLayer(state, layer.id);
  assert.equal(state.layers.length, 0);
  assert.equal(state.selection, null);
  const added = addLayer(state, "text");
  assert.equal(added.state.layers.length, 1);
  assert.equal(added.state.selection, added.layer.id);
  assert.equal(added.layer.type, "text");
});

test("边界组：重试前清理资源且资源峰值保持为一", async () => {
  const registry = new ResourceRegistry("boundary");
  const boundary = new ModuleBoundary({
    id: "export",
    label: "导出",
    cleanup: () => registry.cleanupAll()
  });
  const failed = await boundary.run(async () => {
    registry.add("download", () => {});
    throw new Error("下载通道拒绝连接");
  });
  assert.equal(failed.ok, false);
  assert.equal(registry.size, 0);
  assert.equal(boundary.state.error.moduleLabel, "导出");
  assert.match(boundary.state.error.advice, /允许浏览器下载|另一种格式/);

  const retried = await boundary.run(async () => {
    assert.equal(registry.size, 0);
    registry.add("download", () => {});
    return "ok";
  }, { retry: true });
  assert.equal(retried.ok, true);
  assert.equal(registry.size, 1);
  assert.equal(boundary.state.attempts, 2);
  assert.equal(boundary.state.retries, 1);
  assert.equal(boundary.state.recovered, true);
  registry.cleanupAll();
});

test("边界组：音频故障后节点归零，重试不重复旧节点", async () => {
  const engine = new AudioEngine({ contextFactory: fakeAudioContext });
  const boundary = new ModuleBoundary({
    id: "audio",
    label: "音频合成",
    cleanup: () => engine.stopAll("test-cleanup")
  });
  const failed = await boundary.run(async () => {
    await engine.start(AUDIO_CONFIG, { failAfterCreate: true });
  });
  assert.equal(failed.ok, false);
  assert.equal(engine.nodeCount, 0);

  const retried = await boundary.run(async () => {
    assert.equal(engine.nodeCount, 0);
    await engine.start(AUDIO_CONFIG);
    return engine.snapshot();
  }, { retry: true });
  assert.equal(retried.ok, true);
  const peak = engine.nodeCount;
  assert.ok(peak >= 1 && peak <= 2);
  engine.stopAll("test-end");
  assert.equal(engine.nodeCount, 0);
});

test("边界组：导出失败或限制时工程内容不变", async (t) => {
  const studio = createStudio();
  t.after(() => teardown(studio));
  const { app } = studio;
  const boundary = new ModuleBoundary({
    id: "export",
    label: "导出",
    cleanup: () => app.exportController.dispose()
  });
  const before = JSON.stringify(app.state);
  const failed = await boundary.run(async () => {
    app.exportController.capture(app.state);
    throw Object.assign(new Error("磁盘空间不足"), {
      context: { snapshot: cloneState(app.state), revision: app.state.revision }
    });
  });
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(app.state), before);
  assert.match(failed.error.advice, /导出前状态已保留/);
  assert.equal(failed.error.details.revision, app.state.revision);
});

test("边界组：12 图层快照与导出历史上限可重复载入", () => {
  const storage = memoryStorage();
  let state = createDefaultState("2026-01-01T00:00:00.000Z");
  while (state.layers.length < LIMITS.layers) state = addLayer(state, "rect").state;
  state.exports = Array.from({ length: 12 }, (_, index) => ({
    id: `export-${index}`,
    format: "json",
    projectName: "边界工程",
    revision: index + 1,
    status: "success",
    at: "2026-01-01T00:00:00.000Z",
    bytes: 100 + index,
    reason: ""
  }));
  assert.equal(saveState(storage, state).ok, true);
  const loaded = loadState(storage);
  assert.equal(loaded.source, "restored");
  assert.equal(loaded.state.layers.length, LIMITS.layers);
  assert.equal(loaded.state.exports.length, LIMITS.exportHistory);
});

test("边界组：PNG 导出失败保留导出前快照", async () => {
  const controller = new ExportController({
    delivery: async () => {},
    now: () => "2026-01-01T00:00:00.000Z"
  });
  const state = createDefaultState("2026-01-01T00:00:00.000Z");
  const before = cloneState(state);
  await assert.rejects(
    () => controller.exportPng(state, { fail: true }),
    (error) => error.name === "ExportFailure" && /PNG/.test(error.message)
  );
  assert.deepEqual(state, before);
  assert.equal(controller.lastSnapshot.selection, before.selection);
  assert.equal(controller.lastSnapshot.revision, before.revision);
});
