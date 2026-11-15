import {
  SceneLoader,
  clone,
  countNodes,
  findNode,
  findParent,
  validateScene,
} from "../core/model.js";
import { CacheEngine, exportScene } from "../core/engine.js";
import {
  CORRUPTED_INPUTS,
  VIEWPORT,
  buildBoundaryScene,
  buildNormalScene,
} from "../core/scenarios.js";
import { compareVerificationRuns, runVerification } from "../core/verify.js";
import {
  canvasPoint,
  drawCommands,
  drawSelection,
  hitTest,
  renderPng,
  resizeCanvas,
} from "./canvas.js";

const byId = (id) => document.getElementById(id);
const dom = {
  canvas: byId("editor-canvas"),
  layerTree: byId("layer-tree"),
  nodeCount: byId("node-count"),
  sceneName: byId("scene-name"),
  sceneSelect: byId("scene-select"),
  editedPill: byId("edited-pill"),
  statusStrip: byId("status-strip"),
  statusMode: byId("status-mode"),
  statusElapsed: byId("status-elapsed"),
  statusHit: byId("status-hit"),
  statusRecovery: byId("status-recovery"),
  footerMode: byId("footer-mode"),
  footerResource: byId("footer-resource"),
  footerStatus: byId("footer-status"),
  metricHitRate: byId("metric-hit-rate"),
  metricHitCount: byId("metric-hit-count"),
  metricRecomputes: byId("metric-recomputes"),
  metricRecomputeSplit: byId("metric-recompute-split"),
  metricEdges: byId("metric-edges"),
  metricEntries: byId("metric-entries"),
  metricBytes: byId("metric-bytes"),
  metricInvalidated: byId("metric-invalidated"),
  inspectorForm: byId("inspector-form"),
  emptySelection: byId("empty-selection"),
  selectionType: byId("selection-type"),
  selectionName: byId("selection-name"),
  selectionId: byId("selection-id"),
  fieldX: byId("field-x"),
  fieldY: byId("field-y"),
  fieldWidth: byId("field-width"),
  fieldHeight: byId("field-height"),
  fieldFill: byId("field-fill"),
  fieldText: byId("field-text"),
  fieldFontSize: byId("field-font-size"),
  fieldFontWeight: byId("field-font-weight"),
  fieldVisible: byId("field-visible"),
  verifyNote: byId("verify-note"),
  verifySummary: byId("verify-summary"),
  comparisonList: byId("comparison-list"),
  errorLog: byId("error-log"),
  errorCount: byId("error-count"),
  logCaption: byId("log-caption"),
  recoverButton: byId("recover-button"),
  exportJson: byId("export-json"),
  exportPng: byId("export-png"),
  verifyButton: byId("verify-button"),
  toast: byId("toast"),
  canvasHint: byId("canvas-hint"),
};

const state = {
  scene: null,
  engine: new CacheEngine({ mode: "fixed" }),
  mode: "fixed",
  selectedId: "root",
  sceneKind: "normal",
  renderResult: null,
  errors: [],
  verification: null,
  verificationErrors: [],
  verificationElapsed: 0,
  repeatable: null,
  recovered: false,
  recoveredConfirmed: false,
  dirty: false,
  logSequence: 0,
  addSequence: 0,
  toastTimer: null,
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function modeLabel(mode = state.mode) {
  return mode === "fixed" ? "Fixed dependency cache" : "Legacy repro cache";
}

function showToast(message, { error = false, duration = 4600 } = {}) {
  clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle("is-error", error);
  dom.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, duration);
}

function editorError(message, code = "INVALID_EDIT") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function recordError(error, source, recovery) {
  state.logSequence += 1;
  const entry = {
    sequence: state.logSequence,
    at: new Date().toISOString(),
    code: error.code ?? "UI_RUNTIME_ERROR",
    name: error.name ?? "Error",
    message: error.message,
    source,
    recovery,
  };
  state.errors.unshift(entry);
  console.error(`[${entry.code}] ${entry.source}: ${entry.message}`);
  renderErrorLog();
  updateStatusStrip();
  return entry;
}

