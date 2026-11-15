"use strict";

// ============ 1. 全局状态 ============
const NUM_VOICES = 6;
const NUM_STEPS = 16;
const STORAGE_KEY = "harmonic-network-project";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DEFAULT_MIDI = [48, 55, 52, 60, 59, 55]; // C3 G3 E3 C4 B3 G3
const WAVE_TYPES = ["sine", "triangle", "sawtooth", "square"];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function defaultProject() {
  const voices = [];
  for (let i = 0; i < NUM_VOICES; i++) {
    const pattern = new Array(NUM_STEPS).fill(false);
    pattern[0] = true;
    if (i > 0) pattern[(i * 4) % NUM_STEPS] = true;
    voices.push({
      name: "节点" + (i + 1),
      wave: WAVE_TYPES[i % WAVE_TYPES.length],
      midi: DEFAULT_MIDI[i],
      gain: i === 0 ? 0.7 : 0.0, // 初始只有单音，逐步调复杂
      pan: (i - (NUM_VOICES - 1) / 2) / NUM_VOICES,
      muted: false,
      pattern,
    });
  }
  const connections = [];
  for (let s = 0; s < NUM_VOICES; s++) {
    connections.push([]);
    for (let t = 0; t < NUM_VOICES; t++) {
      connections[s].push({ strength: 0, phase: 0 });
    }
  }
  return {
    version: 1,
    bpm: 96,
    transpose: 0,
    loop: true,
    masterGain: 0.8,
    voices,
    connections,
  };
}

let project = defaultProject();

// 运行时状态（不序列化）
const transport = {
  playing: false,
  paused: false,
  step: 0,
  nextStepTime: 0,
  runStartTime: 0,
  timerId: null,
};

// 首轮 / 重载后的运行统计，用于对比
const runStats = { first: null, reloaded: null };
let hasReloaded = false;

function stepDuration() {
  return 60 / project.bpm / 4; // 16 分音符
}

// ============ 2. 音频引擎 ============
let ctx = null;
let masterGain = null;
let compressor = null;
let analyser = null;
let voices = []; // { osc, voiceGain, noteGain, panner }
let fmLinks = []; // fmLinks[s][t] = { modGain, delay }

const FM_DEPTH_HZ = 220; // 连接强度满值时的最大频偏，限幅防爆音
const MAX_DELAY = 0.02;

function ensureContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 6;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  masterGain.connect(compressor);
  compressor.connect(ctx.destination);
  masterGain.connect(analyser);
}

function voiceFreq(v) {
  return midiToFreq(v.midi + project.transpose);
}

function buildGraph() {
  ensureContext();
  teardownGraph();
  const now = ctx.currentTime;
  for (let i = 0; i < NUM_VOICES; i++) {
    const v = project.voices[i];
    const osc = ctx.createOscillator();
    osc.type = v.wave;
    osc.frequency.value = voiceFreq(v);
    const noteGain = ctx.createGain(); // 音序门控包络
    noteGain.gain.value = 0;
    const voiceGain = ctx.createGain(); // 节点电平
    voiceGain.gain.value = v.muted ? 0 : v.gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = v.pan;
    osc.connect(noteGain);
    noteGain.connect(voiceGain);
    voiceGain.connect(panner);
    panner.connect(masterGain);
    osc.start(now);
    voices.push({ osc, noteGain, voiceGain, panner });
  }
  // FM 连接网络：源振荡器 -> 强度增益 -> 相位延迟 -> 目标 frequency
  for (let s = 0; s < NUM_VOICES; s++) {
    fmLinks.push([]);
    for (let t = 0; t < NUM_VOICES; t++) {
      const c = project.connections[s][t];
      const modGain = ctx.createGain();
      modGain.gain.value = c.strength * FM_DEPTH_HZ;
      const delay = ctx.createDelay(MAX_DELAY);
      delay.delayTime.value = c.phase * MAX_DELAY;
      voices[s].osc.connect(modGain);
      modGain.connect(delay);
      delay.connect(voices[t].osc.frequency);
      fmLinks[s].push({ modGain, delay });
    }
  }
  // 主增益淡入，避免突然出声
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(project.masterGain, now, 0.05);
}

