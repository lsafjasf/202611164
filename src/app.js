import { EditorSession, LIMITS } from "./core.js";
import {
  drawDocument,
  drawThumbnail,
  exportDocumentJson,
  getViewTransform,
  screenToWorld,
} from "./renderer.js";
import {
  corruptPayloads,
  makeBoundaryDocument,
  makeNormalDocument,
} from "./sample-data.js";

const $ = (id) => document.getElementById(id);
const dom = {
  stage: $("stageCanvas"),
  overlay: $("overlayCanvas"),
  shell: $("canvasShell"),
  modeBadge: $("modeBadge"),
  sessionState: $("sessionState"),
  elapsed: $("elapsed"),
  lastOp: $("lastOp"),
  recoveryBanner: $("recoveryBanner"),
  recoveryText: $("recoveryText"),
  documentSize: $("documentSize"),
  activeObjects: $("activeObjects"),
  selectedInfo: $("selectedInfo"),
  cacheEntries: $("cacheEntries"),
  cacheSize: $("cacheSize"),
  memoryEstimate: $("memoryEstimate"),
  memoryBreakdown: $("memoryBreakdown"),
  canvasCount: $("canvasCount"),
  listenerCount: $("listenerCount"),
  historyLabel: $("historyLabel"),
  historyMeter: $("historyMeter"),
  cacheHitRate: $("cacheHitRate"),
  errorCount: $("errorCount"),
  operationTime: $("operationTime"),
  fpsValue: $("fpsValue"),
  zoomValue: $("zoomValue"),
  emptyState: $("emptyState"),
  layerList: $("layerList"),
  layerCount: $("layerCount"),
  errorList: $("errorList"),
  statusText: $("statusText"),
  resourceNote: $("resourceNote"),
  lastCloseNote: $("lastCloseNote"),
  toggleSession: $("toggleSessionButton"),
  stressButton: $("stressButton"),
  toastStack: $("toastStack"),
  jsonInput: $("jsonInput"),
};

const state = {
  tool: "select",
  view: { width: 900, height: 600, dpr: 1 },
  draft: null,
  drag: null,
  errorMode: false,
  forceReduced: false,
  autoReduced: false,
  lowFpsSeconds: 0,
  healthyFpsSeconds: 0,
  fps: 60,
  lastFrame: 0,
  frameHandle: 0,
  renderFault: false,
  statsTimer: 0,
  stressRunning: false,
  hiddenErrorCutoff: 0,
  lastClose: null,
};

const session = new EditorSession({
  stageCanvas: dom.stage,
  overlayCanvas: dom.overlay,
  initialDocument: makeNormalDocument(),
});

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function formatElapsed(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  if (ms < 1) return "<1 ms";
  return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}

function notify(message, { error = false, timeout = 3800 } = {}) {
  const toast = document.createElement("div");
  toast.className = `toast${error ? " error" : ""}`;
  toast.textContent = message;
  while (dom.toastStack.children.length >= 4) dom.toastStack.firstElementChild.remove();
  dom.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), timeout);
}

function modeLabel(mode) {
  if (mode === "recovery") return "恢复模式";
  if (mode === "reduced") return "低细节";
  return "完整渲染";
}

function drawMode() {
  return session.mode === "full" ? "full" : "reduced";
}

function effectiveDocument() {
  return session.exportDocument();
}

function resizeStage() {
  if (session.state !== "open") return;
  const rect = dom.shell.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(240, Math.floor(rect.height));
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  state.view = { width, height, dpr };
  for (const canvas of [dom.stage, dom.overlay]) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
}

function canvasPoint(event) {
  const rect = dom.stage.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * state.view.width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * state.view.height,
  };
}

function worldPoint(event) {
  return screenToWorld(canvasPoint(event), effectiveDocument(), state.view.width, state.view.height);
}

function refreshMode() {
  if (session.state !== "open") return;
  if (state.errorMode) session.setMode("recovery");
  else if (state.forceReduced || state.autoReduced || session.model.objects.length > 90) {
    session.setMode("reduced");
  } else {
    session.setMode("full");
  }
}

function markSuccess() {
  if (state.errorMode) {
    state.errorMode = false;
    refreshMode();
  }
}

