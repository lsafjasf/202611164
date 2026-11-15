import { BenchmarkRunner, structuralDigest } from "./benchmark.js";
import { RollingMetrics } from "./metrics.js";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  clampLayerPosition,
  createInitialProject,
  getLayer,
  getSelectableLayers,
  hitTest,
} from "./model.js";
import { SceneRenderer } from "./renderer.js";
import {
  createExportFile,
  exportSession,
  loadPersistedState,
  persistSession,
  restoreExport,
  stateSnapshot,
} from "./storage.js";
import { runVerification } from "./verification.js";

const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const formatMs = (value) => (value < 10 ? value.toFixed(2) : value.toFixed(1));
const formatPercent = (value) => `${(value * 100).toFixed(1)}%`;

const elements = {
  canvas: $("#scene"),
  canvasFrame: $("#canvas-frame"),
  viewport: $("#canvas-viewport"),
  layerList: $("#layer-list"),
  layerFilter: $("#layer-filter"),
  layerCount: $("#layer-count"),
  selectedName: $("#selected-name"),
  selectedCrumb: $("#selected-crumb"),
  selectedType: $("#selected-type"),
  selectionSwatch: $("#selection-swatch"),
  position: $("#position-readout"),
  textContent: $("#text-content"),
  fieldX: $("#field-x"),
  fieldY: $("#field-y"),
  layerRevision: $("#layer-revision"),
  zoomValue: $("#zoom-value"),
  fpsBadge: $("#fps-badge"),
  saveState: $("#save-state"),
  toast: $("#toast"),
  selectionAnnouncer: $("#selection-announcer"),
  errorAnnouncer: $("#error-announcer"),
  benchmarkBody: $("#benchmark-body"),
  benchmarkSummary: $("#benchmark-summary"),
  parityChip: $("#parity-chip"),
  parityDot: $("#parity-dot"),
  parityResult: $("#parity-result"),
  restoreCopy: $("#restore-copy"),
  reloadExport: $("#reload-export"),
};

const persisted = loadPersistedState(window.localStorage);
let session = persisted.session;
let exportRecord = persisted.exportRecord;
let warnings = persisted.warnings;
const renderer = new SceneRenderer(elements.canvas);
const metrics = new RollingMetrics(90);
const benchmarkRunner = new BenchmarkRunner(renderer, session.project);
let lastMetricUpdate = 0;
let lastFrameAt = performance.now();
let frameLoop = 0;
let saveTimer = 0;
let benchmarkRunning = false;
let verificationRunning = false;
let livePaused = false;
let dragState = null;
let panState = null;
let filteredLayers = [];
let history = [];
let historyIndex = -1;
let previousFrameAverage = 0;
let a11ySummary = null;

function currentSelection() {
  return getLayer(session.project, session.selectionId);
}

function announce(message) {
  elements.selectionAnnouncer.textContent = "";
  requestAnimationFrame(() => {
    elements.selectionAnnouncer.textContent = message;
  });
}

function showError(message, error = null) {
  const text = error ? `${message}：${error.message}` : message;
  elements.errorAnnouncer.textContent = text;
  showToast(text, true);
  elements.saveState.innerHTML = '<span class="save-dot" aria-hidden="true"></span>保存失败';
  elements.saveState.classList.add("is-saving");
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("is-visible"), 3400);
}

function markSaving() {
  elements.saveState.classList.add("is-saving");
  elements.saveState.innerHTML = '<span class="save-dot" aria-hidden="true"></span>保存中…';
}

function markSaved() {
  elements.saveState.classList.remove("is-saving");
  elements.saveState.innerHTML = '<span class="save-dot" aria-hidden="true"></span>本地已保存';
}

function scheduleSave(delay = 180) {
  markSaving();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      session = persistSession(window.localStorage, session);
      markSaved();
    } catch (error) {
      showError("本地保存失败", error);
    }
  }, delay);
}

function setSelection(id, { focusCanvas = false, persist = true } = {}) {
  const next = id && getLayer(session.project, id) ? id : null;
  session.selectionId = next;
  updateSelectionUi();
  renderLayers();
  if (persist) scheduleSave(80);
  if (focusCanvas) {
    elements.canvas.focus({ preventScroll: true });
  }
  if (next) {
    const layer = getLayer(session.project, next);
    announce(`已选择${layer.name}，类型${layer.kind}，位置 X ${Math.round(layer.x)}，Y ${Math.round(layer.y)}`);
  } else {
    announce("已取消选择。按 Tab 浏览图层列表。");
  }
}

