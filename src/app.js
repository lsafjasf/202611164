import { t, LANGS } from './i18n.js';
import { Store } from './store.js';
import { SoundFeedback } from './audio.js';
import { render, getCtx, toCanvasPoint, hitTest, renderToCanvas, CANVAS_W, CANVAS_H } from './renderer.js';
import { exportPng, exportSvg } from './exporter.js';
import { createRunner } from './self-test.js';

class Emitter {
  constructor() {
    this.listeners = new Map();
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
  }
  emit(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }
}

const emitter = new Emitter();
const store = new Store(emitter);
const sound = new SoundFeedback();

const canvas = document.getElementById('poster-canvas');
const ctx = getCtx(canvas);
const liveRegion = document.getElementById('live-region');
const layerInfo = document.getElementById('layer-info');
const langSelect = document.getElementById('lang-select');
const textInput = document.getElementById('text-input');
const fontSize = document.getElementById('font-size');
const fontSizeValue = document.getElementById('font-size-value');
const fillColor = document.getElementById('fill-color');
const testResults = document.getElementById('test-results');
const testSummary = document.getElementById('test-summary');

let drag = null;

function announce(key, params) {
  const msg = t(store.state.lang, key, params);
  liveRegion.textContent = msg;
  return msg;
}

emitter.on('status', ({ key, params }) => announce(key, params));
emitter.on('selection', (id) => {
  const shape = store.state.shapes.find((sh) => sh.id === id);
  if (shape) {
    layerInfo.textContent = `${t(store.state.lang, 'selected')}: ${t(store.state.lang, shape.typeLabelKey)} (${shape.id})`;
  } else {
    layerInfo.textContent = '';
  }
  syncInspector();
});
emitter.on('change', () => {
  render(ctx, canvas, store.state);
  syncInspector();
});

function applyI18n() {
  const lang = store.state.lang;
  document.documentElement.lang = lang;
  langSelect.value = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(lang, key);
  });
  canvas.setAttribute('aria-label', t(lang, 'canvasAria'));
  syncInspector();
}

function syncInspector() {
  const shape = store.state.shapes.find((sh) => sh.id === store.state.selectedId);
  const isText = shape?.type === 'text';
  textInput.disabled = !isText;
  fontSize.disabled = !shape;
  fillColor.disabled = !shape;
  if (shape) {
    if (isText) textInput.value = shape.text;
    fontSize.value = shape.type === 'text' ? shape.fontSize : 28;
    fontSizeValue.textContent = fontSize.value;
    fillColor.value = shape.fill;
  }
  document.getElementById('btn-delete').disabled = !shape;
  document.getElementById('btn-undo').disabled = !store.undoStack.length;
  document.getElementById('btn-redo').disabled = !store.redoStack.length;
}

function addShape(type) {
  const lang = store.state.lang;
  const base = {
    x: 80 + (store.state.shapes.length * 24) % 300,
    y: 80 + (store.state.shapes.length * 20) % 200,
    w: 200,
    h: type === 'text' ? 90 : 140,
    fill: fillColor.value || '#2563eb',
    type,
    typeLabelKey: `shape${type[0].toUpperCase()}${type.slice(1)}`
  };
  if (type === 'text') {
    base.text = t(lang, 'defaultText');
    base.fontSize = Number(fontSize.value) || 28;
    base.h = base.fontSize * 3;
  }
  store.addShape(base);
  sound.add();
}

document.getElementById('btn-rect').addEventListener('click', () => addShape('rect'));
document.getElementById('btn-circle').addEventListener('click', () => addShape('circle'));
document.getElementById('btn-text').addEventListener('click', () => addShape('text'));
document.getElementById('btn-delete').addEventListener('click', () => {
  if (!store.state.selectedId) return;
  if (window.confirm && !window.confirm(t(store.state.lang, 'confirmDelete'))) return;
  if (store.deleteSelected()) sound.remove();
});
document.getElementById('btn-undo').addEventListener('click', () => store.undo());
document.getElementById('btn-redo').addEventListener('click', () => store.redo());

langSelect.addEventListener('change', () => {
  store.setLang(langSelect.value);
  applyI18n();
});

textInput.addEventListener('input', () => {
  const shape = store.state.shapes.find((sh) => sh.id === store.state.selectedId);
  if (shape?.type === 'text') store.updateShape(shape.id, { text: textInput.value });
});
fontSize.addEventListener('input', () => {
  fontSizeValue.textContent = fontSize.value;
  const shape = store.state.shapes.find((sh) => sh.id === store.state.selectedId);
  if (shape?.type === 'text') store.updateShape(shape.id, { fontSize: Number(fontSize.value) });
});
fillColor.addEventListener('input', () => {
  const shape = store.state.shapes.find((sh) => sh.id === store.state.selectedId);
  if (shape) store.updateShape(shape.id, { fill: fillColor.value });
});

