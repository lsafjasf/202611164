import { CanvasStage } from "./canvas-stage.js";
import { worldToScreen } from "./geometry.js";
import {
  createSeedScene,
  loadScene,
  saveScene,
  serializeScene,
  STORAGE_KEY
} from "./scene.js";

const $ = (id) => document.getElementById(id);
const refs = {
  canvas: $("canvas"),
  frame: $("canvas-frame"),
  fatalPanel: $("fatal-panel"),
  fatalMessage: $("fatal-message"),
  retry: $("retry-button"),
  banner: $("error-banner"),
  bannerTitle: $("error-title"),
  bannerMessage: $("error-message"),
  recover: $("recover-button"),
  log: $("error-log"),
  logCount: $("log-count"),
  tip: $("recovery-tip"),
  topGesture: $("top-gesture"),
  topLatency: $("top-latency"),
  topErrors: $("top-errors"),
  mode: $("current-mode"),
  input: $("current-input"),
  badge: $("gesture-badge"),
  latency: $("latency-value"),
  avg: $("avg-latency"),
  p95: $("p95-latency"),
  shapes: $("shape-stat"),
  points: $("point-stat"),
  bitmap: $("bitmap-stat"),
  listeners: $("listener-stat"),
  resourceFill: $("resource-fill"),
  resourceNote: $("resource-note"),
  spark: $("latency-spark"),
  dpr: $("dpr-label"),
  zoom: $("zoom-level"),
  objects: $("object-count"),
  toast: $("gesture-toast"),
  save: $("save-state"),
  logClear: $("clear-log")
};

const TOOL_LABELS = { draw: "绘制工具", select: "选择工具", pan: "移动工具" };
const state = {
  stage: null,
  snapshot: null,
  selected: null,
  errors: [],
  lastSaveError: "",
  saveTimer: 0,
  toastTimer: 0,
  recoveryAction: null,
  pendingQuarantine: null,
  bootCount: 0
};

function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function formatMs(value) {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

function formatTime(at) {
  const date = new Date(at || Date.now());
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function updateRecoveryTip() {
  refs.tip.classList.remove("is-warning", "is-error");
  if (!state.errors.length) {
    refs.tip.innerHTML =
      '<span class="status-ok" aria-hidden="true"></span><p>状态正常。若手势失效，按 <kbd>Esc</kbd> 取消并点击“适合视图”。</p>';
    return;
  }
  const latest = state.errors[state.errors.length - 1];
  let advice = "可点击“重新初始化”重建画布；已完成的本地数据不会被删除。";
  let level = "is-warning";
  if (latest.code.startsWith("JSON") || latest.code === "SCENE_INVALID" || latest.code === "DATA_TOO_LARGE") {
    advice = "损坏数据已隔离并回退到可用的示例画布。可导出 JSON 备份后重试，或采用恢复结果。";
    level = "is-error";
  } else if (latest.code === "CONTEXT_LOST" || latest.code === "RENDER_FAILED") {
    advice = "先点击“重新初始化”；若重复出现，请关闭其他占用 GPU 的页面或导出 JSON 后恢复示例。";
    level = "is-error";
  } else if (latest.code.startsWith("STORAGE")) {
    advice = "请先导出 JSON 备份，再清理浏览器站点存储或使用“恢复示例”。";
    level = "is-warning";
  } else if (latest.code === "POINTER_CAPTURE") {
    advice = "指针被系统释放；当前笔画已安全结束。请重新按下并拖动以继续。";
  }
  refs.tip.replaceChildren();
  refs.tip.classList.add(level);
  const dot = document.createElement("span");
  dot.className = "status-ok";
  dot.setAttribute("aria-hidden", "true");
  const paragraph = document.createElement("p");
  paragraph.textContent = `恢复建议：${advice}`;
  refs.tip.append(dot, paragraph);
}

function addError(entry) {
  const item = {
    code: entry.code || "UNKNOWN",
    message: entry.message || "未知异常",
    at: entry.at || Date.now()
  };
  state.errors.push(item);
  if (state.errors.length > 80) state.errors.shift();
  const row = document.createElement("li");
  const time = document.createElement("time");
  time.dateTime = new Date(item.at).toISOString();
  time.textContent = formatTime(item.at);
  const code = document.createElement("strong");
  code.textContent = item.code;
  const message = document.createElement("p");
  message.textContent = item.message;
  row.append(time, code, message);
  refs.log.prepend(row);
  while (refs.log.children.length > 30) refs.log.lastElementChild.remove();
  setText(refs.logCount, state.errors.length);
  setText(refs.topErrors, state.errors.length);
  updateRecoveryTip();
  return item;
}

function showBanner(title, message, actionLabel, action) {
  refs.bannerTitle.textContent = title;
  refs.bannerMessage.textContent = message;
  refs.recover.textContent = actionLabel;
  state.recoveryAction = action;
  refs.banner.hidden = false;
}

function hideBanner() {
  refs.banner.hidden = true;
  state.recoveryAction = null;
}

function showToast(message, duration = 1500) {
  clearTimeout(state.toastTimer);
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => refs.toast.classList.remove("is-visible"), duration);
}

function persist(quarantineRaw = state.pendingQuarantine) {
  if (!state.stage) return false;
  clearTimeout(state.saveTimer);
  refs.save.classList.remove("is-error");
  const result = saveScene(localStorage, state.stage.getScenePayload(), quarantineRaw);
  if (result.ok) {
    refs.save.classList.remove("is-saving");
    refs.save.innerHTML = "<i></i>已保存到本机";
    refs.save.title = `${result.bytes} 字节 · ${formatTime(Date.now())}`;
    state.pendingQuarantine = null;
    state.lastSaveError = "";
    return true;
  }
  refs.save.classList.remove("is-saving");
  refs.save.classList.add("is-error");
  refs.save.innerHTML = "<i></i>保存失败 · 请导出备份";
  if (result.error.message !== state.lastSaveError) {
    state.lastSaveError = result.error.message;
    addError(result.error);
    showBanner("本地保存失败", result.error.message, "恢复示例", recoverDefault);
  }
  return false;
}

function scheduleSave() {
  if (!state.stage) return;
  refs.save.classList.add("is-saving");
  refs.save.innerHTML = "<i></i>正在保存…";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => persist(), 220);
}