function selectedNode() {
  return state.scene?.root ? findNode(state.scene.root, state.selectedId) : null;
}

function canExport() {
  return !state.recovered || state.recoveredConfirmed;
}

function syncExportAvailability() {
  const enabled = canExport();
  dom.exportJson.disabled = !enabled;
  dom.exportPng.disabled = !enabled;
  dom.exportJson.title = enabled ? "导出场景 JSON" : "安全恢复场景尚未确认，导出已暂停";
  dom.exportPng.title = enabled ? "导出不含选中框的 PNG" : "安全恢复场景尚未确认，导出已暂停";
}

function updateStatusStrip() {
  const metrics = state.renderResult?.metrics;
  const totalErrors = state.errors.length + state.verificationErrors.length;
  const hasProblem = totalErrors > 0 || state.recovered || state.mode === "legacy";
  dom.statusStrip.classList.toggle("is-warning", hasProblem);
  dom.statusMode.textContent = state.recovered
    ? `${modeLabel()} · 安全恢复`
    : modeLabel();
  dom.statusElapsed.textContent = metrics ? `${metrics.elapsedMs.toFixed(2)} ms` : "-- ms";
  dom.statusHit.textContent = metrics ? `${(metrics.hitRate * 100).toFixed(1)}%` : "--%";
  dom.footerMode.textContent = state.mode === "fixed" ? "Fixed" : "Legacy repro";
  if (state.recovered && !state.recoveredConfirmed) {
    dom.statusRecovery.textContent = "恢复建议：损坏输入已拒绝并载入安全场景。检查错误日志后点击“采用安全场景”；导出暂停。";
  } else if (totalErrors > 0) {
    dom.statusRecovery.textContent = "恢复建议：最近错误已记录。可清空缓存重绘、重新加载场景或运行前后对比。";
  } else if (state.mode === "legacy") {
    dom.statusRecovery.textContent = "Legacy 仅用于复现旧图；若结果异常请切回 Fixed，固定模式不会隐藏错误。";
  } else {
    dom.statusRecovery.textContent = "恢复建议：若出现旧图，运行前后对比并清空缓存重绘；错误不会被静默忽略。";
  }
}

function updateMetrics() {
  const result = state.renderResult;
  if (!result) return;
  const metrics = result.metrics;
  const resources = state.engine.resources();
  dom.metricHitRate.textContent = `${(metrics.hitRate * 100).toFixed(1)}%`;
  dom.metricHitCount.textContent = `${metrics.hits} hits / ${metrics.misses} misses`;
  dom.metricRecomputes.textContent = `${metrics.recomputes}`;
  dom.metricRecomputeSplit.textContent = `layout ${metrics.layoutRecomputes} · draw ${metrics.renderRecomputes}`;
  dom.metricEdges.textContent = `${resources.dependencyEdges}`;
  dom.metricEntries.textContent = `${resources.cacheEntries} cache entries`;
  dom.metricBytes.textContent = formatBytes(resources.cacheBytes);
  dom.metricInvalidated.textContent = `${resources.invalidatedEntries} entries invalidated`;
  dom.footerResource.textContent = `${resources.cacheEntries} entries · ${formatBytes(resources.cacheBytes)} · ${resources.dependencyEdges} dependency edges`;
}

function drawCanvas() {
  if (!state.renderResult) return;
  const context = resizeCanvas(dom.canvas, VIEWPORT);
  drawCommands(context, state.renderResult.commands);
  const layout = state.renderResult.layouts.get(state.selectedId);
  drawSelection(context, layout, VIEWPORT);
}

