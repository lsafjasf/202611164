// Transport, scheduler, UI wiring. Timing is anchor-based (see engine.js)
// so pause/resume, tempo changes and looping never accumulate drift.

import {
  createDefaultProject, deserializeProject, serializeProject, collectNotes,
  stepsPerLoop, stepToBeat, secondsPerBeat, beatAtTime, timeAtBeat,
  loopDurationSeconds,
} from './engine.js';
import {
  createTrackChain, createMasterBus, triggerVoice, releaseAllVoices,
  restoreDelaySends, renderOffline, encodeWavFromBuffer, CLIP_THRESHOLD,
} from './synth.js';

const STORAGE_KEY = 'fourtrack-project-v1';
const SCHED_INTERVAL_MS = 25;
const SCHED_LOOKAHEAD_S = 0.12;

let project = loadInitialProject();
let ctx = null;
let master = null;
let chains = [];
const voices = new Set();

let playing = false;
let paused = false;
let loopEnabled = true;
let anchor = { time: 0, beat: 0 };
let pausedBeat = 0;
let nextAbsStep = 0;
let schedulerTimer = null;
let clipClearTimer = null;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function loadInitialProject() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return deserializeProject(saved);
  } catch { /* fall through to default */ }
  return createDefaultProject();
}

// ---------- Audio graph ----------

function ensureContext() {
  if (ctx) return;
  ctx = new AudioContext();
  master = createMasterBus(ctx, project.master, ctx.destination);
  rebuildChains();
}

function rebuildChains() {
  for (const c of chains) {
    for (const key of Object.keys(c)) {
      try { c[key].disconnect(); } catch { /* not connected */ }
    }
  }
  chains = project.tracks.map((t) => createTrackChain(ctx, t, master.busGain));
}

// ---------- Transport ----------

function currentBeat() {
  return beatAtTime(anchor, project.tempo, ctx.currentTime);
}

function startScheduler() {
  stopScheduler();
  schedulerTimer = setInterval(schedulerTick, SCHED_INTERVAL_MS);
}

function stopScheduler() {
  if (schedulerTimer !== null) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function schedulerTick() {
  const horizon = ctx.currentTime + SCHED_LOOKAHEAD_S;
  const total = stepsPerLoop(project);
  while (true) {
    const stepTime = timeAtBeat(anchor, project.tempo, stepToBeat(nextAbsStep));
    if (stepTime >= horizon) break;
    if (!loopEnabled && nextAbsStep >= total) {
      // Play to the end of the loop, then stop exactly on the boundary.
      stopScheduler();
      const waitMs = Math.max(0, (stepTime - ctx.currentTime) * 1000);
      setTimeout(() => stopTransport(), waitMs);
      break;
    }
    scheduleStep(nextAbsStep % total, stepTime);
    nextAbsStep++;
  }
}

function scheduleStep(stepIndex, time) {
  project.tracks.forEach((track, ti) => {
    const cell = track.pattern[stepIndex];
    if (!cell || track.bypass) return;
    triggerVoice(ctx, chains[ti], track, cell.n + track.transpose, cell.v, time, voices);
  });
}

function play() {
  ensureContext();
  if (ctx.state === 'suspended') ctx.resume();
  if (paused) {
    // Resume from the frozen beat: anchor math keeps step times exact.
    anchor = { time: ctx.currentTime + 0.06, beat: pausedBeat };
    nextAbsStep = Math.ceil(pausedBeat * 4 - 1e-9);
    paused = false;
  } else {
    anchor = { time: ctx.currentTime + 0.06, beat: 0 };
    nextAbsStep = 0;
  }
  restoreDelaySends(chains, project.tracks, ctx);
  playing = true;
  startScheduler();
  setStatus('播放中');
}

function pause() {
  if (!playing || paused) return;
  pausedBeat = currentBeat(); // freeze exact position
  stopScheduler();
  releaseAllVoices(voices, chains, ctx); // stop all tails immediately
  playing = false;
  paused = true;
  setStatus('已暂停（尾音已停止）');
}

function stopTransport() {
  if (!ctx) return;
  stopScheduler();
  releaseAllVoices(voices, chains, ctx); // release every sequencer node
  playing = false;
  paused = false;
  pausedBeat = 0;
  nextAbsStep = 0;
  anchor = { time: 0, beat: 0 };
  setStatus('已停止，资源已释放');
}

function setTempo(value) {
  const tempo = Number(value);
  if (playing && ctx) {
    // Re-anchor at the current position so tempo changes add zero drift.
    anchor = { time: ctx.currentTime, beat: currentBeat() };
  }
  project.tempo = tempo;
  $('tempo-val').textContent = String(tempo);
}

// ---------- Save / load ----------

function saveProject() {
  const json = serializeProject(project);
  localStorage.setItem(STORAGE_KEY, json);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, 'project.json');
  setStatus('工程已保存（每轨音量/声像/延迟/旁路/变调 + 总线增益）');
}

