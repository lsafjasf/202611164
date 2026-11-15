// jsdom 冒烟测试：模拟浏览器加载页面、生成、交互、断航与保存/载入。

import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);

window.HTMLCanvasElement.prototype.getContext = function getContext() {
  return new Proxy(
    {},
    {
      get: (t, prop) => {
        if (prop === "createLinearGradient") {
          return () => ({ addColorStop() {} });
        }
        if (prop === "measureText") return () => ({ width: 10 });
        return typeof prop === "string" ? () => {} : undefined;
      },
      set: () => true,
    },
  );
};

window.AudioContext = function MockAudio() {
  return {
    state: "running",
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    resume() {},
    createGain: () => makeNode({ gain: audioParam() }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => makeNode({}),
    createBiquadFilter: () => makeNode({ type: "", frequency: audioParam() }),
    createOscillator: () => makeNode({ type: "", frequency: audioParam() }),
  };
};

function audioParam() {
  return { value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} };
}

function makeNode(extra) {
  return {
    ...extra,
    connect() {
      return this;
    },
    start() {},
    stop() {},
  };
}

await import(pathToFileURL(join(root, "src/app.js")).href);
await new Promise((r) => setTimeout(r, 60));

const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS", msg);
  }
};

const $ = (id) => window.document.getElementById(id);
assert($("summary").textContent.includes("harbor-2026"), "首屏按默认 seed 生成并显示摘要");
assert($("summary").textContent.includes("布局哈希"), "摘要包含布局哈希");

$("seedInput").value = "lighthouse-777";
$("regenerateBtn").click();
assert($("summary").textContent.includes("lighthouse-777"), "显式重新生成切换 seed");

$("buoyCount").value = "4";
$("applyParamsBtn").click();
assert($("message").textContent.includes("仅浮标重排") || $("message").textContent.includes("局部重算"),
  "浮标数量变化走局部重算提示");

$("modeObstacle").click();
const canvas = $("chart");
const blockedMessage = await driveObstacleWall(canvas);
assert(blockedMessage.includes("航线已断开"), "投放障碍断航并给出阻断位置");

$("saveBtn").click();
const savedHash = window.localStorage.getItem("archipelago-layout-v1");
assert(!!savedHash, "场景写入 localStorage");
$("loadBtn").click();
assert($("message").textContent.includes("哈希一致"), "载入后布局哈希一致");

async function driveObstacleWall(target) {
  const { GRID, WORLD } = await import(pathToFileURL(join(root, "src/config.js")).href);
  const clicks = [];
  const rect = { left: 0, top: 0, width: WORLD.width, height: WORLD.height };
  target.getBoundingClientRect = () => rect;
  for (let gx = 4; gx < GRID.cols - 4 && !$("message").textContent.includes("航线已断开"); gx++) {
    for (let gy = 0; gy < GRID.rows; gy++) {
      const evt = new window.MouseEvent("click", {
        clientX: gx * WORLD.cell + WORLD.cell / 2,
        clientY: gy * WORLD.cell + WORLD.cell / 2,
      });
      target.dispatchEvent(evt);
      if ($("message").textContent.includes("航线已断开")) break;
    }
  }
  return $("message").textContent;
}

setTimeout(() => {
  if (!process.exitCode) console.log("\nDOM 冒烟测试全部通过");
  process.exit(process.exitCode || 0);
}, 80);