function renderFrame({ warm = false } = {}) {
  try {
    if (warm) state.engine.render(state.scene, { viewport: VIEWPORT });
    state.renderResult = state.engine.render(state.scene, { viewport: VIEWPORT });
    drawCanvas();
    updateMetrics();
    updateStatusStrip();
  } catch (error) {
    recordError(error, "render", "已清空缓存并改用无缓存路径重绘；请检查日志中的根因。");
    try {
      state.engine.clear();
      state.renderResult = state.engine.render(state.scene, { viewport: VIEWPORT, bypassCache: true });
      drawCanvas();
      updateMetrics();
      updateStatusStrip();
      dom.footerStatus.textContent = "Recovered with uncached render · error retained";
      showToast("缓存渲染失败，已记录错误并用无缓存路径恢复显示。", { error: true });
    } catch (fallbackError) {
      recordError(fallbackError, "render-recovery", "恢复重绘也失败；请重新加载安全场景。");
      dom.statusStrip.classList.add("is-warning");
      dom.statusRecovery.textContent = "恢复建议：恢复重绘失败。请重新加载场景，错误日志已保留。";
    }
  }
}

function renderLayers() {
  if (!state.scene) return;
  dom.layerTree.replaceChildren();
  const fragment = document.createDocumentFragment();
  const addRows = (node, depth) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-row";
    button.dataset.id = node.id;
    if (node.id === state.selectedId) button.classList.add("is-selected");
    if (node.visible === false) button.classList.add("is-hidden");
    const indent = document.createElement("span");
    indent.className = "layer-indent";
    indent.style.width = `${depth * 10}px`;
    const icon = document.createElement("span");
    icon.className = `layer-icon ${node.type === "text" ? "text" : ""}`;
    icon.textContent = node.type === "frame" ? "F" : node.type === "text" ? "T" : "R";
    const label = document.createElement("span");
    label.className = "layer-label";
    label.textContent = node.name || node.id;
    const meta = document.createElement("span");
    meta.className = "layer-meta";
    meta.textContent = node.visible === false ? "hidden" : node.type;
    button.append(indent, icon, label, meta);
    fragment.append(button);
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) addRows(child, depth + 1);
  };
  addRows(state.scene.root, 0);
  dom.layerTree.append(fragment);
  dom.nodeCount.textContent = `${countNodes(state.scene.root)} 节点`;
  dom.sceneName.textContent = state.scene.name || "Untitled";
  dom.editedPill.hidden = !state.dirty;
}

function selectNode(id) {
  if (!findNode(state.scene.root, id)) return;
  state.selectedId = id;
  renderLayers();
  syncInspector();
  drawCanvas();
}

function effectiveFont(node) {
  return state.renderResult?.layouts.get(node.id)?.font ?? { size: 14, weight: 400 };
}

function syncInspector() {
  const node = selectedNode();
  if (!node) {
    dom.inspectorForm.hidden = true;
    dom.emptySelection.hidden = false;
    return;
  }
  dom.inspectorForm.hidden = false;
  dom.emptySelection.hidden = true;
  dom.selectionType.textContent = node.type.toUpperCase();
  dom.selectionName.textContent = node.name || node.id;
  dom.selectionId.textContent = node.id;
  dom.fieldX.value = String(node.x ?? 0);
  dom.fieldY.value = String(node.y ?? 0);
  dom.fieldWidth.value = String(node.width);
  dom.fieldHeight.value = String(node.height);
  dom.fieldFill.value = node.fill ?? "";
  dom.fieldText.value = node.text ?? "";
  dom.fieldText.disabled = node.type !== "text";
  dom.fieldFontSize.value = String(node.font?.size ?? effectiveFont(node).size);
  dom.fieldFontWeight.value = String(node.font?.weight ?? effectiveFont(node).weight);
  dom.fieldVisible.checked = node.visible !== false;
}

function parseCoordinate(raw, label) {
  const value = raw.trim();
  const percent = /^([0-9]{1,3}(?:\.[0-9]+)?)%$/.exec(value);
  if (percent) {
    const amount = Number(percent[1]);
    if (amount >= 0 && amount <= 100) return `${amount}%`;
  }
  const number = Number(value);
  if (Number.isFinite(number) && Math.abs(number) <= 100000) return number;
  throw editorError(`${label} 必须是有限数值或 0–100%`, "INVALID_GEOMETRY");
}