function showFailure(error, operation, { journaled = true } = {}) {
  if (!journaled) session.errors.record(error, operation);
  state.errorMode = true;
  state.renderFault = false;
  refreshMode();
  dom.recoveryBanner.classList.add("error");
  dom.recoveryText.textContent =
    session.recoverySuggestion ||
    "操作失败；画布保持在上一有效状态，请检查诊断日志后重试。";
  dom.statusText.textContent = `${operation} 失败`;
  console.error(`[Loom Canvas] ${operation}`, error);
  notify(`${operation} 失败：${error.message}`, { error: true, timeout: 5200 });
  renderStats();
  renderErrors();
  drawAll();
}

function runAction(operation, task, { successMessage = "" } = {}) {
  if (session.state !== "open") {
    notify("编辑器已关闭，请先重新打开画布。", { error: true });
    return { ok: false, value: null };
  }
  try {
    const value = task();
    markSuccess();
    dom.recoveryBanner.classList.remove("error");
    dom.recoveryText.textContent = session.recoverySuggestion;
    dom.statusText.textContent = `${operation} 完成`;
    if (successMessage) notify(successMessage);
    renderStats();
    renderLayers();
    drawAll();
    return { ok: true, value };
  } catch (error) {
    showFailure(error, operation);
    return { ok: false, value: null, error };
  }
}

function drawOverlay() {
  const context = dom.overlay.getContext("2d");
  if (!context) return;
  const { width, height, dpr } = state.view;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, dom.overlay.width, dom.overlay.height);
  if (session.state !== "open" || !state.draft) return;
  const document = effectiveDocument();
  const view = getViewTransform(document, width, height);
  const frame = normalizedRect(state.draft.start, state.draft.current);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.save();
  context.translate(view.offsetX, view.offsetY);
  context.scale(view.scale, view.scale);
  context.fillStyle = "rgba(110, 231, 183, 0.12)";
  context.strokeStyle = "#6ee7b7";
  context.lineWidth = 2 / view.scale;
  context.setLineDash([7 / view.scale, 5 / view.scale]);
  context.fillRect(frame.x, frame.y, frame.width, frame.height);
  context.strokeRect(frame.x, frame.y, frame.width, frame.height);
  context.restore();
}

function drawAll() {
  if (session.state !== "open") return;
  try {
    const context = dom.stage.getContext("2d");
    if (!context) throw new Error("浏览器未提供 2D 画布上下文");
    const document = effectiveDocument();
    drawDocument(context, document, {
      width: state.view.width,
      height: state.view.height,
      dpr: state.view.dpr,
      mode: drawMode(),
      selected: session.model.selected,
      dragOffset: state.drag ? state.drag.offset : null,
    });
    drawOverlay();
    state.renderFault = false;
    dom.emptyState.hidden = document.objects.length > 0;
    const view = getViewTransform(document, state.view.width, state.view.height);
    dom.zoomValue.textContent = `缩放 ${Math.round(view.scale * 100)}%`;
  } catch (error) {
    if (!state.renderFault) {
      state.renderFault = true;
      session.errors.record(error, "render");
      state.errorMode = true;
      session.setMode("recovery");
      dom.recoveryBanner.classList.add("error");
      dom.recoveryText.textContent =
        "渲染失败，已切换到恢复模式。建议导出当前场景后重新打开画布。";
      dom.statusText.textContent = "渲染失败";
      console.error("[Loom Canvas] render", error);
      notify(`渲染失败：${error.message}`, { error: true, timeout: 6000 });
      renderStats();
      renderErrors();
    }
  }
}

