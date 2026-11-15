import {
  LIMITS,
  PALETTES,
  addLayer,
  applyPalette,
  cloneState,
  getSelectedLayer,
  loadState,
  moveLayer,
  recordExport,
  removeLayer,
  saveState,
  selectLayer,
  toggleAudioStep,
  updateAudio,
  updateBackground,
  updateLayer,
  updateProjectName,
  METRICS_KEY,
  STORAGE_KEY
} from "./model.js";
import {
  createMetrics,
  formatMetric,
  formatRate,
  lastFailure,
  overallRate,
  recordMetric,
  sanitizeMetrics
} from "./metrics.js";
import { FaultInjector, ModuleBoundary, ResourceRegistry } from "./error-boundary.js";
import { AudioEngine } from "./audio-engine.js";
import { ExportController } from "./export.js";
import { drawScene, getLayerBounds, hitTest, pointerToCanvas } from "./render.js";
import { mergeTestSummaries, runAcceptanceSuite } from "./acceptance.js";

const $ = (scope, selector) => scope.querySelector(selector);
const $$ = (scope, selector) => [...scope.querySelectorAll(selector)];

function isEditingField(element) {
  return Boolean(element?.closest?.("input, textarea, select, dialog"));
}

function timeLabel(iso) {
  if (!iso) return "尚未保存";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(iso));
  } catch {
    return "时间未知";
  }
}