function parseSize(raw, label) {
  const value = raw.trim();
  const percent = /^([0-9]{1,3}(?:\.[0-9]+)?)%$/.exec(value);
  if (percent) {
    const amount = Number(percent[1]);
    if (amount >= 0 && amount <= 100) return `${amount}%`;
  }
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0 && number <= 100000) return number;
  throw editorError(`${label} 必须是非负数值或 0–100%`, "INVALID_GEOMETRY");
}

function applyFieldChange(field, value) {
  const node = selectedNode();
  if (!node) return;
  const before = JSON.stringify(node);
  try {
    if (field === "x" || field === "y") {
      node[field] = parseCoordinate(value, field.toUpperCase());
    } else if (field === "width" || field === "height") {
      node[field] = parseSize(value, field === "width" ? "宽度" : "高度");
    } else if (field === "fill") {
      const fill = value.trim();
      if (fill && !/^[#(),.%\w\s-]+$/.test(fill)) {
        throw editorError("填充值不是合法的 CSS 色彩标记", "INVALID_COLOR");
      }
      if (fill) node.fill = fill;
      else delete node.fill;
    } else if (field === "text") {
      if (node.type !== "text") throw editorError("只有文本节点可以修改文字", "INVALID_TYPE_EDIT");
      if (value.length > 5000) throw editorError("文字不能超过 5000 字符", "CONTENT_TOO_LARGE");
      node.text = value;
    } else if (field === "fontSize") {
      if (value.trim() === "") {
        if (node.font) delete node.font.size;
      } else {
        const size = Number(value);
        if (!Number.isFinite(size) || size <= 0 || size > 500) {
          throw editorError("字体大小必须在 (0, 500] 之间", "INVALID_FONT");
        }
        node.font = { ...(node.font ?? {}), size };
      }
    } else if (field === "fontWeight") {
      if (value.trim() === "") {
        if (node.font) delete node.font.weight;
      } else {
        const weight = Number(value);
        if (!Number.isFinite(weight) || weight < 100 || weight > 900) {
          throw editorError("字重必须在 100–900 之间", "INVALID_FONT");
        }
        node.font = { ...(node.font ?? {}), weight };
      }
    } else if (field === "visible") {
      node.visible = value;
    }
    if (JSON.stringify(node) === before) {
      syncInspector();
      return;
    }
    state.dirty = true;
    state.engine.invalidateSubtree(node);
    renderFrame();
    renderLayers();
    syncInspector();
    dom.footerStatus.textContent = `Invalidated ${node.id} subtree`;
  } catch (error) {
    recordError(error, `inspector:${field}`, "输入未应用，属性面板已恢复到当前场景值。");
    syncInspector();
    showToast(error.message, { error: true });
  }
}

function uniqueNodeId(type) {
  let id;
  do {
    state.addSequence += 1;
    id = `${type}-${state.addSequence}`;
  } while (findNode(state.scene.root, id));
  return id;
}

function addNode(type) {
  const selected = selectedNode();
  const parent = selected?.type === "frame"
    ? selected
    : findParent(state.scene.root, state.selectedId) ?? state.scene.root;
  if (!parent || parent.type !== "frame") {
    recordError(editorError("只能向 frame 节点添加子元素", "INVALID_PARENT"), "add-node", "请选择画板或 frame 后重试。");
    return;
  }
  const node = type === "text"
    ? {
        id: uniqueNodeId("text"),
        type: "text",
        name: "New text",
        x: 24,
        y: 24,
        width: 180,
        height: 28,
        text: "New text",
        font: { size: 16, weight: 600 },
        fill: "#172033",
      }
    : {
        id: uniqueNodeId("rect"),
        type: "rect",
        name: "Rectangle",
        x: 24,
        y: 24,
        width: 140,
        height: 84,
        fill: "#dbe5ff",
        stroke: "#b7c7f5",
        radius: 8,
      };
  parent.children = [...(parent.children ?? []), node];
  state.dirty = true;
  state.engine.invalidateSubtree(parent);
  renderFrame();
  selectNode(node.id);
  dom.footerStatus.textContent = `Added ${node.id}`;
  showToast(`已添加 ${node.id}；仅 ${parent.id} 子树重算。`);
}

function deleteSelectedNode() {
  const node = selectedNode();
  if (!node) return;
  try {
    if (node.id === state.scene.root.id) {
      throw editorError("根节点不能删除", "ROOT_DELETE");
    }
    const parent = findParent(state.scene.root, node.id);
    const result = state.engine.deleteNode(state.scene, node.id);
    state.dirty = true;
    state.selectedId = parent?.id ?? state.scene.root.id;
    renderFrame();
    renderLayers();
    syncInspector();
    dom.footerStatus.textContent = `Deleted ${result.ids.length} node(s) · refs ${result.referencesRemaining}`;
    showToast(`删除 ${result.ids.length} 个节点，释放 ${result.layoutReleased + result.renderReleased} 个缓存条目，剩余引用 ${result.referencesRemaining}。`);
  } catch (error) {
    recordError(error, "delete-node", "节点未删除；请选择非根节点后重试。");
    showToast(error.message, { error: true });
  }
}

function verificationErrors(report) {
  if (!report) return [];
  const groups = report.groups;
  const entries = [
    ...groups.normal.before.errors.map((entry) => ({ ...entry, phase: "修改前", recovery: "旧缓存仅失效目标节点，因此出现旧图；修复后按子树释放。" })),
    ...groups.boundary.before.errors.map((entry) => ({ ...entry, phase: "修改前", recovery: "边界节点未失效后代缓存；修复模式会重算受影响子树。" })),
    ...groups.corrupted.before.errors.map((entry) => ({ ...entry, phase: "修改前", recovery: "旧路径直接拒绝输入，没有安全恢复。" })),
    ...groups.normal.after.errors.map((entry) => ({ ...entry, phase: "修改后", recovery: "修复结果与无缓存参考不一致，请查看对应修改。" })),
    ...groups.boundary.after.errors.map((entry) => ({ ...entry, phase: "修改后", recovery: "修复结果与无缓存参考不一致，请查看对应修改。" })),
    ...groups.corrupted.after.errors.map((entry) => ({ ...entry, phase: "修改后", recovery: "已载入安全场景并暂停导出；检查日志后确认恢复。" })),
  ];
  return entries.map((entry, index) => ({
    ...entry,
    sequence: `V${index + 1}`,
    at: null,
  }));
}

function renderErrorLog() {
  const combined = [...state.errors, ...state.verificationErrors];
  dom.errorCount.textContent = String(combined.length);
  dom.errorCount.classList.toggle("has-errors", combined.length > 0);
  dom.logCaption.textContent = `${combined.length} 条 · 保留异常，不静默吞错`;
  dom.errorLog.replaceChildren();
  if (combined.length === 0) {
    const empty = document.createElement("p");
    empty.className = "log-empty";
    empty.textContent = "当前没有错误。";
    dom.errorLog.append(empty);
    return;
  }
  for (const entry of combined.slice(0, 40)) {
    const article = document.createElement("article");
    article.className = "log-entry";
    const header = document.createElement("header");
    const code = document.createElement("span");
    code.textContent = `#${entry.sequence} ${entry.code}`;
    const source = document.createElement("span");
    source.textContent = entry.phase ? `${entry.phase} · ${entry.source}` : entry.source;
    header.append(code, source);
    const message = document.createElement("p");
    message.textContent = entry.message;
    article.append(header, message);
    if (entry.recovery) {
      const recovery = document.createElement("small");
      recovery.textContent = `恢复：${entry.recovery}`;
      article.append(recovery);
    }
    dom.errorLog.append(article);
  }
}

function summaryCell(label, value, tone = "") {
  const cell = document.createElement("div");
  cell.className = `summary-cell ${tone}`;
  const caption = document.createElement("span");
  caption.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  cell.append(caption, content);
  return cell;
}

function comparisonSide(title, lines) {
  const side = document.createElement("div");
  side.className = "comparison-side";
  const heading = document.createElement("strong");
  heading.textContent = title;
  side.append(heading);
  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line;
    side.append(row);
  }
  return side;
}

