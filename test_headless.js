"use strict";
// 无头冒烟测试：用桩替代 DOM 与 Web Audio，验证 app.js 核心逻辑
const fs = require("fs");
const vm = require("vm");

let fakeNow = 0;
const timeouts = [];
const stats = { oscStop: 0, oscStart: 0, disconnect: 0 };

function param(value) {
  return {
    value: value || 0,
    setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {},
    exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {},
  };
}

function node(extra) {
  return Object.assign({
    connect() {}, disconnect() { stats.disconnect++; },
  }, extra);
}

class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.destination = {};
    this.sampleRate = 44100;
  }
  get currentTime() { return fakeNow; }
  createGain() { return node({ gain: param(1) }); }
  createOscillator() {
    return node({
      type: "sine", frequency: param(440),
      start() { stats.oscStart++; }, stop() { stats.oscStop++; },
    });
  }
  createStereoPanner() { return node({ pan: param(0) }); }
  createDynamicsCompressor() {
    return node({ threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0) });
  }
  createAnalyser() { return node({ fftSize: 2048, getByteTimeDomainData(a) { a.fill(128); } }); }
  createDelay() { return node({ delayTime: param(0) }); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  resume() { this.state = "running"; return Promise.resolve(); }
}

class FakeOfflineAudioContext extends FakeAudioContext {
  constructor(ch, length, sr) {
    super();
    this.length = length;
    this.sampleRate = sr;
    this.numberOfChannels = ch;
  }
  startRendering() {
    const { numberOfChannels, length, sampleRate } = this;
    return Promise.resolve({
      numberOfChannels, length, sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    });
  }
}

const ctx2dStub = new Proxy({}, {
  get: (t, p) => (typeof p === "string" ? () => {} : undefined),
  set: () => true,
});

function makeEl(id) {
  return {
    id: id || "", children: [], value: "", checked: false, textContent: "",
    innerHTML: "", width: 640, height: 480, style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, click() {},
    getContext: () => ctx2dStub,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
  };
}

const elCache = {};
const store = {};

global.window = { AudioContext: FakeAudioContext };
global.OfflineAudioContext = FakeOfflineAudioContext;
global.document = {
  getElementById: (id) => (elCache[id] = elCache[id] || makeEl(id)),
  createElement: () => makeEl(),
  createTextNode: (t) => ({ text: t }),
};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
global.requestAnimationFrame = () => {};
global.setInterval = () => 1;
global.clearInterval = () => {};
const realSetTimeout = setTimeout;
global.setTimeout = (fn) => { timeouts.push(fn); return timeouts.length; };

let code = fs.readFileSync(__dirname + "/app.js", "utf8");
code += "\n;globalThis.__app = { get project(){return project}, set project(p){project=p},"
  + " get transport(){return transport}, get voices(){return voices}, get runStats(){return runStats},"
  + " get hasReloaded(){return hasReloaded}, stepDuration, voiceFreq, midiToFreq, compareRuns };";
vm.runInThisContext(code, { filename: "app.js" });

const app = globalThis.__app;
let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name);
  if (!cond) failures++;
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }
function advance(sec) { // 小步推进假时钟并驱动调度器
  const end = fakeNow + sec;
  while (fakeNow < end) {
    fakeNow = Math.min(end, fakeNow + 0.02);
    schedulerTick();
  }
}
function runTimeouts() { while (timeouts.length) timeouts.shift()(); }

// ---- A. 初始工程与图构建 ----
check("默认工程 6 轨 16 步", app.project.voices.length === 6 && app.project.voices[0].pattern.length === 16);
startTransport();
check("构建后 6 个振荡器", app.voices.length === 6 && stats.oscStart === 6);

// 设置一个可数的模式：轨0全步，轨1每4步
app.project.voices[0].pattern.fill(true);
app.project.voices[1].gain = 0.5;
app.project.voices[1].pattern.fill(false);
app.project.voices[1].pattern[0] = app.project.voices[1].pattern[4] = true;
app.project.voices[1].pattern[8] = app.project.voices[1].pattern[12] = true;
stopTransport();
runTimeouts();
check("停止后振荡器全部停止", stats.oscStop === 6 && app.voices.length === 0);