function updateSelectionUi() {
  const layer = currentSelection();
  if (!layer) {
    elements.selectedName.textContent = "未选择";
    elements.selectedCrumb.textContent = "画布";
    elements.selectedType.textContent = "NONE";
    elements.position.textContent = "X — · Y —";
    elements.textContent.value = "";
    elements.textContent.disabled = true;
    elements.fieldX.value = "";
    elements.fieldY.value = "";
    elements.layerRevision.textContent = "修订 —";
    elements.selectionSwatch.style.background = "#e7e3da";
    elements.canvas.setAttribute(
      "aria-label",
      "城市脉冲画布，当前未选择对象。使用 Tab 进入图层列表，或按 Enter 选择最上方对象。",
    );
    return;
  }
  elements.selectedName.textContent = layer.name;
  elements.selectedCrumb.textContent = layer.name;
  elements.selectedType.textContent = layer.kind;
  elements.position.textContent = `X ${Math.round(layer.x)} · Y ${Math.round(layer.y)}`;
  elements.textContent.disabled = layer.type !== "text";
  elements.textContent.value = layer.type === "text" ? layer.text : "此图层没有文字属性";
  elements.fieldX.value = Math.round(layer.x);
  elements.fieldY.value = Math.round(layer.y);
  elements.layerRevision.textContent = `修订 r${session.project.revision}`;
  elements.selectionSwatch.style.background =
    layer.fill && layer.fill !== "transparent" ? layer.fill : layer.stroke || "#e7e3da";
  elements.canvas.setAttribute(
    "aria-label",
    `城市脉冲画布。当前选择${layer.name}，${layer.kind}，X ${Math.round(layer.x)}，Y ${Math.round(layer.y)}。方向键移动，Shift 加速，Escape 取消选择。`,
  );
}

function renderLayers() {
  const filter = elements.layerFilter.value.trim().toLowerCase();
  filteredLayers = getSelectableLayers(session.project).filter((layer) =>
    `${layer.name} ${layer.kind}`.toLowerCase().includes(filter),
  );
  const fragment = document.createDocumentFragment();
  for (const layer of filteredLayers) {
    const item = document.createElement("li");
    item.className = "layer-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-button";
    button.dataset.layerId = layer.id;
    button.setAttribute("aria-pressed", String(layer.id === session.selectionId));
    button.setAttribute("aria-label", `${layer.name}，${layer.kind}`);
    const thumb = document.createElement("span");
    thumb.className = "layer-thumb";
    thumb.setAttribute("aria-hidden", "true");
    thumb.textContent = layer.type === "text" ? "T" : layer.type === "ellipse" ? "○" : "□";
    const copy = document.createElement("span");
    copy.className = "layer-copy";
    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name;
    const kind = document.createElement("span");
    kind.className = "layer-kind";
    kind.textContent = layer.kind;
    copy.append(name, kind);
    const visibility = document.createElement("span");
    visibility.className = "layer-visibility";
    visibility.setAttribute("aria-hidden", "true");
    visibility.textContent = "◉";
    button.append(thumb, copy, visibility);
    button.addEventListener("click", () => setSelection(layer.id));
    item.append(button);
    fragment.append(item);
  }
  if (!filteredLayers.length) {
    const item = document.createElement("li");
    item.className = "empty-row";
    item.textContent = "没有匹配的图层";
    fragment.append(item);
  }
  elements.layerList.replaceChildren(fragment);
  elements.layerCount.textContent = String(filteredLayers.length);
}

function updateOptionUi() {
  for (const [key, selector] of [
    ["shadows", "#toggle-shadows"],
    ["sorting", "#toggle-sorting"],
    ["culling", "#toggle-culling"],
  ]) {
    $(selector).setAttribute("aria-checked", String(session.options[key]));
  }
}

function updateExportUi() {
  if (session.exportRecord) {
    elements.restoreCopy.textContent = `已导出 r${session.exportRecord.revision} · 摘要 ${session.exportRecord.digest} · 选择 ${session.exportRecord.selectionId}`;
    elements.reloadExport.disabled = false;
  } else {
    elements.restoreCopy.textContent = "尚未导出。首次导出会保留当前选择与工程快照。";
    elements.reloadExport.disabled = true;
  }
}

function drawLiveFrame() {
  const sample = renderer.render({
    project: session.project,
    options: session.options,
    selectionId: session.selectionId,
    camera: session.camera,
  });
  metrics.record(sample);
  const now = performance.now();
  const elapsed = now - lastFrameAt;
  lastFrameAt = now;
  if (elapsed > 0) {
    const fps = Math.round(1000 / elapsed);
    elements.fpsBadge.textContent = `${clamp(fps, 1, 120)} FPS`;
  }
  if (now - lastMetricUpdate > 220) {
    updateMetricsUi();
    lastMetricUpdate = now;
  }
}

function frameLoopStep() {
  if (!livePaused && !benchmarkRunning && !verificationRunning) {
    try {
      drawLiveFrame();
    } catch (error) {
      showError("画布渲染失败", error);
    }
  }
  frameLoop = requestAnimationFrame(frameLoopStep);
}