function comparisonCard(title, pillText, pillTone, beforeLines, afterLines) {
  const card = document.createElement("article");
  card.className = "comparison-card";
  const header = document.createElement("header");
  const heading = document.createElement("span");
  heading.textContent = title;
  const pill = document.createElement("span");
  pill.className = `result-pill ${pillTone}`;
  pill.textContent = pillText;
  header.append(heading, pill);
  const body = document.createElement("div");
  body.className = "comparison-body";
  body.append(
    comparisonSide("修改前 · Legacy", beforeLines),
    comparisonSide("修改后 · Fixed", afterLines),
  );
  card.append(header, body);
  return card;
}

function describeResources(resources) {
  return `${resources.cacheEntries} entries · ${formatBytes(resources.cacheBytes)} · ${resources.dependencyEdges} edges`;
}

function renderVerification() {
  const report = state.verification;
  if (!report) return;
  const { normal, boundary, corrupted } = report.groups;
  const normalMatches = normal.after.cases.filter((item) => item.matchesReference).length;
  const staleCount = normal.before.cases.filter((item) => item.stale).length;
  dom.verifySummary.hidden = false;
  dom.verifySummary.replaceChildren(
    summaryCell("正常修改", `${normalMatches}/3 与参考一致`, normalMatches === 3 ? "is-good" : "is-bad"),
    summaryCell("边界输入", boundary.after.matchesReference ? "与参考一致" : "仍不一致", boundary.after.matchesReference ? "is-good" : "is-bad"),
    summaryCell("损坏恢复", corrupted.after.finalResult.recovered ? "安全恢复 + 日志" : "未恢复", corrupted.after.finalResult.recovered ? "is-good" : "is-bad"),
    summaryCell("失败可重复", state.repeatable ? "是" : "否", state.repeatable ? "is-good" : "is-bad"),
  );

  dom.comparisonList.replaceChildren(
    comparisonCard(
      "正常输入 · 尺寸 / 字体 / 隐藏",
      staleCount === 3 ? "旧图 3/3" : `旧图 ${staleCount}/3`,
      staleCount > 0 ? "bad" : "good",
      [
        `旧图结果 ${staleCount}/3`,
        `异常日志 ${normal.before.errors.length}`,
        describeResources(normal.before.resources),
      ],
      [
        `参考一致 ${normalMatches}/3`,
        `异常日志 ${normal.after.errors.length}`,
        describeResources(normal.after.resources),
      ],
    ),
    comparisonCard(
      "边界输入 · 247 节点 / 5000 字符 / 隐藏",
      boundary.before.matchesReference ? "一致" : "旧图",
      boundary.before.matchesReference ? "good" : "bad",
      [
        `${boundary.before.finalResult.recomputes} recomputes`,
        `异常日志 ${boundary.before.errors.length}`,
        describeResources(boundary.before.resources.after),
      ],
      [
        `${boundary.after.finalResult.recomputes} recomputes`,
        `异常日志 ${boundary.after.errors.length}`,
        describeResources(boundary.after.resources.after),
      ],
    ),
    comparisonCard(
      "损坏输入 · 3 个可重复夹具",
      "拒绝输入",
      "bad",
      [
        `结果 ${corrupted.before.finalResult.outcome}`,
        `异常日志 ${corrupted.before.errors.length}`,
        describeResources(corrupted.before.resources),
      ],
      [
        `结果 ${corrupted.after.finalResult.outcome}`,
        `异常日志 ${corrupted.after.errors.length}`,
        describeResources(corrupted.after.resources),
      ],
    ),
  );

  dom.verifyNote.textContent = `耗时 ${state.verificationElapsed.toFixed(1)} ms · 两次执行结果${state.repeatable ? "一致" : "不一致"} · 导出暂停只用于恢复场景，目的是避免把替代内容当成原文件。`;
  dom.footerStatus.textContent = `Verification ${state.verificationElapsed.toFixed(1)} ms · repeatable=${state.repeatable}`;
}

