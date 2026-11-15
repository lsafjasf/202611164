"use strict";

const ROOM_W = 10;
const ROOM_D = 8;
const LISTENER = { x: ROOM_W / 2, y: ROOM_D / 2 };
const STEPS = 16;
const BARS = 4;
const TOTAL_STEPS = STEPS * BARS;
const LOOKAHEAD = 0.15;
const TICK_MS = 30;
const STORE_KEY = "uid783.project.v1";
const EXPORT_KEY = "uid783.lastExport.v1";

const TRACK_DEFS = [
  { name: "Kick 底鼓", type: "kick", color: "#ff5a6e" },
  { name: "Snare 军鼓", type: "snare", color: "#ffd75a" },
  { name: "Hat 踩镲", type: "hat", color: "#5aff8c" },
  { name: "Tom 嗵鼓", type: "tom", color: "#5aa2ff" },
];

const PATH_NAMES = { circle: "圆形", square: "方形", eight: "8 字", line: "直线往返" };

const state = {
  bpm: 120,
  speed: 1.0,
  loop: true,
  tracks: TRACK_DEFS.map((def, i) => ({
    name: def.name,
    type: def.type,
    color: def.color,
    pitch: 1.0,
    gain: 0.9,
    pathType: ["circle", "square", "eight", "line"][i],
    pattern: defaultPattern(def.type),
  })),
};

function defaultPattern(type) {
  const p = new Array(STEPS).fill(false);
  if (type === "kick") [0, 4, 8, 12].forEach(i => (p[i] = true));
  if (type === "snare") [4, 12].forEach(i => (p[i] = true));
  if (type === "hat") for (let i = 0; i < STEPS; i += 2) p[i] = true;
  if (type === "tom") [7, 14, 15].forEach(i => (p[i] = true));
  return p;
}

function pathPos(pathType, t, trackIdx) {
  const cx = ROOM_W / 2, cy = ROOM_D / 2;
  if (pathType === "circle") {
    const a = 2 * Math.PI * t;
    return { x: cx + 2.8 * Math.cos(a), y: cy + 2.2 * Math.sin(a) };
  }
  if (pathType === "square") {
    const x0 = 1.2, x1 = ROOM_W - 1.2, y0 = 1.0, y1 = ROOM_D - 1.0;
    const per = 2 * (x1 - x0) + 2 * (y1 - y0);
    let d = (t % 1) * per;
    if (d < x1 - x0) return { x: x0 + d, y: y0 };
    d -= x1 - x0;
    if (d < y1 - y0) return { x: x1, y: y0 + d };
    d -= y1 - y0;
    if (d < x1 - x0) return { x: x1 - d, y: y1 };
    d -= x1 - x0;
    return { x: x0, y: y1 - d };
  }
  if (pathType === "eight") {
    return { x: cx + 3.0 * Math.sin(2 * Math.PI * t), y: cy + 2.2 * Math.sin(4 * Math.PI * t) };
  }
  const tri = t < 0.5 ? t * 2 : 2 - t * 2;
  return { x: 1.2 + (ROOM_W - 2.4) * tri, y: 1.5 + trackIdx * 1.6 };
}

function wallProximity(x, y) {
  const d = Math.min(x, ROOM_W - x, y, ROOM_D - y);
  return Math.max(0, Math.min(1, 1 - d / 1.5));
}

function secondsPerStep() {
  return 60 / (state.bpm * state.speed) / 4;
}

const noiseBuffers = new WeakMap();
function getNoiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