function updateMetricsUi() {
  const snapshot = metrics.snapshot();
  $("#metric-frame").textContent = formatMs(snapshot.frameMs);
  $("#metric-objects").textContent = String(snapshot.drawnObjects);
  $("#metric-total").textContent = String(snapshot.totalObjects);
  $("#metric-cache").textContent = (snapshot.cacheHitRate * 100).toFixed(0);
  $("#metric-layout").textContent = formatMs(snapshot.layoutMs);
  $("#metric-calls").textContent = String(snapshot.drawCalls);
  $("#objects-foot").textContent = `${snapshot.totalObjects - snapshot.drawnObjects} 个对象被裁剪`;
  $("#cache-foot").textContent = `${snapshot.cacheHits}/${snapshot.cacheLookups || 0} 次命中`;
  $("#calls-foot").textContent = `${snapshot.frames} 帧窗口`;

  const difference = previousFrameAverage ? (snapshot.frameMs - previousFrameAverage) / previousFrameAverage : 0;
  const trend = $("#frame-trend");
  if (previousFrameAverage && Math.abs(difference) > 0.02) {
    trend.textContent = `${difference > 0 ? "+" : "−"}${Math.abs(difference * 100).toFixed(0)}%`;
    trend.classList.toggle("good", difference < 0);
    trend.classList.toggle("bad", difference > 0);
  }
  if (previousFrameAverage) previousFrameAverage = previousFrameAverage * 0.7 + snapshot.frameMs * 0.3;
  else previousFrameAverage = snapshot.frameMs;
  drawSparkline(snapshot.frameSeries);
}

function drawSparkline(values) {
  const series = values.slice(-38);
  if (series.length < 2) return;
  const width = 220;
  const height = 34;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(0.35, max - min);
  const points = series.map((value, index) => {
    const x = (index / (series.length - 1)) * width;
    const y = height - 3 - ((value - min) / range) * (height - 7);
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  $(".sparkline-line").setAttribute("d", line);
  $(".sparkline-area").setAttribute("d", area);
}

function applyZoom() {
  const availableWidth = Math.max(320, elements.viewport.clientWidth - 92);
  const availableHeight = Math.max(280, elements.viewport.clientHeight - 88);
  const fittedWidth = Math.min(availableWidth, availableHeight * (CANVAS_WIDTH / CANVAS_HEIGHT));
  const width = Math.max(320, fittedWidth * session.zoom);
  elements.canvasFrame.style.width = `${width}px`;
  elements.zoomValue.textContent = `${Math.round(session.zoom * 100)}%`;
}

function setZoom(value, announceChange = true) {
  session.zoom = clamp(value, 0.55, 1.3);
  applyZoom();
  if (announceChange) announce(`画布缩放 ${Math.round(session.zoom * 100)}%`);
  scheduleSave(100);
}

function scenePoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
  };
}

function beginHistoryEntry() {
  const snapshot = {
    project: structuredClone(session.project),
    selectionId: session.selectionId,
    at: Date.now(),
  };
  if (historyIndex >= 0 && JSON.stringify(history[historyIndex].project) === JSON.stringify(snapshot.project)) {
    return;
  }
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  if (history.length > 40) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (historyIndex <= 0) {
    announce("没有可撤销的操作");
    return;
  }
  historyIndex -= 1;
  restoreHistory();
  announce("已撤销上一步");
}

function redo() {
  if (historyIndex >= history.length - 1) {
    announce("没有可重做的操作");
    return;
  }
  historyIndex += 1;
  restoreHistory();
  announce("已重做上一步");
}

function restoreHistory() {
  const entry = history[historyIndex];
  session.project = structuredClone(entry.project);
  session.selectionId = entry.selectionId;
  updateSelectionUi();
  renderLayers();
  updateHistoryButtons();
  scheduleSave(80);
}

function updateHistoryButtons() {
  $("#undo-button").disabled = historyIndex <= 0;
  $("#redo-button").disabled = historyIndex >= history.length - 1;
}

function updateLayerGeometry(layer, x, y) {
  const clamped = clampLayerPosition(session.project, layer, x, y);
  layer.x = Math.round(clamped.x * 10) / 10;
  layer.y = Math.round(clamped.y * 10) / 10;
  session.project.revision += 1;
}

elements.canvas.addEventListener("pointerdown", (event) => {
  try {
    event.preventDefault();
    elements.canvas.focus({ preventScroll: true });
    const point = scenePoint(event);
    if (session.tool === "move") {
      panState = {
        startX: event.clientX,
        startY: event.clientY,
        cameraX: session.camera.x || 0,
        cameraY: session.camera.y || 0,
      };
      elements.canvas.classList.add("is-moving");
      elements.canvas.setPointerCapture(event.pointerId);
      return;
    }
    const layer = hitTest(session.project, point.x, point.y);
    if (!layer) {
      setSelection(null, { focusCanvas: true });
      return;
    }
    beginHistoryEntry();
    setSelection(layer.id, { focusCanvas: true });
    dragState = {
      pointerId: event.pointerId,
      layerId: layer.id,
      startX: point.x,
      startY: point.y,
      x: layer.x,
      y: layer.y,
      originalX: layer.x,
      originalY: layer.y,
      moved: false,
    };
    elements.canvas.setPointerCapture(event.pointerId);
    elements.canvas.classList.add("is-moving");
  } catch (error) {
    showError("无法开始拖动", error);
  }
});