function renderStats() {
  const memory = session.memorySnapshot();
  dom.sessionState.textContent = session.state === "open" ? "已打开" : "已关闭";
  dom.modeBadge.textContent = modeLabel(memory.mode);
  dom.modeBadge.title =
    memory.mode === "recovery"
      ? "发生异常，非关键细节已降级；失败信息保留在日志中"
      : memory.mode === "reduced"
        ? "性能保护模式：降低非关键网格与阴影，导出内容不变"
        : "完整动画与选择细节";
  dom.elapsed.textContent = formatElapsed(memory.elapsedMs);
  dom.lastOp.textContent = memory.lastOperationName
    ? `${memory.lastOperationName} · ${formatDuration(memory.lastOperationMs)}`
    : "--";
  dom.activeObjects.textContent = String(memory.activeObjects);
  dom.selectedInfo.textContent = `${memory.selectedObjects} 个选中`;
  dom.cacheEntries.textContent = String(memory.cacheEntries);
  dom.cacheSize.textContent = formatBytes(memory.cacheBytes);
  dom.memoryEstimate.textContent = formatBytes(memory.memoryEstimateBytes);
  dom.memoryBreakdown.textContent =
    `画布 ${formatBytes(memory.canvasBytes)} · ` +
    `模型 ${formatBytes(memory.modelBytes)} · ` +
    `撤销 ${formatBytes(memory.historyBytes)}`;
  dom.canvasCount.textContent = String(memory.canvases);
  dom.listenerCount.textContent = String(memory.listeners);
  dom.historyLabel.textContent = `${memory.historyEntries} 项 · ${formatBytes(memory.historyBytes)}`;
  dom.historyMeter.style.width = `${Math.min(
    100,
    (memory.historyBytes / LIMITS.historyBytes) * 100,
  ).toFixed(1)}%`;
  dom.cacheHitRate.textContent =
    memory.cacheHits + memory.cacheMisses > 0
      ? `${Math.round(memory.cacheHitRate * 100)}%`
      : "--";
  dom.errorCount.textContent = String(memory.errorCount);
  dom.operationTime.textContent = formatDuration(memory.lastOperationMs);
  dom.fpsValue.textContent = `${Math.round(state.fps)} FPS`;
  dom.documentSize.textContent = `${session.model.width} × ${session.model.height}`;
  dom.layerCount.textContent = String(session.model.objects.length);
  dom.resourceNote.textContent =
    session.state === "open"
      ? `画布 ${memory.canvases} · 监听 ${memory.listeners} · 缓存 ${memory.cacheEntries}；导出固定使用完整数据`
      : "画布、监听器与预览缓存已释放；对象和增量撤销保留，供重新打开继续";
  if (session.state === "closed") {
    dom.lastCloseNote.textContent = "画布已关闭；可重新打开继续";
  }
  if (state.lastClose) {
    const before = state.lastClose.before;
    const after = state.lastClose.after;
    if (session.state === "closed") {
      dom.lastCloseNote.textContent =
        `关闭前 ${before.canvases} 画布 / ${before.listeners} 监听 · ` +
        `关闭后 ${after.canvases} / ${after.listeners}`;
    }
  }
  if (!state.errorMode) {
    dom.recoveryBanner.classList.remove("error");
    dom.recoveryText.textContent = memory.recoverySuggestion;
  }
}

function localThumbnail(shape) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 64;
  drawThumbnail(canvas, shape);
  return canvas;
}

function renderLayers() {
  const shapes = session.model.objects;
  dom.layerList.replaceChildren();
  dom.layerCount.textContent = String(shapes.length);
  const visible = shapes.slice(0, 10);
  for (const shape of visible) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `layer-row${session.model.selected.has(shape.id) ? " selected" : ""}`;
    let preview;
    try {
      preview =
        session.state === "open"
          ? session.getPreview(shape, drawThumbnail)
          : localThumbnail(shape);
    } catch {
      preview = localThumbnail(shape);
    }
    row.appendChild(preview);
    const copy = document.createElement("span");
    copy.className = "layer-copy";
    const title = document.createElement("strong");
    title.textContent = shape.type === "text" ? shape.text || shape.id : shape.id;
    const detail = document.createElement("small");
    detail.textContent = `${Math.round(shape.x)}, ${Math.round(shape.y)} · ${Math.round(shape.width)}×${Math.round(shape.height)}`;
    copy.append(title, detail);
    const type = document.createElement("span");
    type.className = "layer-type";
    type.textContent = shape.type;
    row.append(copy, type);
    row.addEventListener("click", () => {
      if (session.state !== "open") return;
      session.model.select([shape.id]);
      renderStats();
      renderLayers();
      drawAll();
    });
    dom.layerList.appendChild(row);
  }
  if (shapes.length === 0) {
    const quiet = document.createElement("p");
    quiet.className = "quiet";
    quiet.textContent = "暂无活动对象。";
    dom.layerList.appendChild(quiet);
  } else if (shapes.length > visible.length) {
    const more = document.createElement("p");
    more.className = "layer-more";
    more.textContent = `另有 ${shapes.length - visible.length} 个活动对象未展开`;
    dom.layerList.appendChild(more);
  }
}

