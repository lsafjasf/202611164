(() => {
  "use strict";

  const WORLD = Object.freeze({ width: 1200, height: 800 });
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 4;
  const STORAGE_KEY = "focus-canvas.project.v1";
  const BACKUP_KEY = "focus-canvas.project.backup.v1";
  const MAX_HISTORY = 50;
  const TOOL_ORDER = ["select", "pen", "line", "rect", "ellipse", "text", "eraser"];
  const TOOLS = Object.freeze({
    select: { label: "选择", key: "V", glyph: "↖" },
    pen: { label: "画笔", key: "P", glyph: "✎" },
    line: { label: "直线", key: "L", glyph: "╱" },
    rect: { label: "矩形", key: "R", glyph: "□" },
    ellipse: { label: "椭圆", key: "O", glyph: "○" },
    text: { label: "文字", key: "T", glyph: "T" },
    eraser: { label: "橡皮", key: "E", glyph: "⌫" },
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const pad = (value) => String(value).padStart(2, "0");

  function uid() {
    return `obj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function defaultState() {
    return {
      version: 1,
      project: { name: "未命名工程", objects: [] },
      tool: "pen",
      zoom: 1,
      cursor: { x: WORLD.width / 2, y: WORLD.height / 2 },
      selectedId: null,
      style: { color: "#20242c", width: 4 },
      lastExport: null,
      updatedAt: null,
    };
  }

  const elements = {
    canvas: document.querySelector("#drawing-canvas"),
    shell: document.querySelector("#canvas-shell"),
    toolList: document.querySelector("#tool-list"),
    toolButtons: [...document.querySelectorAll("[data-tool]")],
    undo: document.querySelector("#undo-button"),
    redo: document.querySelector("#redo-button"),
    strokeColor: document.querySelector("#stroke-color"),
    strokeWidth: document.querySelector("#stroke-width"),
    colorValue: document.querySelector("#color-value"),
    widthValue: document.querySelector("#width-value"),
    zoomValue: document.querySelector("#zoom-value"),
    zoomIn: document.querySelector("#zoom-in"),
    zoomOut: document.querySelector("#zoom-out"),
    resetZoom: document.querySelector("#reset-zoom"),
    hudTool: document.querySelector("#hud-tool"),
    hudFocus: document.querySelector("#hud-focus"),
    focusSummary: document.querySelector("#focus-summary"),
    focusSource: document.querySelector("#focus-source"),
    canvasStatus: document.querySelector("#canvas-status"),
    saveState: document.querySelector("#save-state"),
    persistenceNote: document.querySelector("#persistence-note"),
    emptyHint: document.querySelector("#empty-hint"),
    objectCount: document.querySelector("#object-count"),
    objectList: document.querySelector("#object-list"),
    selectionNote: document.querySelector("#selection-note"),
    deleteObject: document.querySelector("#delete-object"),
    projectName: document.querySelector("#project-name"),
    lastExport: document.querySelector("#last-export"),
    exportSvg: document.querySelector("#export-svg"),
    exportPng: document.querySelector("#export-png"),
    exportResult: document.querySelector("#export-result"),
    errorBanner: document.querySelector("#error-banner"),
    errorMessage: document.querySelector("#error-message"),
    errorAction: document.querySelector("#error-action"),
    errorDismiss: document.querySelector("#error-dismiss"),
    helpButton: document.querySelector("#help-button"),
    helpDialog: document.querySelector("#help-dialog"),
    textDialog: document.querySelector("#text-dialog"),
    textForm: document.querySelector("#text-form"),
    textInput: document.querySelector("#text-input"),
    textPosition: document.querySelector("#text-position"),
    textError: document.querySelector("#text-error"),
    clearDialog: document.querySelector("#clear-dialog"),
    confirmClear: document.querySelector("#confirm-clear"),
    clearCanvas: document.querySelector("#clear-canvas"),
  };

  let state = defaultState();
  let undoStack = [];
  let redoStack = [];
  let draft = null;
  let gesture = null;
  let pinch = null;
  let activePointers = new Map();
  let pendingTextPoint = null;
  let pendingErrorAction = null;
  let storageWarning = null;
  let loadNotice = "新工程";
  let lastFocusedControl = "画布";
  let renderQueued = false;
  const faults = { export: false };

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeState(input) {
    if (!isPlainObject(input) || !isPlainObject(input.project) || !Array.isArray(input.project.objects)) {
      throw new Error("工程数据格式无效");
    }
    const base = defaultState();
    const tool = TOOL_ORDER.includes(input.tool) ? input.tool : base.tool;
    const style = isPlainObject(input.style) ? input.style : {};
    const cursor = isPlainObject(input.cursor) ? input.cursor : {};
    const lastExport = isPlainObject(input.lastExport) ? input.lastExport : null;
    return {
      version: 1,
      project: {
        name: typeof input.project.name === "string" ? input.project.name.slice(0, 80) : base.project.name,
        objects: input.project.objects.filter(isPlainObject).slice(-500),
      },
      tool,
      zoom: clamp(Number(input.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
      cursor: {
        x: clamp(Number(cursor.x) || WORLD.width / 2, 0, WORLD.width),
        y: clamp(Number(cursor.y) || WORLD.height / 2, 0, WORLD.height),
      },
      selectedId: typeof input.selectedId === "string" ? input.selectedId : null,
      style: {
        color: /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : base.style.color,
        width: clamp(Number(style.width) || base.style.width, 1, 24),
      },
      lastExport,
      updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null,
    };
  }

  function readStoredState(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return { state: normalizeState(payload), history: payload.history };
  }

  function loadState() {
    try {
      const stored = readStoredState(STORAGE_KEY);
      if (stored) {
        restoreHistory(stored);
        loadNotice = "已从本机恢复";
        return stored.state;
      }
    } catch (error) {
      try {
        const stored = readStoredState(BACKUP_KEY);
        if (stored) {
          restoreHistory(stored);
          storageWarning = `本地工程数据损坏，已从最近有效备份恢复。原因：${error.message}`;
          loadNotice = "已从备份恢复";
          return stored.state;
        }
      } catch (backupError) {
        storageWarning = `本地工程与备份均无法读取，已创建新工程。原因：${backupError.message}`;
      }
    }
    return defaultState();
  }

  function persistedPayload() {
    return {
      ...state,
      updatedAt: new Date().toISOString(),
      history: {
        undo: undoStack.slice(-MAX_HISTORY),
        redo: redoStack.slice(-MAX_HISTORY),
      },
    };
  }

  function saveState({ quiet = false } = {}) {
    try {
      const previous = localStorage.getItem(STORAGE_KEY);
      if (previous) {
        try {
          normalizeState(JSON.parse(previous));
          localStorage.setItem(BACKUP_KEY, previous);
        } catch {
          // A corrupt current document must never overwrite the known-good backup.
        }
      }
      const payload = persistedPayload();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      state.updatedAt = payload.updatedAt;
      if (!quiet) {
        const time = new Date(payload.updatedAt);
        elements.saveState.textContent = `已自动保存 ${pad(time.getHours())}:${pad(time.getMinutes())}`;
        elements.saveState.classList.remove("is-error");
        elements.persistenceNote.textContent = `本机 ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
      }
      return true;
    } catch (error) {
      elements.saveState.textContent = "自动保存失败";
      elements.saveState.classList.add("is-error");
      showError(`无法保存工程：${error.message}。当前画面仍可继续编辑，请导出文件避免丢失。`);
      return false;
    }
  }

  function restoreHistory(payload) {
    const history = isPlainObject(payload?.history) ? payload.history : {};
    undoStack = Array.isArray(history.undo) ? history.undo.slice(-MAX_HISTORY) : [];
    redoStack = Array.isArray(history.redo) ? history.redo.slice(-MAX_HISTORY) : [];
  }

  function metrics() {
    const rect = elements.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const baseScale = width / WORLD.width;
    return { rect, width, height, baseScale, scale: baseScale * state.zoom };
  }

  function worldToScreen(point, view = metrics()) {
    return {
      x: (point.x - WORLD.width / 2) * view.scale + view.width / 2,
      y: (point.y - WORLD.height / 2) * view.scale + view.height / 2,
    };
  }

  function screenToWorld(clientX, clientY, view = metrics()) {
    const x = (clientX - view.rect.left - view.width / 2) / view.scale + WORLD.width / 2;
    const y = (clientY - view.rect.top - view.height / 2) / view.scale + WORLD.height / 2;
    return {
      x: Math.round(clamp(x, 0, WORLD.width) * 10) / 10,
      y: Math.round(clamp(y, 0, WORLD.height) * 10) / 10,
    };
  }

  function hexToRgba(hex, alpha) {
    const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "20242c";
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function objectStyle(object) {
    return {
      color: /^#[0-9a-f]{6}$/i.test(object.color) ? object.color : state.style.color,
      width: clamp(Number(object.strokeWidth) || 1, 1, 24),
    };
  }

  function traceObject(ctx, object, view, isDraft = false) {
    const style = objectStyle(object);
    ctx.strokeStyle = style.color;
    ctx.fillStyle = hexToRgba(style.color, 0.08);
    ctx.lineWidth = Math.max(1, style.width * view.scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (isDraft) {
      ctx.setLineDash([7, 6]);
      ctx.globalAlpha = 0.9;
    }

    if (object.type === "pen" && Array.isArray(object.points) && object.points.length) {
      ctx.beginPath();
      object.points.forEach((point, index) => {
        const p = worldToScreen(point, view);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      if (object.points.length === 1) {
        const p = worldToScreen(object.points[0], view);
        ctx.lineTo(p.x + 0.1, p.y + 0.1);
      }
      ctx.stroke();
    } else if (object.type === "line") {
      const start = worldToScreen({ x: object.x1, y: object.y1 }, view);
      const end = worldToScreen({ x: object.x2, y: object.y2 }, view);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else if (object.type === "rect") {
      const start = worldToScreen({ x: object.x, y: object.y }, view);
      const w = Number(object.width) * view.scale;
      const h = Number(object.height) * view.scale;
      if (Number.isFinite(w) && Number.isFinite(h)) {
        ctx.fillRect(start.x, start.y, w, h);
        ctx.strokeRect(start.x, start.y, w, h);
      }
    } else if (object.type === "ellipse") {
      const center = worldToScreen({ x: object.cx, y: object.cy }, view);
      const rx = Math.abs(Number(object.rx)) * view.scale;
      const ry = Math.abs(Number(object.ry)) * view.scale;
      if (Number.isFinite(rx) && Number.isFinite(ry) && rx + ry > 0) {
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (object.type === "text" && typeof object.text === "string") {
      const point = worldToScreen({ x: object.x, y: object.y }, view);
      const size = Math.max(12, Number(object.fontSize) || 32) * view.scale;
      ctx.font = `600 ${size}px "Focus Sans", "Noto Sans SC", sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = style.color;
      ctx.fillText(object.text, point.x, point.y);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function drawGrid(ctx, view) {
    const zoomedStep = state.zoom < 0.7 ? 100 : 50;
    const left = (0 - WORLD.width / 2) * view.scale + view.width / 2;
    const top = (0 - WORLD.height / 2) * view.scale + view.height / 2;
    const right = (WORLD.width - WORLD.width / 2) * view.scale + view.width / 2;
    const bottom = (WORLD.height - WORLD.height / 2) * view.scale + view.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    ctx.strokeStyle = "#e6e2d9";
    ctx.lineWidth = 1;
    const step = zoomedStep * view.scale;
    for (let x = left; x <= right + 0.5; x += step) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, top);
      ctx.lineTo(Math.round(x) + 0.5, bottom);
      ctx.stroke();
    }
    for (let y = top; y <= bottom + 0.5; y += step) {
      ctx.beginPath();
      ctx.moveTo(left, Math.round(y) + 0.5);
      ctx.lineTo(right, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function objectBounds(object) {
    if (!object) return null;
    if (object.type === "pen" && Array.isArray(object.points)) {
      const xs = object.points.map((point) => Number(point.x) || 0);
      const ys = object.points.map((point) => Number(point.y) || 0);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    if (object.type === "line") {
      const x = Math.min(object.x1, object.x2);
      const y = Math.min(object.y1, object.y2);
      return { x, y, width: Math.abs(object.x2 - object.x1), height: Math.abs(object.y2 - object.y1) };
    }
    if (object.type === "rect") {
      return { x: object.x, y: object.y, width: object.width, height: object.height };
    }
    if (object.type === "ellipse") {
      return { x: object.cx - Math.abs(object.rx), y: object.cy - Math.abs(object.ry), width: Math.abs(object.rx) * 2, height: Math.abs(object.ry) * 2 };
    }
    if (object.type === "text") {
      const size = Math.max(12, Number(object.fontSize) || 32);
      return { x: object.x, y: object.y - size, width: Math.max(size, String(object.text || "").length * size * 0.62), height: size * 1.2 };
    }
    return null;
  }

  function drawSelection(ctx, object, view) {
    const bounds = objectBounds(object);
    if (!bounds) return;
    const p = worldToScreen({ x: bounds.x, y: bounds.y }, view);
    const w = bounds.width * view.scale;
    const h = bounds.height * view.scale;
    const padding = 7;
    ctx.save();
    ctx.strokeStyle = "#0d7068";
    ctx.fillStyle = "rgba(13, 112, 104, 0.07)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(p.x - padding, p.y - padding, w + padding * 2, h + padding * 2);
    ctx.strokeRect(p.x - padding, p.y - padding, w + padding * 2, h + padding * 2);
    ctx.restore();
  }

  function drawCursor(ctx, view) {
    const point = worldToScreen(state.cursor, view);
    const focused = document.activeElement === elements.canvas;
    const radius = focused ? 11 : 8;
    ctx.save();
    ctx.strokeStyle = focused ? "#0d7068" : "#5d6470";
    ctx.fillStyle = "#fffdf8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(point.x - radius - 5, point.y);
    ctx.lineTo(point.x + radius + 5, point.y);
    ctx.moveTo(point.x, point.y - radius - 5);
    ctx.lineTo(point.x, point.y + radius + 5);
    ctx.stroke();
    ctx.fillStyle = focused ? "#0d7068" : "#5d6470";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    const tool = TOOLS[state.tool];
    const label = `${tool.key} ${tool.label} · ${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)}`;
    ctx.font = '700 10px "Focus Sans", "Noto Sans SC", sans-serif';
    const textWidth = ctx.measureText(label).width;
    const boxWidth = textWidth + 16;
    const boxHeight = 24;
    let labelX = point.x + 18;
    let labelY = point.y + 18;
    if (labelX + boxWidth > view.width - 8) labelX = point.x - boxWidth - 18;
    if (labelY + boxHeight > view.height - 8) labelY = point.y - boxHeight - 18;
    labelX = clamp(labelX, 8, Math.max(8, view.width - boxWidth - 8));
    labelY = clamp(labelY, 8, Math.max(8, view.height - boxHeight - 8));
    ctx.fillStyle = focused ? "#20242c" : "rgba(32, 36, 44, 0.86)";
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, boxWidth, boxHeight, 5);
    ctx.fill();
    ctx.fillStyle = "#fffdf8";
    ctx.textBaseline = "middle";
    ctx.fillText(label, labelX + 8, labelY + boxHeight / 2 + 0.5);
    ctx.restore();
  }

  function renderNow() {
    renderQueued = false;
    const view = metrics();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const targetWidth = Math.round(view.width * dpr);
    const targetHeight = Math.round(view.height * dpr);
    if (elements.canvas.width !== targetWidth || elements.canvas.height !== targetHeight) {
      elements.canvas.width = targetWidth;
      elements.canvas.height = targetHeight;
    }
    const ctx = elements.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, view.width, view.height);
    drawGrid(ctx, view);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.clip();
    for (const object of state.project.objects) traceObject(ctx, object, view);
    const selected = state.project.objects.find((object) => object.id === state.selectedId);
    if (selected) drawSelection(ctx, selected, view);
    if (draft) {
      const draftObject = draftToObject(draft);
      if (draftObject) traceObject(ctx, draftObject, view, true);
    }
    drawCursor(ctx, view);
    ctx.restore();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderNow);
  }

  function draftToObject(value) {
    if (!value) return null;
    const start = value.start;
    const end = value.current || start;
    if (value.type === "pen") {
      return {
        type: "pen",
        points: value.points,
        color: state.style.color,
        strokeWidth: state.style.width,
      };
    }
    if (value.type === "line") {
      return {
        type: "line",
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        color: state.style.color,
        strokeWidth: state.style.width,
      };
    }
    if (value.type === "rect") {
      return {
        type: "rect",
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        color: state.style.color,
        strokeWidth: state.style.width,
      };
    }
    if (value.type === "ellipse") {
      return {
        type: "ellipse",
        cx: (start.x + end.x) / 2,
        cy: (start.y + end.y) / 2,
        rx: Math.abs(end.x - start.x) / 2,
        ry: Math.abs(end.y - start.y) / 2,
        color: state.style.color,
        strokeWidth: state.style.width,
      };
    }
    return null;
  }

  function pushHistory() {
    undoStack.push(clone(state.project.objects));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
  }

  function commitObject(object) {
    if (!object) return false;
    pushHistory();
    object.id = uid();
    object.createdAt = new Date().toISOString();
    state.project.objects.push(object);
    state.selectedId = object.id;
    draft = null;
    saveState();
    updateUI();
    announce(`已创建${TOOLS[state.tool]?.label || "图形"}，共 ${state.project.objects.length} 个对象。`);
    return true;
  }

  function beginDraft(point) {
    cancelDraft(false);
    if (state.tool === "text") {
      openTextDialog(point);
      return;
    }
    if (state.tool === "select") {
      const hit = hitTest(point);
      state.selectedId = hit?.id || null;
      saveState();
      updateUI();
      announce(hit ? `已选择${objectTypeLabel(hit.type)}。` : "此处没有可选择的图形。");
      return;
    }
    if (state.tool === "eraser") {
      const hit = hitTest(point);
      if (hit) deleteObject(hit.id, "已擦除图形");
      else announce("橡皮光标下没有图形。");
      return;
    }
    draft = { type: state.tool, start: { ...point }, current: { ...point }, points: [point] };
    updateUI();
    announce(`已开始${TOOLS[state.tool].label}，当前位置 ${Math.round(point.x)}, ${Math.round(point.y)}。`);
    scheduleRender();
  }

  function extendDraft(point) {
    if (!draft) return;
    draft.current = { ...point };
    if (draft.type === "pen") {
      const last = draft.points[draft.points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1.5) {
        draft.points.push({ ...point });
      }
      if (draft.points.length > 2000) draft.points.shift();
    }
    scheduleRender();
  }

  function completeDraft() {
    if (!draft) return false;
    const object = draftToObject(draft);
    const tooSmall = !object
      || (object.type === "pen" && object.points.length < 2)
      || (object.type === "line" && Math.hypot(object.x2 - object.x1, object.y2 - object.y1) < 2)
      || ((object.type === "rect" || object.type === "ellipse") && (object.width < 2 || object.height < 2));
    if (tooSmall) {
      announce("图形尺寸过小，尚未创建。请继续移动焦点或按 Esc 取消。");
      return false;
    }
    return commitObject(object);
  }

  function cancelDraft(withAnnouncement = true) {
    const hadDraft = Boolean(draft);
    draft = null;
    if (hadDraft && withAnnouncement) announce("已取消当前绘制。");
    scheduleRender();
  }

  function beginGesture(point, pointerId) {
    gesture = { pointerId, start: { ...point }, last: { ...point }, moved: false };
    if (state.tool === "select" || state.tool === "eraser" || state.tool === "text") {
      beginDraft(point);
      gesture.mode = "action";
      return;
    }
    beginDraft(point);
    gesture.mode = "draw";
  }

  function moveGesture(point) {
    if (!gesture) return;
    gesture.last = { ...point };
    gesture.moved = true;
    if (gesture.mode === "draw") extendDraft(point);
    state.cursor = { ...point };
    scheduleRender();
    updateFocusOnly();
  }

  function finishGesture(point) {
    if (!gesture) return;
    if (gesture.mode === "draw" && draft) {
      extendDraft(point);
      state.cursor = { ...point };
      completeDraft();
    }
    gesture = null;
    updateUI();
  }

  function cancelGesture() {
    gesture = null;
    cancelDraft(false);
    activePointers.clear();
    pinch = null;
    updateUI();
  }

  function distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
  }

  function hitTest(point) {
    const tolerance = 10;
    for (let index = state.project.objects.length - 1; index >= 0; index -= 1) {
      const object = state.project.objects[index];
      const style = objectStyle(object);
      const reach = tolerance + style.width / 2;
      if (object.type === "pen" && Array.isArray(object.points)) {
        for (let i = 1; i < object.points.length; i += 1) {
          if (distanceToSegment(point, object.points[i - 1], object.points[i]) <= reach) return object;
        }
      }
      if (object.type === "line" && distanceToSegment(
        point,
        { x: object.x1, y: object.y1 },
        { x: object.x2, y: object.y2 },
      ) <= reach) return object;
      if (object.type === "rect") {
        const inside = point.x >= object.x - reach
          && point.x <= object.x + object.width + reach
          && point.y >= object.y - reach
          && point.y <= object.y + object.height + reach;
        if (inside) return object;
      }
      if (object.type === "ellipse" && object.rx > 0 && object.ry > 0) {
        const nx = (point.x - object.cx) / (object.rx + reach);
        const ny = (point.y - object.cy) / (object.ry + reach);
        if (nx * nx + ny * ny <= 1) return object;
      }
      if (object.type === "text") {
        const bounds = objectBounds(object);
        if (bounds
          && point.x >= bounds.x - reach
          && point.x <= bounds.x + bounds.width + reach
          && point.y >= bounds.y - reach
          && point.y <= bounds.y + bounds.height + reach) return object;
      }
    }
    return null;
  }

  function deleteObject(id, message = "已删除所选对象") {
    const index = state.project.objects.findIndex((object) => object.id === id);
    if (index < 0) return false;
    pushHistory();
    state.project.objects.splice(index, 1);
    state.selectedId = null;
    saveState();
    updateUI();
    announce(`${message}，剩余 ${state.project.objects.length} 个对象。`);
    return true;
  }

  function deleteSelected() {
    if (!state.selectedId) {
      announce("没有选中的对象。");
      return;
    }
    deleteObject(state.selectedId);
  }

  function undo() {
    if (!undoStack.length) {
      announce("没有可撤销的操作。");
      return;
    }
    redoStack.push(clone(state.project.objects));
    state.project.objects = undoStack.pop();
    if (!state.project.objects.some((object) => object.id === state.selectedId)) state.selectedId = null;
    draft = null;
    saveState();
    updateUI();
    announce(`已撤销，当前 ${state.project.objects.length} 个对象。`);
  }

  function redo() {
    if (!redoStack.length) {
      announce("没有可重做的操作。");
      return;
    }
    undoStack.push(clone(state.project.objects));
    state.project.objects = redoStack.pop();
    if (!state.project.objects.some((object) => object.id === state.selectedId)) state.selectedId = null;
    draft = null;
    saveState();
    updateUI();
    announce(`已重做，当前 ${state.project.objects.length} 个对象。`);
  }

  function objectTypeLabel(type) {
    return {
      pen: "画笔线条",
      line: "直线",
      rect: "矩形",
      ellipse: "椭圆",
      text: "文字",
    }[type] || "图形";
  }

  function previewLabel(object) {
    if (object.type === "text") {
      const text = String(object.text || "").replace(/\s+/g, " ").trim();
      return `文字 · ${text.length > 18 ? `${text.slice(0, 18)}…` : text}`;
    }
    if (object.type === "pen") return `画笔 · ${Array.isArray(object.points) ? object.points.length : 0} 个点`;
    return objectTypeLabel(object.type);
  }

  function formatExport(record) {
    if (!record || !record.format) return "尚未导出";
    const date = new Date(record.at);
    if (Number.isNaN(date.getTime())) return `${record.format.toUpperCase()} · 已记录`;
    return `${record.format.toUpperCase()} · ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function announce(message) {
    if (!message) return;
    elements.canvasStatus.textContent = "";
    window.setTimeout(() => {
      elements.canvasStatus.textContent = message;
    }, 20);
  }

  function updateFocusOnly() {
    elements.hudFocus.textContent = `焦点 ${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)}`;
    elements.focusSummary.textContent = `工具：${TOOLS[state.tool].label}\n坐标：${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)} · 缩放 ${Math.round(state.zoom * 100)}%`;
    elements.canvas.setAttribute(
      "aria-label",
      `绘图画布，当前工具：${TOOLS[state.tool].label}，焦点 ${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)}，缩放 ${Math.round(state.zoom * 100)}%。`
        + "使用方向键移动光标，空格键开始或完成绘制。",
    );
    scheduleRender();
  }

  function renderObjectList() {
    const activeButton = document.activeElement?.closest?.("#object-list button");
    const activeId = activeButton?.dataset.objectId;
    elements.objectList.replaceChildren();
    if (!state.project.objects.length) {
      const empty = document.createElement("li");
      empty.className = "object-empty";
      empty.textContent = "还没有对象。按空格键在画布焦点处绘制。";
      elements.objectList.append(empty);
      return;
    }
    state.project.objects.forEach((object, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.objectId = object.id;
      if (object.id === state.selectedId) button.setAttribute("aria-current", "true");
      button.setAttribute("aria-label", `对象 ${index + 1}，${previewLabel(object)}${object.id === state.selectedId ? "，已选择" : ""}`);
      const swatch = document.createElement("span");
      swatch.className = "object-swatch";
      swatch.style.background = objectStyle(object).color;
      const label = document.createElement("span");
      label.textContent = previewLabel(object);
      const kind = document.createElement("span");
      kind.className = "object-kind";
      kind.textContent = `#${index + 1}`;
      button.append(swatch, label, kind);
      item.append(button);
      elements.objectList.append(item);
    });
    if (activeId) {
      requestAnimationFrame(() => {
        elements.objectList.querySelector(`[data-object-id="${CSS.escape(activeId)}"]`)?.focus({ preventScroll: true });
      });
    }
  }

  function updateUI({ preserveStatus = false } = {}) {
    const tool = TOOLS[state.tool];
    elements.toolButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.tool === state.tool));
    });
    elements.strokeColor.value = state.style.color;
    elements.strokeWidth.value = state.style.width;
    elements.colorValue.textContent = state.style.color.toUpperCase();
    elements.widthValue.textContent = `${state.style.width} px`;
    elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    elements.zoomValue.value = `${Math.round(state.zoom * 100)}%`;
    const keyBadge = document.createElement("b");
    keyBadge.textContent = tool.key;
    elements.hudTool.replaceChildren(keyBadge, document.createTextNode(` ${tool.label}`));
    elements.hudFocus.textContent = `焦点 ${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)}`;
    elements.focusSummary.textContent = `工具：${tool.label}\n坐标：${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)} · 缩放 ${Math.round(state.zoom * 100)}%`;
    elements.focusSource.textContent = lastFocusedControl;
    elements.emptyHint.hidden = state.project.objects.length > 0 || Boolean(draft);
    elements.objectCount.textContent = `${state.project.objects.length} 个对象`;
    elements.projectName.textContent = state.project.name;
    elements.lastExport.textContent = formatExport(state.lastExport);
    elements.deleteObject.disabled = !state.selectedId;
    elements.undo.disabled = undoStack.length === 0;
    elements.redo.disabled = redoStack.length === 0;
    elements.selectionNote.textContent = state.selectedId
      ? "所选对象已在画布上高亮，可从对象列表切换。"
      : "选择工具后，用空格拾取对象。";
    if (state.updatedAt) {
      const saved = new Date(state.updatedAt);
      elements.persistenceNote.textContent = `本机 ${pad(saved.getHours())}:${pad(saved.getMinutes())}:${pad(saved.getSeconds())}`;
      elements.saveState.textContent = `已自动保存 ${pad(saved.getHours())}:${pad(saved.getMinutes())}`;
    }
    elements.canvas.setAttribute(
      "aria-label",
      `绘图画布，当前工具：${tool.label}，焦点 ${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)}，缩放 ${Math.round(state.zoom * 100)}%，`
        + `共 ${state.project.objects.length} 个对象${state.selectedId ? "，已选择对象" : ""}。`
        + "使用方向键移动光标，空格键开始或完成绘制。",
    );
    elements.canvas.dataset.tool = state.tool;
    renderObjectList();
    if (!preserveStatus) {
      announce(`工具${tool.label}。焦点 ${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)}。缩放 ${Math.round(state.zoom * 100)}%。共 ${state.project.objects.length} 个对象。`);
    }
    scheduleRender();
  }

  function setTool(tool, { focusCanvas = false } = {}) {
    if (!TOOLS[tool]) return;
    cancelDraft(false);
    state.tool = tool;
    state.selectedId = tool === "select" ? state.selectedId : null;
    saveState();
    updateUI();
    announce(`已选择${TOOLS[tool].label}工具，快捷键 ${TOOLS[tool].key}。`);
    if (focusCanvas) elements.canvas.focus({ preventScroll: true });
  }

  function setZoom(nextZoom, { announceChange = true } = {}) {
    const zoom = Math.round(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM) * 100) / 100;
    const wasClamped = nextZoom < MIN_ZOOM || nextZoom > MAX_ZOOM;
    if (zoom === state.zoom) {
      if (wasClamped) announce(`缩放已达到${nextZoom < MIN_ZOOM ? "最小值 50%" : "最大值 400%"}。`);
      return;
    }
    state.zoom = zoom;
    saveState();
    updateUI({ preserveStatus: true });
    if (announceChange) {
      announce(`缩放 ${Math.round(zoom * 100)}%。${wasClamped ? `已限制在 ${MIN_ZOOM * 100}% 至 ${MAX_ZOOM * 100}% 范围内。` : ""}`);
    }
  }

  function zoomBy(factor) {
    setZoom(state.zoom * factor);
  }

  function moveCursor(dx, dy) {
    state.cursor = {
      x: clamp(Math.round((state.cursor.x + dx) * 10) / 10, 0, WORLD.width),
      y: clamp(Math.round((state.cursor.y + dy) * 10) / 10, 0, WORLD.height),
    };
    if (draft) extendDraft(state.cursor);
    saveState();
    updateFocusOnly();
    updateUI({ preserveStatus: true });
    announce(`焦点 ${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)}。`);
  }

  function pointerPosition(event) {
    return screenToWorld(event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (document.activeElement !== elements.canvas) {
      elements.canvas.focus({ preventScroll: true });
    }
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType === "touch" && activePointers.size === 2) {
      cancelDraft(false);
      gesture = null;
      const points = [...activePointers.values()];
      pinch = {
        startDistance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
        startZoom: state.zoom,
      };
      announce(`双指缩放，当前 ${Math.round(state.zoom * 100)}%。`);
      return;
    }
    if (activePointers.size > 1) return;
    const point = pointerPosition(event);
    state.cursor = point;
    updateFocusOnly();
    beginGesture(point, event.pointerId);
    try {
      elements.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser already cancelled the gesture.
    }
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && activePointers.size >= 2) {
      const points = [...activePointers.values()];
      const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
      setZoom(pinch.startZoom * (distance / pinch.startDistance), { announceChange: false });
      event.preventDefault();
      return;
    }
    if (gesture && gesture.pointerId === event.pointerId) {
      moveGesture(pointerPosition(event));
      event.preventDefault();
    }
  }

  function onPointerUp(event) {
    const wasPinching = Boolean(pinch);
    activePointers.delete(event.pointerId);
    try {
      if (elements.canvas.hasPointerCapture(event.pointerId)) {
        elements.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }
    if (wasPinching) {
      if (activePointers.size < 2) {
        pinch = null;
        gesture = null;
        announce(`双指缩放完成，当前 ${Math.round(state.zoom * 100)}%。`);
        updateUI();
      }
      return;
    }
    if (gesture && gesture.pointerId === event.pointerId) {
      finishGesture(pointerPosition(event));
      event.preventDefault();
    }
  }

  function onPointerCancel(event) {
    activePointers.delete(event.pointerId);
    if (pinch) {
      pinch = null;
      gesture = null;
      announce("缩放手势已取消，工程未更改。");
      updateUI();
      return;
    }
    if (gesture) {
      cancelGesture();
      announce("指针手势已取消，草稿未写入工程。");
    }
  }

  function isEditableTarget(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
  }

  function onCanvasKeyDown(event) {
    const key = event.key;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? 1 : 10;
    const directions = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (directions[key]) {
      event.preventDefault();
      moveCursor(...directions[key]);
      return;
    }
    if (key === " " || key === "Enter") {
      event.preventDefault();
      if (draft) completeDraft();
      else beginDraft({ ...state.cursor });
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      if (draft) cancelDraft();
      else if (state.selectedId) {
        state.selectedId = null;
        saveState();
        updateUI();
        announce("已取消对象选择。");
      }
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    }
  }

  function onGlobalKeyDown(event) {
    if (event.defaultPrevented) return;
    if (document.querySelector("dialog[open]")) return;
    const key = event.key;
    const command = event.ctrlKey || event.metaKey;
    if (key === "Escape" && !elements.errorBanner.hidden) {
      event.preventDefault();
      hideError();
      announce("已关闭错误提示，工程状态未更改。");
      return;
    }
    if (command && key.toLowerCase() === "z" && !isEditableTarget(event.target)) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (command || event.altKey || isEditableTarget(event.target)) return;
    if (key === "?") {
      event.preventDefault();
      openHelp();
      return;
    }
    if (key === "+" || key === "=") {
      event.preventDefault();
      zoomBy(1.25);
      return;
    }
    if (key === "-" || key === "_") {
      event.preventDefault();
      zoomBy(0.8);
      return;
    }
    if (key === "0") {
      event.preventDefault();
      setZoom(1);
      return;
    }
    const upper = key.length === 1 ? key.toUpperCase() : "";
    const byKey = TOOL_ORDER.find((tool) => TOOLS[tool].key === upper);
    const index = /^[1-7]$/.test(key) ? Number(key) - 1 : -1;
    if (byKey || index >= 0) {
      event.preventDefault();
      setTool(byKey || TOOL_ORDER[index]);
    }
  }

  function onFocusIn(event) {
    if (event.target === elements.canvas) {
      lastFocusedControl = "画布";
    } else if (event.target?.matches?.("button, a, input, textarea")) {
      const label = event.target.getAttribute("aria-label")
        || event.target.closest("button")?.textContent?.trim()
        || event.target.labels?.[0]?.textContent?.trim()
        || event.target.tagName.toLowerCase();
      lastFocusedControl = `控件：${label.replace(/\s+/g, " ").slice(0, 30)}`;
    }
    elements.focusSource.textContent = lastFocusedControl;
    scheduleRender();
  }

  function openHelp() {
    if (!elements.helpDialog.open) elements.helpDialog.showModal();
    elements.helpDialog.querySelector(".dialog-close")?.focus();
  }

  function openTextDialog(point) {
    pendingTextPoint = { ...point };
    elements.textPosition.textContent = `插入位置：${Math.round(point.x)}, ${Math.round(point.y)}`;
    elements.textInput.value = "";
    elements.textError.hidden = true;
    elements.textError.textContent = "";
    if (!elements.textDialog.open) elements.textDialog.showModal();
    elements.textInput.focus();
  }

  function closeTextDialog() {
    pendingTextPoint = null;
    if (elements.textDialog.open) elements.textDialog.close();
    elements.canvas.focus({ preventScroll: true });
  }

  function submitText(event) {
    event.preventDefault();
    const text = elements.textInput.value.trim();
    if (!text) {
      elements.textError.textContent = "请输入至少一个字符；工程未更改。";
      elements.textError.hidden = false;
      elements.textInput.focus();
      announce("文字为空，未插入。请输入文字后重试。");
      return;
    }
    const point = pendingTextPoint || { ...state.cursor };
    const object = {
      type: "text",
      x: point.x,
      y: point.y,
      text,
      fontSize: Math.max(18, state.style.width * 6),
      color: state.style.color,
      strokeWidth: state.style.width,
    };
    pendingTextPoint = null;
    elements.textDialog.close();
    commitObject(object);
    elements.canvas.focus({ preventScroll: true });
  }

  function clearCanvas() {
    if (!state.project.objects.length) {
      announce("画布已经是空的。");
      return;
    }
    pushHistory();
    state.project.objects = [];
    state.selectedId = null;
    draft = null;
    saveState();
    updateUI();
    announce("画布已清空，可使用撤销恢复。");
  }

  function showError(message, action = null, actionLabel = "重试") {
    pendingErrorAction = action;
    elements.errorMessage.textContent = message;
    elements.errorAction.textContent = actionLabel;
    elements.errorAction.hidden = !action;
    elements.errorBanner.hidden = false;
  }

  function hideError() {
    elements.errorBanner.hidden = true;
    pendingErrorAction = null;
  }

  function svgEscape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function svgNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
  }

  function objectToSvg(object) {
    const style = objectStyle(object);
    const common = `stroke="${style.color}" stroke-width="${style.width}" stroke-linecap="round" stroke-linejoin="round"`;
    if (object.type === "pen" && Array.isArray(object.points) && object.points.length) {
      const path = object.points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${svgNumber(point.x)} ${svgNumber(point.y)}`)
        .join(" ");
      return `<path data-object-id="${svgEscape(object.id || "")}" d="${path}" fill="none" ${common}/>`;
    }
    if (object.type === "line") {
      return `<line data-object-id="${svgEscape(object.id || "")}" x1="${svgNumber(object.x1)}" y1="${svgNumber(object.y1)}" x2="${svgNumber(object.x2)}" y2="${svgNumber(object.y2)}" fill="none" ${common}/>`;
    }
    if (object.type === "rect") {
      return `<rect data-object-id="${svgEscape(object.id || "")}" x="${svgNumber(object.x)}" y="${svgNumber(object.y)}" width="${svgNumber(object.width)}" height="${svgNumber(object.height)}" fill="${style.color}" fill-opacity="0.08" ${common}/>`;
    }
    if (object.type === "ellipse") {
      return `<ellipse data-object-id="${svgEscape(object.id || "")}" cx="${svgNumber(object.cx)}" cy="${svgNumber(object.cy)}" rx="${svgNumber(Math.abs(object.rx))}" ry="${svgNumber(Math.abs(object.ry))}" fill="${style.color}" fill-opacity="0.08" ${common}/>`;
    }
    if (object.type === "text" && typeof object.text === "string") {
      const size = Math.max(12, Number(object.fontSize) || 32);
      return `<text data-object-id="${svgEscape(object.id || "")}" x="${svgNumber(object.x)}" y="${svgNumber(object.y)}" fill="${style.color}" font-family="sans-serif" font-size="${svgNumber(size)}" font-weight="600" xml:space="preserve">${svgEscape(object.text)}</text>`;
    }
    return "";
  }

  function buildSvg() {
    const objects = state.project.objects.map(objectToSvg).filter(Boolean).join("\n  ");
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" width="${WORLD.width}" height="${WORLD.height}" viewBox="0 0 ${WORLD.width} ${WORLD.height}" role="img" aria-labelledby="export-title export-desc">`,
      `  <title id="export-title">焦点画布工程 · ${svgEscape(state.project.name)}</title>`,
      `  <desc id="export-desc">${state.project.objects.length} 个对象，由焦点画布导出。</desc>`,
      `  <rect width="${WORLD.width}" height="${WORLD.height}" fill="#fffdf8"/>`,
      objects ? `  ${objects}` : "",
      "</svg>",
      "",
    ].filter((line) => line !== "").join("\n");
  }

  function renderBitmapCanvas(scale = 2) {
    const bitmap = document.createElement("canvas");
    bitmap.width = WORLD.width * scale;
    bitmap.height = WORLD.height * scale;
    const ctx = bitmap.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    const view = {
      width: WORLD.width,
      height: WORLD.height,
      baseScale: 1,
      scale: 1,
      rect: { left: 0, top: 0, width: WORLD.width, height: WORLD.height },
    };
    state.project.objects.forEach((object) => traceObject(ctx, object, view));
    return bitmap;
  }

  function pngBlob() {
    const bitmap = renderBitmapCanvas(2);
    return new Promise((resolve, reject) => {
      bitmap.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("浏览器无法生成 PNG 数据"));
      }, "image/png");
    });
  }

  function downloadBlob(blob, format) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
    const filename = `focus-canvas-${stamp}.${format}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return filename;
  }

  async function exportProject(format) {
    if (!["svg", "png"].includes(format)) throw new Error(`不支持的导出格式：${format}`);
    const buttons = [elements.exportSvg, elements.exportPng];
    buttons.forEach((button) => { button.disabled = true; });
    elements.exportResult.classList.remove("is-error");
    elements.exportResult.textContent = `正在生成 ${format.toUpperCase()}…`;
    elements.canvas.setAttribute("aria-busy", "true");
    hideError();
    try {
      if (faults.export) {
        faults.export = false;
        throw new Error("模拟导出故障：下载通道暂时不可用");
      }
      const isSvg = format === "svg";
      const blob = isSvg
        ? new Blob([buildSvg()], { type: "image/svg+xml;charset=utf-8" })
        : await pngBlob();
      const filename = downloadBlob(blob, format);
      const exportedAt = new Date().toISOString();
      state.lastExport = {
        format,
        at: exportedAt,
        objectCount: state.project.objects.length,
        filename,
      };
      saveState();
      updateUI({ preserveStatus: true });
      elements.exportResult.textContent = `已导出 ${filename} · ${state.project.objects.length} 个对象`;
      announce(`${format.toUpperCase()} 导出成功，包含 ${state.project.objects.length} 个对象，工程状态保持不变。`);
      return { ok: true, filename, format, objectCount: state.project.objects.length };
    } catch (error) {
      const message = `${format.toUpperCase()} 导出失败：${error.message}。工程和导出前状态均未更改。`;
      elements.exportResult.textContent = message;
      elements.exportResult.classList.add("is-error");
      showError(message, () => exportProject(format), "重试导出");
      announce(message);
      return { ok: false, reason: message };
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      elements.canvas.removeAttribute("aria-busy");
    }
  }

  function wireEvents() {
    elements.toolButtons.forEach((button) => {
      button.addEventListener("click", () => setTool(button.dataset.tool));
    });
    elements.undo.addEventListener("click", undo);
    elements.redo.addEventListener("click", redo);
    elements.strokeColor.addEventListener("input", () => {
      state.style.color = elements.strokeColor.value;
      saveState();
      updateUI({ preserveStatus: true });
      announce(`画笔颜色 ${state.style.color}。`);
    });
    elements.strokeWidth.addEventListener("input", () => {
      state.style.width = clamp(Number(elements.strokeWidth.value) || 4, 1, 24);
      saveState();
      updateUI({ preserveStatus: true });
      announce(`画笔线宽 ${state.style.width} 像素。`);
    });
    elements.zoomIn.addEventListener("click", () => zoomBy(1.25));
    elements.zoomOut.addEventListener("click", () => zoomBy(0.8));
    elements.resetZoom.addEventListener("click", () => setZoom(1));
    elements.exportSvg.addEventListener("click", () => exportProject("svg"));
    elements.exportPng.addEventListener("click", () => exportProject("png"));
    elements.helpButton.addEventListener("click", openHelp);
    elements.helpDialog.querySelector(".dialog-close")?.addEventListener("click", () => elements.helpDialog.close());
    elements.textDialog.querySelector(".dialog-close")?.addEventListener("click", closeTextDialog);
    elements.textForm.addEventListener("submit", submitText);
    elements.textDialog.addEventListener("close", () => { pendingTextPoint = null; });
    elements.clearCanvas.addEventListener("click", () => elements.clearDialog.showModal());
    elements.confirmClear.addEventListener("click", clearCanvas);
    elements.deleteObject.addEventListener("click", deleteSelected);
    elements.errorDismiss.addEventListener("click", hideError);
    elements.errorAction.addEventListener("click", () => {
      const action = pendingErrorAction;
      hideError();
      if (action) action();
    });
    elements.canvas.addEventListener("pointerdown", onPointerDown);
    elements.canvas.addEventListener("pointermove", onPointerMove);
    elements.canvas.addEventListener("pointerup", onPointerUp);
    elements.canvas.addEventListener("pointercancel", onPointerCancel);
    elements.canvas.addEventListener("keydown", onCanvasKeyDown);
    elements.canvas.addEventListener("focus", scheduleRender);
    elements.canvas.addEventListener("blur", scheduleRender);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onGlobalKeyDown);
    elements.objectList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-object-id]");
      if (!button) return;
      state.selectedId = button.dataset.objectId;
      saveState();
      updateUI();
      announce(`已选择${previewLabel(state.project.objects.find((object) => object.id === state.selectedId))}。`);
    });
    window.addEventListener("pagehide", () => saveState({ quiet: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveState({ quiet: true });
    });
    const observer = new ResizeObserver(scheduleRender);
    observer.observe(elements.shell);
  }

  function init() {
    state = loadState();
    if (state.selectedId && !state.project.objects.some((object) => object.id === state.selectedId)) {
      state.selectedId = null;
    }
    wireEvents();
    saveState({ quiet: true });
    updateUI();
    elements.saveState.textContent = loadNotice === "新工程" ? "新工程 · 自动保存已开启" : `${loadNotice} · 自动保存已开启`;
    document.title = `${state.project.name} · 焦点画布`;
    requestAnimationFrame(renderNow);
    if (document.fonts?.ready) {
      document.fonts.ready.then(scheduleRender);
    }
    if (storageWarning) {
      showError(storageWarning, hideError, "继续编辑");
      announce(storageWarning);
    }
    window.__focusCanvas = {
      getState() {
        return {
          project: clone(state.project),
          tool: state.tool,
          zoom: state.zoom,
          cursor: clone(state.cursor),
          selectedId: state.selectedId,
          style: clone(state.style),
          lastExport: clone(state.lastExport),
          draft: draft ? clone(draft) : null,
          undoCount: undoStack.length,
          redoCount: redoStack.length,
        };
      },
      getUiSnapshot() {
        return {
          tool: elements.canvas.dataset.tool,
          pressedTool: elements.toolButtons.find((button) => button.getAttribute("aria-pressed") === "true")?.dataset.tool,
          zoom: elements.zoomValue.textContent,
          hudTool: elements.hudTool.textContent.trim(),
          hudFocus: elements.hudFocus.textContent,
          focusSummary: elements.focusSummary.textContent,
          canvasLabel: elements.canvas.getAttribute("aria-label"),
          liveStatus: elements.canvasStatus.textContent,
          saveState: elements.saveState.textContent,
          objectCount: elements.objectCount.textContent,
        };
      },
      getStorage() {
        return {
          current: localStorage.getItem(STORAGE_KEY),
          backup: localStorage.getItem(BACKUP_KEY),
        };
      },
      injectFault(name) {
        if (name === "export") faults.export = true;
      },
      version: 1,
    };
    document.documentElement.dataset.appReady = "true";
  }

  init();

  // __APPEND__
})();