function triggerHit(ctx, dest, track, time, activeSources) {
  const out = ctx.createGain();
  out.connect(dest);
  const pitch = track.pitch;
  const stopAt = time + 0.6;
  if (track.type === "kick") {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(140 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(42 * pitch, time + 0.12);
    g.gain.setValueAtTime(1.0, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(g).connect(out);
    osc.start(time); osc.stop(stopAt);
    activeSources.push(osc);
  } else if (track.type === "snare") {
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1800 * pitch; bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.8, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    noise.connect(bp).connect(ng).connect(out);
    const osc = ctx.createOscillator();
    osc.frequency.value = 190 * pitch;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(og).connect(out);
    noise.start(time); noise.stop(time + 0.2);
    osc.start(time); osc.stop(stopAt);
    activeSources.push(noise, osc);
  } else if (track.type === "hat") {
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 6000 * pitch;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    noise.connect(hp).connect(g).connect(out);
    noise.start(time); noise.stop(time + 0.08);
    activeSources.push(noise);
  } else {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(200 * pitch, time);
    osc.frequency.exponentialRampToValueAtTime(95 * pitch, time + 0.2);
    g.gain.setValueAtTime(0.9, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
    osc.connect(g).connect(out);
    osc.start(time); osc.stop(stopAt);
    activeSources.push(osc);
  }
  return out;
}

function buildTrackChain(ctx, master, track) {
  const input = ctx.createGain();
  input.gain.value = track.gain;
  const panner = ctx.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 1;
  panner.maxDistance = 50;
  panner.rolloffFactor = 1;
  const dry = ctx.createGain();
  dry.gain.value = 1.0;
  const delay = ctx.createDelay(0.3);
  delay.delayTime.value = 0.09;
  const refl = ctx.createGain();
  refl.gain.value = 0;
  input.connect(panner);
  panner.connect(dry).connect(master);
  panner.connect(delay).connect(refl).connect(master);
  return { input, panner, dry, delay, refl };
}

function setListener(ctx) {
  const l = ctx.listener;
  if (l.positionX) {
    l.positionX.value = LISTENER.x;
    l.positionY.value = 0;
    l.positionZ.value = LISTENER.y;
    l.forwardX.value = 0; l.forwardY.value = 0; l.forwardZ.value = -1;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(LISTENER.x, 0, LISTENER.y);
    l.setOrientation(0, 0, -1, 0, 1, 0);
  }
}

function setPannerPos(panner, x, y, time) {
  if (panner.positionX) {
    panner.positionX.setValueAtTime(x, time);
    panner.positionY.setValueAtTime(0, time);
    panner.positionZ.setValueAtTime(y, time);
  } else {
    panner.setPosition(x, 0, y);
  }
}

let audioCtx = null;
let master = null;
let chains = [];
let activeSources = [];
let playing = false;
let paused = false;
let stepIndex = 0;
let sessionStart = 0;
let timerID = null;
let visualEvents = [];
let pulses = [];

function ensureCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function buildGraph() {
  const ctx = ensureCtx();
  setListener(ctx);
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  chains = state.tracks.map(t => buildTrackChain(ctx, master, t));
}

function teardownGraph() {
  activeSources.forEach(s => { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} });
  activeSources = [];
  chains.forEach(c => {
    [c.input, c.panner, c.dry, c.delay, c.refl].forEach(n => { try { n.disconnect(); } catch (e) {} });
  });
  chains = [];
  if (master) { try { master.disconnect(); } catch (e) {} master = null; }
  visualEvents = [];
}

function scheduleStep(idx, time) {
  const tNorm = (idx % TOTAL_STEPS) / TOTAL_STEPS;
  state.tracks.forEach((track, ti) => {
    const pos = pathPos(track.pathType, tNorm, ti);
    const chain = chains[ti];
    setPannerPos(chain.panner, pos.x, pos.y, time);
    chain.refl.gain.setTargetAtTime(0.35 * wallProximity(pos.x, pos.y), time, 0.03);
    if (track.pattern[idx % STEPS]) {
      triggerHit(audioCtx, chain.input, track, time, activeSources);
      visualEvents.push({ time, track: ti });
    }
  });
}

function schedulerTick() {
  if (!playing || paused) return;
  const sps = secondsPerStep();
  while (sessionStart + stepIndex * sps < audioCtx.currentTime + LOOKAHEAD) {
    if (!state.loop && stepIndex >= TOTAL_STEPS) {
      const stopTime = sessionStart + stepIndex * sps;
      setTimeout(() => stopAll(true), Math.max(0, (stopTime - audioCtx.currentTime) * 1000));
      return;
    }
    scheduleStep(stepIndex, sessionStart + stepIndex * sps);
    stepIndex++;
  }
}

function play() {
  if (playing && !paused) return;
  if (playing && paused) { resumePlay(); return; }
  ensureCtx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  teardownGraph();
  buildGraph();
  stepIndex = 0;
  sessionStart = audioCtx.currentTime + 0.1;
  playing = true;
  paused = false;
  timerID = setInterval(schedulerTick, TICK_MS);
  schedulerTick();
  log(`播放开始 bpm=${state.bpm} speed=${state.speed.toFixed(2)} loop=${state.loop}`);
  updateButtons();
}

function pausePlay() {
  if (!playing || paused) return;
  paused = true;
  clearInterval(timerID);
  timerID = null;
  audioCtx.suspend();
  log(`暂停于第 ${stepIndex} 步 (audioTime=${audioCtx.currentTime.toFixed(3)}s)`);
  updateButtons();
}

function resumePlay() {
  if (!playing || !paused) return;
  const sps = secondsPerStep();
  sessionStart = audioCtx.currentTime + 0.1 - stepIndex * sps;
  paused = false;
  audioCtx.resume();
  timerID = setInterval(schedulerTick, TICK_MS);
  schedulerTick();
  log(`恢复播放，从第 ${stepIndex} 步继续（节拍时钟已按步索引重对齐，无累积误差）`);
  updateButtons();
}

function stopAll(silent) {
  if (timerID) { clearInterval(timerID); timerID = null; }
  playing = false;
  paused = false;
  stepIndex = 0;
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  teardownGraph();
  if (!silent) log("停止：所有音序节点已停止并断开，资源已释放");
  updateButtons();
}

function applyTempoChange() {
  document.getElementById("valBpm").textContent = state.bpm;
  document.getElementById("valSpeed").textContent = state.speed.toFixed(2) + "×";
  if (playing && !paused) {
    sessionStart = audioCtx.currentTime + 0.08 - stepIndex * secondsPerStep();
  }
}

const canvas = document.getElementById("room");
const c2d = canvas.getContext("2d");
const SX = canvas.width / ROOM_W;
const SY = canvas.height / ROOM_D;

function drawRoom() {
  c2d.fillStyle = "#0b0e14";
  c2d.fillRect(0, 0, canvas.width, canvas.height);
  c2d.strokeStyle = "#3a4a66";
  c2d.lineWidth = 3;
  c2d.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  c2d.fillStyle = "#141a26";
  c2d.fillRect(3, 3, canvas.width - 6, canvas.height - 6);
}

function drawPaths() {
  state.tracks.forEach((track, ti) => {
    c2d.beginPath();
    for (let i = 0; i <= 100; i++) {
      const p = pathPos(track.pathType, i / 100, ti);
      const px = p.x * SX, py = p.y * SY;
      if (i === 0) c2d.moveTo(px, py); else c2d.lineTo(px, py);
    }
    c2d.strokeStyle = track.color + "33";
    c2d.lineWidth = 1.5;
    c2d.stroke();
  });
}

function drawListener() {
  const px = LISTENER.x * SX, py = LISTENER.y * SY;
  c2d.beginPath();
  c2d.arc(px, py, 10, 0, Math.PI * 2);
  c2d.fillStyle = "#dfe6f0";
  c2d.fill();
  c2d.fillStyle = "#0b0e14";
  c2d.font = "9px sans-serif";
  c2d.textAlign = "center";
  c2d.fillText("L", px - 4, py + 3);
  c2d.fillText("R", px + 4, py + 3);
}

function currentBeatFloat() {
  if (!audioCtx || !playing) return 0;
  return (audioCtx.currentTime - sessionStart) / secondsPerStep();
}

function drawSources() {
  const beatFloat = Math.max(0, currentBeatFloat());
  const tNorm = playing ? ((beatFloat % TOTAL_STEPS) / TOTAL_STEPS) : 0;
  state.tracks.forEach((track, ti) => {
    const pos = pathPos(track.pathType, tNorm, ti);
    const px = pos.x * SX, py = pos.y * SY;
    const prox = wallProximity(pos.x, pos.y);
    if (prox > 0.05) {
      c2d.beginPath();
      c2d.arc(px, py, 16 + 14 * prox, 0, Math.PI * 2);
      c2d.fillStyle = track.color + "22";
      c2d.fill();
    }
    const pulse = pulses.find(p => p.track === ti);
    const r = pulse ? 9 + 10 * pulse.strength : 8;
    c2d.beginPath();
    c2d.arc(px, py, r, 0, Math.PI * 2);
    c2d.fillStyle = track.color;
    c2d.fill();
    c2d.fillStyle = "#0b0e14";
    c2d.font = "9px sans-serif";
    c2d.textAlign = "center";
    c2d.fillText(track.type, px, py + 3);
  });
}

function processVisualEvents() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  while (visualEvents.length && visualEvents[0].time <= now) {
    const ev = visualEvents.shift();
    pulses = pulses.filter(p => p.track !== ev.track);
    pulses.push({ track: ev.track, strength: 1 });
    if (ev.track === 0) flashLamp();
  }
  pulses.forEach(p => (p.strength *= 0.9));
  pulses = pulses.filter(p => p.strength > 0.05);
}

let lampTimer = null;
function flashLamp() {
  const lamp = document.getElementById("beatLamp");
  lamp.classList.add("on");
  clearTimeout(lampTimer);
  lampTimer = setTimeout(() => lamp.classList.remove("on"), 90);
}

function renderLoop() {
  processVisualEvents();
  drawRoom();
  drawPaths();
  drawListener();
  drawSources();
  requestAnimationFrame(renderLoop);
}

function serializeProject() {
  return {
    version: 1,
    bpm: state.bpm,
    speed: state.speed,
    loop: state.loop,
    tracks: state.tracks.map(t => ({
      type: t.type,
      pitch: t.pitch,
      gain: t.gain,
      pathType: t.pathType,
      pattern: t.pattern.slice(),
    })),
  };
}

function saveProject() {
  localStorage.setItem(STORE_KEY, JSON.stringify(serializeProject()));
  log("工程已保存：含每轨 pitch/gain/path/pattern 与全局 bpm/speed/loop");
}

function loadProject() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) { log("未找到已保存的工程"); return false; }
  try {
    const proj = JSON.parse(raw);
    stopAll(true);
    state.bpm = proj.bpm;
    state.speed = proj.speed;
    state.loop = proj.loop;
    proj.tracks.forEach((saved, i) => {
      const t = state.tracks[i];
      t.pitch = saved.pitch;
      t.gain = saved.gain;
      t.pathType = saved.pathType;
      t.pattern = saved.pattern.slice(0, STEPS);
    });
    syncUIFromState();
    log("工程已载入，播放头复位到起点");
    return true;
  } catch (e) {
    log("载入失败: " + e.message);
    return false;
  }
}