// 停止所有节点并释放资源，保证无残留声音
function teardownGraph() {
  if (!ctx) return;
  const now = ctx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(0, now, 0.03);
  const oldVoices = voices;
  const oldLinks = fmLinks;
  voices = [];
  fmLinks = [];
  for (const v of oldVoices) {
    v.noteGain.gain.cancelScheduledValues(now);
    v.noteGain.gain.setTargetAtTime(0, now, 0.02);
    try {
      v.osc.stop(now + 0.2);
    } catch (e) { /* 已停止 */ }
    setTimeout(() => {
      try {
        v.osc.disconnect();
        v.noteGain.disconnect();
        v.voiceGain.disconnect();
        v.panner.disconnect();
      } catch (e) { /* 已断开 */ }
    }, 300);
  }
  for (const row of oldLinks) {
    for (const l of row) {
      setTimeout(() => {
        try {
          l.modGain.disconnect();
          l.delay.disconnect();
        } catch (e) { /* 已断开 */ }
      }, 300);
    }
  }
}

// ============ 3. 音序器与走带 ============
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

function startTransport() {
  ensureContext();
  if (voices.length === 0) buildGraph();
  if (transport.paused) {
    // 恢复：AudioContext 时钟在 suspend 期间冻结，节拍时间不产生累积误差
    ctx.resume();
    transport.paused = false;
    transport.playing = true;
    setStatus("已恢复");
    return;
  }
  ctx.resume();
  transport.playing = true;
  transport.step = 0;
  transport.runStartTime = ctx.currentTime + 0.08;
  transport.nextStepTime = transport.runStartTime;
  beginRunStats();
  if (transport.timerId === null) {
    transport.timerId = setInterval(schedulerTick, LOOKAHEAD_MS);
  }
  setStatus("播放中");
}

function pauseTransport() {
  if (!transport.playing || transport.paused) return;
  // suspend 冻结音频时钟，恢复后 nextStepTime 依然准确，无节拍漂移
  ctx.suspend();
  transport.paused = true;
  transport.playing = false;
  setStatus("已暂停");
}

function stopTransport() {
  transport.playing = false;
  transport.paused = false;
  transport.step = 0;
  if (transport.timerId !== null) {
    clearInterval(transport.timerId);
    transport.timerId = null;
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
  teardownGraph(); // 所有音序节点停止后释放资源
  finalizeRunStats();
  setStatus("已停止，资源已释放");
}

function schedulerTick() {
  if (!transport.playing) return;
  while (transport.nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(transport.step, transport.nextStepTime);
    recordBeat(transport.step, transport.nextStepTime);
    // 步进基于绝对节拍时间累加，改速只影响后续步，不累积偏移
    transport.nextStepTime += stepDuration();
    transport.step++;
    if (transport.step >= NUM_STEPS) {
      if (project.loop) {
        transport.step = 0;
      } else {
        const stopAt = transport.nextStepTime;
        setTimeout(stopTransport, Math.max(0, (stopAt - ctx.currentTime) * 1000));
        transport.playing = false;
        break;
      }
    }
  }
}

function scheduleStep(step, time) {
  const dur = stepDuration();
  for (let i = 0; i < NUM_VOICES; i++) {
    const v = project.voices[i];
    const g = voices[i].noteGain.gain;
    if (v.pattern[step] && !v.muted && v.gain > 0) {
      g.cancelScheduledValues(time);
      g.setValueAtTime(0.0001, time);
      g.exponentialRampToValueAtTime(1, time + 0.012);
      g.setTargetAtTime(0.0001, time + dur * 0.7, 0.04);
      recordNote(i, step, time);
    } else {
      g.setTargetAtTime(0.0001, time, 0.03);
    }
  }
}

// ============ 4. 运行统计（首轮 vs 重载） ============
let currentRun = null;

function beginRunStats() {
  currentRun = { notes: 0, beats: [], exportDuration: null };
}

function recordNote(voice, step, time) {
  if (!currentRun) return;
  currentRun.notes++;
}

function recordBeat(step, time) {
  stepEvents.push({ step, time });
  if (stepEvents.length > 64) stepEvents.splice(0, stepEvents.length - 64);
  if (currentRun) {
    currentRun.beats.push({ step, t: time - transport.runStartTime });
  }
}

function finalizeRunStats() {
  if (!currentRun) return;
  if (hasReloaded) {
    runStats.reloaded = currentRun;
  } else {
    runStats.first = currentRun;
  }
  currentRun = null;
}

function compareRuns() {
  const a = runStats.first;
  const b = runStats.reloaded;
  const out = document.getElementById("compareOut");
  if (!a || !b) {
    out.textContent = "需要先完整播放一轮、保存并重载后再播放一轮。\n"
      + "首轮: " + (a ? "已记录" : "缺失") + "，重载: " + (b ? "已记录" : "缺失");
    return;
  }
  const n = Math.min(a.beats.length, b.beats.length);
  let maxBeatErr = 0;
  for (let i = 0; i < n; i++) {
    maxBeatErr = Math.max(maxBeatErr, Math.abs(a.beats[i].t - b.beats[i].t));
  }
  const durA = a.exportDuration;
  const durB = b.exportDuration;
  const durDiff = durA !== null && durB !== null ? Math.abs(durA - durB) : null;
  out.textContent =
    "音符数量  首轮: " + a.notes + "  重载: " + b.notes +
    "  → " + (a.notes === b.notes ? "一致 ✓" : "不一致 ✗") + "\n" +
    "节拍位置  采样 " + n + " 步，最大偏差: " + (maxBeatErr * 1000).toFixed(3) + " ms" +
    (maxBeatErr < 1 ? " ✓" : " ✗") + "\n" +
    "导出时长  首轮: " + fmtDur(durA) + "  重载: " + fmtDur(durB) +
    (durDiff !== null ? "  差值: " + (durDiff * 1000).toFixed(3) + " ms " + (durDiff < 0.001 ? "✓" : "✗") : "（未导出）");
}

function fmtDur(d) {
  return d === null || d === undefined ? "--" : d.toFixed(4) + " s";
}

// ============ 5. 保存 / 重载 ============
function saveProject() {
  const json = JSON.stringify(project, null, 2);
  localStorage.setItem(STORAGE_KEY, json);
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, "harmonic-network.json");
  setStatus("工程已保存（含每轨参数与增益）");
}

