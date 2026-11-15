/* jsdom 冒烟测试：验证 UI 绑定与状态机；Web Audio/Canvas 以桩对象替代。 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

function noop() {}
const ctx2d = new Proxy({}, { get: function () { return noop; }, set: function () { return true; } });
window.HTMLCanvasElement.prototype.getContext = function () { return ctx2d; };

class AudioNode {
  constructor() { this.gain = { value: 1, setValueAtTime: noop, linearRampToValueAtTime: noop,
    exponentialRampToValueAtTime: noop }; this.frequency = { value: 0, setValueAtTime: noop,
    exponentialRampToValueAtTime: noop }; this.pan = { value: 0 }; this.Q = { value: 0 };
    this.delayTime = { value: 0 }; this.fftSize = 0; }
  connect() {} disconnect() {} start() {} stop() {}
  getChannelData() { return new Float32Array(8); }
}
class FakeAudioContext {
  constructor() {
    this.state = "running"; this.sampleRate = 48000; this.currentTime = 0;
    this.destination = new AudioNode();
  }
  createGain() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createConvolver() { return new AudioNode(); }
  createDelay() { return new AudioNode(); }
  createStereoPanner() { return new AudioNode(); }
  createAnalyser() {
    const n = new AudioNode();
    n.frequencyBinCount = 1024;
    n.getByteFrequencyData = function (a) { a.fill(128); };
    return n;
  }
  createBuffer(ch, len) { return { getChannelData: function () { return new Float32Array(len); } }; }
  createBufferSource() { const n = new AudioNode(); n.buffer = null; n.playbackRate = { value: 1 }; return n; }
  createOscillator() { const n = new AudioNode(); n.type = ""; return n; }
  createScriptProcessor() {
    const n = new AudioNode();
    n.onaudioprocess = null;
    return n;
  }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}
window.AudioContext = FakeAudioContext;
window.performance = { now: function () { return Date.now(); } };

function load(script) {
  window.eval(fs.readFileSync(path.join(__dirname, "..", script), "utf8"));
}
load("js/engine.js");
load("js/visuals.js");
load("js/audio.js");
load("js/app.js");

const $ = function (id) { return window.document.getElementById(id); };

assert.strictEqual($("positionGrid").children.length, 4, "应有 4 个监听位置");
assert.strictEqual($("deductionForm").querySelectorAll("select").length, 9, "应有 9 个推断下拉框");
assert.ok($("btnPause").disabled, "初始暂停按钮应禁用");
assert.ok($("btnSubmit").disabled, "初始提交按钮应禁用");

const beforeText = window.document.body.textContent;
["混凝土墙", "砖墙", "瓷砖墙", "脚步声", "滴水声", "低频嗡鸣"].forEach(function (word) {
  const inOptions = Array.from(window.document.querySelectorAll("option")).some(function (o) {
    return o.textContent.indexOf(word) >= 0;
  });
  assert.ok(inOptions, "选项文案 " + word + " 应存在于表单");
});
assert.ok(!$("settlementPanel").classList.contains("hidden") === false, "结算面板初始应隐藏");

$("btnStart").click();
assert.strictEqual($("phaseBadge").textContent, "调查中");
assert.ok(!$("btnPause").disabled, "开始后可暂停");
assert.ok(!$("btnSubmit").disabled, "开始后可提交");

$("btnPause").click();
assert.strictEqual($("phaseBadge").textContent, "已暂停");
$("btnStart").click();
assert.strictEqual($("phaseBadge").textContent, "调查中");

$("btnRecA").click();
assert.strictEqual($("trackMetaA").textContent, "录制中…");
$("btnRecA").click();
assert.ok($("trackMetaA").textContent.indexOf("位置") >= 0, "录音元数据应包含位置");

const selects = $("deductionForm").querySelectorAll("select");
selects.forEach(function (sel) {
  sel.value = sel.options[1].value;
  sel.dispatchEvent(new window.Event("change"));
});
$("btnSubmit").click();
assert.ok(!$("settlementPanel").classList.contains("hidden"), "提交后结算面板应显示");
const rows = $("evidenceTable").querySelector("tbody").querySelectorAll("tr");
assert.strictEqual(rows.length, 9, "结算表应有 9 行判断");
rows.forEach(function (tr) {
  assert.ok(tr.children.length === 8, "每行应并列 8 列对照信息");
});

$("btnReopen").click();
assert.ok($("settlementPanel").classList.contains("hidden"), "重开后结算应重置隐藏");
assert.strictEqual($("seedInput").value, "case-20261116", "重开保持同一 seed");

console.log("DOM 冒烟测试通过：页面渲染、开始/暂停/提交/重开与 9 行结算均正常");
process.exit(0);