elements.canvas.addEventListener("pointermove", (event) => {
  try {
    if (panState) {
      session.camera.x = panState.cameraX + (event.clientX - panState.startX) * 0.5;
      session.camera.y = panState.cameraY + (event.clientY - panState.startY) * 0.5;
      return;
    }
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const point = scenePoint(event);
    const layer = getLayer(session.project, dragState.layerId);
    if (!layer) return;
    dragState.moved =
      dragState.moved || Math.abs(point.x - dragState.startX) > 0.4 || Math.abs(point.y - dragState.startY) > 0.4;
    const next = clampLayerPosition(
      session.project,
      layer,
      dragState.x + point.x - dragState.startX,
      dragState.y + point.y - dragState.startY,
    );
    layer.x = Math.round(next.x * 10) / 10;
    layer.y = Math.round(next.y * 10) / 10;
    updateSelectionUi();
    markSaving();
  } catch (error) {
    showError("拖动更新失败", error);
  }
});

function finishPointer(event, cancelled = false) {
  try {
    if (panState) {
      panState = null;
      elements.canvas.classList.remove("is-moving");
      scheduleSave(100);
      announce("画布位置已更新");
      return;
    }
    if (!dragState) return;
    const layer = getLayer(session.project, dragState.layerId);
    if (cancelled && layer) {
      layer.x = dragState.originalX;
      layer.y = dragState.originalY;
      updateSelectionUi();
      announce(`${layer.name}拖动已取消，位置已恢复`);
    } else if (layer) {
      session.project.revision += 1;
      announce(`${layer.name}已移动到 X ${Math.round(layer.x)}，Y ${Math.round(layer.y)}`);
    }
    if (elements.canvas.hasPointerCapture?.(event.pointerId)) {
      elements.canvas.releasePointerCapture(event.pointerId);
    }
    dragState = null;
    elements.canvas.classList.remove("is-moving");
    scheduleSave(90);
  } catch (error) {
    showError("结束拖动时保存失败", error);
  }
}

elements.canvas.addEventListener("pointerup", (event) => finishPointer(event));
elements.canvas.addEventListener("pointercancel", (event) => finishPointer(event, true));

elements.canvas.addEventListener("keydown", (event) => {
  const layer = currentSelection();
  if (event.key === "Escape") {
    setSelection(null);
    event.preventDefault();
    return;
  }
  if (event.key === "Enter" && !layer) {
    const first = getSelectableLayers(session.project)[0];
    if (first) setSelection(first.id);
    event.preventDefault();
    return;
  }
  if (event.key === "+" || event.key === "=") {
    setZoom(session.zoom + 0.05);
    event.preventDefault();
    return;
  }
  if (event.key === "-" || event.key === "_") {
    setZoom(session.zoom - 0.05);
    event.preventDefault();
    return;
  }
  const directions = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  if (!layer) {
    announce("方向键需要先选择对象。按 Enter 选择最上方对象。");
    return;
  }
  beginHistoryEntry();
  const amount = event.shiftKey ? 10 : 1;
  updateLayerGeometry(layer, layer.x + direction[0] * amount, layer.y + direction[1] * amount);
  updateSelectionUi();
  announce(`${layer.name}移动到 X ${Math.round(layer.x)}，Y ${Math.round(layer.y)}`);
  scheduleSave(180);
});

elements.layerList.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const buttons = [...elements.layerList.querySelectorAll(".layer-button")];
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const offset = event.key === "ArrowDown" ? 1 : -1;
  buttons[(index + offset + buttons.length) % buttons.length]?.focus();
});

$("#layer-filter").addEventListener("input", renderLayers);

for (const [key, button] of [
  ["shadows", "#toggle-shadows"],
  ["sorting", "#toggle-sorting"],
  ["culling", "#toggle-culling"],
]) {
  $(button).addEventListener("click", () => toggleOptimization(key));
}

function toggleOptimization(key) {
  try {
    const before = cloneCanvasElement(elements.canvas);
    session.options[key] = !session.options[key];
    updateOptionUi();
    const sample = renderer.render({
      project: session.project,
      options: session.options,
      selectionId: session.selectionId,
      camera: session.camera,
    });
    metrics.record(sample);
    const difference = renderer.pixelDifference(before);
    const passed = difference <= 0.005;
    setParityUi(passed, passed ? `画面一致 · ${(difference * 100).toFixed(3)}% 差异` : `画面差异 ${(difference * 100).toFixed(3)}%`);
    const label = key === "shadows" ? "阴影" : key === "sorting" ? "排序" : "裁剪";
    announce(`${label}优化${session.options[key] ? "已开启" : "已关闭"}。${passed ? "画面保持一致" : "检测到画面差异，请运行验证"}`);
    scheduleSave(120);
  } catch (error) {
    showError("切换优化开关失败", error);
  }
}

function cloneCanvasElement(source) {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d").drawImage(source, 0, 0);
  return copy;
}

