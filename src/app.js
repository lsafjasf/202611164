// Browser wiring: canvas-backed measurement, rendering, focus/aria
// updates, keyboard/mouse/touch listeners, persistence and restore.
import { TextLayoutEngine } from "./layout.js";
import { SubtitleController } from "./controller.js";
import { createStore } from "./store.js";

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const measure = (text, font, fontSize) => {
  ctx.font = `${fontSize}px ${font}`;
  return ctx.measureText(text).width;
};

const engine = new TextLayoutEngine({ measure });
const scene = document.getElementById("scene");
const live = document.getElementById("live");
const errorBox = document.getElementById("error");
const statsBox = document.getElementById("stats");

const controller = new SubtitleController({
  store: createStore(),
  engine,
  announce: (msg) => { live.textContent = msg; },
  onError: (msg) => { errorBox.textContent = msg; live.textContent = msg; },
  onFocus: (index) => {
    const el = scene.querySelector(`[data-index="${index}"]`);
    if (el) el.focus();
  },
});

function render() {
  const { items, style, selectedIndex } = controller.state;
  const blocks = items.map((item) =>
    engine.layout({ text: item.text, ...style })
  );
  const placed = engine.stack(blocks, 8);
  scene.textContent = "";
  placed.forEach((block, i) => {
    const el = document.createElement("div");
    el.className = "sub";
    el.dataset.index = String(i);
    el.id = items[i].id;
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", String(i === selectedIndex));
    el.setAttribute("tabindex", i === selectedIndex ? "0" : "-1");
    el.style.top = `${block.y + 8}px`;
    el.style.height = `${block.height}px`;
    el.style.lineHeight = `${block.lineHeight}px`;
    el.style.fontSize = `${style.fontSize}px`;
    el.style.textAlign = style.align;
    el.textContent = block.lines.map((l) => l.text).join("\n");
    el.addEventListener("click", () =>
      controller.handleClick("item", { index: i })
    );
    scene.appendChild(el);
  });
  scene.setAttribute("aria-activedescendant", items[selectedIndex].id);
  const s = engine.stats();
  statsBox.textContent =
    `缓存命中率: ${(s.hitRate * 100).toFixed(1)}% (${s.hits}/${s.hits + s.misses})  ` +
    `布局耗时: 共 ${s.totalLayoutMs.toFixed(1)}ms, 平均 ${s.avgLayoutMs.toFixed(2)}ms, ` +
    `峰值 ${s.maxLayoutMs.toFixed(1)}ms  缓存条目: ${s.cacheSize}`;
}

// Restore scroll position after reload; keep it persisted on scroll.
scene.scrollTop = controller.state.scrollTop;
scene.addEventListener("scroll", () =>
  controller.dispatch("scroll", { scrollTop: scene.scrollTop })
);

scene.addEventListener("keydown", (e) => {
  if (controller.handleKey(e.key)) e.preventDefault();
});
document.getElementById("exportBtn").addEventListener("click", () =>
  controller.handleClick("export")
);
document.getElementById("align").addEventListener("change", (e) =>
  controller.dispatch("set-style", { patch: { align: e.target.value } })
);
document.getElementById("fontSize").addEventListener("change", (e) =>
  controller.dispatch("set-style", { patch: { fontSize: Number(e.target.value) } })
);
document.getElementById("width").addEventListener("change", (e) =>
  controller.dispatch("set-style", { patch: { width: Number(e.target.value) } })
);

// Touch: tap selects, vertical swipe moves selection, long-press exports.
let touchStartY = null;
let touchTimer = null;
scene.addEventListener("touchstart", (e) => {
  touchStartY = e.touches[0].clientY;
  touchTimer = setTimeout(() => controller.handleTouch("long-press"), 600);
});
scene.addEventListener("touchend", (e) => {
  clearTimeout(touchTimer);
  if (touchStartY == null) return;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (dy < -40) controller.handleTouch("swipe-up");
  else if (dy > 40) controller.handleTouch("swipe-down");
  touchStartY = null;
});

// Reflect persisted style choices into the controls on load.
document.getElementById("fontSize").value = controller.state.style.fontSize;
document.getElementById("width").value = controller.state.style.width;
document.getElementById("align").value = controller.state.style.align;

render();