function runComparison() {
  dom.verifyButton.disabled = true;
  dom.verifyNote.textContent = "正在执行正常、边界、损坏三组输入，并重复一次检查可重复性…";
  const started = performance.now();
  try {
    const first = runVerification();
    const second = runVerification();
    state.verification = first;
    state.repeatable = compareVerificationRuns(first, second);
    state.verificationElapsed = performance.now() - started;
    state.verificationErrors = verificationErrors(first);
    renderVerification();
    renderErrorLog();
    updateStatusStrip();
    showToast(`验证完成：${state.verificationElapsed.toFixed(1)} ms，可重复=${state.repeatable}；修改后仍保留 ${first.summary.afterErrorCount} 条恢复日志。`);
  } catch (error) {
    recordError(error, "verification", "验证未完成；报告不标记成功，请查看日志后重试。");
    dom.verifyNote.textContent = "验证失败，未生成成功标记。请查看错误日志后重试。";
    showToast("验证失败，错误已保留。", { error: true });
  } finally {
    dom.verifyButton.disabled = false;
  }
}

function adoptRecoveryErrors(loaded) {
  for (const item of loaded.errors) {
    state.logSequence += 1;
    state.errors.unshift({
      sequence: state.logSequence,
      at: item.at,
      code: item.code,
      name: "SceneValidationError",
      message: item.message,
      source: "scene-loader",
      recovery: item.recovery,
    });
  }
}