function loadProject() {
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) {
    setStatus("未找到已保存的工程");
    return;
  }
  try {
    const data = JSON.parse(json);
    validateProject(data);
    const wasActive = transport.playing || transport.paused;
    if (wasActive) stopTransport();
    project = data;
    hasReloaded = true;
    buildGraph();
    syncUIFromProject();
    // 重载后从头播放
    transport.step = 0;
    startTransport();
    setStatus("工程已重载，从头播放");
  } catch (e) {
    setStatus("重载失败: " + e.message);
  }
}

function validateProject(p) {
  if (!p || !Array.isArray(p.voices) || p.voices.length !== NUM_VOICES) {
    throw new Error("工程数据不完整");
  }
  for (const v of p.voices) {
    if (typeof v.gain !== "number" || !Array.isArray(v.pattern)) {
      throw new Error("音轨参数缺失");
    }
  }
}

// ============ 6. 离线导出 WAV ============
async function exportWav() {
  const dur = NUM_STEPS * stepDuration(); // 一个完整循环
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const master = off.createGain();
  master.gain.value = project.masterGain;
  const comp = off.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(off.destination);
  const oscs = [];
  const noteGains = [];
  for (let i = 0; i < NUM_VOICES; i++) {
    const v = project.voices[i];
    const osc = off.createOscillator();
    osc.type = v.wave;
    osc.frequency.value = voiceFreq(v);
    const ng = off.createGain();
    ng.gain.value = 0;
    const vg = off.createGain();
    vg.gain.value = v.muted ? 0 : v.gain;
    const pan = off.createStereoPanner();
    pan.pan.value = v.pan;
    osc.connect(ng);
    ng.connect(vg);
    vg.connect(pan);
    pan.connect(master);
    oscs.push(osc);
    noteGains.push(ng);
  }
  for (let s = 0; s < NUM_VOICES; s++) {
    for (let t = 0; t < NUM_VOICES; t++) {
      const c = project.connections[s][t];
      if (c.strength <= 0) continue;
      const mg = off.createGain();
      mg.gain.value = c.strength * FM_DEPTH_HZ;
      const dl = off.createDelay(MAX_DELAY);
      dl.delayTime.value = c.phase * MAX_DELAY;
      oscs[s].connect(mg);
      mg.connect(dl);
      dl.connect(oscs[t].frequency);
    }
  }
  const stepDur = stepDuration();
  for (let step = 0; step < NUM_STEPS; step++) {
    const t = step * stepDur;
    for (let i = 0; i < NUM_VOICES; i++) {
      const v = project.voices[i];
      const g = noteGains[i].gain;
      if (v.pattern[step] && !v.muted && v.gain > 0) {
        g.setValueAtTime(0.0001, t);
        g.exponentialRampToValueAtTime(1, t + 0.012);
        g.setTargetAtTime(0.0001, t + stepDur * 0.7, 0.04);
      }
    }
  }
  for (const o of oscs) {
    o.start(0);
    o.stop(dur);
  }
  const buf = await off.startRendering();
  const wav = encodeWav(buf);
  downloadBlob(new Blob([wav], { type: "audio/wav" }), "harmonic-network.wav");
  // 记录导出时长用于首轮/重载对比
  const target = hasReloaded ? "reloaded" : "first";
  if (!runStats[target]) runStats[target] = { notes: 0, beats: [], exportDuration: null };
  runStats[target].exportDuration = buf.duration;
  setStatus("已导出 WAV，时长 " + buf.duration.toFixed(4) + " s");
}