function loadProjectData(data, sourceLabel) {
  stopTransport();
  project = deserializeProject(data);
  // Reload always restarts from the top.
  pausedBeat = 0;
  nextAbsStep = 0;
  anchor = { time: 0, beat: 0 };
  if (ctx) {
    master.compressor.threshold.value = project.master.compThreshold;
    master.compressor.ratio.value = project.master.compRatio;
    master.masterGain.gain.value = project.master.gain;
    rebuildChains();
  }
  buildTrackUI();
  syncMasterUI();
  const notes = collectNotes(project);
  setStatus(`已从${sourceLabel}载入：${notes.length} 个音符，时长 ${loopDurationSeconds(project).toFixed(2)}s，从头播放`);
}

function loadProject() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    loadProjectData(saved, '本地存储');
  } else {
    $('file-input').click();
  }
}

// ---------- Export ----------

async function exportWav() {
  if (clipping) {
    setStatus('总线正在削波，已阻止导出：请先降低音量', true);
    return;
  }
  ensureContext();
  setStatus('离线渲染中…');
  const { buffer, duration } = await renderOffline(project);
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak >= CLIP_THRESHOLD) {
    markClipping();
    setStatus(`渲染结果削波（峰值 ${peak.toFixed(3)}），已阻止导出`, true);
    return;
  }
  const wav = encodeWavFromBuffer(buffer);
  downloadBlob(new Blob([wav], { type: 'audio/wav' }), 'loop.wav');
  setStatus(`已导出 loop.wav（${duration.toFixed(2)}s，峰值 ${peak.toFixed(3)}）`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- Clip detection ----------

let clipping = false;
const clipLed = $('clip-led');

function markClipping() {
  clipping = true;
  clipLed.classList.add('clipping');
  $('btn-export').disabled = true;
  if (clipClearTimer) clearTimeout(clipClearTimer);
  clipClearTimer = setTimeout(() => {
    clipping = false;
    clipLed.classList.remove('clipping');
    $('btn-export').disabled = false;
  }, 1500);
}

const analyserBuf = new Float32Array(2048);
function pollClip() {
  if (!master) return;
  master.analyser.getFloatTimeDomainData(analyserBuf);
  for (let i = 0; i < analyserBuf.length; i++) {
    if (Math.abs(analyserBuf[i]) >= CLIP_THRESHOLD) {
      markClipping();
      return;
    }
  }
}

// ---------- Canvas faders ----------

// Vertical fader drawn on canvas. bipolar=true renders -1..+1 (pan).
function attachFader(canvas, { min = 0, max = 1, bipolar = false, get, set }) {
  const g = canvas.getContext('2d');
  const pad = 8;
  function draw() {
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#171a22';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a4152';
    g.beginPath();
    g.moveTo(w / 2, pad);
    g.lineTo(w / 2, h - pad);
    g.stroke();
    if (bipolar) {
      g.strokeStyle = '#2a2e3a';
      g.beginPath();
      g.moveTo(4, h / 2);
      g.lineTo(w - 4, h / 2);
      g.stroke();
    }
    const v = (get() - min) / (max - min);
    const y = h - pad - v * (h - 2 * pad);
    g.fillStyle = '#4fc3f7';
    g.fillRect(w / 2 - 9, y - 4, 18, 8);
  }
  function setFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const v = 1 - Math.min(1, Math.max(0, (y - pad) / (rect.height - 2 * pad)));
    set(min + v * (max - min));
    draw();
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    setFromEvent(e);
    const move = (ev) => setFromEvent(ev);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => canvas.removeEventListener('pointermove', move), { once: true });
  });
  draw();
  return { redraw: draw };
}