function renderErrors() {
  const entries = session.errors
    .list()
    .filter((entry) => entry.id > state.hiddenErrorCutoff)
    .slice(-8)
    .reverse();
  dom.errorList.replaceChildren();
  if (entries.length === 0) {
    const quiet = document.createElement("p");
    quiet.className = "quiet";
    quiet.textContent =
      state.hiddenErrorCutoff > 0
        ? `视图已折叠；会话仍保留 ${session.errors.entries.length} 条异常记录`
        : "暂无异常。失败输入会在这里留下可复现记录。";
    dom.errorList.appendChild(quiet);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("article");
    item.className = "error-entry";
    item.title = entry.stack || `${entry.code}: ${entry.message}`;
    const heading = document.createElement("strong");
    const code = document.createElement("span");
    code.textContent = `${entry.code} · ${entry.operation}`;
    heading.append(document.createTextNode(entry.name), code);
    const message = document.createElement("p");
    message.textContent = entry.message;
    item.append(heading, message);
    dom.errorList.appendChild(item);
  }
}

function normalizedRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function hitShape(point) {
  const shapes = session.model.objects;
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    const shape = shapes[index];
    const centerX = shape.x + shape.width / 2;
    const centerY = shape.y + shape.height / 2;
    const radians = (-(shape.rotation || 0) * Math.PI) / 180;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const localX = dx * Math.cos(radians) - dy * Math.sin(radians) + centerX;
    const localY = dx * Math.sin(radians) + dy * Math.cos(radians) + centerY;
    if (
      localX >= shape.x &&
      localX <= shape.x + shape.width &&
      localY >= shape.y &&
      localY <= shape.y + shape.height
    ) {
      return shape;
    }
  }
  return null;
}

function finishDraft(event) {
  const draft = state.draft;
  state.draft = null;
  if (!draft) return;
  const point = worldPoint(event);
  const rect = normalizedRect(draft.start, point);
  if (rect.width < 8 || rect.height < 8) {
    rect.x = draft.start.x - 70;
    rect.y = draft.start.y - 45;
    rect.width = 140;
    rect.height = 90;
  }
  const palette = {
    rect: "#60a5fa",
    ellipse: "#f59e0b",
    text: "#6ee7b7",
  };
  runAction(
    "创建对象",
    () =>
      session.addShape({
        type: draft.type,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: palette[draft.type],
        ...(draft.type === "text" ? { text: "新文本" } : {}),
      }),
    { successMessage: `已创建 ${draft.type === "text" ? "文本" : "图形"}对象` },
  );
}

function finishDrag(event) {
  const drag = state.drag;
  state.drag = null;
  if (!drag) return;
  const point = worldPoint(event);
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    drawAll();
    return;
  }
  runAction("移动对象", () => session.translateSelection(dx, dy));
}

function onPointerDown(event) {
  if (session.state !== "open" || event.button !== 0) return;
  event.preventDefault();
  const point = worldPoint(event);
  state.activePointer = event.pointerId;
  try {
    dom.stage.setPointerCapture(event.pointerId);
  } catch {
    // Capture is a convenience; pointer events still work without it.
  }
  if (state.tool === "select") {
    const shape = hitShape(point);
    if (!shape) {
      if (!event.shiftKey) session.model.clearSelection();
      renderLayers();
      renderStats();
      drawAll();
      return;
    }
    if (event.shiftKey) {
      if (session.model.selected.has(shape.id)) session.model.selected.delete(shape.id);
      else session.model.selected.add(shape.id);
    } else if (!session.model.selected.has(shape.id)) {
      session.model.select([shape.id]);
    }
    state.drag = { start: point, offset: { x: 0, y: 0 } };
    renderLayers();
    renderStats();
    drawAll();
    return;
  }
  state.draft = { type: state.tool, start: point, current: point };
  drawAll();
}

function onPointerMove(event) {
  if (session.state !== "open") return;
  if (state.draft) {
    state.draft.current = worldPoint(event);
    drawAll();
    return;
  }
  if (state.drag) {
    const point = worldPoint(event);
    state.drag.offset = {
      x: point.x - state.drag.start.x,
      y: point.y - state.drag.start.y,
    };
    drawAll();
  }
}