function setParityUi(passed, text) {
  elements.parityChip.textContent = passed ? "画面一致" : "需检查";
  elements.parityChip.classList.toggle("is-pass", passed);
  elements.parityDot.classList.toggle("is-pass", passed);
  elements.parityDot.classList.toggle("is-fail", !passed);
  elements.parityResult.textContent = text;
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    if (editing) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.toLowerCase() === "v") {
    setTool("select");
  } else if (event.key.toLowerCase() === "t") {
    setTool("text");
  } else if (event.key.toLowerCase() === "h") {
    setTool("move");
  } else if (event.key === "+" || event.key === "=") {
    setZoom(session.zoom + 0.05);
  } else if (event.key === "-" || event.key === "_") {
    setZoom(session.zoom - 0.05);
  }
});

function setTool(tool) {
  session.tool = tool;
  for (const name of ["select", "text", "move"]) {
    $(`#tool-${name}`).classList.toggle("is-active", name === tool);
    $(`#tool-${name}`).setAttribute("aria-pressed", String(name === tool));
  }
  if (tool === "text") {
    const selected = currentSelection();
    const textLayer = selected?.type === "text" ? selected : getSelectableLayers(session.project).find((layer) => layer.type === "text");
    if (textLayer) {
      setSelection(textLayer.id);
      elements.textContent.focus();
    }
  }
  announce(`${tool === "select" ? "选择" : tool === "text" ? "文字" : "平移"}工具已启用`);
  scheduleSave(100);
}

$("#tool-select").addEventListener("click", () => setTool("select"));
$("#tool-text").addEventListener("click", () => setTool("text"));
$("#tool-move").addEventListener("click", () => setTool("move"));
$("#undo-button").addEventListener("click", undo);
$("#redo-button").addEventListener("click", redo);

elements.textContent.addEventListener("focus", beginHistoryEntry);
elements.textContent.addEventListener("input", () => {
  const layer = currentSelection();
  if (!layer || layer.type !== "text") return;
  layer.text = elements.textContent.value;
  session.project.revision += 1;
  elements.layerRevision.textContent = `修订 r${session.project.revision}`;
  announce(`${layer.name}文字已更新，共 ${layer.text.length} 个字符`);
  scheduleSave(260);
});

for (const [input, axis] of [
  [elements.fieldX, "x"],
  [elements.fieldY, "y"],
]) {
  input.addEventListener("focus", beginHistoryEntry);
  input.addEventListener("change", () => {
    const layer = currentSelection();
    if (!layer) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      input.value = Math.round(layer[axis]);
      showError("坐标必须是有效数字");
      return;
    }
    beginHistoryEntry();
    updateLayerGeometry(layer, axis === "x" ? value : layer.x, axis === "y" ? value : layer.y);
    updateSelectionUi();
    announce(`${layer.name}${axis === "x" ? "水平" : "垂直"}坐标更新为 ${Math.round(layer[axis])}`);
    scheduleSave(100);
  });
}

$("#reset-layer").addEventListener("click", () => {
  const layer = currentSelection();
  if (!layer) return;
  beginHistoryEntry();
  const fresh = structuredClone(createInitialProject().layers.find((item) => item.id === layer.id));
  if (!fresh) {
    showError("找不到此图层的初始状态");
    return;
  }
  Object.keys(layer).forEach((key) => delete layer[key]);
  Object.assign(layer, fresh);
  session.project.revision += 1;
  updateSelectionUi();
  renderLayers();
  announce(`${layer.name}已恢复初始属性`);
  scheduleSave(80);
});

$("#zoom-in").addEventListener("click", () => setZoom(session.zoom + 0.06));
$("#zoom-out").addEventListener("click", () => setZoom(session.zoom - 0.06));
$("#fit-button").addEventListener("click", () => {
  setZoom(0.82);
  announce("画布已适应窗口");
});

$("#export-button").addEventListener("click", doExport);

function doExport() {
  try {
    const result = exportSession(window.localStorage, session);
    session = result.session;
    exportRecord = result.exportRecord;
    updateExportUi();
    const text = createExportFile(result.exportRecord);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `city-pulse-r${result.exportRecord.revision}.json`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    announce(`导出成功。工程摘要 ${result.exportRecord.digest}，导出前选择 ${result.exportRecord.selectionId} 已保留。`);
    showToast(`导出成功 · 摘要 ${result.exportRecord.digest} · 恢复点已保留`);
    setParityUi(true, `导出摘要 ${result.exportRecord.digest}`);
  } catch (error) {
    showError("导出失败，已保留导出前状态", error);
  }
}

$("#reload-export").addEventListener("click", () => {
  try {
    const result = restoreExport(window.localStorage, session);
    session = result.session;
    exportRecord = result.exportRecord;
    benchmarkRunner.project = session.project;
    updateOptionUi();
    updateSelectionUi();
    updateExportUi();
    renderLayers();
    applyZoom();
    announce(`已从导出记录重新载入，选择 ${session.selectionId} 与工程摘要 ${exportRecord.digest} 一致`);
    showToast("工程已从导出恢复点重新载入");
  } catch (error) {
    showError("重新载入导出记录失败", error);
  }
});