function recoverDefault() {
  if (!state.stage) return;
  const seed = createSeedScene();
  state.stage.replaceScene(seed, { fit: true });
  state.pendingQuarantine = null;
  if (persist() !== false) hideBanner();
  showToast("已恢复示例画布 · 异常记录保留");
}

function updateSpark(values = []) {
  const bars = [...refs.spark.querySelectorAll("i")];
  if (!bars.length) return;
  const maximum = Math.max(0.5, ...values);
  for (let index = 0; index < bars.length; index += 1) {
    const value = values[index];
    const height = value === undefined ? 8 : Math.max(8, (value / maximum) * 100);
    bars[index].style.height = `${height}%`;
  }
}

function updateSnapshot(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot;
  const { render, resources, gesture } = snapshot;
  setText(refs.topGesture, gesture.label);
  setText(refs.topLatency, formatMs(render.lastMs));
  setText(refs.latency, formatMs(render.lastMs));
  setText(refs.avg, `${formatMs(render.avgMs)} ms`);
  setText(refs.p95, `${formatMs(render.p95Ms)} ms`);
  setText(refs.shapes, resources.shapes);
  setText(refs.points, resources.points);
  setText(refs.bitmap, `${resources.bitmapMiB.toFixed(2)} MB`);
  setText(refs.listeners, resources.listeners + resources.activePointers);
  setText(refs.dpr, `${resources.dpr.toFixed(1)}×`);
  setText(refs.zoom, `${Math.round(snapshot.view.scale * 100)}%`);
  setText(refs.objects, resources.shapes);
  setText(refs.mode, TOOL_LABELS[snapshot.tool] || "画布工具");
  const selection = snapshot.selectedId ? ` · 已选 ${snapshot.selectedId.slice(-8)}` : "";
  const latency = snapshot.inputLatencyMs !== null ? ` · 输入 ${formatMs(snapshot.inputLatencyMs)} ms` : "";
  setText(refs.input, `${gesture.input}${selection}${latency}`);
  setText(refs.badge, gesture.label);
  refs.badge.classList.toggle("is-hot", gesture.kind !== "idle");
  refs.latency.parentElement.parentElement.classList.toggle("is-active", gesture.kind !== "idle");
  const fill = Math.min(100, Math.max(2, (resources.bitmapMiB / 64) * 100));
  refs.resourceFill.style.width = `${fill}%`;
  const heap = resources.heapMiB === null ? "JS 堆不可见" : `JS 堆 ${resources.heapMiB.toFixed(1)} MB`;
  refs.resourceNote.textContent =
    `${resources.canvasWidth}×${resources.canvasHeight} px · ${heap} · ${resources.listeners} 个受管监听器`;
  updateSpark(render.samples);
}

