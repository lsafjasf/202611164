import {
  clamp,
  distance,
  hitTest,
  MAX_SCALE,
  midpoint,
  MIN_SCALE,
  normalizeRect,
  normalizeWheel,
  pinchView,
  screenToWorld,
  simplifyStroke,
  worldToScreen,
  zoomAt
} from "./geometry.js";

const LONG_PRESS_MS = 540;
const LONG_PRESS_MOVE_PX = 9;
const MOUSE_DRAG_PX = 4;
const MAX_STROKE_POINTS = 8000;
const MAX_RENDER_SAMPLES = 240;
const COLORS = ["#25324a", "#df583c", "#2f6e67", "#a66a24", "#64508d"];

function now() {
  return performance.now();
}

function makeShape(points, index) {
  return {
    id: `stroke-${Date.now().toString(36)}-${index}`,
    type: "stroke",
    color: COLORS[index % COLORS.length],
    width: 3,
    createdAt: Date.now(),
    points
  };
}

export class CanvasStage {
  constructor(canvas, scene, callbacks = {}) {
    this.canvas = canvas;
    this.scene = scene;
    this.callbacks = callbacks;
    this.ctx = null;
    this.dpr = 1;
    this.cssSize = { width: 1, height: 1 };
    this.tool = "draw";
    this.selectedId = null;
    this.crosshair = { x: 0, y: 0, visible: true };
    this.pointers = new Map();
    this.gesture = { kind: "idle", label: "空闲", input: "等待输入" };
    this.panGesture = null;
    this.pinchGesture = null;
    this.drawGesture = null;
    this.selectGesture = null;
    this.longPressTimer = null;
    this.ignoreTouchUntilClear = false;
    this.frameRequest = 0;
    this.resizeFrame = 0;
    this.resizeObserver = null;
    this.abortController = new AbortController();
    this.listenerCount = 0;
    this.inputStartedAt = null;
    this.lastInputLatencyMs = null;
    this.contextLost = false;
    this.destroyed = false;
    this.metrics = {
      startedAt: Date.now(),
      renderCount: 0,
      renderSamples: [],
      lastRenderMs: null,
      lastInputLatencyMs: null,
      pointerEvents: 0,
      wheelEvents: 0,
      zoomEvents: 0,
      panEvents: 0,
      drawEvents: 0,
      longPressEvents: 0,
      errors: 0,
      renderErrors: 0,
      inputs: { mouse: 0, touch: 0, pen: 0, trackpad: 0 }
    };

    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!this.ctx) {
      throw new Error("Canvas 2D 上下文创建失败，设备可能禁用了硬件加速。");
    }
    this.bindEvents();
    this.observeSize();
    this.resize();
    this.fitView(false);
    this.requestRender("init");
  }

  bindEvents() {
    const options = { signal: this.abortController.signal };
    const add = (target, type, handler, extra = {}) => {
      target.addEventListener(type, handler, { ...options, ...extra });
      this.listenerCount += 1;
    };
    add(this.canvas, "pointerdown", (event) => this.runGuarded("POINTER_DOWN", () => this.onPointerDown(event)));
    add(this.canvas, "pointermove", (event) => this.runGuarded("POINTER_MOVE", () => this.onPointerMove(event)));
    add(this.canvas, "pointerup", (event) => this.runGuarded("POINTER_UP", () => this.onPointerUp(event)));
    add(this.canvas, "pointercancel", (event) => this.runGuarded("POINTER_CANCEL", () => this.onPointerCancel(event)));
    add(this.canvas, "lostpointercapture", (event) => this.onLostCapture(event));
    add(this.canvas, "wheel", (event) => this.runGuarded("WHEEL", () => this.onWheel(event)), { passive: false });
    add(this.canvas, "pointerleave", () => this.onPointerLeave());
    add(this.canvas, "contextmenu", (event) => event.preventDefault());
    add(this.canvas, "contextlost", (event) => this.onContextLost(event));
    add(this.canvas, "contextrestored", () => this.onContextRestored());
    add(document, "visibilitychange", () => this.onVisibilityChange());
  }

  observeSize() {
    this.resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.resize());
    });
    this.resizeObserver.observe(this.canvas);
    this.listenerCount += 1;
  }

  resize() {
    if (this.destroyed || this.contextLost) return;
    const rect = normalizeRect(this.canvas.getBoundingClientRect());
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    this.cssSize = { width: rect.width, height: rect.height };
    this.dpr = dpr;
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.crosshair.x = clamp(Number.isFinite(this.crosshair.x) ? this.crosshair.x : rect.width / 2, 0, rect.width);
    this.crosshair.y = clamp(Number.isFinite(this.crosshair.y) ? this.crosshair.y : rect.height / 2, 0, rect.height);
    if (!this.crosshair.visible) {
      this.crosshair = { x: rect.width / 2, y: rect.height / 2, visible: true };
    }
    this.requestRender("resize");
    this.emitMetrics();
  }

  localPoint(event) {
    const rect = normalizeRect(this.canvas.getBoundingClientRect());
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height)
    };
  }

  runGuarded(code, callback) {
    try {
      callback();
    } catch (error) {
      this.cancelLongPress();
      for (const pointerId of this.pointers.keys()) this.releasePointer(pointerId);
      this.pointers.clear();
      this.pinchGesture = null;
      this.panGesture = null;
      this.drawGesture = null;
      this.selectGesture = null;
      this.touchGesture = null;
      this.ignoreTouchUntilClear = false;
      this.setGesture("recovering", "输入恢复中", "安全模式");
      this.recordError(code, `${code} 输入处理失败：${error.message}`, true);
      this.requestRender("input-recovery");
    }
  }

  setTool(tool) {
    if (!["draw", "select", "pan"].includes(tool)) return;
    this.tool = tool;
    this.callbacks.onTool?.(tool);
    this.requestRender("tool");
  }

  setGesture(kind, label, input) {
    this.gesture = { kind, label, input };
    this.callbacks.onGesture?.({ ...this.gesture });
  }

  getSelectedShape() {
    return this.scene.shapes.find((shape) => shape.id === this.selectedId) || null;
  }

  selectAt(worldPoint) {
    const tolerance = 10 / this.scene.view.scale;
    const shape = hitTest(this.scene.shapes, worldPoint, tolerance);
    this.selectedId = shape?.id || null;
    this.callbacks.onSelection?.(shape);
    this.requestRender("selection");
    return shape;
  }

  requestRender(reason = "update") {
    if (this.destroyed || this.contextLost) return;
    if (this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.render(reason);
    });
  }

  emitMetrics() {
    this.callbacks.onMetrics?.(this.getSnapshot());
  }

  getSnapshot() {
    const samples = this.metrics.renderSamples;
    const sum = samples.reduce((total, value) => total + value, 0);
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
    const points = this.scene.shapes.reduce((total, shape) => total + shape.points.length, 0);
    const bitmapBytes = this.canvas.width * this.canvas.height * 4;
    return {
      tool: this.tool,
      gesture: { ...this.gesture },
      view: { ...this.scene.view },
      selectedId: this.selectedId,
      crosshair: { ...this.crosshair },
      render: {
        count: this.metrics.renderCount,
        lastMs: this.metrics.lastRenderMs,
        avgMs: samples.length ? sum / samples.length : null,
        p95Ms: p95,
        samples: samples.slice(-16)
      },
      inputLatencyMs: this.lastInputLatencyMs,
      counters: {
        pointerEvents: this.metrics.pointerEvents,
        wheelEvents: this.metrics.wheelEvents,
        zoomEvents: this.metrics.zoomEvents,
        panEvents: this.metrics.panEvents,
        drawEvents: this.metrics.drawEvents,
        longPressEvents: this.metrics.longPressEvents,
        errors: this.metrics.errors,
        renderErrors: this.metrics.renderErrors
      },
      inputs: { ...this.metrics.inputs },
      resources: {
        shapes: this.scene.shapes.length,
        points,
        activePointers: this.pointers.size,
        listeners: this.listenerCount,
        bitmapBytes,
        bitmapMiB: bitmapBytes / 1024 / 1024,
        dpr: this.dpr,
        canvasWidth: this.canvas.width,
        canvasHeight: this.canvas.height,
        heapMiB: performance.memory ? performance.memory.usedJSHeapSize / 1024 / 1024 : null
      },
      sessionMs: Date.now() - this.metrics.startedAt
    };
  }

  onContextLost(event) {
    event.preventDefault();
    this.contextLost = true;
    this.metrics.errors += 1;
    this.callbacks.onError?.({
      code: "CONTEXT_LOST",
      message: "GPU 绘图上下文丢失。画布已暂停，请点击重新初始化。",
      recoverable: true
    });
  }

  onContextRestored() {
    this.contextLost = false;
    this.resize();
    this.requestRender("context-restored");
  }

  onVisibilityChange() {
    if (document.hidden) {
      this.cancelLongPress();
      if (this.drawGesture) this.drawGesture = null;
    } else {
      this.resize();
    }
  }

  onPointerDown(event) {
    if (event.pointerType === "touch") event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    const point = this.localPoint(event);
    this.crosshair = { ...point, visible: true };
    this.inputStartedAt = now();
    this.metrics.pointerEvents += 1;
    const input = event.pointerType || "mouse";
    this.metrics.inputs[input] = (this.metrics.inputs[input] || 0) + 1;

    if (input === "touch") {
      this.onTouchDown(event, point);
    } else {
      this.onMouseLikeDown(event, point, input);
    }
    this.requestRender("pointerdown");
  }

  onTouchDown(event, point) {
    const pointer = {
      id: event.pointerId,
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y
    };
    this.pointers.set(event.pointerId, pointer);
    this.capturePointer(event.pointerId);
    if (this.pointers.size === 1) {
      this.touchGesture = { ...pointer, last: point, moved: false, selected: false };
      this.ignoreTouchUntilClear = false;
      this.setGesture("touch-pending", "单指待命", "触屏");
      this.scheduleLongPress();
    } else if (this.pointers.size === 2) {
      this.cancelLongPress();
      if (this.touchGesture) this.touchGesture.moved = true;
      this.beginPinch();
    } else {
      this.cancelLongPress();
      this.pinchGesture = null;
      this.setGesture("touch-locked", "多指已锁定", "触屏");
    }
  }

  onMouseLikeDown(event, point, input) {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const wantsPan = event.button !== 0 || this.tool === "pan";
    if (wantsPan) {
      this.beginPan(event.pointerId, point, input);
      this.capturePointer(event.pointerId);
      return;
    }
    if (this.tool === "draw") {
      const world = screenToWorld(point, this.scene.view);
      this.drawGesture = {
        pointerId: event.pointerId,
        points: [world],
        lastScreen: point,
        limitNotified: false
      };
      this.setGesture("drawing", "绘制中", input === "pen" ? "手写笔" : "鼠标");
      this.capturePointer(event.pointerId);
      return;
    }
    this.selectGesture = {
      pointerId: event.pointerId,
      start: point,
      last: point,
      moved: false
    };
    this.setGesture("select-pending", "选择待命", input === "pen" ? "手写笔" : "鼠标");
    this.capturePointer(event.pointerId);
  }

  beginPan(pointerId, point, input) {
    this.panGesture = { pointerId, last: point, input };
    this.metrics.panEvents += 1;
    this.setGesture("panning", "平移中", input === "mouse" ? "鼠标" : input);
  }

  beginPinch() {
    const [first, second] = [...this.pointers.values()].slice(0, 2);
    if (!first || !second) return;
    this.pinchGesture = {
      ids: [first.id, second.id],
      startView: { ...this.scene.view },
      startMidpoint: midpoint(first, second),
      startDistance: Math.max(1, distance(first, second)),
      reportedLimit: false
    };
    this.metrics.zoomEvents += 1;
    this.setGesture("pinching", "双指缩放", "触屏");
    this.callbacks.onFeedback?.("双指缩放 · 已锁定绘图");
  }

  scheduleLongPress() {
    this.cancelLongPress();
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      const gesture = this.touchGesture;
      if (!gesture || gesture.moved || this.pointers.size !== 1) return;
      const world = screenToWorld(gesture, this.scene.view);
      const shape = this.selectAt(world);
      gesture.selected = true;
      this.metrics.longPressEvents += 1;
      this.setGesture("selected", shape ? "已选择图形" : "未命中图形", "触屏长按");
      this.callbacks.onFeedback?.(shape ? "长按选择 · 已高亮图形" : "长按选择 · 此处没有图形");
      this.requestRender("long-press");
    }, LONG_PRESS_MS);
  }

  cancelLongPress() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  capturePointer(pointerId) {
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch (error) {
      this.recordError("POINTER_CAPTURE", `无法锁定指针：${error.message}`, true);
    }
  }

  releasePointer(pointerId) {
    try {
      if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    } catch (error) {
      this.callbacks.onNotice?.(`指针释放提示：${error.message}`);
    }
  }

  onPointerMove(event) {
    const point = this.localPoint(event);
    this.crosshair = { ...point, visible: true };
    this.metrics.pointerEvents += 1;
    const tracked = this.pointers.get(event.pointerId);
    if (tracked) {
      tracked.x = point.x;
      tracked.y = point.y;
    }
    if (event.pointerType === "touch" && this.pointers.size) {
      this.onTouchMove(event, point);
    } else {
      this.onMouseLikeMove(event, point);
    }
    this.requestRender("pointermove");
  }

  onTouchMove(event, point) {
    if (this.pointers.size >= 2) {
      event.preventDefault();
      this.updatePinch();
      return;
    }
    const gesture = this.touchGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.x = point.x;
    gesture.y = point.y;
    const travel = Math.hypot(point.x - gesture.startX, point.y - gesture.startY);
    if (travel > LONG_PRESS_MOVE_PX && !gesture.moved) {
      gesture.moved = true;
      this.cancelLongPress();
      this.metrics.panEvents += 1;
      this.setGesture("panning", "单指平移", "触屏");
    }
    if (gesture.moved && !this.ignoreTouchUntilClear) {
      this.scene.view.x += point.x - gesture.last.x;
      this.scene.view.y += point.y - gesture.last.y;
    }
    gesture.last = point;
  }

  updatePinch() {
    if (!this.pinchGesture || this.pointers.size < 2) return;
    const first = this.pointers.get(this.pinchGesture.ids[0]);
    const second = this.pointers.get(this.pinchGesture.ids[1]);
    if (!first || !second) return;
    const currentMidpoint = midpoint(first, second);
    const ratio = distance(first, second) / this.pinchGesture.startDistance;
    const before = this.scene.view.scale;
    this.scene.view = pinchView(
      this.pinchGesture.startView,
      this.pinchGesture.startMidpoint,
      currentMidpoint,
      ratio
    );
    this.setGesture("pinching", `双指缩放 · ${Math.round(this.scene.view.scale * 100)}%`, "触屏");
    const atLimit = this.scene.view.scale <= MIN_SCALE || this.scene.view.scale >= MAX_SCALE;
    if (atLimit && !this.pinchGesture.reportedLimit && before !== this.scene.view.scale) {
      this.pinchGesture.reportedLimit = true;
      this.callbacks.onFeedback?.("已到缩放边界 · 25%–400%");
    }
  }

  onMouseLikeMove(event, point) {
    if (this.drawGesture?.pointerId === event.pointerId) {
      const travel = distance(point, this.drawGesture.lastScreen);
      if (travel < 1.1) return;
      if (this.drawGesture.points.length >= MAX_STROKE_POINTS) {
        if (!this.drawGesture.limitNotified) {
          this.drawGesture.limitNotified = true;
          this.callbacks.onFeedback?.(`单笔上限 ${MAX_STROKE_POINTS} 点 · 已停止追加`);
        }
        return;
      }
      this.drawGesture.points.push(screenToWorld(point, this.scene.view));
      this.drawGesture.lastScreen = point;
      return;
    }
    if (this.panGesture?.pointerId === event.pointerId) {
      this.scene.view.x += point.x - this.panGesture.last.x;
      this.scene.view.y += point.y - this.panGesture.last.y;
      this.panGesture.last = point;
      return;
    }
    if (this.selectGesture?.pointerId === event.pointerId) {
      const travel = Math.hypot(
        point.x - this.selectGesture.start.x,
        point.y - this.selectGesture.start.y
      );
      if (travel > MOUSE_DRAG_PX) {
        this.selectGesture.moved = true;
        this.beginPan(event.pointerId, this.selectGesture.last, this.tool === "select" ? "mouse" : "pen");
        this.selectGesture = null;
      } else {
        this.selectGesture.last = point;
      }
    }
  }

  onPointerUp(event) {
    const point = this.localPoint(event);
    this.crosshair = { ...point, visible: true };
    this.inputStartedAt = now();
    if (event.pointerType === "touch") this.onTouchUp(event, point);
    else this.onMouseLikeUp(event, point);
    this.releasePointer(event.pointerId);
    this.requestRender("pointerup");
  }

  onTouchUp(event, point) {
    this.cancelLongPress();
    const wasPinching = Boolean(this.pinchGesture);
    const wasPanning = Boolean(this.touchGesture?.moved);
    this.pointers.delete(event.pointerId);
    this.pinchGesture = null;
    if (wasPinching) this.ignoreTouchUntilClear = true;
    if (this.pointers.size === 0) {
      this.ignoreTouchUntilClear = false;
      this.touchGesture = null;
      this.setGesture("idle", "空闲", "触屏");
    } else {
      const remaining = [...this.pointers.values()][0];
      if (remaining) {
        this.touchGesture = {
          ...remaining,
          last: { x: remaining.x, y: remaining.y },
          moved: true,
          selected: false
        };
      }
    }
    this.lastInputLatencyMs = this.inputStartedAt
      ? Math.max(0, now() - this.inputStartedAt)
      : this.lastInputLatencyMs;
    if (wasPinching || wasPanning) {
      this.callbacks.onViewChange?.({ ...this.scene.view });
      this.callbacks.onChange?.("view");
    }
    void point;
  }

  onMouseLikeUp(event, point) {
    if (this.drawGesture?.pointerId === event.pointerId) {
      this.finishDraw();
    } else if (this.selectGesture?.pointerId === event.pointerId) {
      if (!this.selectGesture.moved) {
        this.selectAt(screenToWorld(point, this.scene.view));
        this.setGesture("selected", this.selectedId ? "已选择图形" : "未命中图形", "鼠标");
      }
      this.selectGesture = null;
    }
    if (this.panGesture?.pointerId === event.pointerId) {
      this.panGesture = null;
      this.callbacks.onViewChange?.({ ...this.scene.view });
      this.callbacks.onChange?.("view");
    }
    if (!this.pointers.size && !this.drawGesture) {
      this.setGesture("idle", "空闲", this.tool === "draw" ? "鼠标 / 触屏" : "鼠标 / 触屏");
    }
    this.lastInputLatencyMs = this.inputStartedAt
      ? Math.max(0, now() - this.inputStartedAt)
      : this.lastInputLatencyMs;
  }

  finishDraw() {
    const gesture = this.drawGesture;
    this.drawGesture = null;
    if (!gesture?.points.length) return;
    if (gesture.points.length === 1) {
      gesture.points.push({ ...gesture.points[0] });
    }
    const points = simplifyStroke(gesture.points, 1.1);
    const shape = makeShape(points, this.scene.shapes.length);
    this.scene.shapes.push(shape);
    this.selectedId = shape.id;
    this.metrics.drawEvents += 1;
    this.callbacks.onSelection?.(shape);
    this.callbacks.onChange?.("draw");
    this.setGesture("idle", "绘制完成", "鼠标");
  }

  onPointerCancel(event) {
    const discarded = Boolean(this.drawGesture);
    this.cancelLongPress();
    this.pointers.delete(event.pointerId);
    this.pinchGesture = null;
    this.panGesture = null;
    this.drawGesture = null;
    this.selectGesture = null;
    this.ignoreTouchUntilClear = false;
    this.releasePointer(event.pointerId);
    this.setGesture("idle", "输入已取消", event.pointerType === "touch" ? "触屏" : "指针");
    if (discarded) this.callbacks.onNotice?.("绘制被系统取消，未写入未完成笔画。");
    this.requestRender("pointercancel");
  }

  onLostCapture(event) {
    const isTracked = this.pointers.has(event.pointerId) || this.drawGesture?.pointerId === event.pointerId;
    if (!isTracked) return;
    this.callbacks.onNotice?.("系统已释放指针捕获，当前输入已安全结束。");
    if (event.pointerType === "mouse" && this.drawGesture) {
      this.finishDraw();
    } else {
      this.onPointerCancel(event);
    }
  }

  onPointerLeave() {
    this.crosshair.visible = true;
    this.requestRender("pointerleave");
  }

  onWheel(event) {
    event.preventDefault();
    event.stopPropagation();
    const point = this.localPoint(event);
    this.crosshair = { ...point, visible: true };
    this.metrics.wheelEvents += 1;
    this.metrics.inputs.trackpad += 1;
    this.inputStartedAt = now();
    if (event.ctrlKey || event.metaKey) {
      const normalized = normalizeWheel(event, this.cssSize.height);
      const factor = Math.exp(-clamp(normalized.y, -120, 120) * 0.012);
      this.scene.view = zoomAt(this.scene.view, point, this.scene.view.scale * factor);
      this.metrics.zoomEvents += 1;
      this.setGesture("zooming", `触控板缩放 · ${Math.round(this.scene.view.scale * 100)}%`, "触控板");
    } else {
      const delta = normalizeWheel(event, this.cssSize.height);
      const horizontal = delta.x || (event.shiftKey ? delta.y : 0);
      const vertical = event.shiftKey ? 0 : delta.y;
      this.scene.view.x -= horizontal;
      this.scene.view.y -= vertical;
      this.metrics.panEvents += 1;
      this.setGesture("panning", "触控板平移", "触控板");
    }
    this.callbacks.onViewChange?.({ ...this.scene.view });
    this.callbacks.onChange?.("view");
    this.requestRender("wheel");
  }

  resetInputState() {
    this.cancelLongPress();
    this.pointers.clear();
    this.pinchGesture = null;
    this.panGesture = null;
    this.drawGesture = null;
    this.selectGesture = null;
    this.ignoreTouchUntilClear = false;
    this.setGesture("idle", "空闲", "等待输入");
  }

  render(reason = "update") {
    if (this.destroyed || this.contextLost || !this.ctx) return;
    const started = now();
    try {
      const { width, height } = this.cssSize;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.fillStyle = "#faf8f1";
      this.ctx.fillRect(0, 0, width, height);
      this.drawGrid(width, height);
      this.drawShapes();
      if (this.drawGesture) this.drawStroke(this.drawGesture.points, {
        color: COLORS[this.scene.shapes.length % COLORS.length],
        width: 3
      });
      this.drawSelection();
      this.drawCrosshair(width, height);
      this.drawScaleIndicator(width, height);
      const elapsed = now() - started;
      this.metrics.renderCount += 1;
      this.metrics.lastRenderMs = elapsed;
      this.metrics.renderSamples.push(elapsed);
      if (this.metrics.renderSamples.length > MAX_RENDER_SAMPLES) {
        this.metrics.renderSamples.shift();
      }
      if (this.inputStartedAt !== null) {
        this.lastInputLatencyMs = Math.max(0, now() - this.inputStartedAt);
        this.inputStartedAt = null;
        this.metrics.lastInputLatencyMs = this.lastInputLatencyMs;
      }
      this.lastRenderReason = reason;
    } catch (error) {
      this.metrics.renderErrors += 1;
      this.recordError("RENDER_FAILED", `画布渲染失败：${error.message}`, true);
    }
    this.emitMetrics();
  }

  drawGrid(width, height) {
    let step = 40 * this.scene.view.scale;
    while (step < 24) step *= 2;
    while (step > 92) step /= 2;
    const offsetX = ((this.scene.view.x % step) + step) % step;
    const offsetY = ((this.scene.view.y % step) + step) % step;
    this.ctx.save();
    this.ctx.lineWidth = 1;
    for (let x = offsetX; x <= width; x += step) {
      const major = Math.round((x - this.scene.view.x) / step) % 4 === 0;
      this.ctx.strokeStyle = major ? "rgba(32,40,50,0.11)" : "rgba(32,40,50,0.055)";
      this.ctx.beginPath();
      this.ctx.moveTo(Math.round(x) + 0.5, 0);
      this.ctx.lineTo(Math.round(x) + 0.5, height);
      this.ctx.stroke();
    }
    for (let y = offsetY; y <= height; y += step) {
      const major = Math.round((y - this.scene.view.y) / step) % 4 === 0;
      this.ctx.strokeStyle = major ? "rgba(32,40,50,0.11)" : "rgba(32,40,50,0.055)";
      this.ctx.beginPath();
      this.ctx.moveTo(0, Math.round(y) + 0.5);
      this.ctx.lineTo(width, Math.round(y) + 0.5);
      this.ctx.stroke();
    }
    const originX = this.scene.view.x;
    const originY = this.scene.view.y;
    if (originX >= 0 && originX <= width) {
      this.ctx.strokeStyle = "rgba(223,88,60,0.2)";
      this.ctx.beginPath();
      this.ctx.moveTo(Math.round(originX) + 0.5, 0);
      this.ctx.lineTo(Math.round(originX) + 0.5, height);
      this.ctx.stroke();
    }
    if (originY >= 0 && originY <= height) {
      this.ctx.strokeStyle = "rgba(223,88,60,0.2)";
      this.ctx.beginPath();
      this.ctx.moveTo(0, Math.round(originY) + 0.5);
      this.ctx.lineTo(width, Math.round(originY) + 0.5);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  tracePoints(points) {
    const path = new Path2D();
    const screen = points.map((point) => worldToScreen(point, this.scene.view));
    if (!screen.length) return path;
    path.moveTo(screen[0].x, screen[0].y);
    if (screen.length === 2) {
      path.lineTo(screen[1].x, screen[1].y);
      return path;
    }
    for (let index = 1; index < screen.length - 1; index += 1) {
      const current = screen[index];
      const next = screen[index + 1];
      path.quadraticCurveTo(
        current.x,
        current.y,
        (current.x + next.x) / 2,
        (current.y + next.y) / 2
      );
    }
    const last = screen[screen.length - 1];
    path.lineTo(last.x, last.y);
    return path;
  }

  drawStroke(points, shape) {
    if (!points.length) return;
    const path = this.tracePoints(points);
    this.ctx.save();
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.strokeStyle = shape.color;
    this.ctx.lineWidth = clamp(shape.width * this.scene.view.scale, 1, 30);
    this.ctx.stroke(path);
    this.ctx.restore();
  }

  drawShapes() {
    const selected = this.getSelectedShape();
    if (selected) {
      const path = this.tracePoints(selected.points);
      this.ctx.save();
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      this.ctx.strokeStyle = "rgba(223,88,60,0.2)";
      this.ctx.lineWidth = clamp(selected.width * this.scene.view.scale + 9, 9, 38);
      this.ctx.stroke(path);
      this.ctx.restore();
    }
    for (const shape of this.scene.shapes) this.drawStroke(shape.points, shape);
  }

  drawSelection() {
    const shape = this.getSelectedShape();
    if (!shape) return;
    const screenPoints = shape.points.map((point) => worldToScreen(point, this.scene.view));
    const minX = Math.min(...screenPoints.map((point) => point.x));
    const minY = Math.min(...screenPoints.map((point) => point.y));
    const maxX = Math.max(...screenPoints.map((point) => point.x));
    const maxY = Math.max(...screenPoints.map((point) => point.y));
    const handles = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: maxX, y: maxY }
    ];
    this.ctx.save();
    this.ctx.setLineDash([3, 3]);
    this.ctx.strokeStyle = "rgba(223,88,60,0.5)";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(minX - 5, minY - 5, maxX - minX + 10, maxY - minY + 10);
    this.ctx.setLineDash([]);
    for (const handle of handles) {
      this.ctx.fillStyle = "#faf8f1";
      this.ctx.strokeStyle = "#df583c";
      this.ctx.lineWidth = 1.5;
      this.ctx.fillRect(handle.x - 3, handle.y - 3, 6, 6);
      this.ctx.strokeRect(handle.x - 3, handle.y - 3, 6, 6);
    }
    this.ctx.restore();
  }

  drawCrosshair(width, height) {
    if (!this.crosshair.visible) return;
    const x = clamp(this.crosshair.x, 0, width);
    const y = clamp(this.crosshair.y, 0, height);
    const gap = 12;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(223,88,60,0.78)";
    this.ctx.fillStyle = "#df583c";
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(0, Math.round(y) + 0.5);
    this.ctx.lineTo(Math.max(0, x - gap), Math.round(y) + 0.5);
    this.ctx.moveTo(Math.min(width, x + gap), Math.round(y) + 0.5);
    this.ctx.lineTo(width, Math.round(y) + 0.5);
    this.ctx.moveTo(Math.round(x) + 0.5, 0);
    this.ctx.lineTo(Math.round(x) + 0.5, Math.max(0, y - gap));
    this.ctx.moveTo(Math.round(x) + 0.5, Math.min(height, y + gap));
    this.ctx.lineTo(Math.round(x) + 0.5, height);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    this.ctx.fill();
    const world = screenToWorld({ x, y }, this.scene.view);
    const label = `X ${Math.round(world.x)}  Y ${Math.round(world.y)}`;
    this.ctx.font = '9px "SFMono-Regular", Consolas, monospace';
    const labelWidth = this.ctx.measureText(label).width + 12;
    const labelX = x + 14 + labelWidth > width - 8 ? x - labelWidth - 12 : x + 12;
    const labelY = y - 26 < 8 ? y + 12 : y - 25;
    this.ctx.fillStyle = "rgba(32,40,50,0.88)";
    this.ctx.fillRect(labelX, labelY, labelWidth, 17);
    this.ctx.fillStyle = "#f8f6ef";
    this.ctx.fillText(label, labelX + 6, labelY + 11.5);
    this.ctx.restore();
  }

  drawScaleIndicator(width, height) {
    const length = 44;
    const x = width - length - 26;
    const y = height - 25;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(32,40,50,0.36)";
    this.ctx.fillStyle = "rgba(32,40,50,0.52)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + length, y);
    this.ctx.moveTo(x, y - 3);
    this.ctx.lineTo(x, y + 3);
    this.ctx.moveTo(x + length, y - 3);
    this.ctx.lineTo(x + length, y + 3);
    this.ctx.stroke();
    this.ctx.font = '8px "SFMono-Regular", Consolas, monospace';
    this.ctx.fillText(`${Math.round(this.scene.view.scale * 100)}%`, x + 11, y - 6);
    this.ctx.restore();
  }

  fitView(shouldRender = true) {
    const { width, height } = this.cssSize;
    if (!this.scene.shapes.length) {
      this.scene.view = { x: width / 2, y: height / 2, scale: 1 };
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const shape of this.scene.shapes) {
        for (const point of shape.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
      const contentWidth = Math.max(80, maxX - minX);
      const contentHeight = Math.max(80, maxY - minY);
      const scale = clamp(
        Math.min((width - 120) / contentWidth, (height - 120) / contentHeight),
        MIN_SCALE,
        1.8
      );
      this.scene.view = {
        x: width / 2 - ((minX + maxX) / 2) * scale,
        y: height / 2 - ((minY + maxY) / 2) * scale,
        scale
      };
    }
    this.callbacks.onViewChange?.({ ...this.scene.view });
    if (shouldRender) this.requestRender("fit-view");
  }

  zoomBy(factor) {
    const anchor = { x: this.cssSize.width / 2, y: this.cssSize.height / 2 };
    this.scene.view = zoomAt(this.scene.view, anchor, this.scene.view.scale * factor);
    this.metrics.zoomEvents += 1;
    this.setGesture("zooming", `视图缩放 · ${Math.round(this.scene.view.scale * 100)}%`, "按钮");
    this.callbacks.onViewChange?.({ ...this.scene.view });
    this.requestRender("zoom-button");
  }

  replaceScene(scene, { fit = false } = {}) {
    this.scene = scene;
    this.selectedId = null;
    this.callbacks.onSelection?.(null);
    if (fit) this.fitView(false);
    this.callbacks.onViewChange?.({ ...this.scene.view });
    this.requestRender("replace-scene");
  }

  clearScene() {
    this.scene.shapes = [];
    this.selectedId = null;
    this.callbacks.onSelection?.(null);
    this.callbacks.onChange?.("clear");
    this.requestRender("clear-scene");
  }

  clearSelection() {
    this.selectedId = null;
    this.callbacks.onSelection?.(null);
    this.requestRender("clear-selection");
  }

  getScenePayload() {
    return {
      version: 1,
      view: { ...this.scene.view },
      shapes: this.scene.shapes.map((shape) => ({
        ...shape,
        points: shape.points.map((point) => ({ ...point }))
      }))
    };
  }

  createExportCanvas(scale = 2) {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, Math.round(this.cssSize.width * scale));
    exportCanvas.height = Math.max(1, Math.round(this.cssSize.height * scale));
    const context = exportCanvas.getContext("2d");
    if (!context) throw new Error("无法创建 PNG 导出画布。");
    context.scale(scale, scale);
    context.fillStyle = "#faf8f1";
    context.fillRect(0, 0, this.cssSize.width, this.cssSize.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const shape of this.scene.shapes) {
      context.strokeStyle = shape.color;
      context.lineWidth = clamp(shape.width * this.scene.view.scale, 1, 30);
      context.stroke(this.tracePoints(shape.points));
    }
    return exportCanvas;
  }

  exportPng() {
    return new Promise((resolve, reject) => {
      let exportCanvas;
      try {
        exportCanvas = this.createExportCanvas(2);
      } catch (error) {
        this.recordError("EXPORT_CANVAS", error.message, true);
        reject(error);
        return;
      }
      exportCanvas.toBlob((blob) => {
        if (!blob) {
          const error = new Error("浏览器未能生成 PNG 数据。");
          this.recordError("EXPORT_BLOB", error.message, true);
          reject(error);
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  }

  recordError(code, message, recoverable = true) {
    this.metrics.errors += 1;
    this.callbacks.onError?.({ code, message, recoverable, at: Date.now() });
  }

  destroy() {
    this.destroyed = true;
    this.cancelLongPress();
    cancelAnimationFrame(this.frameRequest);
    cancelAnimationFrame(this.resizeFrame);
    this.resizeObserver?.disconnect();
    this.abortController.abort();
    this.pointers.clear();
  }
}