function onPointerUp(event) {
  if (session.state !== "open") return;
  try {
    dom.stage.releasePointerCapture(event.pointerId);
  } catch {
    // The pointer may already have been released by the browser.
  }
  if (state.draft) finishDraft(event);
  else if (state.drag) finishDrag(event);
  state.activePointer = null;
}

function onPointerCancel() {
  state.draft = null;
  state.drag = null;
  state.activePointer = null;
  drawAll();
}

function setTool(tool) {
  state.tool = tool;
  for (const button of document.querySelectorAll("[data-tool]")) {
    button.classList.toggle("active", button.dataset.tool === tool);
  }
  dom.stage.style.cursor = tool === "select" ? "default" : "crosshair";
}

function bindSessionInput() {
  session.bindInput(dom.stage, {
    pointerdown: onPointerDown,
    pointermove: onPointerMove,
    pointerup: onPointerUp,
    pointercancel: onPointerCancel,
  });
  session.bindInput(window, {
    keydown: onKeyDown,
    resize: () => {
      resizeStage();
      drawAll();
    },
    blur: () => {
      state.drag = null;
      state.draft = null;
      drawAll();
    },
  });
}

function undo() {
  runAction("撤销", () => session.undo());
}

function redo() {
  runAction("重做", () => session.redo());
}

function deleteSelection() {
  const selected = session.model.selected.size;
  if (selected === 0) {
    notify("没有选中的对象。");
    return;
  }
  runAction("删除对象", () => session.deleteSelected());
}