// ---------- Track UI ----------

const trackFaders = [];

function buildTrackUI() {
  const host = $('tracks');
  host.innerHTML = '';
  trackFaders.length = 0;
  const total = stepsPerLoop(project);

  project.tracks.forEach((track, ti) => {
    const section = document.createElement('section');
    section.className = 'track' + (track.bypass ? ' bypassed' : '');

    const head = document.createElement('div');
    head.className = 'track-head';
    const name = document.createElement('span');
    name.className = 'track-name';
    name.textContent = track.name;
    const bypassBtn = document.createElement('button');
    bypassBtn.textContent = track.bypass ? '已旁路' : '旁路';
    bypassBtn.classList.toggle('active', track.bypass);
    bypassBtn.onclick = () => {
      track.bypass = !track.bypass;
      if (chains[ti]) chains[ti].bypassGain.gain.value = track.bypass ? 0 : 1;
      buildTrackUI();
    };
    head.append(name, bypassBtn);

    if (track.type === 'bass' || track.type === 'lead') {
      const tr = document.createElement('span');
      tr.className = 'transpose';
      const minus = document.createElement('button');
      minus.textContent = '−';
      const plus = document.createElement('button');
      plus.textContent = '+';
      const label = document.createElement('span');
      const fmt = (v) => `变调 ${v > 0 ? '+' : ''}${v}`;
      label.textContent = fmt(track.transpose);
      // Absolute assignment (not incremental accumulation) avoids pitch drift.
      minus.onclick = () => { track.transpose = Math.max(-24, track.transpose - 1); label.textContent = fmt(track.transpose); };
      plus.onclick = () => { track.transpose = Math.min(24, track.transpose + 1); label.textContent = fmt(track.transpose); };
      tr.append(minus, label, plus);
      head.append(tr);
    }

    const grid = document.createElement('div');
    grid.className = 'step-grid';
    const baseNote = track.type === 'bass' ? 33 : track.type === 'lead' ? 69 : track.type === 'kick' ? 36 : 42;
    for (let s = 0; s < total; s++) {
      const cell = document.createElement('button');
      cell.className = 'step' + (track.pattern[s] ? ' on' : '') + (s % 16 === 0 ? ' bar-start' : '');
      cell.dataset.step = String(s);
      cell.onclick = () => {
        track.pattern[s] = track.pattern[s] ? null : { n: baseNote, v: 0.85 };
        cell.classList.toggle('on', Boolean(track.pattern[s]));
      };
      grid.append(cell);
    }

    const controls = document.createElement('div');
    controls.className = 'track-controls';
    const specs = [
      { key: 'volume', label: '音量', min: 0, max: 1 },
      { key: 'pan', label: '声像', min: -1, max: 1, bipolar: true },
      { key: 'delaySend', label: '延迟', min: 0, max: 1 },
    ];
    for (const spec of specs) {
      const wrap = document.createElement('div');
      const canvas = document.createElement('canvas');
      canvas.className = 'fader-canvas';
      canvas.width = 36;
      canvas.height = 110;
      const lab = document.createElement('span');
      lab.className = 'fader-label';
      lab.textContent = spec.label;
      const fader = attachFader(canvas, {
        min: spec.min,
        max: spec.max,
        bipolar: spec.bipolar,
        get: () => track[spec.key],
        set: (v) => {
          track[spec.key] = spec.bipolar ? Math.round(v * 100) / 100 : v;
          applyTrackParam(ti, spec.key);
        },
      });
      trackFaders.push(fader);
      wrap.append(canvas, lab);
      controls.append(wrap);
    }

    section.append(head, grid, controls);
    host.append(section);
  });
}