// ---- B. 首轮播放：音符数与节拍网格 ----
const sd = app.stepDuration();
app.project.loop = false; // 单轮播放，避免循环多调度
startTransport();
advance(sd * 16 + 0.05);
runTimeouts();
stopTransport();
const first = app.runStats.first;
check("首轮音符数 = 16+4", first && first.notes === 20);
let gridOk = first && first.beats.length >= 16;
for (let i = 0; i < 16 && gridOk; i++) gridOk = approx(first.beats[i].t, i * sd, 1e-6);
check("首轮节拍落在网格上", gridOk);
app.project.loop = true;

// ---- C. 快速暂停/恢复不累积节拍误差 ----
startTransport();
for (let k = 0; k < 5; k++) {
  advance(sd * 1.3);
  pauseTransport();
  startTransport(); // 暂停状态下调用即恢复
}
advance(sd * 16);
stopTransport();
runTimeouts();
const afterPause = app.runStats.first;
let pauseOk = true;
for (let i = 1; i < afterPause.beats.length && pauseOk; i++) {
  pauseOk = approx(afterPause.beats[i].t, i * sd, 1e-6);
}
check("5 次暂停/恢复后节拍零漂移", pauseOk);

// ---- D. 中途变速不产生跳变 ----
startTransport();
advance(sd * 4 + 0.01);
app.project.bpm = 120;
const sd2 = app.stepDuration();
advance(sd2 * 12 + 0.05);
stopTransport();
runTimeouts();
const bpmRun = app.runStats.first;
let bpmOk = bpmRun.beats.length >= 16;
// 已前瞻排入的转换步允许用旧间隔，其后必须全部为新间隔
const transition = bpmRun.beats[5].t - bpmRun.beats[4].t;
bpmOk = bpmOk && (approx(transition, sd, 1e-6) || approx(transition, sd2, 1e-6));
for (let i = 6; i < 16 && bpmOk; i++) {
  bpmOk = approx(bpmRun.beats[i].t - bpmRun.beats[i - 1].t, sd2, 1e-6);
}
bpmOk = bpmOk && approx(bpmRun.beats[4].t, 4 * sd, 1e-6);
check("变速后节拍间隔切换且位置连续", bpmOk);
app.project.bpm = 96;

// ---- E. 变调不累积偏移 ----
app.project.transpose = 7;
app.project.transpose = -5;
app.project.transpose = 0;
check("变调往返后频率还原", approx(app.voiceFreq(app.project.voices[0]), app.midiToFreq(app.project.voices[0].midi)));

// ---- F. 保存 → 重载 → 对比 ----
saveProject();
check("工程已写入存储", !!store["harmonic-network-project"]);
app.project.voices[2].gain = 0.9; // 改动后再重载应被还原
const savedGain = JSON.parse(store["harmonic-network-project"]).voices[2].gain;
loadProject();
runTimeouts();
check("重载后参数还原", app.project.voices[2].gain === savedGain);
check("重载标记已置位", app.hasReloaded === true);
check("重载后自动从头播放", app.transport.playing && app.transport.step >= 0);
app.project.loop = false;
advance(app.stepDuration() * 16 + 0.05);
runTimeouts();
stopTransport();
const reloaded = app.runStats.reloaded;
check("重载轮音符数一致", reloaded && reloaded.notes === 20);
let reloadGridOk = reloaded && reloaded.beats.length >= 16;
for (let i = 0; i < 16 && reloadGridOk; i++) reloadGridOk = approx(reloaded.beats[i].t, i * sd, 1e-6);
check("重载轮节拍位置与首轮一致", reloadGridOk);

// ---- G. 导出时长对比 ----
exportWav().then(() => {
  check("重载后轮导出时长 = 一个循环", approx(app.runStats.reloaded.exportDuration, 16 * sd, 1e-3));
  app.compareRuns();
  const out = elCache["compareOut"].textContent;
  check("对比报告包含音符/节拍/时长", /音符数量/.test(out) && /节拍位置/.test(out) && /导出时长/.test(out));
  console.log(failures === 0 ? "\n全部通过" : "\n失败 " + failures + " 项");
  process.exit(failures === 0 ? 0 : 1);
});
