// 页面控制器：生成器面板、Canvas 交互、增量编辑、持久化与自检。

import { WORLD, DEFAULT_PARAMS, rulesSummary } from "./config.js";
import { generateLayout, snapshotChunkHashes } from "./layout.js";
import { moveBuoy, addObstacle, removeObstacle, updateParams } from "./edits.js";
import { serializeState, deserializeState } from "./persistence.js";
import { ChartRenderer } from "./chart-renderer.js";
import { SeaAudio } from "./sea-audio.js";
import { runSelfTests } from "./self-test.js";
import { chunkAt } from "./terrain.js";

const SEED_PRESETS = ["harbor-2026", "lighthouse-777", "atoll-042"];
const STORAGE_KEY = "archipelago-layout-v1";

const state = {
  layout: null,
  mode: "buoy",
  selectedBuoy: null,
  highlight: [],
  lastChanged: [],
};

const els = {};
let renderer;
let audio;

function cacheElements() {
  for (const id of [
    "chart", "seedInput", "regenerateBtn", "seedPreset",
    "islandSlots", "shallowSlots", "buoyCount", "applyParamsBtn",
    "modeBuoy", "modeObstacle", "removeObstacleBtn",
    "saveBtn", "loadBtn", "exportBtn", "importBtn", "importText",
    "runTestsBtn", "message", "audioStatus",
  ]) {
    els[id] = document.getElementById(id);
  }
}

function init() {
  cacheElements();
  renderer = new ChartRenderer(els.chart);
  renderer.resize();
  audio = new SeaAudio();
  bindControls();
  bindCanvas();
  regenerate(SEED_PRESETS[0]);
  requestAnimationFrame(loop);
}

function regenerate(seed) {
  const params = readParams();
  state.layout = generateLayout(seed, params);
  state.selectedBuoy = null;
  state.highlight = [];
  state.lastChanged = [];
  els.seedInput.value = seed;
  syncParamInputs(state.layout.params);
  render();
  flash(`已按 seed「${seed}」显式重新生成`);
}

function readParams() {
  return {
    islandSlots: intOf(els.islandSlots, DEFAULT_PARAMS.islandSlots),
    shallowSlots: intOf(els.shallowSlots, DEFAULT_PARAMS.shallowSlots),
    buoyCount: intOf(els.buoyCount, DEFAULT_PARAMS.buoyCount),
  };
}

function intOf(input, fallback) {
  const v = parseInt(input.value, 10);
  return Number.isFinite(v) ? v : fallback;
}

function syncParamInputs(params) {
  els.islandSlots.value = params.islandSlots;
  els.shallowSlots.value = params.shallowSlots;
  els.buoyCount.value = params.buoyCount;
}

function bindControls() {
  els.regenerateBtn.addEventListener("click", () => {
    audio.resume();
    regenerate(els.seedInput.value.trim() || SEED_PRESETS[0]);
    audio.click(true);
  });
  els.seedPreset.addEventListener("change", () => {
    if (els.seedPreset.value) regenerate(els.seedPreset.value);
  });
  els.applyParamsBtn.addEventListener("click", applyParams);
  els.modeBuoy.addEventListener("click", () => setMode("buoy"));
  els.modeObstacle.addEventListener("click", () => setMode("obstacle"));
  els.removeObstacleBtn.addEventListener("click", removeLastObstacle);
  els.saveBtn.addEventListener("click", saveLayout);
  els.loadBtn.addEventListener("click", loadLayout);
  els.exportBtn.addEventListener("click", exportLayout);
  els.importBtn.addEventListener("click", importLayout);
  els.runTestsBtn.addEventListener("click", runTests);
}

function setMode(mode) {
  state.mode = mode;
  state.selectedBuoy = null;
  els.modeBuoy.classList.toggle("active", mode === "buoy");
  els.modeObstacle.classList.toggle("active", mode === "obstacle");
  flash(mode === "buoy" ? "浮标模式：点选浮标后点水面移动" : "障碍模式：点击水面投放方形障碍");
}

function applyParams() {
  const before = snapshotChunkHashes(state.layout);
  const res = updateParams(state.layout, readParams());
  if (!res.ok) {
    flash(res.error, true);
    audio.click(false);
    return;
  }
  state.lastChanged = res.changedChunks || [];
  state.highlight = state.lastChanged;
  render();
  const scope = res.fullTerrain ? "全地形重算" : res.buoysOnly ? "仅浮标重排" : "局部重算";
  flash(`${scope}，受影响区块 ${state.lastChanged.length} 个：${state.lastChanged.join(", ") || "无"}`);
  audio.click(true);
}

function bindCanvas() {
  els.chart.addEventListener("click", onCanvasClick);
}

function canvasPoint(event) {
  const rect = els.chart.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * WORLD.width,
    y: ((event.clientY - rect.top) / rect.height) * WORLD.height,
  };
}