async function runBenchmarkFlow({ automatic = false, force = false } = {}) {
  if (benchmarkRunning || (verificationRunning && !force)) return null;
  benchmarkRunning = true;
  livePaused = true;
  const runButton = $("#run-benchmark");
  runButton.disabled = true;
  elements.benchmarkSummary.textContent = "等待字体就绪并运行 24 帧固定动作 × 3 种配置…";
  elements.parityResult.textContent = "逐帧采样中";
  try {
    await document.fonts?.ready;
    renderer.clearCache();
    benchmarkRunner.project = session.project;
    const result = await benchmarkRunner.run({
      selectionId: session.selectionId,
      onProgress({ config, frame, progress }) {
        elements.benchmarkSummary.textContent = `正在采样 ${config.label} · 第 ${frame + 1}/24 帧 · ${Math.round(progress * 100)}%`;
      },
    });
    if (!result) return null;
    session.benchmark = result;
    renderBenchmarkUi(result);
    scheduleSave(80);
    if (!automatic) {
      showToast(
        result.parity
          ? `三配置基准通过 · ${result.configs.length}/${result.configs.length} 画面一致`
          : `基准发现差异 · ${result.failures[0] || "请查看详情"}`,
        !result.parity,
      );
    }
    return result;
  } catch (error) {
    elements.benchmarkSummary.textContent = `基准失败：${error.message}`;
    setParityUi(false, `基准失败：${error.message}`);
    showError("固定动作基准失败", error);
    return null;
  } finally {
    runButton.disabled = false;
    benchmarkRunning = false;
    livePaused = false;
  }
}

function renderBenchmarkUi(result) {
  const rows = result.configs.map((config, index) => {
    const row = document.createElement("tr");
    if (config.id === "optimized") row.className = "is-optimized";
    const name = document.createElement("td");
    name.textContent = config.label;
    const frame = document.createElement("td");
    frame.textContent = formatMs(config.frameAvg);
    const objects = document.createElement("td");
    objects.textContent = Math.round(config.drawnAvg);
    const cache = document.createElement("td");
    cache.textContent = `${(config.cacheHitRate * 100).toFixed(0)}%`;
    const layout = document.createElement("td");
    layout.textContent = formatMs(config.layoutAvg);
    row.append(name, frame, objects, cache, layout);
    row.title = `${config.detail}；p95 ${formatMs(config.frameP95)} ms；像素差异 ${(config.maxPixelDiff * 100).toFixed(3)}%`;
    return row;
  });
  elements.benchmarkBody.replaceChildren(...rows);
  const baseline = result.configs[0];
  const optimized = result.configs.find((config) => config.id === "optimized") || result.configs[1];
  const improvement = baseline.frameAvg ? (1 - optimized.frameAvg / baseline.frameAvg) * 100 : 0;
  elements.benchmarkSummary.innerHTML = result.parity
    ? `<strong>${result.configs.length}/${result.configs.length} 配置通过</strong> · 画面一致 · ${result.actions} 帧 × 3 · 优化帧时 ${improvement >= 0 ? "下降" : "上升"} ${Math.abs(improvement).toFixed(0)}%`
    : `<strong>基准未通过</strong> · ${result.failures.join("；")}`;
  setParityUi(
    result.parity,
    result.parity
      ? `3 组像素摘要一致 · 最大差异 ${(Math.max(...result.configs.map((item) => item.maxPixelDiff)) * 100).toFixed(3)}%`
      : result.failures.join("；"),
  );
}

$("#run-benchmark").addEventListener("click", () => runBenchmarkFlow());

async function runVerificationFlow() {
  if (verificationRunning || benchmarkRunning) {
    showToast("已有验证正在运行，请稍候");
    return;
  }
  const dialog = $("#verify-dialog");
  if (!dialog.open) dialog.showModal();
  verificationRunning = true;
  livePaused = true;
  $("#verify-status").textContent = "RUNNING";
  $("#verify-status").className = "report-status pending";
  $("#verify-rate").textContent = "—";
  $("#verify-verdict").textContent = "正在运行可重复验证";
  $("#verify-detail").textContent = "固定动作、固定种子、固定画面摘要。";
  $("#verify-body").innerHTML = '<tr><td colspan="4" class="empty-row">正在检查默认、边界与错误恢复…</td></tr>';
  $("#verify-button").disabled = true;
  try {
    const benchmark =
      (await runBenchmarkFlow({ automatic: true, force: true })) || session.benchmark;
    const result = await runVerification({
      renderer,
      session,
      benchmarkResult: benchmark,
    });
    session.verification = result;
    renderVerificationUi(result);
    scheduleSave(80);
  } catch (error) {
    $("#verify-status").textContent = "ERROR";
    $("#verify-status").className = "report-status fail";
    $("#verify-verdict").textContent = "验证流程发生异常";
    $("#verify-detail").textContent = error.message;
    showError("可重复验证失败", error);
  } finally {
    verificationRunning = false;
    livePaused = false;
    $("#verify-button").disabled = false;
  }
}