function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length * numCh * 2;
  const out = new ArrayBuffer(44 + len);
  const view = new DataView(out);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + len, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, len, true);
  let offset = 44;
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ============ 7. 可视化（Canvas 网络 + 波形，与节拍同步） ============
const cvNet = document.getElementById("cvNetwork");
const cvWave = document.getElementById("cvWave");
const netCtx = cvNet.getContext("2d");
const waveCtx = cvWave.getContext("2d");
const waveData = new Uint8Array(2048);
let stepEvents = []; // {step, time} 已调度步，用于视觉与音频时钟对齐
let selectedConn = null; // {s, t}
let pendingSelect = null;

function nodePos(i) {
  const cx = cvNet.width / 2;
  const cy = cvNet.height / 2;
  const r = Math.min(cx, cy) - 60;
  const a = -Math.PI / 2 + (i / NUM_VOICES) * Math.PI * 2;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function currentStep() {
  if (!ctx || !transport.playing) return -1;
  const now = ctx.currentTime;
  let s = -1;
  for (const e of stepEvents) {
    if (e.time <= now) s = e.step;
    else break;
  }
  return s;
}

function drawNetwork() {
  netCtx.clearRect(0, 0, cvNet.width, cvNet.height);
  const step = currentStep();
  const now = ctx ? ctx.currentTime : 0;
  // 连接边：线宽=强度，流动虚线偏移=相位
  for (let s = 0; s < NUM_VOICES; s++) {
    for (let t = 0; t < NUM_VOICES; t++) {
      const c = project.connections[s][t];
      if (c.strength <= 0.01 || s === t) continue;
      const a = nodePos(s);
      const b = nodePos(t);
      netCtx.strokeStyle = "rgba(111,168,236," + (0.25 + c.strength * 0.6) + ")";
      netCtx.lineWidth = 1 + c.strength * 6;
      netCtx.setLineDash([6, 6]);
      netCtx.lineDashOffset = -((now * 40 + c.phase * 100) % 12);
      netCtx.beginPath();
      netCtx.moveTo(a.x, a.y);
      netCtx.quadraticCurveTo(cvNet.width / 2, cvNet.height / 2, b.x, b.y);
      netCtx.stroke();
    }
  }
  netCtx.setLineDash([]);
  // 节点：触发步时放大发光
  for (let i = 0; i < NUM_VOICES; i++) {
    const p = nodePos(i);
    const v = project.voices[i];
    const active = step >= 0 && v.pattern[step] && !v.muted && v.gain > 0;
    const r = active ? 26 : 20;
    netCtx.beginPath();
    netCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    netCtx.fillStyle = v.muted ? "#333c4e" : active ? "#ffd166" : "#4f8fdd";
    netCtx.fill();
    if (selectedConn && (selectedConn.s === i || selectedConn.t === i)) {
      netCtx.strokeStyle = "#fff";
      netCtx.lineWidth = 2;
      netCtx.stroke();
    }
    netCtx.fillStyle = "#0b0e14";
    netCtx.font = "12px sans-serif";
    netCtx.textAlign = "center";
    netCtx.textBaseline = "middle";
    netCtx.fillText(String(i + 1), p.x, p.y);
  }
  // 底部节拍条
  const bw = cvNet.width / NUM_STEPS;
  for (let i = 0; i < NUM_STEPS; i++) {
    netCtx.fillStyle = i === step ? "#ffd166" : i % 4 === 0 ? "#33405a" : "#232b3a";
    netCtx.fillRect(i * bw + 1, cvNet.height - 12, bw - 2, 8);
  }
}

function drawWave() {
  waveCtx.clearRect(0, 0, cvWave.width, cvWave.height);
  if (!analyser) return;
  analyser.getByteTimeDomainData(waveData);
  waveCtx.strokeStyle = "#8fd18a";
  waveCtx.lineWidth = 2;
  waveCtx.beginPath();
  const dx = cvWave.width / waveData.length;
  for (let i = 0; i < waveData.length; i++) {
    const y = (waveData[i] / 255) * cvWave.height;
    if (i === 0) waveCtx.moveTo(0, y);
    else waveCtx.lineTo(i * dx, y);
  }
  waveCtx.stroke();
}

function drawLoop() {
  drawNetwork();
  drawWave();
  highlightStepButtons(currentStep());
  requestAnimationFrame(drawLoop);
}

// ============ 8. UI 绑定 ============
const statusEl = document.getElementById("status");
const stepButtons = []; // stepButtons[voice][step]

function setStatus(msg) {
  statusEl.textContent = msg;
}

function highlightStepButtons(step) {
  for (let i = 0; i < NUM_VOICES; i++) {
    const row = stepButtons[i];
    if (!row) continue;
    for (let s = 0; s < NUM_STEPS; s++) {
      row[s].classList.toggle("playing", s === step);
    }
  }
}

function buildVoicePanel() {
  const panel = document.getElementById("voicePanel");
  panel.innerHTML = "";
  stepButtons.length = 0;
  project.voices.forEach((v, i) => {
    const div = document.createElement("div");
    div.className = "voice";
    const title = document.createElement("h3");
    title.textContent = v.name;
    div.appendChild(title);

    const waveSel = document.createElement("select");
    WAVE_TYPES.forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w;
      opt.textContent = w;
      waveSel.appendChild(opt);
    });
    waveSel.value = v.wave;
    waveSel.onchange = () => {
      v.wave = waveSel.value;
      if (voices[i]) voices[i].osc.type = v.wave;
    };
    div.appendChild(waveSel);

    div.appendChild(makeSlider("音高", v.midi, 36, 84, 1, (val) => {
      v.midi = val;
      if (voices[i]) {
        voices[i].osc.frequency.setTargetAtTime(voiceFreq(v), ctx.currentTime, 0.02);
      }
    }, (val) => NOTE_NAMES[val % 12] + (Math.floor(val / 12) - 1)));

    div.appendChild(makeSlider("增益", v.gain, 0, 1, 0.01, (val) => {
      v.gain = val;
      applyVoiceGain(i);
    }));

    div.appendChild(makeSlider("声像", v.pan, -1, 1, 0.01, (val) => {
      v.pan = val;
      if (voices[i]) voices[i].panner.pan.setTargetAtTime(val, ctx.currentTime, 0.02);
    }));

    const muteLbl = document.createElement("label");
    const muteChk = document.createElement("input");
    muteChk.type = "checkbox";
    muteChk.checked = v.muted;
    muteChk.onchange = () => {
      v.muted = muteChk.checked;
      applyVoiceGain(i);
    };
    muteLbl.appendChild(muteChk);
    muteLbl.appendChild(document.createTextNode(" 静音"));
    div.appendChild(muteLbl);

    const steps = document.createElement("div");
    steps.className = "steps";
    const row = [];
    for (let s = 0; s < NUM_STEPS; s++) {
      const b = document.createElement("button");
      b.classList.toggle("on", v.pattern[s]);
      b.onclick = () => {
        v.pattern[s] = !v.pattern[s];
        b.classList.toggle("on", v.pattern[s]);
      };
      steps.appendChild(b);
      row.push(b);
    }
    stepButtons.push(row);
    div.appendChild(steps);
    panel.appendChild(div);
  });
}