function onCanvasClick(event) {
  audio.resume();
  const point = canvasPoint(event);
  const hit = renderer.hitTest(state.layout, point.x, point.y);
  if (state.mode === "buoy") {
    if (hit.type === "buoy" && !state.selectedBuoy) {
      state.selectedBuoy = hit.object.id;
      flash(`已选中 ${hit.object.id}，再点水面目标位置移动`);
      audio.click(true);
      return;
    }
    if (state.selectedBuoy) {
      const before = snapshotChunkHashes(state.layout);
      const res = moveBuoy(state.layout, state.selectedBuoy, point.x, point.y);
      finishEdit(res, before, "浮标移动");
      state.selectedBuoy = null;
    }
  } else {
    const before = snapshotChunkHashes(state.layout);
    const res = addObstacle(state.layout, point.x, point.y);
    finishEdit(res, before, "投放障碍");
  }
}

function finishEdit(res, before, label) {
  if (!res.ok) {
    flash(`${label}被拒绝：${res.error}`, true);
    audio.click(false);
    audio.setState("warning");
    updateAudioStatus();
    return;
  }
  state.lastChanged = res.changedChunks || [];
  state.highlight = state.lastChanged;
  render();
  if (state.layout.blockage) {
    const p = state.layout.blockage.blockPoint;
    flash(`航线已断开！阻断位置 (${Math.round(p.x)}, ${Math.round(p.y)})，请移动浮标或移除障碍`, true);
    audio.setState("blocked");
  } else {
    flash(`${label}完成，受影响区块：${state.lastChanged.join(", ") || "无"}`);
    audio.setState("calm");
    audio.click(true);
  }
  updateAudioStatus();
}

function removeLastObstacle() {
  const last = state.layout.obstacles[state.layout.obstacles.length - 1];
  if (!last) {
    flash("当前没有可移除的障碍");
    return;
  }
  const before = snapshotChunkHashes(state.layout);
  const res = removeObstacle(state.layout, last.id);
  finishEdit(res, before, "移除障碍");
}

function saveLayout() {
  const text = serializeState(state.layout);
  localStorage.setItem(STORAGE_KEY, text);
  flash(`已保存，布局哈希 ${state.layout.layoutHash}`);
  audio.click(true);
}

function loadLayout() {
  const text = localStorage.getItem(STORAGE_KEY);
  if (!text) {
    flash("没有已保存的场景", true);
    return;
  }
  const result = deserializeState(text);
  state.layout = result.layout;
  state.highlight = [];
  render();
  flash(result.hashMatched
    ? `载入成功，布局哈希一致：${result.recomputedHash}`
    : `哈希不一致！保存 ${result.savedHash} / 重算 ${result.recomputedHash}`, !result.hashMatched);
  audio.click(result.hashMatched);
}

function exportLayout() {
  els.importText.value = serializeState(state.layout);
  flash("场景 JSON 已输出到文本框");
}

function importLayout() {
  try {
    const result = deserializeState(els.importText.value);
    state.layout = result.layout;
    state.highlight = [];
    render();
    flash(result.hashMatched ? "导入成功，哈希校验通过" : "导入成功但哈希不一致，已标记", !result.hashMatched);
  } catch (err) {
    flash(`导入失败：${err.message}`, true);
  }
}

function runTests() {
  const results = runSelfTests();
  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "✅" : "❌"} ${r.name}${r.ok ? "" : ` → ${r.error}`}`);
  flash(`自检 ${results.length - failed.length}/${results.length} 通过（详见控制台与文本框）`, failed.length > 0);
  els.importText.value = lines.join("\n");
  for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.error || "");
  audio.click(failed.length === 0);
}

function updateAudioStatus() {
  els.audioStatus.textContent = audio.statusText();
}

function flash(text, danger = false) {
  els.message.textContent = text;
  els.message.classList.toggle("danger", danger);
}

function render() {
  renderer.draw(state.layout, state.highlight);
  renderSummary();
  updateAudioStatus();
}

function renderSummary() {
  const layout = state.layout;
  const targetCount = 2 + layout.buoys.length;
  const summary = [
    `Seed：${layout.seed}`,
    `目标数量：${targetCount}（码头 1 · 灯塔 1 · 浮标 ${layout.buoys.length}）`,
    `布局哈希：${layout.layoutHash}`,
    `航线状态：${layout.reachable ? (layout.waypointOk ? "全程连通" : "可达但航点链异常") : "断开"}`,
    "",
    rulesSummary(layout.params),
    "",
    "区块哈希：",
    ...Object.entries(layout.chunkHashes).map(([k, h]) => `  ${k} = ${h}`),
  ].join("\n");
  const panel = document.getElementById("summary");
  panel.textContent = summary;
}

function loop() {
  renderer.dashOffset = (renderer.dashOffset + 0.6) % 36;
  if (state.layout) renderer.draw(state.layout, state.highlight);
  requestAnimationFrame(loop);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