function renderVerificationUi(result) {
  const rows = result.groups.map((group) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "group-name";
    name.textContent = `${group.label} / ${group.scenario}`;
    const checks = document.createElement("td");
    checks.textContent = `${group.passedChecks}/${group.totalChecks}`;
    const status = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `report-pill ${group.passed ? "pass" : "fail"}`;
    pill.textContent = group.passed ? "PASS" : "FAIL";
    status.append(pill);
    const detail = document.createElement("td");
    detail.textContent = group.checks
      .map((item) => `${item.passed ? "✓" : "✕"} ${item.name}：${item.detail}`)
      .join(" ");
    row.append(name, checks, status, detail);
    return row;
  });
  $("#verify-body").replaceChildren(...rows);
  $("#verify-rate").textContent = formatPercent(result.passRate);
  $("#verify-status").textContent = result.passed ? "PASS" : "FAIL";
  $("#verify-status").className = `report-status ${result.passed ? "pass" : "fail"}`;
  $("#verify-verdict").textContent = result.passed
    ? `${result.passedChecks}/${result.totalChecks} 项检查通过`
    : `${result.failures.length} 项失败，需要处理`;
  $("#verify-detail").textContent = result.passed
    ? "默认、边界与错误恢复均完成；错误恢复未改变工程与用户选择。"
    : result.failures.join("；");
  $("#verify-timestamp").textContent = `最近运行 ${new Date(result.timestamp).toLocaleString("zh-CN")}`;
}

$("#verify-button").addEventListener("click", runVerificationFlow);
$("#rerun-verify").addEventListener("click", runVerificationFlow);
$("#close-verify").addEventListener("click", () => $("#verify-dialog").close());
$("#dialog-a11y").addEventListener("click", () => {
  $("#verify-dialog").close();
  openA11yDialog();
});

const fallbackA11ySummary = {
  checkedAt: null,
  passRate: 0,
  passed: 0,
  total: 10,
  summary: "浏览器无障碍路径尚未运行。打开验证后会生成键盘、鼠标、触屏、焦点与读屏检查摘要。",
  paths: [
    ["键盘移动", "待验证", "Tab 聚焦画布，方向键移动选中对象"],
    ["鼠标选择", "待验证", "点击画布对象并同步属性面板"],
    ["触屏轻触", "待验证", "轻触同一画布对象到达相同选择状态"],
    ["键盘控件", "待验证", "Space 切换优化开关并同步 aria-checked"],
    ["焦点更新", "待验证", "操作后活动焦点与选择一致"],
    ["读屏播报", "待验证", "aria-live 区域播报选择与位置"],
    ["文字编辑", "待验证", "键盘修改文字并在刷新后恢复"],
    ["错误恢复", "待验证", "受控缓存故障后恢复原摘要"],
    ["导出保留", "待验证", "导出前选择与工程摘要保留"],
    ["刷新恢复", "待验证", "刷新后工程、选择与导出记录不重置"],
  ],
  failureRecovery: ["尚无失败记录"],
};

async function loadA11ySummary() {
  let summary = null;
  try {
    const stored = localStorage.getItem("framelab.a11y.v1");
    if (stored) summary = JSON.parse(stored);
  } catch {
    summary = null;
  }
  if (!summary) {
    try {
      const response = await fetch("./artifacts/accessibility-summary.json", { cache: "no-store" });
      if (response.ok) summary = await response.json();
    } catch {
      summary = null;
    }
  }
  a11ySummary = normalizeA11ySummary(summary || fallbackA11ySummary);
  renderA11ySummary(a11ySummary);
}

function normalizeA11ySummary(summary) {
  return {
    checkedAt: summary.checkedAt || null,
    passRate: Number(summary.passRate) || 0,
    passed: Number(summary.passed) || 0,
    total: Number(summary.total) || (summary.paths?.length || 0),
    summary: summary.summary || "无障碍检查摘要",
    paths: (summary.paths || []).map((path) =>
      Array.isArray(path)
        ? { name: path[0], status: path[1], detail: path[2] }
        : path,
    ),
    failureRecovery: summary.failureRecovery || [],
  };
}

