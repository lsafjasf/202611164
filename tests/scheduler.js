/* 验证 Web Audio 调度器：按确定性时间步推进，检查线索次数与跨循环重绕。 */
const assert = require("assert");
const E = require("../js/engine.js");

class StubNode {
  constructor() {
    this.gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {} };
    this.frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    this.delayTime = { value: 0 };
    this.pan = { value: 0 };
    this.Q = { value: 0 };
  }
  connect() {} disconnect() {} start() {} stop() {}
}
class StubContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.destination = new StubNode();
  }
  createGain() { return new StubNode(); }
  createBiquadFilter() { return new StubNode(); }
  createConvolver() { return new StubNode(); }
  createDelay() { return new StubNode(); }
  createStereoPanner() { return new StubNode(); }
  createAnalyser() { const n = new StubNode(); n.frequencyBinCount = 1024;
    n.getByteFrequencyData = function () {}; return n; }
  createBuffer(ch, len) {
    return { getChannelData: function () { return new Float32Array(len); } };
  }
  createBufferSource() { const n = new StubNode(); n.playbackRate = { value: 1 }; return n; }
  createOscillator() { return new StubNode(); }
  createScriptProcessor() { return new StubNode(); }
  resume() {} suspend() {} close() {}
}

global.self = global;
global.AudioContext = StubContext;
let clockMs = 0;
global.performance = { now: function () { return clockMs; } };
require("../js/audio.js");

const caseData = E.generateCase("scheduler-seed");
const engine = new global.AudioEngine(caseData);
engine.init();

const triggered = { steps: 0, drip: 0, hum: 0 };
["steps", "drip", "hum"].forEach(function (kind) {
  engine["_voice" + (kind === "steps" ? "Steps" : kind === "drip" ? "Drip" : "Hum")] = function () {
    triggered[kind]++;
  };
});

engine.start();
const stepMs = 40;
for (let i = 0; i < (caseData.loopSeconds * 1000) / stepMs; i++) {
  clockMs += stepMs;
  engine._loop();
}

const expected = caseData.events.reduce(function (acc, ev) {
  acc[ev.kind]++;
  return acc;
}, { steps: 0, drip: 0, hum: 0 });

Object.keys(expected).forEach(function (kind) {
  assert.ok(triggered[kind] >= expected[kind],
    kind + " 触发 " + triggered[kind] + " 次，至少应为 " + expected[kind]);
});

const firstLoopCounts = Object.assign({}, triggered);
for (let i = 0; i < (caseData.loopSeconds * 1000) / stepMs; i++) {
  clockMs += stepMs;
  engine._loop();
}
Object.keys(expected).forEach(function (kind) {
  const second = triggered[kind] - firstLoopCounts[kind];
  assert.ok(Math.abs(second - expected[kind]) <= 1,
    "第二循环 " + kind + " 触发 " + second + " 次，期望约 " + expected[kind]);
});

engine.replay();
assert.strictEqual(engine.virtualTime, 0, "重播应归零虚拟时间");
assert.strictEqual(engine.absoluteTime, 0, "重播应归零绝对时间");

console.log("调度器验证通过：单循环触发 steps=" + firstLoopCounts.steps +
  " drip=" + firstLoopCounts.drip + " hum=" + firstLoopCounts.hum + "，跨循环重绕不丢线索");
process.exit(0);