function loadScene(kind) {
  state.sceneKind = kind;
  state.recovered = false;
  state.recoveredConfirmed = false;
  state.dirty = false;
  state.selectedId = "root";
  state.renderResult = null;
  try {
    if (kind === "corrupted") {
      const loader = new SceneLoader(buildNormalScene(), console);
      const loaded = loader.load(CORRUPTED_INPUTS[1].input);
      state.scene = loaded.scene;
      state.recovered = loaded.recovered;
      adoptRecoveryErrors(loaded);
    } else {
      state.scene = kind === "boundary" ? buildBoundaryScene() : buildNormalScene();
      validateScene(state.scene);
    }
    state.engine = new CacheEngine({ mode: state.mode });
    state.selectedId = state.scene.root.id;
    dom.sceneSelect.value = kind;
    renderFrame({ warm: true });
    renderLayers();
    syncInspector();
    syncExportAvailability();
    dom.recoverButton.hidden = !state.recovered;
    dom.canvasHint.textContent = state.recovered
      ? "损坏输入已拒绝；当前为安全场景。错误日志保留，导出暂停。"
      : state.mode === "legacy"
        ? "Legacy repro：修改父级尺寸、字体或隐藏状态后可能看到旧图。"
        : "选择图层后，在右侧修改父元素尺寸、字体或可见性。";
    renderErrorLog();
    updateStatusStrip();
    dom.footerStatus.textContent = state.recovered ? "Safe scene active · export paused" : "Ready";
  } catch (error) {
    recordError(error, `load:${kind}`, "场景未载入；请选择正常场景或查看日志。");
    showToast("场景载入失败，错误已记录。", { error: true });
  }
}