function bytesLabel(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

export class StudioApp {
  constructor(options = {}) {
    this.doc = options.document || globalThis.document;
    this.root = options.root || this.doc;
    this.storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    this.contextFactory = options.contextFactory;
    this.downloadDelivery = options.downloadDelivery;
    this.canvasFactory = options.canvasFactory || (() => this.doc.createElement("canvas"));
    this.audioFactory = options.audioFactory;
    this.testing = false;
    this.testRunning = false;
    this.testSummary = { total: 0, passed: 0, failed: 0, suites: {} };
    this.saveTimer = null;
    this.previewFrame = null;
    this.drag = null;
    this.preExportSnapshot = null;
    this.preExportMeta = null;
    this.loadSource = "new";
    this.storageBlocked = false;
    this.lastSavedAt = null;
    this.imageResources = new ResourceRegistry("image");
    this.el = this.collectElements();
    this.loadProject();
    this.faults = new FaultInjector(() => this.renderFaultState());
    this.initModules();
    this.bindEvents();
    this.initStaticUI();
    this.renderAll();
    this.renderRestoreNotice();
  }

  collectElements() {
    const selectors = [
      "saveStatus", "healthSummary", "revisionValue", "layerCountValue", "exportCountValue",
      "canvasFrame", "studioCanvas", "canvasStatus", "renderState", "selectionReadout",
      "layerList", "layerEmpty", "layerCountBadge", "selectionInspector", "editorFields",
      "layerNameInput", "layerTextInput", "layerWidthInput", "layerHeightInput",
      "layerSizeInput", "layerColorInput", "textField", "shapeFields", "positionReadout",
      "grainRange", "grainOutput", "vignetteRange", "vignetteOutput", "applyImage",
      "restoreRender", "imageStatus", "imageHealth", "imageError", "audioError", "exportError",
      "audioHealth", "exportHealth", "waveformBars", "audioTime", "stepGrid",
      "waveformSelect", "volumeRange", "volumeOutput", "playAudio", "stopAudio",
      "audioStatus", "audioResources", "projectNameInput", "exportJson", "exportPng",
      "exportGuard", "restorePreExport", "exportHistory", "exportHistoryCount",
      "exportStatus", "successRate", "successDetail", "rateFill", "metricImage",
      "metricImageRate", "metricAudio", "metricAudioRate", "metricExport",
      "metricExportRate", "failureReason", "clearStats", "lastSavedMeta",
      "testSummary", "defaultResult", "boundaryResult", "errorResult", "runAllTests",
      "testRunState", "testLog", "faultStatus", "a11yDialog", "openA11y", "closeA11y",
      "dismissA11y", "announcer", "projectTitle"
    ];
    return Object.fromEntries(selectors.map((id) => [id, this.doc.getElementById(id)]));
  }

  loadProject() {
    let storage = this.storage;
    try {
      storage = this.storage || globalThis.localStorage;
    } catch {
      storage = null;
    }
    const loaded = loadState(storage);
    this.storage = storage;
    this.state = loaded.state;
    this.loadSource = loaded.source;
    if (loaded.source === "corrupt" && storage) {
      try {
        storage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, loaded.raw);
        this.storageBlocked = false;
      } catch {
        this.storageBlocked = true;
      }
    } else if (loaded.source === "storage-error") {
      this.storageBlocked = true;
    }
    this.metrics = this.loadMetrics();
  }

  loadMetrics() {
    try {
      const raw = this.storage?.getItem(METRICS_KEY);
      return raw ? sanitizeMetrics(JSON.parse(raw)) : createMetrics();
    } catch {
      return createMetrics();
    }
  }

  initModules() {
    const cleanup = {
      image: () => this.imageResources.cleanupAll(),
      audio: () => this.audio?.stopAll("boundary-cleanup"),
      export: () => this.exportController?.dispose()
    };
    this.boundaries = {
      image: new ModuleBoundary({
        id: "image",
        label: "图像处理",
        cleanup: cleanup.image,
        onChange: () => this.onBoundaryChange("image")
      }),
      audio: new ModuleBoundary({
        id: "audio",
        label: "音频合成",
        cleanup: cleanup.audio,
        onChange: () => this.onBoundaryChange("audio")
      }),
      export: new ModuleBoundary({
        id: "export",
        label: "导出",
        cleanup: cleanup.export,
        onChange: () => this.onBoundaryChange("export")
      })
    };
    const audioOptions = {
      contextFactory: this.contextFactory,
      onStateChange: (snapshot) => this.onAudioState(snapshot),
      onStep: (step) => this.onAudioStep(step)
    };
    this.audio = this.audioFactory ? this.audioFactory(audioOptions) : new AudioEngine(audioOptions);
    this.exportController = new ExportController({
      delivery: this.downloadDelivery
    });
  }

  initStaticUI() {
    const bars = Array.from({ length: 34 }, (_, index) => {
      const height = 18 + Math.round(Math.abs(Math.sin((index + 2) * 1.7)) * 72);
      return `<i style="--height:${height}%;--delay:${index * 23}ms"></i>`;
    }).join("");
    this.el.waveformBars.innerHTML = bars;
    this.el.stepGrid.innerHTML = Array.from({ length: 8 }, (_, index) => {
      const note = 28 + Math.round(Math.abs(Math.sin(index * 2.2)) * 58);
      return `<button class="step" type="button" data-step="${index}" aria-pressed="false" aria-label="第 ${index + 1} 步" style="--note:${note}%">${index + 1}</button>`;
    }).join("");
  }

  renderRestoreNotice() {
    const source = this.loadSource;
    if (source === "restored") {
      this.el.saveStatus.textContent = `已恢复本地工程 · rev ${this.state.revision}`;
      this.el.saveStatus.className = "save-status is-saved";
      this.announce(`已恢复本地工程，修订 ${this.state.revision}，当前选择为${getSelectedLayer(this.state)?.name || "无"}。`);
    } else if (source === "corrupt") {
      this.el.saveStatus.textContent = "原快照损坏，已另存备份";
      this.el.saveStatus.className = "save-status";
      this.announce("本地工程快照损坏，已保留原始备份，当前使用新工程。");
    } else if (source === "storage-error") {
      this.el.saveStatus.textContent = "本地存储不可用";
      this.el.saveStatus.className = "save-status";
      this.announce("本地存储不可用，当前编辑仅在本次页面有效。");
    } else {
      this.el.saveStatus.textContent = "新工程 · 自动保存已开启";
      this.el.saveStatus.className = "save-status is-saved";
    }
  }

  bindEvents() {
    const on = (target, type, handler, options) => target?.addEventListener(type, handler, options);

    for (const button of $$(this.root, "[data-add]")) {
      on(button, "click", () => this.addNewLayer(button.dataset.add));
    }

    on(this.el.studioCanvas, "keydown", (event) => this.handleCanvasKeydown(event));
    on(this.el.studioCanvas, "pointerdown", (event) => this.handlePointerDown(event));
    on(this.el.studioCanvas, "pointermove", (event) => this.handlePointerMove(event));
    on(this.el.studioCanvas, "pointerup", (event) => this.handlePointerUp(event));
    on(this.el.studioCanvas, "pointercancel", (event) => this.handlePointerUp(event));

    on(this.el.layerList, "click", (event) => {
      const deleteButton = event.target.closest("[data-delete-layer]");
      if (deleteButton) {
        this.deleteSelectedLayer(deleteButton.dataset.deleteLayer);
        return;
      }
      const selectButton = event.target.closest("[data-select-layer]");
      if (selectButton) this.selectLayerById(selectButton.dataset.selectLayer, "图层列表");
    });

    on(this.root, "click", (event) => {
      const nudge = event.target.closest("[data-nudge]");
      if (nudge) this.nudgeSelected(nudge.dataset.nudge);
    });

    on(this.root, "click", (event) => {
      const palette = event.target.closest("[data-preset]");
      if (palette) this.choosePalette(palette.dataset.preset);
      const retry = event.target.closest("[data-retry]");
      if (retry) this.retryModule(retry.dataset.retry);
      const fault = event.target.closest("[data-fault]");
      if (fault) {
        this.faults.arm(fault.dataset.fault);
        this.announce(`已注入一次性${this.moduleLabel(fault.dataset.fault)}故障。执行对应操作可验证恢复。`);
      }
      const suite = event.target.closest("[data-run-suite]");
      if (suite) this.runSuite(suite.dataset.runSuite);
    });

    on(this.el.grainRange, "input", (event) => {
      this.setState(updateBackground(this.state, { grain: Number(event.target.value) }), { mode: "canvas" });
    });
    on(this.el.vignetteRange, "input", (event) => {
      this.setState(updateBackground(this.state, { vignette: Number(event.target.value) }), { mode: "canvas" });
    });
    on(this.el.applyImage, "click", () => this.applyImageAction());
    on(this.el.restoreRender, "click", () => this.retryModule("image"));

    on(this.el.layerNameInput, "input", (event) => {
      this.updateSelected({ name: event.target.value }, false);
    });
    on(this.el.layerTextInput, "input", (event) => {
      this.updateSelected({ text: event.target.value }, false);
    });
    on(this.el.layerWidthInput, "input", (event) => {
      this.updateSelected({ width: Number(event.target.value) }, false);
    });
    on(this.el.layerHeightInput, "input", (event) => {
      this.updateSelected({ height: Number(event.target.value) }, false);
    });
    on(this.el.layerSizeInput, "input", (event) => {
      this.updateSelected({ size: Number(event.target.value) }, false);
    });
    on(this.el.layerColorInput, "input", (event) => {
      this.updateSelected({ fill: event.target.value }, false);
    });

    on(this.el.waveformSelect, "change", (event) => {
      const next = updateAudio(this.state, { waveform: event.target.value });
      this.audio.stopAll("waveform-change");
      this.setState(next);
      this.announce(`波形已切换为${event.target.selectedOptions?.[0]?.text || event.target.value}。`);
    });
    on(this.el.volumeRange, "input", (event) => {
      this.setState(updateAudio(this.state, { volume: Number(event.target.value) }), { mode: "silent" });
      this.el.volumeOutput.textContent = `${event.target.value}%`;
    });
    on(this.el.stepGrid, "click", (event) => {
      const step = event.target.closest("[data-step]");
      if (!step) return;
      this.audio.stopAll("pattern-change");
      const next = toggleAudioStep(this.state, Number(step.dataset.step));
      this.setState(next);
      this.announce(`第 ${Number(step.dataset.step) + 1} 步已${next.audio.pattern[Number(step.dataset.step)] ? "开启" : "关闭"}。`);
    });
    on(this.el.playAudio, "click", () => this.playAudioAction());
    on(this.el.stopAudio, "click", () => {
      const stopped = this.audio.stopAll("user-stop");
      this.announce(`音频已停止，释放 ${stopped} 个活动节点。`);
      this.renderAudioState();
    });

    on(this.el.projectNameInput, "input", (event) => {
      const next = updateProjectName(this.state, event.target.value);
      this.setState(next);
      this.el.projectTitle.textContent = next.projectName || "未命名作品";
    });
    on(this.el.exportJson, "click", () => this.exportAction("json"));
    on(this.el.exportPng, "click", () => this.exportAction("png"));
    on(this.el.restorePreExport, "click", () => this.restorePreExportState());

    on(this.el.runAllTests, "click", () => this.runAllSuites());
    on(this.el.clearStats, "click", () => {
      this.metrics = createMetrics();
      this.persistMetrics();
      this.renderMetrics();
      this.announce("运行统计已清除。工程内容与导出记录未改变。");
    });

    on(this.el.openA11y, "click", () => this.el.a11yDialog?.showModal?.());
    on(this.el.closeA11y, "click", () => this.el.a11yDialog?.close?.());
    on(this.el.dismissA11y, "click", () => this.el.a11yDialog?.close?.());

    on(this.doc, "keydown", (event) => this.handleGlobalKey(event));
    on(this.doc, "visibilitychange", () => {
      if (this.doc.visibilityState === "hidden") this.persistState();
    });
    on(this.doc.defaultView || globalThis, "pagehide", () => this.persistState());
  }

  setState(next, options = {}) {
    this.state = next;
    if (!this.testing) this.scheduleSave();
    if (options.mode !== "silent") {
      if (options.mode === "canvas") {
        this.renderCanvas();
        this.renderHeader();
      } else {
        this.renderAll();
      }
    }
    if (options.announce) this.announce(options.announce);
  }

  scheduleSave() {
    this.el.saveStatus.textContent = "保存中…";
    this.el.saveStatus.className = "save-status is-saving";
    if (this.saveTimer) globalThis.clearTimeout?.(this.saveTimer);
    this.saveTimer = globalThis.setTimeout?.(() => this.persistState(), 180);
  }

  persistState() {
    if (this.testing || this.storageBlocked) return;
    if (this.saveTimer) {
      globalThis.clearTimeout?.(this.saveTimer);
      this.saveTimer = null;
    }
    const result = saveState(this.storage, this.state);
    if (result.ok) {
      this.lastSavedAt = result.at;
      this.el.saveStatus.textContent = `已保存 ${timeLabel(result.at)}`;
      this.el.saveStatus.className = "save-status is-saved";
      this.el.lastSavedMeta.textContent = `最后保存 ${timeLabel(result.at)}`;
    } else {
      this.el.saveStatus.textContent = "本地保存失败";
      this.el.saveStatus.className = "save-status";
      this.announce(`本地保存失败：${result.error?.message || "存储不可用"}。当前编辑仍保留在页面中。`);
    }
  }

  persistMetrics() {
    if (this.testing || this.storageBlocked) return;
    try {
      this.storage?.setItem(METRICS_KEY, JSON.stringify(this.metrics));
    } catch {
      // Metrics are secondary to project persistence.
    }
  }

  announce(message) {
    if (!this.el.announcer) return;
    this.el.announcer.textContent = "";
    globalThis.setTimeout?.(() => {
      this.el.announcer.textContent = message;
    }, 20);
  }

  moduleLabel(module) {
    return { image: "图像", audio: "音频", export: "导出" }[module] || module;
  }

  renderAll() {
    this.renderHeader();
    this.renderCanvas();
    this.renderLayers();
    this.renderInspector();
    this.renderImageControls();
    this.renderAudioState();
    this.renderSteps();
    this.renderExportHistory();
    this.renderMetrics();
    for (const module of ["image", "audio", "export"]) this.renderBoundary(module);
    this.renderFaultState();
  }

  renderHeader() {
    const selected = getSelectedLayer(this.state);
    this.el.projectTitle.textContent = this.state.projectName || "未命名作品";
    this.el.revisionValue.textContent = `rev ${this.state.revision}`;
    this.el.layerCountValue.textContent = String(this.state.layers.length);
    this.el.exportCountValue.textContent = String(
      this.state.exports.filter((item) => item.status === "success").length
    );
    this.el.layerCountBadge.textContent = `${this.state.layers.length} LAYER${this.state.layers.length === 1 ? "" : "S"}`;
    if (this.doc.activeElement !== this.el.projectNameInput) {
      this.el.projectNameInput.value = this.state.projectName;
    }
    this.el.selectionReadout.textContent = selected
      ? `${selected.type.toUpperCase()} / ${selected.name}`
      : "未选择图层";
  }

  renderCanvas(options = {}) {
    const boundary = this.boundaries.image;
    const failed = boundary.isFailed;
    const recovered = boundary.state.recovered && !failed;
    const context = this.el.studioCanvas.getContext?.("2d");
    if (!context) {
      this.el.canvasStatus.className = "canvas-badge is-faulted";
      $(this.el.canvasStatus, "span:last-child").textContent = "Canvas 上下文不可用";
      this.el.renderState.textContent = "不可用";
      this.el.renderState.dataset.tone = "error";
      if (options.throwOnError) throw new Error("Canvas 2D 上下文不可用。");
      return;
    }
    try {
      drawScene(context, this.state, {
        failed,
        recovered,
        recoveryMessage: `已恢复 · ${this.state.layers.length} 个图层与文字保留`
      });
      this.el.canvasFrame.classList.toggle("is-faulted", failed);
      this.el.canvasStatus.className = `canvas-badge${failed ? " is-faulted" : recovered ? " is-recovered" : ""}`;
      $(this.el.canvasStatus, "span:last-child").textContent = failed
        ? "图像故障 · 其他编辑已保留"
        : recovered
          ? `已恢复 · ${this.state.layers.length} 个图层保留`
          : `画布已同步 · rev ${this.state.revision}`;
      this.el.renderState.textContent = failed ? "故障" : recovered ? "已恢复" : "已渲染";
      this.el.renderState.dataset.tone = failed ? "error" : recovered ? "success" : "";
    } catch (error) {
      this.el.canvasStatus.className = "canvas-badge is-faulted";
      $(this.el.canvasStatus, "span:last-child").textContent = "画布渲染失败";
      this.el.renderState.textContent = "渲染失败";
      this.el.renderState.dataset.tone = "error";
      if (options.throwOnError) throw error;
    }
  }

  renderLayers() {
    const active = this.doc.activeElement;
    const activeLayerId = active?.closest?.("[data-layer-id]")?.dataset.layerId || null;
    const isFocusInList = this.el.layerList.contains(active);
    this.el.layerList.innerHTML = this.state.layers
      .map((layer) => {
        const selected = layer.id === this.state.selection;
        const shapeClass = layer.type === "circle" ? " is-circle" : layer.type === "text" ? " is-text" : "";
        const swatch = layer.type === "text"
          ? `<span class="layer-swatch is-text" style="color:${encodeURIComponent(layer.fill).replace(/%23/g, "#")}" aria-hidden="true">T</span>`
          : `<span class="layer-swatch${shapeClass}" style="background:${escapeHtml(layer.fill)}" aria-hidden="true"></span>`;
        return `
          <li class="layer-row${selected ? " is-selected" : ""}" data-layer-id="${escapeHtml(layer.id)}">
            <button class="layer-select" type="button" data-select-layer="${escapeHtml(layer.id)}" aria-pressed="${selected}" aria-label="选择${escapeHtml(layer.name)}，${layer.type} 图层">
              ${swatch}
              <span class="layer-copy">
                <strong>${escapeHtml(layer.name)}</strong>
                <small>${layer.type} · x ${Math.round(layer.x)} / y ${Math.round(layer.y)}</small>
              </span>
            </button>
            <button class="layer-delete" type="button" data-delete-layer="${escapeHtml(layer.id)}" aria-label="删除${escapeHtml(layer.name)}">×</button>
          </li>`;
      })
      .join("");
    this.el.layerEmpty.hidden = this.state.layers.length > 0;
    if (isFocusInList && activeLayerId) {
      const row = [...this.el.layerList.querySelectorAll("[data-layer-id]")]
        .find((item) => item.dataset.layerId === activeLayerId);
      row?.querySelector("[data-select-layer]")?.focus({ preventScroll: true });
    }
  }

  renderInspector() {
    const layer = getSelectedLayer(this.state);
    const empty = $(this.el.selectionInspector, ".empty-state");
    this.el.editorFields.hidden = !layer;
    empty.hidden = Boolean(layer);
    if (!layer) return;

    this.el.textField.hidden = layer.type !== "text";
    this.el.shapeFields.hidden = layer.type === "text";
    const sizeField = this.el.layerSizeInput.closest(".field");
    if (sizeField) sizeField.hidden = layer.type !== "text";
    if (this.doc.activeElement !== this.el.layerNameInput) this.el.layerNameInput.value = layer.name;
    if (this.doc.activeElement !== this.el.layerTextInput) this.el.layerTextInput.value = layer.text || "";
    if (this.doc.activeElement !== this.el.layerWidthInput) this.el.layerWidthInput.value = String(layer.width);
    if (this.doc.activeElement !== this.el.layerHeightInput) this.el.layerHeightInput.value = String(layer.height);
    if (this.doc.activeElement !== this.el.layerSizeInput) this.el.layerSizeInput.value = String(layer.size || 38);
    if (this.doc.activeElement !== this.el.layerColorInput) this.el.layerColorInput.value = layer.fill;
    this.el.positionReadout.textContent = `x ${Math.round(layer.x)} / y ${Math.round(layer.y)}`;
  }

  renderImageControls() {
    for (const button of $$(this.root, "[data-preset]")) {
      const active = button.dataset.preset === this.state.background.palette;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.el.grainRange.value = String(this.state.background.grain);
    this.el.grainOutput.textContent = `${this.state.background.grain}%`;
    this.el.vignetteRange.value = String(this.state.background.vignette);
    this.el.vignetteOutput.textContent = `${this.state.background.vignette}%`;
  }

  renderAudioState() {
    const snapshot = this.audio.snapshot();
    const boundaryFailed = this.boundaries.audio.isFailed;
    this.el.volumeRange.value = String(this.state.audio.volume);
    this.el.volumeOutput.textContent = `${this.state.audio.volume}%`;
    if (this.doc.activeElement !== this.el.waveformSelect) {
      this.el.waveformSelect.value = this.state.audio.waveform;
    }
    const playing = snapshot.status === "playing" && !boundaryFailed;
    this.el.playAudio.disabled = playing;
    this.el.playAudio.textContent = playing ? "正在合成…" : "播放序列";
    this.el.stopAudio.disabled = !playing && snapshot.nodeCount === 0;
    this.el.audioResources.textContent = `活动节点 ${snapshot.nodeCount} · ${snapshot.nodeCount === 0 ? "资源已释放" : "资源已注册"}`;
    this.el.audioTime.textContent = playing
      ? `00:${String(Math.round(snapshot.stepIndex * 60000 / this.state.audio.bpm / 2000)).padStart(2, "0")}`
      : "00:00";
    this.el.waveformBars.classList.toggle("is-playing", playing);
    this.el.audioStatus.textContent = boundaryFailed
      ? "已停止出错节点 · 等待重试"
      : playing
        ? `合成中 · ${this.state.audio.waveform}`
        : "音频引擎空闲";
    for (const step of $$(this.el.stepGrid, "[data-step]")) {
      step.classList.toggle("is-current", playing && Number(step.dataset.step) === snapshot.stepIndex);
    }
  }

  renderSteps() {
    for (const step of $$(this.el.stepGrid, "[data-step]")) {
      const active = this.state.audio.pattern[Number(step.dataset.step)];
      step.setAttribute("aria-pressed", String(Boolean(active)));
    }
  }

  renderExportHistory() {
    const exports = this.state.exports;
    this.el.exportHistoryCount.textContent = `${exports.length} 条`;
    if (exports.length === 0) {
      this.el.exportHistory.innerHTML = '<li class="empty-state">尚未导出。成功后记录会保留在本地。</li>';
    } else {
      this.el.exportHistory.innerHTML = exports
        .map((item) => `
          <li title="${escapeHtml(item.reason || "导出成功")}">
            <span class="history-status${item.status === "failure" ? " is-error" : ""}" aria-hidden="true"></span>
            <span class="history-copy">
              <strong>${escapeHtml(item.projectName)} · ${item.format.toUpperCase()}</strong>
              <small>rev ${item.revision} · ${item.status === "success" ? bytesLabel(item.bytes) : escapeHtml(item.reason)}</small>
            </span>
            <time datetime="${escapeHtml(item.at)}">${timeLabel(item.at)}</time>
          </li>`)
        .join("");
    }
    const boundaryFailed = this.boundaries.export.isFailed;
    if (boundaryFailed && this.preExportMeta) {
      this.el.exportGuard.innerHTML = `
        <span class="guard-dot" aria-hidden="true"></span>
        <span>导出前状态已保留 · rev ${this.preExportMeta.revision}</span>
        <button class="text-button" type="button" id="restorePreExport">恢复导出前状态</button>`;
      this.el.restorePreExport = this.doc.getElementById("restorePreExport");
      this.el.restorePreExport?.addEventListener("click", () => this.restorePreExportState());
    } else {
      const successful = exports.filter((item) => item.status === "success");
      this.el.exportGuard.innerHTML = `
        <span class="guard-dot" aria-hidden="true"></span>
        <span>${successful.length ? `已导出 ${successful.length} 次 · 状态未被重置` : "导出前状态保护已开启"}</span>`;
      this.el.restorePreExport = null;
    }
    const success = exports.find((item) => item.status === "success");
    this.el.exportStatus.textContent = boundaryFailed
      ? "导出失败 · 工程内容与选择保持不变"
      : success
        ? `最近成功 rev ${success.revision} · ${timeLabel(success.at)}`
        : "等待导出";
  }

  renderMetrics() {
    const rate = overallRate(this.metrics);
    this.el.successRate.textContent = formatRate(rate);
    const total = this.metrics.total.success + this.metrics.total.failure;
    this.el.successDetail.textContent = total
      ? `共 ${total} 次模块操作 · 成功 ${this.metrics.total.success} · 失败 ${this.metrics.total.failure}`
      : "还没有模块操作";
    this.el.rateFill.style.width = `${rate === null ? 0 : rate * 100}%`;
    for (const module of ["image", "audio", "export"]) {
      const entry = this.metrics.modules[module];
      const element = this.el[`metric${module[0].toUpperCase()}${module.slice(1)}`];
      const rateElement = this.el[`metric${module[0].toUpperCase()}${module.slice(1)}Rate`];
      element.textContent = formatMetric(entry);
      rateElement.textContent = entry.failure > 0
        ? `${formatRate(entry.success / (entry.success + entry.failure))} · ${entry.failure} 次失败`
        : entry.success > 0
          ? `${formatRate(1)} 成功`
          : "暂无操作";
      element.closest(".metric")?.classList.toggle("has-error", entry.failure > 0);
    }
    const failure = lastFailure(this.metrics);
    this.el.failureReason.textContent = failure
      ? `${failure.moduleLabel}：${failure.message}${failure.advice ? ` 建议：${failure.advice}` : ""}`
      : "暂无失败。失败时会显示模块、原因与重试建议。";
  }

  renderBoundary(module) {
    const boundary = this.boundaries[module];
    const state = boundary.state;
    const badge = this.el[`${module}Health`];
    const errorBox = this.el[`${module}Error`];
    const failed = boundary.isFailed;
    const recovering = state.status === "recovering";
    if (badge) {
      badge.textContent = failed ? "故障" : recovering ? "恢复中" : state.recovered ? "已恢复" : "就绪";
      badge.dataset.state = failed ? "error" : recovering ? "recovering" : "ready";
    }
    if (errorBox) {
      errorBox.hidden = !failed;
      if (failed && state.error) {
        $(errorBox, ".error-message").textContent = `${state.error.moduleLabel}：${state.error.message}`;
        $(errorBox, ".error-advice").textContent = `建议：${state.error.advice}`;
        $(errorBox, "h3").textContent = `${state.error.moduleLabel}失败`;
        $(errorBox, "h3").id = `${module}ErrorTitle`;
        const retry = $(errorBox, "[data-retry]");
        retry.setAttribute("aria-describedby", `${module}ErrorTitle`);
        retry.textContent = module === "image"
          ? "重试图像操作"
          : module === "audio"
            ? "停止并重试"
            : "重试导出";
      }
    }
    const summary = $(this.el.healthSummary, `[data-health="${module}"]`);
    if (summary) {
      summary.classList.toggle("is-error", failed);
      summary.classList.toggle("is-recovering", recovering);
      summary.title = failed
        ? `${boundary.label}故障：${state.error?.message || "未知错误"}`
        : state.recovered
          ? `${boundary.label}已从故障恢复`
          : `${boundary.label}正常`;
    }
  }

  renderFaultState() {
    const armed = this.faults.snapshot();
    for (const button of $$(this.root, "[data-fault]")) {
      const active = armed.includes(button.dataset.fault);
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("button-primary", active);
    }
    this.el.faultStatus.textContent = armed.length
      ? `已就绪：${armed.map((item) => this.moduleLabel(item)).join("、")}将在下一次操作失败一次`
      : "未注入故障";
  }

  onBoundaryChange(module) {
    this.renderBoundary(module);
    if (module === "image") this.renderCanvas();
    if (module === "audio") this.renderAudioState();
    if (module === "export") this.renderExportHistory();
  }

  onAudioState(snapshot) {
    if (!this.el.audioResources) return;
    if (
      snapshot.status === "error" &&
      snapshot.lastError &&
      !this.audioOperationActive &&
      !this.boundaries.audio.isFailed &&
      this.lastAudioReportedError !== snapshot.lastError
    ) {
      this.lastAudioReportedError = snapshot.lastError;
      const error = this.boundaries.audio.reportError(new Error(snapshot.lastError));
      this.noteModuleResult("audio", false, error);
      this.renderAudioState();
      this.focusError("audio");
      this.announce(`音频合成失败：${error.message}。出错节点已停止，可重试恢复。`);
      return;
    }
    this.el.audioResources.textContent = `活动节点 ${snapshot.nodeCount} · ${snapshot.nodeCount === 0 ? "资源已释放" : "资源已注册"}`;
    this.renderAudioState();
  }

  onAudioStep(step) {
    for (const button of $$(this.el.stepGrid, "[data-step]")) {
      button.classList.toggle("is-current", Number(button.dataset.step) === step);
    }
    this.el.audioTime.textContent = `00:${String(Math.round((step + 1) * 60 / this.state.audio.bpm / 2)).padStart(2, "0")}`;
  }

  addNewLayer(type) {
    try {
      const result = addLayer(this.state, type);
      this.setState(result.state, { announce: `已添加${result.layer.name}，当前选择已更新。` });
    } catch (error) {
      this.el.imageStatus.textContent = `无法添加：${error.message}`;
      this.announce(`无法添加${type === "text" ? "文字" : type === "circle" ? "圆形" : "矩形"}：${error.message}`);
    }
  }

  selectLayerById(id, source = "交互") {
    const next = selectLayer(this.state, id);
    const layer = getSelectedLayer(next);
    this.setState(next, {
      announce: layer ? `已通过${source}选择${layer.name}，位置 x ${Math.round(layer.x)}，y ${Math.round(layer.y)}。` : "已取消选择。"
    });
  }

  deleteSelectedLayer(id = this.state.selection) {
    const layer = this.state.layers.find((item) => item.id === id);
    if (!layer) return;
    const next = removeLayer(this.state, id);
    this.setState(next, {
      announce: next.layers.length
        ? `已删除${layer.name}，当前选择为${getSelectedLayer(next)?.name || "无"}。`
        : `已删除${layer.name}，画布还可以继续添加图层。`
    });
  }

  updateSelected(patch, announce = true) {
    const layer = getSelectedLayer(this.state);
    if (!layer) return;
    const next = updateLayer(this.state, layer.id, patch);
    this.setState(next, {
      announce: announce ? `已更新${layer.name}。` : undefined
    });
  }

  nudgeSelected(direction, step = 8) {
    const layer = getSelectedLayer(this.state);
    if (!layer) {
      this.announce("尚未选择图层。请先使用 Tab 或图层列表选择一个图层。");
      return;
    }
    const vectors = {
      up: [0, -step],
      down: [0, step],
      left: [-step, 0],
      right: [step, 0]
    };
    const [dx, dy] = vectors[direction] || [0, 0];
    const next = moveLayer(this.state, layer.id, dx, dy);
    const moved = getSelectedLayer(next);
    this.setState(next, {
      announce: `${moved.name}已移动到 x ${Math.round(moved.x)}，y ${Math.round(moved.y)}。`
    });
  }

  handleCanvasKeydown(event) {
    const vectors = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right"
    };
    if (vectors[event.key]) {
      event.preventDefault();
      this.nudgeSelected(vectors[event.key], event.shiftKey ? 1 : 8);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteSelectedLayer();
      return;
    }
    const key = event.key.toLowerCase();
    if (["r", "c", "t"].includes(key)) {
      event.preventDefault();
      this.addNewLayer({ r: "rect", c: "circle", t: "text" }[key]);
    }
  }

  handleGlobalKey(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditingField(event.target) || this.el.a11yDialog?.open) return;
    if (event.target === this.el.studioCanvas || event.target.closest?.("#studioCanvas")) return;
    const key = event.key.toLowerCase();
    if (!["r", "c", "t"].includes(key)) return;
    event.preventDefault();
    this.addNewLayer({ r: "rect", c: "circle", t: "text" }[key]);
  }

  handlePointerDown(event) {
    if (this.boundaries.image.isFailed) {
      this.announce("图像模块故障，画布操作已暂停。请使用图层列表继续选择，或重试图像操作。");
      return;
    }
    const point = pointerToCanvas(this.el.studioCanvas, event.clientX, event.clientY);
    const hit = hitTest(this.state, point.x, point.y);
    if (!hit) {
      this.selectLayerById(null, event.pointerType === "touch" ? "触屏" : "画布");
      return;
    }
    const layer = this.state.layers.find((item) => item.id === hit);
    this.drag = {
      id: hit,
      pointerId: event.pointerId,
      start: point,
      originX: layer.x,
      originY: layer.y,
      moved: false,
      source: event.pointerType === "touch" ? "触屏" : event.pointerType || "鼠标"
    };
    this.el.studioCanvas.classList.add("is-dragging");
    try {
      this.el.studioCanvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events do not own an active pointer.
    }
    event.preventDefault();
    this.selectLayerById(hit, this.drag.source);
  }

  handlePointerMove(event) {
    if (!this.drag || (event.pointerId !== undefined && this.drag.pointerId !== event.pointerId)) return;
    const point = pointerToCanvas(this.el.studioCanvas, event.clientX, event.clientY);
    const dx = point.x - this.drag.start.x;
    const dy = point.y - this.drag.start.y;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    this.drag.moved = true;
    const next = updateLayer(this.state, this.drag.id, {
      x: this.drag.originX + dx,
      y: this.drag.originY + dy
    });
    event.preventDefault();
    this.setState(next, { mode: "canvas" });
    this.el.selectionReadout.textContent = `${next.layers.find((item) => item.id === this.drag.id)?.type.toUpperCase()} / 拖动中`;
  }

  handlePointerUp(event) {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    this.el.studioCanvas.classList.remove("is-dragging");
    try {
      this.el.studioCanvas.releasePointerCapture?.(event.pointerId);
    } catch {
      // Capture may not have been established in synthetic test events.
    }
    const layer = getSelectedLayer(this.state);
    this.renderAll();
    if (layer) {
      this.announce(
        drag.moved
          ? `${drag.source}拖动结束，${layer.name}位于 x ${Math.round(layer.x)}，y ${Math.round(layer.y)}。`
          : `已通过${drag.source}选择${layer.name}。`
      );
    }
  }

  choosePalette(paletteId) {
    const next = applyPalette(this.state, paletteId);
    this.setState(next);
    this.announce(`背景预设已切换为${PALETTES[paletteId]?.label || paletteId}，正在等待应用。`);
  }

  async applyImageAction(options = {}) {
    const retry = options.retry === true || this.boundaries.image.isFailed;
    this.el.applyImage.disabled = true;
    this.el.applyImage.textContent = retry ? "恢复中…" : "重绘中…";
    const result = await this.boundaries.image.run(async () => {
      if (this.faults.consume("image")) {
        throw new Error("模拟的一次性图像故障：无法建立图层合成上下文。");
      }
      this.renderCanvas({ throwOnError: true });
      return { layers: this.state.layers.length, revision: this.state.revision };
    }, { retry });
    this.el.applyImage.disabled = false;
    this.el.applyImage.textContent = "应用并重绘";
    if (result.ok) {
      this.el.imageStatus.textContent = result.boundary.recovered
        ? `画布已恢复 · ${this.state.layers.length} 个图层保留`
        : `已重绘 · ${this.state.layers.length} 个图层`;
      this.noteModuleResult("image", true);
      this.announce(result.boundary.recovered
        ? `图像模块已恢复。${this.state.layers.length} 个图层、文字与选择均保留。`
        : `图像处理成功，已绘制 ${this.state.layers.length} 个图层。`);
    } else {
      this.el.imageStatus.textContent = "图像失败，其他编辑已保留";
      this.noteModuleResult("image", false, result.error);
      this.renderCanvas();
      this.focusError("image");
      this.announce(`图像处理失败：${result.error.message}。${result.error.advice}`);
    }
    return result;
  }

  async playAudioAction(options = {}) {
    const retry = options.retry === true || this.boundaries.audio.isFailed;
    this.audioOperationActive = true;
    let result;
    try {
      result = await this.boundaries.audio.run(async () => {
        const fault = this.faults.consume("audio");
        await this.audio.start(this.state.audio, { failAfterCreate: fault });
        return this.audio.snapshot();
      }, { retry });
    } finally {
      this.audioOperationActive = false;
    }
    if (result.ok) {
      this.lastAudioReportedError = null;
      this.noteModuleResult("audio", true);
      this.announce(`音频合成成功，当前有 ${this.audio.nodeCount} 个活动节点。`);
      this.el.audioStatus.textContent = `合成中 · ${this.state.audio.waveform}`;
    } else {
      this.noteModuleResult("audio", false, result.error);
      this.renderAudioState();
      this.focusError("audio");
      this.announce(`音频合成失败：${result.error.message}。出错节点已停止。${result.error.advice}`);
    }
    return result;
  }

  async exportAction(format = "json", options = {}) {
    this.lastExportFormat = format;
    const preSnapshot = cloneState(this.state);
    const retry = options.retry === true || this.boundaries.export.isFailed;
    this.el.exportJson.disabled = true;
    this.el.exportPng.disabled = true;
    this.el.exportStatus.textContent = retry ? "正在恢复并重新导出…" : "正在生成导出…";
    const result = await this.boundaries.export.run(async () => {
      const fault = this.faults.consume("export");
      const exportOptions = {
        fail: fault,
        deliver: options.deliver !== false,
        canvasFactory: this.canvasFactory
      };
      return format === "png"
        ? this.exportController.exportPng(this.state, exportOptions)
        : this.exportController.exportJson(this.state, exportOptions);
    }, { retry });
    this.el.exportJson.disabled = false;
    this.el.exportPng.disabled = false;
    if (result.ok) {
      const successState = recordExport(this.state, result.value.record);
      this.preExportSnapshot = preSnapshot;
      this.preExportMeta = {
        revision: preSnapshot.revision,
        layers: preSnapshot.layers.length,
        format
      };
      this.setState(successState);
      this.noteModuleResult("export", true);
      this.el.exportStatus.textContent = `成功 · ${result.value.record.format.toUpperCase()} · ${bytesLabel(result.value.record.bytes)}`;
      this.announce(`导出成功：${result.value.record.format.toUpperCase()}，${bytesLabel(result.value.record.bytes)}，修订 ${result.value.record.revision}。导出前状态已保留。`);
    } else {
      const details = result.error.details || {};
      this.preExportSnapshot = details.snapshot || preSnapshot;
      this.preExportMeta = {
        revision: details.revision ?? preSnapshot.revision,
        layers: (details.snapshot || preSnapshot).layers.length,
        format
      };
      if (details.record) {
        this.setState(recordExport(this.state, details.record));
      } else {
        this.renderExportHistory();
      }
      this.noteModuleResult("export", false, result.error);
      this.renderExportHistory();
      this.focusError("export");
      this.announce(`导出失败：${result.error.message}。导出前状态已保留，可重试或显式恢复。`);
    }
    return result;
  }

  restorePreExportState() {
    const snapshot = this.exportController.restoreSnapshot() || this.preExportSnapshot;
    if (!snapshot) {
      this.announce("没有可恢复的导出前快照。");
      return;
    }
    const restored = cloneState(snapshot);
    restored.exports = this.state.exports;
    restored.lastExportRevision = this.state.lastExportRevision;
    restored.revision = Math.max(snapshot.revision, this.state.revision - 1);
    restored.updatedAt = new Date().toISOString();
    this.preExportMeta = null;
    this.setState(restored);
    this.announce(`已显式恢复导出前状态：修订 ${snapshot.revision}，${restored.layers.length} 个图层，选择为${getSelectedLayer(restored)?.name || "无"}。`);
  }

  noteModuleResult(module, ok, error = null) {
    if (this.testing) return;
    this.metrics = recordMetric(this.metrics, module, ok, error
      ? { message: error.message, advice: error.advice }
      : {});
    this.persistMetrics();
    this.renderMetrics();
  }

  retryModule(module) {
    if (module === "image") return this.applyImageAction({ retry: true });
    if (module === "audio") return this.playAudioAction({ retry: true });
    return this.exportAction(this.lastExportFormat || "json", { retry: true });
  }

  focusError(module) {
    const heading = this.el[`${module}Error`]?.querySelector("h3");
    if (!heading) return;
    globalThis.setTimeout?.(() => heading.focus(), 0);
  }

  async runSuite(suiteName) {
    if (this.testRunning) {
      this.announce("验收测试正在运行，请等待当前组完成。");
      return null;
    }
    this.testRunning = true;
    const label = suiteName === "default" ? "默认" : suiteName === "boundary" ? "边界" : "错误";
    this.el.testRunState.textContent = `正在运行${label}组…`;
    const suiteElement = $(this.root, `[data-suite="${suiteName}"]`);
    suiteElement?.classList.add("is-running");
    this.announce(`开始运行${label}验收组，状态将在隔离快照中恢复。`);
    try {
      const run = await runAcceptanceSuite(this, suiteName);
      suiteElement?.classList.remove("is-running");
      suiteElement?.classList.toggle("is-pass", run.failed === 0);
      suiteElement?.classList.toggle("is-fail", run.failed > 0);
      const resultElement = this.el[`${suiteName}Result`];
      resultElement.textContent = `${run.passed}/${run.total} 通过${run.failed ? ` · ${run.failed} 失败` : ""}`;
      resultElement.title = run.results
        .filter((item) => !item.ok)
        .map((item) => `${item.name}: ${item.detail}`)
        .join("\n");
      this.renderTestLog(run);
      this.testSummary = mergeTestSummaries(this.testSummary, run);
      this.el.testSummary.textContent = this.testSummary.failed
        ? `${this.testSummary.passed}/${this.testSummary.total} 通过 · ${this.testSummary.failed} 失败`
        : `全部通过 ${this.testSummary.total}/${this.testSummary.total}`;
      this.el.testSummary.dataset.tone = this.testSummary.failed ? "error" : "success";
      this.el.testRunState.textContent = `最近运行：${run.label}组 · ${run.passed}/${run.total} 通过`;
      this.announce(this.testSummary.failed
        ? `${run.label}组完成：${run.passed} 通过，${run.failed} 失败。${run.results.filter((item) => !item.ok).map((item) => `${item.name}：${item.detail}`).join("；")}`
        : `${run.label}组完成：${run.total} 项全部通过。工程状态已恢复。`);
      return run;
    } catch (error) {
      suiteElement?.classList.remove("is-running");
      suiteElement?.classList.add("is-fail");
      this.el.testRunState.textContent = `运行失败：${error.message}`;
      this.announce(`验收运行失败：${error.message}`);
      return {
        suite: suiteName,
        label,
        total: 0,
        passed: 0,
        failed: 1,
        results: [{ name: "运行器", ok: false, detail: error.message }]
      };
    } finally {
      this.testRunning = false;
      this.renderAll();
    }
  }

  async runAllSuites() {
    if (this.testRunning) {
      this.announce("验收测试正在运行，请等待当前组完成。");
      return null;
    }
    this.testSummary = { total: 0, passed: 0, failed: 0, suites: {} };
    this.el.testLog.innerHTML = "";
    for (const name of ["default", "boundary", "error"]) {
      await this.runSuite(name);
    }
    this.el.testSummary.textContent = this.testSummary.failed
      ? `${this.testSummary.passed}/${this.testSummary.total} 通过 · ${this.testSummary.failed} 失败`
      : `全部通过 ${this.testSummary.total}/${this.testSummary.total}`;
    this.el.testSummary.dataset.tone = this.testSummary.failed ? "error" : "success";
    return this.testSummary;
  }

  renderTestLog(run) {
    const fragment = run.results.map((result) => `
      <li class="${result.ok ? "is-pass" : "is-fail"}">
        <span class="log-icon" aria-hidden="true">${result.ok ? "✓" : "×"}</span>
        <strong>${escapeHtml(run.label)} · ${escapeHtml(result.name)}</strong>
        <span>${escapeHtml(result.detail)}</span>
      </li>`).join("");
    const wrapper = this.doc.createElement("div");
    wrapper.innerHTML = fragment;
    const items = [...wrapper.children];
    this.el.testLog.append(...items);
    while (this.el.testLog.children.length > 36) this.el.testLog.firstElementChild.remove();
  }

  destroy() {
    this.audio?.dispose();
    this.exportController?.dispose();
  }
}