function installSparkBars() {
  for (let index = 0; index < 16; index += 1) {
    const bar = document.createElement("i");
    bar.style.height = "8%";
    refs.spark.append(bar);
  }
}

function updateToolButtons(tool) {
  for (const button of document.querySelectorAll(".tool")) {
    const active = button.dataset.tool === tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  showToast(`${TOOL_LABELS[tool]}已启用`);
}

function createStage(scene) {
  if (state.stage) state.stage.destroy();
  refs.fatalPanel.hidden = true;
  try {
    state.bootCount += 1;
    state.stage = new CanvasStage(refs.canvas, scene, {
      onMetrics: updateSnapshot,
      onGesture: () => {
        setText(refs.topGesture, state.stage?.gesture.label || "空闲");
      },
      onFeedback: (message) => showToast(message),
      onNotice: (message) => showToast(message, 1900),
      onSelection: (shape) => {
        state.selected = shape;
        if (shape) showToast(`已选择 · ${shape.id.slice(-10)}`, 1150);
      },
      onTool: (tool) => updateToolButtons(tool),
      onChange: () => scheduleSave(),
      onViewChange: () => scheduleSave(),
      onError: (error) => {
        addError(error);
        if (error.code === "CONTEXT_LOST" || error.code === "RENDER_FAILED") {
          showBanner("渲染中断", error.message, "重新初始化", reinitializeStage);
        } else if (error.recoverable) {
          showBanner("输入已恢复", `${error.message} 可在当前会话继续操作。`, "适合视图", () => {
            state.stage?.fitView();
            hideBanner();
          });
        }
      }
    });
    updateSnapshot(state.stage.getSnapshot());
    updateToolButtons(state.stage.tool);
    return true;
  } catch (error) {
    state.stage = null;
    addError({ code: "BOOT_FAILED", message: `画布初始化失败：${error.message}` });
    refs.fatalMessage.textContent = error.message;
    refs.fatalPanel.hidden = false;
    showBanner("画布启动失败", "请查看异常日志后重新初始化。", "重新初始化", reinitializeStage);
    return false;
  }
}

function reinitializeStage() {
  const currentScene = state.stage?.getScenePayload() || createSeedScene();
  const ok = createStage(currentScene);
  if (ok) {
    hideBanner();
    showToast("画布已重新初始化");
    scheduleSave();
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  if (!state.stage) return;
  try {
    const payload = serializeScene(state.stage.getScenePayload());
    downloadBlob(new Blob([payload], { type: "application/json" }), `crosshair-${Date.now()}.json`);
    showToast("JSON 已导出 · 画布视图与笔画完整保留");
  } catch (error) {
    addError({ code: "EXPORT_JSON", message: `JSON 导出失败：${error.message}` });
    showBanner("导出失败", error.message, "重新初始化", reinitializeStage);
  }
}

async function exportPng() {
  if (!state.stage) return;
  try {
    const blob = await state.stage.exportPng();
    downloadBlob(blob, `crosshair-${Date.now()}.png`);
    showToast("PNG 已导出 · 不含准星与诊断层");
  } catch (error) {
    addError({ code: "EXPORT_PNG", message: `PNG 导出失败：${error.message}` });
    showBanner("导出失败", error.message, "重新初始化", reinitializeStage);
  }
}

function bindControls() {
  for (const button of document.querySelectorAll(".tool")) {
    button.addEventListener("click", () => state.stage?.setTool(button.dataset.tool));
  }
  $("zoom-in").addEventListener("click", () => state.stage?.zoomBy(1.25));
  $("zoom-out").addEventListener("click", () => state.stage?.zoomBy(0.8));
  $("reset-view").addEventListener("click", () => {
    state.stage?.fitView();
    showToast("已适合全部图形");
  });
  refs.recover.addEventListener("click", () => {
    const action = state.recoveryAction || recoverDefault;
    action();
  });
  refs.retry.addEventListener("click", reinitializeStage);
  $("export-json").addEventListener("click", exportJson);
  $("export-png").addEventListener("click", exportPng);
  $("reset-scene").addEventListener("click", recoverDefault);
  $("clear-canvas").addEventListener("click", () => {
    state.stage?.clearScene();
    persist();
    showToast("画布已清空 · 可通过导出文件恢复");
  });
  refs.logClear.addEventListener("click", () => {
    state.errors = [];
    refs.log.replaceChildren();
    setText(refs.logCount, "0");
    setText(refs.topErrors, "0");
    updateRecoveryTip();
    showToast("本次会话日志已清空");
  });

  let previousTool = "draw";
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && /input|textarea|select/i.test(target.tagName)) return;
    const key = event.key.toLowerCase();
    if (key === "v" || key === "d" || key === "h") {
      state.stage?.setTool({ v: "select", d: "draw", h: "pan" }[key]);
    } else if (key === "0") {
      state.stage?.fitView();
    } else if (key === "+" || key === "=") {
      state.stage?.zoomBy(1.25);
    } else if (key === "-" || key === "_") {
      state.stage?.zoomBy(0.8);
    } else if (key === "escape") {
      state.stage?.resetInputState();
      state.stage?.clearSelection();
      showToast("手势已取消 · 适合视图可恢复定位");
    } else if (event.code === "Space" && document.activeElement === refs.canvas) {
      event.preventDefault();
      if (!event.repeat) {
        previousTool = state.stage?.tool || "draw";
        state.stage?.setTool("pan");
      }
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space" && document.activeElement === refs.canvas) {
      event.preventDefault();
      state.stage?.setTool(previousTool);
    }
  });
  window.addEventListener("pagehide", () => {
    if (state.stage) persist();
  });
}