function confirmRecovery() {
  if (!state.recovered) return;
  state.recoveredConfirmed = true;
  dom.recoverButton.hidden = true;
  syncExportAvailability();
  updateStatusStrip();
  dom.statusRecovery.textContent = "安全场景已确认。原始损坏输入仍保留在错误日志中；导出现在使用已确认的安全场景。";
  dom.footerStatus.textContent = "Safe scene confirmed · errors retained";
  showToast("已确认使用安全场景；错误日志和资源计数仍保留。");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJsonScene() {
  if (!canExport()) {
    showToast("安全恢复场景尚未确认，导出已暂停。", { error: true });
    return;
  }
  try {
    const blob = new Blob([exportScene(state.scene)], { type: "application/json" });
    downloadBlob(blob, `${state.sceneKind}-scene.json`);
    showToast(`已导出 JSON：${blob.size} B；内容与缓存模式无关。`);
  } catch (error) {
    recordError(error, "export-json", "导出未完成，场景未被修改。");
    showToast("JSON 导出失败，错误已记录。", { error: true });
  }
}

async function exportPngScene() {
  if (!canExport()) {
    showToast("安全恢复场景尚未确认，导出已暂停。", { error: true });
    return;
  }
  try {
    const commands = state.renderResult?.commands ?? [];
    const blob = await renderPng(commands, VIEWPORT);
    downloadBlob(blob, `${state.sceneKind}-canvas.png`);
    showToast(`已导出 PNG：${formatBytes(blob.size)}，不含选中框等编辑叠层。`);
  } catch (error) {
    recordError(error, "export-png", "PNG 未导出；可先运行对比并修复渲染错误。");
    showToast("PNG 导出失败，错误已记录。", { error: true });
  }
}

function setMode(mode) {
  if (mode !== "fixed" && mode !== "legacy") return;
  state.mode = mode;
  state.engine = new CacheEngine({ mode });
  for (const button of document.querySelectorAll("[data-mode]")) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  renderFrame({ warm: true });
  syncInspector();
  updateStatusStrip();
  dom.canvasHint.textContent = mode === "legacy"
    ? "Legacy repro：修改父级尺寸、字体或隐藏状态后可能看到旧图。"
    : "Fixed：缓存键包含祖先几何、继承字体和可见性，删除会清理引用。";
  dom.footerStatus.textContent = `${mode === "fixed" ? "Fixed" : "Legacy repro"} mode · cache rebuilt`;
  showToast(mode === "legacy"
    ? "已切换 Legacy repro，用于复现旧图；导出内容基于当前场景数据。"
    : "已切换 Fixed，受影响子树会完整失效。");
}

function showTab(name) {
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  byId("inspector-pane").hidden = name !== "inspector";
  byId("verify-pane").hidden = name !== "verify";
}

function downloadVerificationReport() {
  if (!state.verification) {
    showToast("请先运行前后对比。", { error: true });
    return;
  }
  const payload = {
    ...state.verification,
    verificationElapsedMs: state.verificationElapsed,
    repeatable: state.repeatable,
    runtimeErrors: state.errors,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, "cache-verification-report.json");
  showToast(`验证报告已导出：${formatBytes(blob.size)}。`);
}

function bindEvents() {
  dom.layerTree.addEventListener("click", (event) => {
    const row = event.target.closest(".layer-row");
    if (row) selectNode(row.dataset.id);
  });
  dom.canvas.addEventListener("click", (event) => {
    const point = canvasPoint(dom.canvas, event, VIEWPORT);
    const id = hitTest(state.renderResult?.layouts ?? new Map(), point);
    if (id) selectNode(id);
  });
  dom.inspectorForm.addEventListener("submit", (event) => event.preventDefault());
  dom.inspectorForm.addEventListener("change", (event) => {
    const field = event.target.name;
    if (!field) return;
    applyFieldChange(field, event.target.type === "checkbox" ? event.target.checked : event.target.value);
  });
  byId("add-rect").addEventListener("click", () => addNode("rect"));
  byId("add-text").addEventListener("click", () => addNode("text"));
  byId("delete-node").addEventListener("click", deleteSelectedNode);
  byId("delete-inspector").addEventListener("click", deleteSelectedNode);
  byId("select-parent").addEventListener("click", () => {
    const parent = findParent(state.scene.root, state.selectedId);
    if (parent) selectNode(parent.id);
    else showToast("当前已是根节点。");
  });
  dom.sceneSelect.addEventListener("change", () => loadScene(dom.sceneSelect.value));
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  }
  dom.verifyButton.addEventListener("click", () => {
    runComparison();
    showTab("verify");
  });
  dom.recoverButton.addEventListener("click", confirmRecovery);
  dom.exportJson.addEventListener("click", exportJsonScene);
  dom.exportPng.addEventListener("click", exportPngScene);
  byId("download-report").addEventListener("click", downloadVerificationReport);
  window.addEventListener("resize", drawCanvas);
  window.addEventListener("error", (event) => {
    recordError(event.error ?? new Error(event.message), "window", "界面收到未捕获错误；错误日志已保留。");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    recordError(error, "unhandled-promise", "异步操作失败；错误日志已保留。");
  });
}

function init() {
  bindEvents();
  renderErrorLog();
  syncExportAvailability();
  loadScene("normal");
}

init();