async function renderOffline(proj) {
  const sps = 60 / (proj.bpm * proj.speed) / 4;
  const seqDur = TOTAL_STEPS * sps;
  const tail = 0.8;
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.ceil((seqDur + tail) * sr), sr);
  setListener(off);
  const offMaster = off.createGain();
  offMaster.gain.value = 0.9;
  offMaster.connect(off.destination);
  const offChains = proj.tracks.map(t => buildTrackChain(off, offMaster, t));
  const offSources = [];
  const beatTimes = [];
  let noteCount = 0;
  for (let idx = 0; idx < TOTAL_STEPS; idx++) {
    const time = idx * sps + 0.05;
    const tNorm = idx / TOTAL_STEPS;
    proj.tracks.forEach((track, ti) => {
      const pos = pathPos(track.pathType, tNorm, ti);
      const chain = offChains[ti];
      setPannerPos(chain.panner, pos.x, pos.y, time);
      chain.refl.gain.setTargetAtTime(0.35 * wallProximity(pos.x, pos.y), time, 0.03);
      if (track.pattern[idx % STEPS]) {
        triggerHit(off, chain.input, track, time, offSources);
        noteCount++;
        beatTimes.push(Number(time.toFixed(4)));
      }
    });
  }
  const buffer = await off.startRendering();
  return { buffer, noteCount, beatTimes, duration: buffer.duration };
}

function bufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length * numCh * 2 + 44;
  const view = new DataView(new ArrayBuffer(len));
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, len - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, len - 44, true);
  let offset = 44;
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

async function exportMix() {
  stopAll(true);
  log("离线渲染双耳混音中…");
  const proj = serializeProject();
  const result = await renderOffline(proj);
  const blob = bufferToWav(result.buffer);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "binaural_mix.wav";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  const metrics = {
    when: new Date().toISOString(),
    noteCount: result.noteCount,
    beatTimes: result.beatTimes,
    duration: result.duration,
  };
  localStorage.setItem(EXPORT_KEY, JSON.stringify(metrics));
  log(`导出完成：音符数=${result.noteCount} 时长=${result.duration.toFixed(3)}s (指标已记录)`);
}

function compareBeatArrays(a, b) {
  const n = Math.max(a.length, b.length);
  let maxDiff = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === undefined || b[i] === undefined) return { exact: false, maxDiff: Infinity };
    maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  }
  return { exact: maxDiff < 1e-9, maxDiff };
}

async function compareRuns() {
  stopAll(true);
  log("—— 对比验证开始 ——");
  const projA = serializeProject();
  const runA = await renderOffline(projA);
  log(`首轮：音符数=${runA.noteCount} 首拍=${runA.beatTimes[0]}s 末拍=${runA.beatTimes[runA.beatTimes.length - 1]}s 导出时长=${runA.duration.toFixed(3)}s`);

  saveProject();
  if (!loadProject()) return;
  const projB = serializeProject();
  const runB = await renderOffline(projB);
  log(`重载：音符数=${runB.noteCount} 首拍=${runB.beatTimes[0]}s 末拍=${runB.beatTimes[runB.beatTimes.length - 1]}s 导出时长=${runB.duration.toFixed(3)}s`);

  const cmp = compareBeatArrays(runA.beatTimes, runB.beatTimes);
  const durDiff = Math.abs(runA.duration - runB.duration);
  log(`音符数量一致: ${runA.noteCount === runB.noteCount ? "✔" : "✘"} | 节拍位置最大偏差: ${cmp.maxDiff === Infinity ? "N/A" : cmp.maxDiff.toFixed(6) + "s"} | 导出时长差: ${durDiff.toFixed(6)}s`);
  log(runA.noteCount === runB.noteCount && cmp.exact && durDiff < 1e-6
    ? "结论：重载前后完全一致 ✔"
    : "结论：存在差异，请检查参数 ✘");

  const prevRaw = localStorage.getItem(EXPORT_KEY);
  if (prevRaw) {
    const prev = JSON.parse(prevRaw);
    const cmpPrev = compareBeatArrays(prev.beatTimes, runB.beatTimes);
    log(`与上次导出记录对比：音符数 ${prev.noteCount} vs ${runB.noteCount} | 节拍最大偏差 ${cmpPrev.maxDiff === Infinity ? "N/A" : cmpPrev.maxDiff.toFixed(6) + "s"} | 时长 ${prev.duration.toFixed(3)}s vs ${runB.duration.toFixed(3)}s`);
  }
  log("—— 对比验证结束 ——");
}