function installGlobalErrorHandlers() {
  window.addEventListener("error", (event) => {
    const message = event.error?.message || event.message || "未知脚本错误";
    addError({ code: "WINDOW_ERROR", message });
    showBanner("检测到脚本异常", message, "重新初始化", reinitializeStage);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const message = event.reason?.message || String(event.reason || "未处理的异步异常");
    addError({ code: "UNHANDLED_REJECTION", message });
    showBanner("检测到异步异常", message, "重新初始化", reinitializeStage);
  });
}

function installDebugApi() {
  window.__canvasDebug = {
    getState() {
      const rect = refs.canvas.getBoundingClientRect();
      return {
        bootCount: state.bootCount,
        snapshot: state.stage?.getSnapshot() || null,
        scene: state.stage?.getScenePayload() || null,
        errors: state.errors.map((error) => ({ ...error })),
        selected: state.selected?.id || null,
        banner: refs.banner.hidden ? null : refs.bannerMessage.textContent,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        storageBytes: (() => {
          try {
            return (localStorage.getItem(STORAGE_KEY) || "").length;
          } catch {
            return null;
          }
        })()
      };
    },
    project(worldPoint) {
      return state.stage ? worldToScreen(worldPoint, state.stage.scene.view) : null;
    },
    seedCorrupt(raw = '{"version":1,"shapes":[{"id":"broken","type":"stroke","points":[{"x":0,"y":NaN}]}') {
      localStorage.setItem(STORAGE_KEY, raw);
      location.reload();
    },
    setRaw(raw) {
      if (raw === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, raw);
    },
    clearStorage() {
      localStorage.clear();
    },
    fitView() {
      state.stage?.fitView();
    }
  };
}

function init() {
  installSparkBars();
  bindControls();
  installGlobalErrorHandlers();
  installDebugApi();
  const loaded = loadScene(localStorage);
  const firstRun = loaded.raw === null;
  let scene = loaded.scene;
  if (firstRun) {
    scene = createSeedScene();
  } else if (loaded.recovered) {
    state.pendingQuarantine = loaded.raw;
    for (const item of loaded.issues) addError(item);
    showBanner(
      "画布已从异常数据恢复",
      `检测到 ${loaded.issues.length} 项问题，已隔离原始数据并载入可用内容。异常记录已保留。`,
      "采用恢复结果",
      () => {
        if (persist()) hideBanner();
      }
    );
  } else if (!loaded.ok && loaded.issues.length) {
    for (const item of loaded.issues) addError(item);
  }
  const created = createStage(scene);
  if (created && (firstRun || loaded.recovered)) persist(state.pendingQuarantine);
}

init();