function makeSlider(label, value, min, max, step, oninput, fmt) {
  const lbl = document.createElement("label");
  const span = document.createElement("span");
  const show = fmt || ((x) => Number(x).toFixed(2));
  span.textContent = " " + label + " " + show(value);
  const rng = document.createElement("input");
  rng.type = "range";
  rng.min = min;
  rng.max = max;
  rng.step = step;
  rng.value = value;
  rng.oninput = () => {
    const val = Number(rng.value);
    oninput(val);
    span.textContent = " " + label + " " + show(val);
  };
  lbl.appendChild(rng);
  lbl.appendChild(span);
  return lbl;
}

// 增益平滑过渡，避免爆音与突然静音
function applyVoiceGain(i) {
  if (!voices[i] || !ctx) return;
  const v = project.voices[i];
  const target = v.muted ? 0 : v.gain;
  voices[i].voiceGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
}

function syncUIFromProject() {
  document.getElementById("rngBpm").value = project.bpm;
  document.getElementById("lblBpm").textContent = project.bpm;
  document.getElementById("rngTranspose").value = project.transpose;
  document.getElementById("lblTranspose").textContent = project.transpose;
  document.getElementById("chkLoop").checked = project.loop;
  buildVoicePanel();
}

// ============ 9. 连接编辑与走带绑定 ============
const rngConnStr = document.getElementById("rngConnStr");
const rngConnPhase = document.getElementById("rngConnPhase");
const connLabel = document.getElementById("connLabel");