function applyTrackParam(ti, key) {
  if (!chains[ti] || !ctx) return;
  const t = project.tracks[ti];
  const now = ctx.currentTime;
  if (key === 'volume') chains[ti].trackGain.gain.setTargetAtTime(t.volume, now, 0.01);
  if (key === 'pan') chains[ti].panner.pan.setTargetAtTime(t.pan, now, 0.01);
  if (key === 'delaySend') chains[ti].delaySend.gain.setTargetAtTime(t.delaySend, now, 0.01);
}

// ---------- Waveform + playhead ----------

const waveCanvas = $('waveform');
const waveG = waveCanvas.getContext('2d');

function drawWaveform() {
  const { width: w, height: h } = waveCanvas;
  waveG.fillStyle = '#1e222c';
  waveG.fillRect(0, 0, w, h);
  waveG.strokeStyle = '#4fc3f7';
  waveG.beginPath();
  if (master) {
    master.analyser.getFloatTimeDomainData(analyserBuf);
    for (let i = 0; i < analyserBuf.length; i++) {
      const x = (i / analyserBuf.length) * w;
      const y = h / 2 + analyserBuf[i] * (h / 2 - 4);
      if (i === 0) waveG.moveTo(x, y);
      else waveG.lineTo(x, y);
    }
  } else {
    waveG.moveTo(0, h / 2);
    waveG.lineTo(w, h / 2);
  }
  waveG.stroke();
}

function updatePlayhead() {
  const total = stepsPerLoop(project);
  let step = -1;
  if (playing && ctx) {
    const beat = currentBeat();
    step = Math.floor(beat * 4) % total;
    $('position').textContent = `小节 ${Math.floor(beat / 4) + 1} · 步 ${(step % 16) + 1}`;
  } else if (paused) {
    step = Math.floor(pausedBeat * 4) % total;
    $('position').textContent = `已暂停 @ 步 ${step + 1}`;
  } else {
    $('position').textContent = '小节 1 · 步 1';
  }
  document.querySelectorAll('.step.playing').forEach((el) => el.classList.remove('playing'));
  if (step >= 0) {
    document.querySelectorAll(`.step[data-step="${step}"]`).forEach((el) => el.classList.add('playing'));
  }
}

function animationLoop() {
  pollClip();
  drawWaveform();
  updatePlayhead();
  requestAnimationFrame(animationLoop);
}

// ---------- Master UI ----------

function syncMasterUI() {
  $('tempo').value = String(project.tempo);
  $('tempo-val').textContent = String(project.tempo);
  $('comp-threshold').value = String(project.master.compThreshold);
  $('comp-ratio').value = String(project.master.compRatio);
  $('comp-enabled').checked = project.master.compEnabled !== false;
  masterFader.redraw();
}

const masterFader = attachFader($('master-fader'), {
  min: 0,
  max: 1,
  get: () => project.master.gain,
  set: (v) => {
    project.master.gain = v;
    if (master && ctx) master.masterGain.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
  },
});

// ---------- Wiring ----------

$('btn-play').onclick = () => play();
$('btn-pause').onclick = () => pause();
$('btn-stop').onclick = () => stopTransport();
$('btn-loop').onclick = (e) => {
  loopEnabled = !loopEnabled;
  e.target.classList.toggle('active', loopEnabled);
  setStatus(loopEnabled ? '循环开' : '循环关（播完一遍自动停止）');
};
$('tempo').oninput = (e) => setTempo(e.target.value);
$('btn-save').onclick = () => saveProject();
$('btn-load').onclick = () => loadProject();
$('btn-export').onclick = () => exportWav();
$('file-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (file) loadProjectData(await file.text(), '文件');
  e.target.value = '';
};
$('comp-threshold').oninput = (e) => {
  project.master.compThreshold = Number(e.target.value);
  if (master) master.compressor.threshold.value = project.master.compThreshold;
};
$('comp-ratio').oninput = (e) => {
  project.master.compRatio = Number(e.target.value);
  if (master) master.compressor.ratio.value = project.master.compRatio;
};
$('comp-enabled').onchange = (e) => {
  project.master.compEnabled = e.target.checked;
  if (master && ctx) {
    master.compressor.ratio.setTargetAtTime(e.target.checked ? project.master.compRatio : 1, ctx.currentTime, 0.01);
  }
};

buildTrackUI();
syncMasterUI();
animationLoop();