function log(msg) {
  const el = document.getElementById("log");
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  el.textContent += `[${time}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function updateButtons() {
  document.getElementById("btnPlay").disabled = playing && !paused;
  document.getElementById("btnPause").disabled = !playing || paused;
}

function buildTrackPanels() {
  const wrap = document.getElementById("trackPanels");
  state.tracks.forEach((track, ti) => {
    const div = document.createElement("div");
    div.className = "track";
    div.style.borderLeftColor = track.color;
    const h3 = document.createElement("h3");
    h3.textContent = track.name;
    const gainLabel = document.createElement("span");
    gainLabel.textContent = "增益";
    const gain = document.createElement("input");
    gain.type = "range"; gain.min = 0; gain.max = 1.5; gain.step = 0.05; gain.value = track.gain;
    gain.addEventListener("input", () => {
      track.gain = Number(gain.value);
      if (chains[ti]) chains[ti].input.gain.setTargetAtTime(track.gain, audioCtx.currentTime, 0.02);
    });
    const pitchLabel = document.createElement("span");
    pitchLabel.textContent = "音高";
    const pitch = document.createElement("input");
    pitch.type = "range"; pitch.min = 0.5; pitch.max = 2; pitch.step = 0.05; pitch.value = track.pitch;
    pitch.addEventListener("input", () => { track.pitch = Number(pitch.value); });
    const pathSel = document.createElement("select");
    Object.entries(PATH_NAMES).forEach(([key, label]) => {
      const opt = document.createElement("option");
      opt.value = key; opt.textContent = label;
      pathSel.appendChild(opt);
    });
    pathSel.value = track.pathType;
    pathSel.addEventListener("change", () => { track.pathType = pathSel.value; });
    h3.append(gainLabel, gain, pitchLabel, pitch, pathSel);
    const stepsDiv = document.createElement("div");
    stepsDiv.className = "steps";
    track.pattern.forEach((on, si) => {
      const b = document.createElement("button");
      b.className = "step" + (si % 4 === 0 ? " beat4" : "") + (on ? " on" : "");
      b.addEventListener("click", () => {
        track.pattern[si] = !track.pattern[si];
        b.classList.toggle("on", track.pattern[si]);
      });
      stepsDiv.appendChild(b);
    });
    div.append(h3, stepsDiv);
    wrap.appendChild(div);
    track._ui = { gain, pitch, pathSel, steps: stepsDiv.children };
  });
}

function syncUIFromState() {
  document.getElementById("rngBpm").value = state.bpm;
  document.getElementById("rngSpeed").value = state.speed;
  document.getElementById("chkLoop").checked = state.loop;
  applyTempoChange();
  state.tracks.forEach(track => {
    if (!track._ui) return;
    track._ui.gain.value = track.gain;
    track._ui.pitch.value = track.pitch;
    track._ui.pathSel.value = track.pathType;
    track.pattern.forEach((on, si) => track._ui.steps[si].classList.toggle("on", on));
  });
}

function init() {
  buildTrackPanels();
  syncUIFromState();
  document.getElementById("btnPlay").addEventListener("click", play);
  document.getElementById("btnPause").addEventListener("click", pausePlay);
  document.getElementById("btnStop").addEventListener("click", () => stopAll(false));
  document.getElementById("btnSave").addEventListener("click", saveProject);
  document.getElementById("btnLoad").addEventListener("click", loadProject);
  document.getElementById("btnExport").addEventListener("click", exportMix);
  document.getElementById("btnCompare").addEventListener("click", compareRuns);
  document.getElementById("chkLoop").addEventListener("change", e => { state.loop = e.target.checked; });
  document.getElementById("rngBpm").addEventListener("input", e => { state.bpm = Number(e.target.value); applyTempoChange(); });
  document.getElementById("rngSpeed").addEventListener("input", e => { state.speed = Number(e.target.value); applyTempoChange(); });
  updateButtons();
  requestAnimationFrame(renderLoop);
  log("就绪：点击播放开始。保存/载入使用 localStorage，导出为 44.1kHz 立体声 WAV。");
  const prevRaw = localStorage.getItem(EXPORT_KEY);
  if (prevRaw) {
    const prev = JSON.parse(prevRaw);
    log(`检测到上次导出记录：音符数=${prev.noteCount} 时长=${prev.duration.toFixed(3)}s，可点击"对比验证"与重载后结果比较。`);
  }
}

init();