cvNet.addEventListener("click", (e) => {
  const rect = cvNet.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * cvNet.width;
  const y = ((e.clientY - rect.top) / rect.height) * cvNet.height;
  let hit = -1;
  for (let i = 0; i < NUM_VOICES; i++) {
    const p = nodePos(i);
    if (Math.hypot(p.x - x, p.y - y) < 28) hit = i;
  }
  if (hit < 0) return;
  if (pendingSelect === null) {
    pendingSelect = hit;
    connLabel.textContent = "源节点 " + (hit + 1) + " → 再点目标节点";
  } else {
    selectedConn = { s: pendingSelect, t: hit };
    pendingSelect = null;
    const c = project.connections[selectedConn.s][selectedConn.t];
    rngConnStr.value = c.strength;
    rngConnPhase.value = c.phase;
    connLabel.textContent = "连接 " + (selectedConn.s + 1) + " → " + (selectedConn.t + 1);
  }
});

function applyConn() {
  if (!selectedConn) return;
  const { s, t } = selectedConn;
  const c = project.connections[s][t];
  c.strength = Number(rngConnStr.value);
  c.phase = Number(rngConnPhase.value);
  if (fmLinks[s] && fmLinks[s][t] && ctx) {
    fmLinks[s][t].modGain.gain.setTargetAtTime(c.strength * FM_DEPTH_HZ, ctx.currentTime, 0.05);
    fmLinks[s][t].delay.delayTime.setTargetAtTime(c.phase * MAX_DELAY, ctx.currentTime, 0.05);
  }
}
rngConnStr.oninput = applyConn;
rngConnPhase.oninput = applyConn;

document.getElementById("btnPlay").onclick = startTransport;
document.getElementById("btnPause").onclick = pauseTransport;
document.getElementById("btnStop").onclick = stopTransport;
document.getElementById("btnSave").onclick = saveProject;
document.getElementById("btnLoad").onclick = loadProject;
document.getElementById("btnExport").onclick = () => {
  exportWav().catch((e) => setStatus("导出失败: " + e.message));
};
document.getElementById("btnCompare").onclick = compareRuns;

document.getElementById("chkLoop").onchange = (e) => {
  project.loop = e.target.checked;
};

// 速度只影响后续步的间隔，节拍索引不回溯，不产生累积误差
document.getElementById("rngBpm").oninput = (e) => {
  project.bpm = Number(e.target.value);
  document.getElementById("lblBpm").textContent = project.bpm;
};

// 变调始终由基础音高重新计算，不叠加历史偏移
document.getElementById("rngTranspose").oninput = (e) => {
  project.transpose = Number(e.target.value);
  document.getElementById("lblTranspose").textContent = project.transpose;
  if (!ctx) return;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (voices[i]) {
      voices[i].osc.frequency.setTargetAtTime(voiceFreq(project.voices[i]), ctx.currentTime, 0.03);
    }
  }
};

// ============ 10. 初始化 ============
syncUIFromProject();
drawLoop();
setStatus("就绪：点击播放开始，点击画布节点编辑连接");