function renderA11ySummary(summary) {
  $("#a11y-rate").textContent = summary.total ? `${Math.round(summary.passRate * 100)}%` : "—";
  $("#a11y-summary").textContent = summary.checkedAt
    ? `${summary.summary} 最近检查：${new Date(summary.checkedAt).toLocaleString("zh-CN")}`
    : summary.summary;
  const cards = summary.paths.map((path) => {
    const card = document.createElement("article");
    card.className = "a11y-check";
    const header = document.createElement("div");
    header.className = "a11y-check-header";
    const title = document.createElement("h3");
    title.textContent = path.name;
    const state = document.createElement("span");
    const passed = String(path.status).toLowerCase().includes("pass") || path.status === "已验证" || path.status === "通过";
    state.className = `check-state ${passed ? "" : "fail"}`;
    state.textContent = path.status;
    header.append(title, state);
    const detail = document.createElement("p");
    detail.textContent = path.detail;
    card.append(header, detail);
    return card;
  });
  const recovery = document.createElement("article");
  recovery.className = "a11y-check";
  const recoveryHeader = document.createElement("div");
  recoveryHeader.className = "a11y-check-header";
  const recoveryTitle = document.createElement("h3");
  recoveryTitle.textContent = "失败恢复";
  const recoveryState = document.createElement("span");
  recoveryState.className = "check-state";
  recoveryState.textContent = summary.failureRecovery.length ? "已记录" : "无失败";
  recoveryHeader.append(recoveryTitle, recoveryState);
  const recoveryDetail = document.createElement("p");
  recoveryDetail.textContent = summary.failureRecovery.join("；") || "尚无失败记录";
  recovery.append(recoveryHeader, recoveryDetail);
  $("#a11y-sections").replaceChildren(...cards, recovery);
}

function openA11yDialog() {
  $("#a11y-dialog").showModal();
}

$("#a11y-button").addEventListener("click", openA11yDialog);
$("#close-a11y").addEventListener("click", () => $("#a11y-dialog").close());
$("#close-a11y-footer").addEventListener("click", () => $("#a11y-dialog").close());

function saveNow() {
  clearTimeout(saveTimer);
  try {
    session = persistSession(window.localStorage, session);
    markSaved();
    return stateSnapshot(session);
  } catch (error) {
    showError("立即保存失败", error);
    return null;
  }
}

function init() {
  renderer.resize(window.devicePixelRatio || 1);
  updateOptionUi();
  updateSelectionUi();
  renderLayers();
  updateExportUi();
  beginHistoryEntry();
  updateHistoryButtons();
  renderer.project = session.project;
  requestAnimationFrame(applyZoom);
  frameLoop = requestAnimationFrame(frameLoopStep);

  const resizeObserver = new ResizeObserver(() => {
    applyZoom();
    renderer.resize(window.devicePixelRatio || 1);
  });
  resizeObserver.observe(elements.viewport);

  if (warnings.length) {
    showToast(warnings.join("；"), true);
    elements.errorAnnouncer.textContent = warnings.join("；");
  } else {
    scheduleSave(120);
  }

  if (session.benchmark?.configs?.length) {
    renderBenchmarkUi(session.benchmark);
  } else {
    requestAnimationFrame(() => runBenchmarkFlow({ automatic: true }));
  }
  loadA11ySummary();
  document.fonts?.ready.then(() => {
    renderer.clearCache();
    drawLiveFrame();
  });

  window.addEventListener("pagehide", () => {
    try {
      session = persistSession(window.localStorage, session);
    } catch {
    }
  });
}

window.__FRAMELAB__ = {
  getState() {
    return {
      selectionId: session.selectionId,
      options: { ...session.options },
      tool: session.tool,
      revision: session.project.revision,
      digest: stateSnapshot(session).digest,
      exportRecord: exportRecord
        ? {
            id: exportRecord.id,
            digest: exportRecord.digest,
            preExportDigest: exportRecord.preExportDigest,
            selectionId: exportRecord.selectionId,
          }
        : null,
      benchmark: session.benchmark
        ? {
            parity: session.benchmark.parity,
            configs: session.benchmark.configs.length,
            actions: session.benchmark.actions,
          }
        : null,
    };
  },
  getLayerPoint(id) {
    const layer = getLayer(session.project, id);
    if (!layer) return null;
    const rect = elements.canvas.getBoundingClientRect();
    const sceneX = layer.type === "ellipse" ? layer.x + layer.w / 2 : layer.x + Math.min(layer.w / 2, 30);
    const sceneY = layer.type === "ellipse" ? layer.y + layer.h / 2 : layer.y + Math.min(layer.h / 2, 16);
    return {
      x: rect.left + (sceneX / CANVAS_WIDTH) * rect.width,
      y: rect.top + (sceneY / CANVAS_HEIGHT) * rect.height,
      sceneX,
      sceneY,
    };
  },
  getLayer(id) {
    return structuredClone(getLayer(session.project, id));
  },
  getCanvasDigest() {
    return renderer.pixelDigest();
  },
  getStructuralDigest() {
    return structuralDigest(session.project);
  },
  saveNow,
  runBenchmark: () => runBenchmarkFlow(),
  runVerification: () => runVerificationFlow(),
  getBenchmark() {
    return session.benchmark ? structuredClone(session.benchmark) : null;
  },
  getVerification() {
    return session.verification ? structuredClone(session.verification) : null;
  },
  setA11ySummary(summary) {
    localStorage.setItem("framelab.a11y.v1", JSON.stringify(summary));
    a11ySummary = normalizeA11ySummary(summary);
    renderA11ySummary(a11ySummary);
  },
  getA11ySummary() {
    return structuredClone(a11ySummary);
  },
  getLiveRegionText() {
    return elements.selectionAnnouncer.textContent;
  },
  getMetrics() {
    return metrics.snapshot();
  },
};

init();