function onKeyDown(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (modifier && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    downloadJson();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (event.key === "Escape") {
    state.draft = null;
    state.drag = null;
    drawAll();
    return;
  }
  const shortcuts = { v: "select", r: "rect", e: "ellipse", t: "text" };
  if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
}

function downloadJson() {
  const text = exportDocumentJson(session);
  const blob = new Blob([text], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `loom-canvas-${session.exportSignature()}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  notify(`已导出 JSON · ${formatBytes(new TextEncoder().encode(text).byteLength)}`);
}

function importScenario(kind) {
  const scenario = kind === "normal" ? makeNormalDocument() : makeBoundaryDocument();
  dom.jsonInput.value = JSON.stringify(scenario, null, 2);
  return runAction(
    `导入${kind === "normal" ? "正常" : "边界"}场景`,
    () => session.importDocument(scenario),
    {
      successMessage:
        kind === "normal"
          ? "正常场景已导入；对象可继续编辑和撤销。"
          : "边界场景已导入；尺寸、坐标与文本长度均在允许范围内。",
    },
  );
}

function runCorruptDrill() {
  if (session.state !== "open") {
    notify("请先打开画布再运行损坏输入测试。", { error: true });
    return;
  }
  const signatures = [];
  let rejected = 0;
  let unexpectedSuccess = 0;
  for (let round = 0; round < 2; round += 1) {
    for (const payload of corruptPayloads) {
      const before = session.exportSignature();
      try {
        session.importDocument(payload.value);
        unexpectedSuccess += 1;
        console.error(`[Loom Canvas] corrupt input unexpectedly accepted: ${payload.name}`);
      } catch (error) {
        rejected += 1;
        console.error(`[Loom Canvas] corrupt input rejected: ${payload.name}`, error);
      }
      signatures.push(`${before}:${session.exportSignature()}`);
    }
  }
  const unchanged = signatures.every((entry) => entry.split(":")[0] === entry.split(":")[1]);
  state.errorMode = true;
  session.setMode("recovery");
  session.recoverySuggestion =
    unexpectedSuccess > 0
      ? "损坏输入演练出现意外接受，请导出当前场景并检查诊断日志。"
      : `两轮共 ${rejected} 次损坏输入被原子拒绝；当前画布签名保持不变，可修正 JSON 后重试。`;
  dom.recoveryBanner.classList.add("error");
  dom.recoveryText.textContent = session.recoverySuggestion;
  dom.statusText.textContent = `损坏输入演练：${rejected} 次拒绝`;
  dom.jsonInput.value =
    typeof corruptPayloads[0].value === "string"
      ? corruptPayloads[0].value
      : JSON.stringify(corruptPayloads[0].value, null, 2);
  renderStats();
  renderLayers();
  renderErrors();
  drawAll();
  notify(
    unchanged && unexpectedSuccess === 0
      ? `损坏输入已拒绝 ${rejected}/12；异常已记录，画布未修改。`
      : "损坏输入演练未通过一致性检查，请查看异常日志。",
    { error: true, timeout: 6000 },
  );
}

function startFrameLoop() {
  if (state.frameHandle || session.state !== "open") return;
  state.lastFrame = performance.now();
  const frame = (now) => {
    state.frameHandle = 0;
    if (session.state !== "open") return;
    const delta = Math.max(1, now - state.lastFrame);
    state.lastFrame = now;
    const instantFps = Math.min(144, 1000 / delta);
    state.fps = state.fps * 0.9 + instantFps * 0.1;
    if (state.fps < 25) {
      state.lowFpsSeconds += delta / 1000;
      state.healthyFpsSeconds = 0;
    } else if (state.fps > 50) {
      state.healthyFpsSeconds += delta / 1000;
      state.lowFpsSeconds = 0;
    }
    if (!state.autoReduced && state.lowFpsSeconds >= 3) {
      state.autoReduced = true;
      refreshMode();
      notify("帧率持续偏低，已切换到低细节；导出内容不受影响。");
    } else if (state.autoReduced && state.healthyFpsSeconds >= 5) {
      state.autoReduced = false;
      refreshMode();
      notify("帧率已恢复，渲染切回完整模式。");
    }
    refreshMode();
    drawAll();
    state.frameHandle = requestAnimationFrame(frame);
  };
  state.frameHandle = requestAnimationFrame(frame);
}

function stopFrameLoop() {
  if (state.frameHandle) cancelAnimationFrame(state.frameHandle);
  state.frameHandle = 0;
}

function openEditor({ silent = false } = {}) {
  if (session.state === "open") {
    resizeStage();
    refreshMode();
    renderStats();
    renderLayers();
    drawAll();
    return true;
  }
  try {
    session.open();
    resizeStage();
    bindSessionInput();
    refreshMode();
    dom.toggleSession.textContent = "关闭画布";
    dom.statusText.textContent = "编辑就绪";
    renderStats();
    renderLayers();
    renderErrors();
    drawAll();
    startFrameLoop();
    if (!silent) notify("画布已重新打开；对象与增量撤销状态已恢复。");
    return true;
  } catch (error) {
    showFailure(error, "打开画布", { journaled: false });
    return false;
  }
}

function closeEditor({ silent = false } = {}) {
  if (session.state !== "open") return true;
  try {
    state.draft = null;
    state.drag = null;
    const report = session.close();
    state.lastClose = report;
    stopFrameLoop();
    dom.toggleSession.textContent = "打开画布";
    dom.statusText.textContent = "画布已关闭，资源已释放";
    renderStats();
    renderLayers();
    renderErrors();
    if (!silent) {
      notify(
        `关闭完成：画布 ${report.before.canvases}→${report.after.canvases}，` +
          `监听 ${report.before.listeners}→${report.after.listeners}，` +
          `撤销 ${report.after.historyEntries} 项保留。`,
      );
    }
    return true;
  } catch (error) {
    showFailure(error, "关闭画布", { journaled: false });
    return false;
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function runStressTest() {
  if (state.stressRunning) return;
  state.stressRunning = true;
  dom.stressButton.disabled = true;
  dom.stressButton.textContent = "开关测试进行中…";
  const started = performance.now();
  const signature = session.exportSignature();
  const reports = [];
  let peak = 0;
  try {
    if (session.state !== "open" && !openEditor({ silent: true })) {
      throw new Error("无法打开画布进行压力测试");
    }
    if (session.state === "open") closeEditor({ silent: true });
    for (let cycle = 0; cycle < 20; cycle += 1) {
      if (!openEditor({ silent: true })) throw new Error(`第 ${cycle + 1} 轮打开失败`);
      resizeStage();
      for (const shape of session.model.objects.slice(0, LIMITS.cacheEntries)) {
        session.getPreview(shape, drawThumbnail);
      }
      peak = Math.max(peak, session.memorySnapshot().memoryEstimateBytes);
      drawAll();
      renderStats();
      await nextFrame();
      if (!closeEditor({ silent: true })) throw new Error(`第 ${cycle + 1} 轮关闭失败`);
      reports.push(session.lastCloseReport);
      await nextFrame();
    }
    const finalClose = reports.at(-1);
    const after = finalClose.after;
    await nextFrame();
    openEditor({ silent: true });
    const unchanged = signature === session.exportSignature();
    state.lastClose = finalClose;
    dom.lastCloseNote.textContent =
      `20 轮完成 · 最终关闭后画布 ${after.canvases} / 监听 ${after.listeners} / ` +
      `缓存 ${after.cacheEntries}`;
    dom.statusText.textContent = "20 轮开关测试完成";
    renderStats();
    renderLayers();
    drawAll();
    notify(
      `20 轮完成：关闭后画布 ${after.canvases}、监听 ${after.listeners}、` +
        `缓存 ${after.cacheEntries}；峰值 ${formatBytes(peak)}；` +
        `场景${unchanged ? "未变化" : "发生变化"}。`,
      { error: !unchanged, timeout: 6500 },
    );
  } catch (error) {
    showFailure(error, "开关压力测试", { journaled: false });
  } finally {
    state.stressRunning = false;
    dom.stressButton.disabled = false;
    dom.stressButton.textContent = "运行 20 轮打开/关闭测试";
    if (session.state !== "open") openEditor({ silent: true });
    renderStats();
    dom.fpsValue.title = `测试耗时 ${formatDuration(performance.now() - started)}`;
  }
}

function bindUi() {
  for (const button of document.querySelectorAll("[data-tool]")) {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  }
  dom.toggleSession.addEventListener("click", () => {
    if (session.state === "open") closeEditor();
    else openEditor();
  });
  $("undoButton").addEventListener("click", undo);
  $("redoButton").addEventListener("click", redo);
  $("exportButton").addEventListener("click", downloadJson);
  $("deleteButton").addEventListener("click", deleteSelection);
  $("clearSelectionButton").addEventListener("click", () => {
    if (session.state !== "open") return;
    session.model.clearSelection();
    renderStats();
    renderLayers();
    drawAll();
  });
  dom.stressButton.addEventListener("click", runStressTest);
  for (const button of document.querySelectorAll("[data-scenario]")) {
    button.addEventListener("click", () => {
      if (button.dataset.scenario === "corrupt") runCorruptDrill();
      else importScenario(button.dataset.scenario);
    });
  }
  $("loadJsonButton").addEventListener("click", () => {
    const text = dom.jsonInput.value.trim();
    if (!text) {
      notify("请输入 JSON 后再导入。", { error: true });
      return;
    }
    runAction("导入自定义 JSON", () => session.importDocument(text), {
      successMessage: "自定义 JSON 已导入。",
    });
  });
  $("loadCurrentButton").addEventListener("click", () => {
    dom.jsonInput.value = JSON.stringify(session.exportDocument(), null, 2);
    notify("当前场景已填入输入框，可用于对照导出内容。");
  });
  $("clearErrorsButton").addEventListener("click", () => {
    const entries = session.errors.entries;
    state.hiddenErrorCutoff = entries.length ? entries[entries.length - 1].id : 0;
    renderErrors();
    notify("已折叠当前日志视图；会话错误计数与完整栈仍保留。");
  });
  $("diagnosticsJump").addEventListener("click", () => {
    $("diagnosticsPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  dom.modeBadge.addEventListener("click", () => {
    if (session.state !== "open") return;
    state.forceReduced = !state.forceReduced;
    refreshMode();
    renderStats();
    drawAll();
    notify(
      state.forceReduced
        ? "已手动切换到低细节；导出数据与完整模式一致。"
        : "已恢复自动模式选择。",
    );
  });
  dom.modeBadge.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dom.modeBadge.click();
    }
  });
  window.addEventListener("beforeunload", () => {
    if (session.state === "open") session.close();
  });
}

function init() {
  bindUi();
  setTool("select");
  openEditor({ silent: true });
  state.statsTimer = window.setInterval(() => {
    renderStats();
    if (session.state === "open") renderLayers();
    renderErrors();
  }, 500);
}

init();
