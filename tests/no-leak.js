/* 提交前不得在 DOM 中暴露真实参数；位置只能是抽象文字标签（无平面图）。 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only" });
const window = dom.window;
const noop = function () {};
window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, { get: function () { return noop; }, set: function () { return true; } });
};
function node() {
  return {
    gain: { value: 1 }, frequency: { value: 0 }, Q: { value: 0 },
    delayTime: { value: 0 }, pan: { value: 0 },
    connect: noop, disconnect: noop, start: noop, stop: noop
  };
}
window.AudioContext = function () {
  return {
    state: "running", sampleRate: 48000, currentTime: 0, destination: node(),
    createGain: node, createBiquadFilter: node, createConvolver: node,
    createDelay: node, createStereoPanner: node,
    createAnalyser: function () {
      const n = node();
      n.frequencyBinCount = 64;
      n.getByteFrequencyData = noop;
      return n;
    },
    createBuffer: function (ch, len) {
      return { getChannelData: function () { return new Float32Array(len); } };
    },
    createBufferSource: function () { const n = node(); n.playbackRate = { value: 1 }; return n; },
    createOscillator: node,
    createScriptProcessor: function () { const n = node(); n.onaudioprocess = null; return n; },
    resume: noop, suspend: noop, close: noop
  };
};
window.performance = { now: function () { return 0; } };
window.requestAnimationFrame = function () { return 0; };

["js/engine.js", "js/visuals.js", "js/audio.js", "js/app.js"].forEach(function (f) {
  window.eval(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
});

const bodyText = window.document.body.textContent;
assert.ok(window.document.getElementById("settlementPanel").classList.contains("hidden"),
  "结算面板初始必须隐藏");
assert.ok(!bodyText.includes("RT60"), "提交前不得出现墙面 RT60 真实参数");
assert.ok(!bodyText.includes("低通"), "提交前不得出现门洞低通真实参数");
assert.ok(Array.from(window.document.querySelectorAll(".position-btn"))
  .every(function (b) { return /位置 [A-D]/.test(b.textContent); }),
  "监听位置只能是抽象文字标签，不得出现平面结构");
assert.strictEqual(window.document.querySelectorAll("select").length, 9, "应有 9 个推断选择框");
assert.ok(!window.APP_STATE.submitted, "初始未提交");

console.log("防泄密验证通过：提交前 DOM 无真实参数，无平面图，仅抽象位置标签");
process.exit(0);