function pointerDown(event) {
  canvas.focus();
  const point = toCanvasPoint(canvas, event.clientX, event.clientY);
  const hit = hitTest(store.state.shapes, point);
  if (hit) {
    store.select(hit.id);
    sound.select();
    drag = { id: hit.id, startX: point.x, startY: point.y, origX: hit.x, origY: hit.y, moved: false };
  } else {
    store.select(null);
    drag = null;
  }
}

function pointerMove(event) {
  if (!drag) return;
  const point = toCanvasPoint(canvas, event.clientX, event.clientY);
  const dx = point.x - drag.startX;
  const dy = point.y - drag.startY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
  const shape = store.state.shapes.find((sh) => sh.id === drag.id);
  if (shape) {
    shape.x = Math.max(0, Math.min(CANVAS_W - shape.w, drag.origX + dx));
    shape.y = Math.max(0, Math.min(CANVAS_H - shape.h, drag.origY + dy));
    render(ctx, canvas, store.state);
  }
}

function pointerUp() {
  if (drag?.moved) {
    const shape = store.state.shapes.find((sh) => sh.id === drag.id);
    if (shape) {
      store.pushHistory();
      store.persist();
      emitter.emit('change', store.state);
      announce('statusMoved', { x: Math.round(shape.x), y: Math.round(shape.y) });
    }
  }
  drag = null;
}

canvas.addEventListener('mousedown', pointerDown);
window.addEventListener('mousemove', pointerMove);
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('touchstart', (event) => {
  event.preventDefault();
  const touch = event.changedTouches[0];
  pointerDown({ clientX: touch.clientX, clientY: touch.clientY });
}, { passive: false });
canvas.addEventListener('touchmove', (event) => {
  event.preventDefault();
  const touch = event.changedTouches[0];
  pointerMove({ clientX: touch.clientX, clientY: touch.clientY });
}, { passive: false });
canvas.addEventListener('touchend', (event) => {
  event.preventDefault();
  pointerUp();
}, { passive: false });

canvas.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 20 : 5;
  const keyMap = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (keyMap[event.key]) {
    event.preventDefault();
    if (store.moveSelected(...keyMap[event.key])) sound.select();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    if (store.deleteSelected()) sound.remove();
  }
});

function doExport(format) {
  try {
    store.savePreExportSnapshot();
    if (format === 'PNG') {
      const offscreen = renderToCanvas(store.state);
      exportPng(offscreen);
    } else {
      exportSvg(ctx, store.state, { width: CANVAS_W, height: CANVAS_H });
    }
    store.recordExport(format);
    sound.success();
  } catch (err) {
    store.recordExportFailure(err.message || String(err));
    sound.error();
  }
}

document.getElementById('btn-png').addEventListener('click', () => doExport('PNG'));
document.getElementById('btn-svg').addEventListener('click', () => doExport('SVG'));
document.getElementById('btn-restore').addEventListener('click', () => store.restorePreExportSnapshot());

const runner = createRunner({ store, ctx, canvas, render: () => render(ctx, canvas, store.state), sound, t, LANGS });
document.getElementById('btn-tests').addEventListener('click', async () => {
  const report = await runner.run();
  renderReport(report);
});

function renderReport(report) {
  testResults.innerHTML = '';
  for (const group of report.groups) {
    const header = document.createElement('li');
    header.className = 'test-group';
    header.textContent = group.title;
    testResults.appendChild(header);
    for (const item of group.items) {
      const li = document.createElement('li');
      li.className = item.pass ? 'pass' : 'fail';
      li.textContent = item.pass
        ? `PASS ${item.name}`
        : t(store.state.lang, 'testFail', { name: item.name, reason: item.reason });
      testResults.appendChild(li);
    }
  }
  const rate = Math.round((report.passed / report.total) * 100);
  testSummary.textContent = t(store.state.lang, 'testSummary', {
    passed: report.passed,
    total: report.total,
    rate
  });
  testSummary.dataset.passed = String(report.passed);
  testSummary.dataset.total = String(report.total);
  testSummary.dataset.rate = String(rate);
  window.__lastTestReport = report;
}

store.load();
langSelect.value = LANGS.includes(store.state.lang) ? store.state.lang : 'zh';
applyI18n();
render(ctx, canvas, store.state);
syncInspector();
window.__editor = { store, canvas, ctx, sound, runner };
