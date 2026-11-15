import {
  BAND,
  activeSources,
  bearingResponse,
  cyclePosition,
  evaluateSubmission,
  generateCase,
  getStation,
  normalizeSeed,
  receiverTelemetry,
  tuningResponse,
} from "./engine.js";
import { ReceiverAudio } from "./audio.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const refs = {
  headerCase: $("#headerCase"),
  caseSerial: $("#caseSerial"),
  caseStatusDot: $("#caseStatusDot"),
  liveStatus: $("#liveStatus"),
  elapsedClock: $("#elapsedClock"),
  seedInput: $("#seedInput"),
  loadSeedBtn: $("#loadSeedBtn"),
  candidateList: $("#candidateList"),
  candidateCount: $("#candidateCount"),
  fftBadge: $("#fftBadge"),
  bandReadout: $("#bandReadout"),
  scopeHover: $("#scopeHover"),
  scopeWrap: $("#scopeWrap"),
  spectrumCanvas: $("#spectrumCanvas"),
  waterfallCanvas: $("#waterfallCanvas"),
  waterfallClock: $("#waterfallClock"),
  cycleProgress: $("#cycleProgress"),
  cycleLabel: $("#cycleLabel"),
  evidenceCount: $("#evidenceCount"),
  evidenceList: $("#evidenceList"),
  freqMhz: $("#freqMhz"),
  freqFine: $("#freqFine"),
  freqRange: $("#freqRange"),
  freqLabel: $("#freqLabel"),
  bearingValue: $("#bearingValue"),
  bearingSector: $("#bearingSector"),
  bearingRange: $("#bearingRange"),
  compass: $("#compass"),
  needle: $("#needle"),
  gainRange: $("#gainRange"),
  gainValue: $("#gainValue"),
  sMeter: $("#sMeter"),
  snrValue: $("#snrValue"),
  clipWarning: $("#clipWarning"),
  rxState: $("#rxState"),
  lockPanel: $("#lockPanel"),
  lockKicker: $("#lockKicker"),
  lockName: $("#lockName"),
  lockMeta: $("#lockMeta"),
  lockProgress: $("#lockProgress"),
  recordBtn: $("#recordBtn"),
  answerCount: $("#answerCount"),
  answerNodes: [0, 1, 2].map((index) => $(`#answer${index}`)),
  startBtn: $("#startBtn"),
  pauseBtn: $("#pauseBtn"),
  restartBtn: $("#restartBtn"),
  submitBtn: $("#submitBtn"),
  transportMessage: $("#transportMessage"),
  helpBtn: $("#helpBtn"),
  helpModal: $("#helpModal"),
  submitModal: $("#submitModal"),
  submitOrder: $("#submitOrder"),
  confirmSubmitBtn: $("#confirmSubmitBtn"),
  resultModal: $("#resultModal"),
  resultContent: $("#resultContent"),
  scopePanel: $(".scope-panel"),
  waterfallPanel: $(".waterfall-panel"),
};

const audio = new ReceiverAudio();
const initialSeed = new URLSearchParams(window.location.search).get("seed") || "SW-0714";

const state = {
  caseData: generateCase(initialSeed),
  receiver: {
    frequency: BAND.start + 14,
    bearing: 0,
    gain: 48,
  },
  running: false,
  paused: false,
  started: false,
  ended: false,
  elapsed: 0,
  lastFrame: performance.now(),
  lastUiFrame: 0,
  lockSource: null,
  lockCandidate: null,
  lockProgress: 0,
  foundIds: new Set(),
  evidence: [],
  answers: ["", "", ""],
  telemetry: null,
  lastSpectrum: null,
  history: [],
  lastHistoryAt: 0,
  messageTimer: null,
  result: null,
  spectrumContext: refs.spectrumCanvas.getContext("2d"),
  waterfallContext: refs.waterfallCanvas.getContext("2d"),
  waterfallBuffer: document.createElement("canvas"),
  pointers: {
    scope: false,
    compass: false,
  },
};

state.waterfallBuffer.width = 280;
state.waterfallBuffer.height = 120;
state.waterfallBufferContext = state.waterfallBuffer.getContext("2d", { willReadFrequently: true });

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function sectorName(bearing) {
  const names = ["正北", "东北", "正东", "东南", "正南", "西南", "正西", "西北"];
  return names[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

function stationOptions() {
  return state.caseData.candidates
    .map((station) => `<option value="${station.id}">${escapeHtml(station.name)} · ${station.code}</option>`)
    .join("");
}

function renderCaseChrome() {
  refs.headerCase.textContent = state.caseData.caseId;
  refs.caseSerial.textContent = state.caseData.serial;
  refs.seedInput.value = state.caseData.seed;
  refs.bandReadout.textContent = "6.120–6.148 MHz";
  document.title = `${state.caseData.caseId} · 夜航短波`;
}

function renderCandidates() {
  refs.candidateList.innerHTML = state.caseData.candidates
    .map((station) => `
      <li class="candidate ${state.foundIds.has(station.id) ? "is-found" : ""}" style="--station-color:${station.color}" data-station="${station.id}">
        <i class="candidate-dot"></i>
        <div class="candidate-copy">
          <strong>${escapeHtml(station.name)}</strong>
          <small>${station.code} · ${escapeHtml(station.profile)}</small>
        </div>
        <span class="found-badge">已识别</span>
      </li>
    `)
    .join("");
  refs.candidateCount.textContent = String(state.caseData.candidates.length).padStart(2, "0");
}

function populateAnswerOptions() {
  for (const select of refs.answerNodes) {
    select.innerHTML = `<option value="">选择信标</option>${stationOptions()}`;
    select.required = true;
  }
}

function syncAnswers() {
  refs.answerNodes.forEach((select, index) => {
    select.value = state.answers[index] || "";
  });
  const filled = state.answers.filter(Boolean).length;
  refs.answerCount.textContent = `${filled}/3`;
}

function renderEvidence() {
  refs.evidenceCount.textContent = String(state.evidence.length).padStart(2, "0");
  if (!state.evidence.length) {
    refs.evidenceList.innerHTML = `
      <li class="empty-log"><span class="empty-wave"></span>尚未捕获载波。开始监听后，在频谱中寻找活动峰值。</li>
    `;
    return;
  }
  refs.evidenceList.innerHTML = state.evidence
    .map((entry, index) => {
      const station = getStation(entry.stationId);
      return `
        <li class="evidence-item" style="--station-color:${station.color}">
          <span class="evidence-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="evidence-source"><i></i>${escapeHtml(station.name)}</span>
          <span class="evidence-reading">${entry.observedFrequency.toFixed(1)} kHz · ${String(entry.observedBearing).padStart(3, "0")}° · <span class="evidence-kind ${entry.broad ? "is-broad" : ""}">${entry.broad ? "复合边带" : "窄带"}</span></span>
          <span class="evidence-time">${formatTime(entry.time)}</span>
        </li>
      `;
    })
    .join("");
}

function setFrequency(value) {
  const frequency = Math.round(clamp(Number(value), BAND.start, BAND.end) * 10) / 10;
  state.receiver.frequency = frequency;
  refs.freqRange.value = String(frequency);
  const fixed = frequency.toFixed(1);
  const [whole, decimal] = fixed.split(".");
  refs.freqMhz.textContent = (Number(whole) / 1000).toFixed(3);
  refs.freqFine.textContent = decimal;
  refs.freqLabel.textContent = `${fixed} kHz`;
}

function setBearing(value) {
  const bearing = Math.round((((Number(value) % 360) + 360) % 360));
  state.receiver.bearing = bearing;
  refs.bearingRange.value = String(bearing);
  refs.bearingValue.textContent = `${String(bearing).padStart(3, "0")}°`;
  refs.bearingSector.textContent = sectorName(bearing);
  refs.needle.style.transform = `rotate(${bearing}deg)`;
  refs.compass.setAttribute("aria-valuenow", String(bearing));
}

function setGain(value) {
  const gain = Math.round(clamp(Number(value), 0, 100));
  state.receiver.gain = gain;
  refs.gainRange.value = String(gain);
  refs.gainValue.textContent = `${gain}%`;
}

function syncTransport() {
  const startLabel = state.running ? "监听中" : state.started ? "继续监听" : "开始监听";
  $("span", refs.startBtn).textContent = startLabel;
  refs.startBtn.disabled = state.running || state.ended;
  refs.pauseBtn.disabled = !state.running || state.ended;
  refs.submitBtn.disabled = state.ended;
  refs.liveStatus.classList.toggle("is-running", state.running);
  refs.liveStatus.classList.toggle("is-paused", state.paused && !state.running);
  refs.liveStatus.classList.toggle("is-ended", state.ended);
  const statusText = state.ended ? "已结算" : state.running ? "监听中" : state.paused ? "已暂停" : "待启动";
  $("b", refs.liveStatus).textContent = statusText;
  refs.scopePanel.classList.toggle("is-idle", !state.started);
  refs.scopePanel.classList.toggle("is-paused", state.paused && !state.running);
  refs.rxState.classList.toggle("is-running", state.running);
  refs.rxState.classList.toggle("is-paused", state.paused && !state.running);
  refs.rxState.innerHTML = `<i></i>${state.running ? "LISTENING" : state.ended ? "CLOSED" : state.paused ? "PAUSED" : "STANDBY"}`;
}

function flashMessage(message, tone = "info") {
  const dot = $("i", refs.transportMessage);
  $("span", refs.transportMessage).textContent = message;
  dot.style.background = tone === "error" ? "var(--red)" : tone === "success" ? "var(--mint)" : "var(--mint-deep)";
  window.clearTimeout(state.messageTimer);
  state.messageTimer = window.setTimeout(() => {
    $("span", refs.transportMessage).textContent = "建议佩戴耳机 · 点击开始后才会产生声音";
    dot.style.background = "var(--mint-deep)";
  }, 4600);
}

function resetHistory() {
  state.history = [];
  state.lastSpectrum = null;
  state.lastHistoryAt = 0;
  const context = state.waterfallBufferContext;
  context.fillStyle = "#041012";
  context.fillRect(0, 0, state.waterfallBuffer.width, state.waterfallBuffer.height);
  refs.waterfallClock.textContent = "−24.0s";
}

function resetLock() {
  state.lockSource = null;
  state.lockCandidate = null;
  state.lockProgress = 0;
  renderLock();
}

function resetForCase(caseData) {
  state.caseData = caseData;
  state.receiver.frequency = BAND.start + 14;
  state.receiver.bearing = 0;
  state.receiver.gain = 48;
  state.running = false;
  state.paused = false;
  state.started = false;
  state.ended = false;
  state.elapsed = 0;
  state.foundIds = new Set();
  state.evidence = [];
  state.answers = ["", "", ""];
  state.result = null;
  state.telemetry = null;
  state.lastFrame = performance.now();
  resetHistory();
  resetLock();
  refs.resultModal.hidden = true;
  refs.submitModal.hidden = true;
  renderCaseChrome();
  renderCandidates();
  populateAnswerOptions();
  syncAnswers();
  renderEvidence();
  setFrequency(state.receiver.frequency);
  setBearing(state.receiver.bearing);
  setGain(state.receiver.gain);
  syncTransport();
  if (audio.created) audio.setCase(caseData);
}

async function startListening() {
  if (state.ended) return;
  try {
    await audio.start(state.caseData);
  } catch (error) {
    flashMessage(`音频启动失败：${error.message}`, "error");
    return;
  }
  if (!state.started) {
    state.started = true;
    state.elapsed = 0;
    state.lastFrame = performance.now();
    resetHistory();
  }
  state.running = true;
  state.paused = false;
  state.lastFrame = performance.now();
  audio.update({
    caseData: state.caseData,
    elapsed: state.elapsed,
    receiver: state.receiver,
    running: true,
  });
  syncTransport();
  flashMessage("接收机已启动 · 拖动频谱游标并缓慢旋转天线", "success");
}

async function pauseListening() {
  if (!state.running) return;
  state.running = false;
  state.paused = true;
  await audio.pause();
  syncTransport();
  flashMessage("监听已暂停 · 信号时间与线索内容保持冻结");
}

async function restartCase() {
  const replay = generateCase(state.caseData.seed);
  await audio.pause();
  resetForCase(replay);
  flashMessage(`已按 seed ${replay.seed} 重置 · 线索顺序与惩罚规则不变`, "success");
}

function loadSeed(rawSeed) {
  const seed = normalizeSeed(rawSeed);
  const caseData = generateCase(seed);
  audio.pause();
  resetForCase(caseData);
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  window.history.replaceState({}, "", url);
  flashMessage(`案件 ${caseData.caseId} 已载入`, "success");
}

function sizeCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height, ratio };
}

function frequencyToX(frequency, width) {
  return ((frequency - BAND.start) / (BAND.end - BAND.start)) * width;
}

function idleSpectrum(time, binIndex, bins) {
  const texture = Math.sin(binIndex * 1.73 + time * 0.0017) * 2.2
    + Math.sin(binIndex * 0.37 - time * 0.0011) * 1.6;
  const lowNoise = Math.exp(-binIndex / (bins * 0.26)) * 4;
  return -97 + texture + lowNoise;
}

function spectrumRow(data, width, analysis, time) {
  const row = new Array(width);
  if (!data) {
    for (let index = 0; index < width; index += 1) {
      row[index] = idleSpectrum(time, index, width);
    }
    return row;
  }
  const binHz = analysis?.binHz || 23.4375;
  const maxHz = analysis?.maxDisplayHz || 16000;
  const binCount = data.length;
  for (let index = 0; index < width; index += 1) {
    const startBin = Math.floor((index / width) * (maxHz / binHz));
    const endBin = Math.max(startBin + 1, Math.floor(((index + 1) / width) * (maxHz / binHz)));
    let peak = -110;
    for (let bin = startBin; bin < Math.min(endBin + 1, binCount); bin += 1) {
      if (data[bin] > peak) peak = data[bin];
    }
    row[index] = peak;
  }
  return row;
}

function drawSpectrum(time) {
  const canvas = refs.spectrumCanvas;
  const context = state.spectrumContext;
  const { width, height } = sizeCanvas(canvas, context);
  context.clearRect(0, 0, width, height);
  const plotTop = 12;
  const plotBottom = height - 17;
  const plotHeight = plotBottom - plotTop;

  context.save();
  context.strokeStyle = "rgba(117, 204, 185, 0.075)";
  context.lineWidth = 1;
  context.font = '7px "SFMono-Regular", monospace';
  context.fillStyle = "rgba(111, 149, 142, 0.58)";
  context.textAlign = "right";
  const gridLevels = [
    { y: plotTop, label: "0" },
    { y: plotTop + plotHeight * 0.29, label: "−28" },
    { y: plotTop + plotHeight * 0.58, label: "−56" },
    { y: plotBottom, label: "−88" },
  ];
  for (const level of gridLevels) {
    context.beginPath();
    context.moveTo(0, Math.round(level.y) + 0.5);
    context.lineTo(width, Math.round(level.y) + 0.5);
    context.stroke();
    context.fillText(level.label, width - 3, level.y - 3);
  }

  const spectrum = state.lastSpectrum;
  const analysis = audio.getAnalysis?.();
  const row = spectrumRow(spectrum, Math.max(1, Math.round(width)), analysis, time);
  const gradient = context.createLinearGradient(0, plotTop, 0, plotBottom);
  gradient.addColorStop(0, "rgba(120, 242, 207, 0.42)");
  gradient.addColorStop(0.55, "rgba(53, 186, 162, 0.18)");
  gradient.addColorStop(1, "rgba(32, 106, 97, 0.015)");
  context.beginPath();
  context.moveTo(0, plotBottom);
  for (let index = 0; index < row.length; index += 1) {
    const normalized = clamp((row[index] + 96) / 88, 0, 1);
    const y = plotBottom - normalized * plotHeight;
    if (index === 0) context.lineTo(index, y);
    else context.lineTo(index, y);
  }
  context.lineTo(width, plotBottom);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  for (let index = 0; index < row.length; index += 1) {
    const normalized = clamp((row[index] + 96) / 88, 0, 1);
    const y = plotBottom - normalized * plotHeight;
    if (index === 0) context.moveTo(index, y);
    else context.lineTo(index, y);
  }
  context.strokeStyle = state.started ? "rgba(120, 242, 207, 0.88)" : "rgba(92, 142, 133, 0.55)";
  context.lineWidth = 1;
  context.shadowColor = "rgba(120, 242, 207, 0.24)";
  context.shadowBlur = state.started ? 5 : 0;
  context.stroke();
  context.shadowBlur = 0;

  context.textAlign = "center";
  context.fillStyle = "rgba(111, 149, 142, 0.72)";
  for (let step = 0; step <= 7; step += 1) {
    const frequency = BAND.start + step * 4;
    const x = frequencyToX(frequency, width);
    context.beginPath();
    context.moveTo(Math.round(x) + 0.5, plotBottom);
    context.lineTo(Math.round(x) + 0.5, plotBottom + 4);
    context.stroke();
    if (step < 7 || width > 540) {
      context.fillText((frequency / 1000).toFixed(3), clamp(x, 20, width - 20), height - 4);
    }
  }

  if (state.foundIds.size) {
    const nowActive = new Set(activeSources(state.caseData, state.elapsed).map((source) => source.id));
    for (const source of state.caseData.sources) {
      if (!state.foundIds.has(source.id)) continue;
      const x = frequencyToX(source.frequency, width);
      const active = nowActive.has(source.id);
      context.fillStyle = active ? source.color : "rgba(129, 154, 148, 0.38)";
      context.beginPath();
      context.moveTo(x, plotTop + 2);
      context.lineTo(x - 3, plotTop + 7);
      context.lineTo(x + 3, plotTop + 7);
      context.closePath();
      context.fill();
    }
  }

  const cursorX = frequencyToX(state.receiver.frequency, width);
  context.setLineDash([3, 4]);
  context.strokeStyle = "rgba(255, 190, 106, 0.92)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(cursorX + 0.5, 0);
  context.lineTo(cursorX + 0.5, plotBottom);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "rgba(255, 190, 106, 0.95)";
  context.beginPath();
  context.moveTo(cursorX, 0);
  context.lineTo(cursorX - 4, 5);
  context.lineTo(cursorX + 4, 5);
  context.closePath();
  context.fill();
  context.restore();
}

function waterfallColor(db) {
  const intensity = clamp((db + 91) / 62, 0, 1);
  if (intensity < 0.04) return [4, 16, 18, 255];
  if (intensity < 0.44) {
    const t = intensity / 0.44;
    return [Math.round(4 + 18 * t), Math.round(16 + 95 * t), Math.round(18 + 73 * t), 255];
  }
  if (intensity < 0.78) {
    const t = (intensity - 0.44) / 0.34;
    return [Math.round(22 + 30 * t), Math.round(111 + 124 * t), Math.round(91 + 90 * t), 255];
  }
  const t = (intensity - 0.78) / 0.22;
  return [Math.round(52 + 203 * t), Math.round(235 - 45 * t), Math.round(181 - 75 * t), 255];
}

function captureWaterfall(time) {
  if (!state.running || time - state.lastHistoryAt < 95) return;
  state.lastHistoryAt = time;
  const buffer = state.waterfallBuffer;
  const context = state.waterfallBufferContext;
  const width = buffer.width;
  const height = buffer.height;
  const analysis = audio.getAnalysis?.();
  const rowValues = spectrumRow(state.lastSpectrum, width, analysis, time);

  const previous = context.getImageData(0, 0, width, height - 1);
  context.putImageData(previous, 0, 1);
  const row = context.createImageData(width, 1);
  for (let index = 0; index < width; index += 1) {
    const [red, green, blue, alpha] = waterfallColor(rowValues[index]);
    const offset = index * 4;
    row.data[offset] = red;
    row.data[offset + 1] = green;
    row.data[offset + 2] = blue;
    row.data[offset + 3] = alpha;
  }
  context.putImageData(row, 0, 0);
  state.history.push(rowValues);
  if (state.history.length > 240) state.history.shift();
  refs.waterfallClock.textContent = `−${Math.min(24, state.history.length * 0.1).toFixed(1)}s`;
}

function drawWaterfall() {
  const canvas = refs.waterfallCanvas;
  const context = state.waterfallContext;
  const { width, height } = sizeCanvas(canvas, context);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  context.drawImage(state.waterfallBuffer, 0, 0, width, height);

  context.fillStyle = "rgba(4, 14, 16, 0.67)";
  context.fillRect(0, height - 15, width, 15);
  context.strokeStyle = "rgba(117, 204, 185, 0.13)";
  context.lineWidth = 1;
  context.font = '7px "SFMono-Regular", monospace';
  context.fillStyle = "rgba(111, 149, 142, 0.67)";
  context.textAlign = "center";
  for (let step = 0; step <= 7; step += 1) {
    const frequency = BAND.start + step * 4;
    const x = frequencyToX(frequency, width);
    context.beginPath();
    context.moveTo(Math.round(x) + 0.5, height - 15);
    context.lineTo(Math.round(x) + 0.5, height);
    context.stroke();
    context.fillText((frequency / 1000).toFixed(3), clamp(x, 19, width - 19), height - 4);
  }

  const cursorX = frequencyToX(state.receiver.frequency, width);
  context.setLineDash([2, 3]);
  context.strokeStyle = "rgba(255, 190, 106, 0.8)";
  context.beginPath();
  context.moveTo(cursorX + 0.5, 0);
  context.lineTo(cursorX + 0.5, height - 15);
  context.stroke();
  context.setLineDash([]);
}

function renderLock() {
  const locked = Boolean(state.lockSource) && state.lockProgress >= 1;
  const tracking = Boolean(state.lockCandidate) && !locked;
  refs.lockPanel.dataset.state = locked ? "locked" : tracking ? "tracking" : "idle";
  refs.lockProgress.style.width = `${clamp(state.lockProgress, 0, 1) * 100}%`;

  if (locked) {
    const source = state.lockSource;
    refs.lockKicker.textContent = "CARRIER LOCKED";
    refs.lockName.textContent = source.name;
    refs.lockMeta.textContent = `${source.frequency.toFixed(1)} kHz · ${source.sidebands ? "复合边带" : "窄带载波"} · ${source.code}`;
    refs.recordBtn.disabled = state.evidence.some((entry) => entry.stationId === source.id);
    refs.recordBtn.textContent = state.evidence.some((entry) => entry.stationId === source.id)
      ? "已写入监听记录"
      : "写入推断序列";
    return;
  }

  if (tracking) {
    refs.lockKicker.textContent = "CARRIER DETECTED";
    refs.lockName.textContent = "载波逼近";
    refs.lockMeta.textContent = state.telemetry?.clipping > 0.12
      ? "前端过载，降低增益后再解码"
      : "继续微调频率与天线方向";
    refs.recordBtn.disabled = true;
    refs.recordBtn.textContent = "等待载波锁定";
    return;
  }

  refs.lockKicker.textContent = "NO CARRIER";
  refs.lockName.textContent = "等待载波";
  refs.lockMeta.textContent = state.receiver.gain > 76
    ? "前端增益过高，可能掩盖微弱信标"
    : "调谐至活动峰值，并缓慢旋转天线";
  refs.recordBtn.disabled = true;
  refs.recordBtn.textContent = "写入推断序列";
}

function updateLock(deltaSeconds) {
  if (!state.running) return;
  const telemetry = state.telemetry;
  const source = telemetry?.nearest;
  if (!telemetry?.lockable || !source) {
    state.lockSource = null;
    state.lockCandidate = source ?? null;
    state.lockProgress = Math.max(0, state.lockProgress - deltaSeconds * 2.8);
    if (state.lockProgress <= 0.001) {
      state.lockProgress = 0;
      state.lockCandidate = null;
    }
    renderLock();
    return;
  }
  if (state.lockCandidate?.id !== source.id) {
    state.lockCandidate = source;
    state.lockProgress = 0;
  }
  state.lockProgress = clamp(state.lockProgress + deltaSeconds / 0.72, 0, 1);
  if (state.lockProgress >= 1) {
    state.lockSource = source;
    if (!state.foundIds.has(source.id)) {
      state.foundIds.add(source.id);
      renderCandidates();
      flashMessage(`识别到 ${source.name} · 呼号 ${source.code}`, "success");
    }
  }
  renderLock();
}

function updateTelemetryUi() {
  const telemetry = state.telemetry;
  const signal = telemetry?.signalDbfs ?? -96;
  const segments = $$("i", refs.sMeter);
  const activeSegments = Math.round(clamp((signal + 92) / 65, 0, 1) * segments.length);
  segments.forEach((segment, index) => {
    segment.className = "";
    if (index < activeSegments) {
      segment.classList.add(index > segments.length * 0.78 ? "is-hot" : "is-on");
    }
    if (index >= segments.length - 2 && telemetry?.clipping > 0.2 && index < activeSegments) {
      segment.className = "is-clip";
    }
  });
  refs.snrValue.textContent = telemetry?.nearest ? `${Math.round(signal)} dB` : "--";
  const clipping = (telemetry?.clipping ?? 0) > 0.13;
  refs.clipWarning.classList.toggle("is-visible", clipping);
  refs.elapsedClock.textContent = formatTime(state.elapsed);
  const position = cyclePosition(state.elapsed);
  refs.cycleProgress.style.width = `${(position / state.caseData.cycle) * 100}%`;
  refs.cycleLabel.textContent = `${formatTime(position)} / ${formatTime(state.caseData.cycle)}`;
  refs.scopeWrap.setAttribute("data-active", String(telemetry?.active?.length ?? 0));
}

function frame(time) {
  const deltaSeconds = Math.min(0.2, Math.max(0, (time - state.lastFrame) / 1000));
  state.lastFrame = time;

  if (state.running) {
    state.elapsed += deltaSeconds;
    audio.update({
      caseData: state.caseData,
      elapsed: state.elapsed,
      receiver: state.receiver,
      running: true,
    });
    const spectrum = audio.getSpectrum();
    if (spectrum) state.lastSpectrum = new Float32Array(spectrum);
    state.telemetry = receiverTelemetry(state.caseData, state.receiver, state.elapsed);
    updateLock(deltaSeconds);
  } else if (!state.telemetry) {
    state.telemetry = receiverTelemetry(state.caseData, state.receiver, state.elapsed);
  }

  drawSpectrum(time);
  captureWaterfall(time);
  drawWaterfall();
  if (time - state.lastUiFrame > 55) {
    state.lastUiFrame = time;
    updateTelemetryUi();
  }
  requestAnimationFrame(frame);
}

function recordCurrentSource() {
  if (!state.running || !state.lockSource || state.lockProgress < 1) return;
  const source = state.lockSource;
  if (state.evidence.some((entry) => entry.stationId === source.id)) {
    flashMessage(`${source.name} 已写入监听记录`);
    return;
  }

  state.evidence.push({
    stationId: source.id,
    time: state.elapsed,
    observedFrequency: source.frequency,
    observedBearing: state.receiver.bearing,
    broad: source.sidebands > 0,
  });
  renderEvidence();

  const emptyIndex = state.answers.findIndex((answer) => !answer);
  if (emptyIndex >= 0 && !state.answers.includes(source.id)) {
    state.answers[emptyIndex] = source.id;
    syncAnswers();
  }
  renderLock();
  flashMessage(`${source.name} 已写入第 ${emptyIndex >= 0 ? emptyIndex + 1 : 3} 位推断`, "success");
}

function refreshStaticTelemetry() {
  state.telemetry = receiverTelemetry(state.caseData, state.receiver, state.elapsed);
  updateTelemetryUi();
}

function updateCanvasHover(event) {
  const rect = refs.spectrumCanvas.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const frequency = BAND.start + ratio * (BAND.end - BAND.start);
  refs.scopeHover.textContent = `${frequency.toFixed(1)} kHz`;
  refs.scopeHover.style.left = `${clamp(event.clientX - rect.left, 38, rect.width - 38)}px`;
  refs.scopeHover.style.top = `${clamp(event.clientY - rect.top - 21, 6, rect.height - 24)}px`;
  refs.scopeHover.classList.add("is-visible");
}

function tuneFromPointer(event) {
  const rect = refs.spectrumCanvas.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  setFrequency(BAND.start + ratio * (BAND.end - BAND.start));
  state.telemetry = receiverTelemetry(state.caseData, state.receiver, state.elapsed);
}

function compassBearing(event) {
  const rect = refs.compass.getBoundingClientRect();
  const x = event.clientX - (rect.left + rect.width / 2);
  const y = event.clientY - (rect.top + rect.height / 2);
  return Math.round((((Math.atan2(x, -y) * 180) / Math.PI) + 360) % 360);
}

function openSubmitModal() {
  if (state.ended) return;
  const missingIndex = state.answers.findIndex((answer) => !answer);
  if (missingIndex >= 0) {
    flashMessage(`请先补齐第 ${missingIndex + 1} 位推断`, "error");
    refs.answerNodes[missingIndex].focus();
    return;
  }
  refs.submitOrder.innerHTML = state.answers
    .map((stationId, index) => {
      const station = getStation(stationId);
      const capture = state.evidence.find((entry) => entry.stationId === stationId);
      return `
        <div class="submit-slot ${station ? "" : "is-empty"}">
          <small>POSITION 0${index + 1}</small>
          <strong>${station ? escapeHtml(station.name) : "未填写"}</strong>
          <span>${capture ? `${formatTime(capture.time)} · ${capture.observedFrequency.toFixed(1)} kHz` : station ? "手动推断 · 无监听记录" : "空缺"}</span>
        </div>
      `;
    })
    .join("");
  refs.submitModal.hidden = false;
}

function verdictLabel(verdict) {
  return {
    hit: "命中",
    order: "时序错位",
    source: "声源错误",
    duplicate: "重复记录",
    missing: "空缺",
  }[verdict] ?? "未核对";
}

function verdictDimension(verdict) {
  return {
    hit: "",
    order: "时序",
    source: "声源",
    duplicate: "完整性",
    missing: "完整性",
  }[verdict] ?? "未知";
}

function renderResult(result) {
  const seconds = Math.round(state.elapsed);
  const isWrong = !result.correct;
  const comparisonRows = result.comparisons
    .map((row) => {
      const guess = row.guess;
      const capture = guess
        ? state.evidence.find((entry) => entry.stationId === guess.id)
        : null;
      const dimension = verdictDimension(row.verdict);
      return `
        <div class="comparison-row">
          <div class="comparison-position">0${row.position}</div>
          <div class="comparison-cell">
            <strong>${guess ? escapeHtml(guess.name) : "未填写"}</strong>
            <small>${capture
              ? `观测 ${formatTime(capture.time)} · ${capture.observedFrequency.toFixed(1)} kHz`
              : guess ? "手动选择 · 无监听记录" : "空缺"}</small>
          </div>
          <div class="comparison-cell is-truth">
            <strong>${escapeHtml(row.truth.name)} · ${row.truth.code}</strong>
            <small>${row.truth.frequencyLabel} · ${row.truth.bearingLabel} · ${row.truth.windowLabel}</small>
          </div>
          <div class="row-verdict">
            <span class="${row.verdict === "hit" ? "" : "is-bad"}">${verdictLabel(row.verdict)}</span>
            ${dimension ? `<span class="${row.verdict === "hit" ? "" : "is-bad"}">${dimension}</span>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  const truthCards = result.truth
    .map((source) => `
      <article class="truth-card" style="--station-color:${source.color}">
        <div class="truth-card-top">
          <i></i><strong>${escapeHtml(source.name)}</strong><span>${source.code}</span>
        </div>
        <dl>
          <div><dt>载波</dt><dd>${source.frequencyLabel}</dd></div>
          <div><dt>天线方位</dt><dd>${source.bearingLabel}</dd></div>
          <div><dt>发报窗口</dt><dd>${source.windowLabel}</dd></div>
          <div><dt>周期位次</dt><dd>第 ${source.order} 位</dd></div>
        </dl>
      </article>
    `)
    .join("");

  const decoyText = state.caseData.decoys
    .map((source) => `${source.name} ${source.frequency.toFixed(1)} kHz`)
    .join(" · ");

  refs.resultContent.innerHTML = `
    <div class="result-hero ${isWrong ? "is-wrong" : ""}">
      <span class="eyebrow">SETTLEMENT / ${state.caseData.caseId}</span>
      <div class="result-verdict-row">
        <div>
          <h2>${result.correct ? "结论成立" : "结论不成立"}</h2>
          <p>${result.correct
            ? "三枚信标的声源与周期内出现顺序均已还原，监听记录可以归档。"
            : "至少一个判断维度与真实发射参数不符。请查看下方的具体维度反馈。"}</p>
        </div>
        <div class="score-ring"><strong>${result.score}</strong><span>/100</span></div>
      </div>
    </div>
    <div class="result-body">
      <div class="result-summary">
        <div class="summary-item"><small>CASE SEED</small><b>${escapeHtml(state.caseData.seed)}</b></div>
        <div class="summary-item"><small>监听时长</small><b>${formatTime(seconds)}</b></div>
        <div class="summary-item"><small>监听记录</small><b>${state.evidence.length} 条</b></div>
        <div class="summary-item"><small>误差规则</small><b>固定 / 同 seed</b></div>
      </div>

      <section class="result-section">
        <div class="result-section-head"><h3>判断维度反馈</h3><span>SPECIFIC DIMENSIONS</span></div>
        <ul class="feedback-list">
          ${result.feedback.map((item) => `
            <li class="feedback-item ${item.tone === "ok" ? "is-ok" : ""}">
              <span class="dimension-tag">${escapeHtml(item.dimension)}</span>
              <p>${escapeHtml(item.message)}</p>
            </li>
          `).join("")}
        </ul>
      </section>

      <section class="result-section">
        <div class="result-section-head"><h3>推断 / 真实参数对照</h3><span>每个位次并列核对声源、频段与时间</span></div>
        <div class="comparison-table">
          <div class="comparison-row is-head">
            <div>位次</div><div>你的判断 / 实测记录</div><div>真实声源 / 参数</div><div>核对</div>
          </div>
          ${comparisonRows}
        </div>
      </section>

      <section class="result-section">
        <div class="result-section-head"><h3>真实发射参数</h3><span>${state.caseData.cycle.toFixed(1)}s 循环</span></div>
        <div class="truth-cards">${truthCards}</div>
        <p class="decoy-note">本周期邻频干扰：${decoyText}。它们使用复合边带掩盖窄带信标，并在天线转动时保持较宽响应。</p>
      </section>

      <div class="result-actions">
        <span class="result-seed-note">同 seed 重开将复现相同载波、方向、顺序与惩罚规则。</span>
        <button class="btn btn-ghost" id="resultNewSeed" type="button">换一个案件</button>
        <button class="btn btn-primary" id="resultRestart" type="button">同 seed 重开</button>
      </div>
    </div>
  `;

  $("#resultRestart").addEventListener("click", async () => {
    await restartCase();
    refs.resultModal.hidden = true;
    refs.startBtn.focus();
  });
  $("#resultNewSeed").addEventListener("click", () => {
    const random = new Uint32Array(1);
    window.crypto.getRandomValues(random);
    const nextSeed = `SW-${String(random[0] % 9000 + 1000).padStart(4, "0")}`;
    refs.resultModal.hidden = true;
    loadSeed(nextSeed);
  });
}

async function submitConclusion() {
  const result = evaluateSubmission(state.caseData, state.answers);
  state.result = result;
  state.ended = true;
  state.running = false;
  state.paused = false;
  await audio.pause();
  refs.submitModal.hidden = true;
  refs.resultModal.hidden = false;
  renderResult(result);
  syncTransport();
  renderLock();
}

function closeModal(modal) {
  modal.hidden = true;
}

refs.freqRange.addEventListener("input", (event) => {
  setFrequency(event.target.value);
  refreshStaticTelemetry();
});
refs.bearingRange.addEventListener("input", (event) => {
  setBearing(event.target.value);
  refreshStaticTelemetry();
});
refs.gainRange.addEventListener("input", (event) => {
  setGain(event.target.value);
  refreshStaticTelemetry();
});

refs.spectrumCanvas.addEventListener("pointermove", (event) => {
  updateCanvasHover(event);
  if (state.pointers.scope) tuneFromPointer(event);
});
refs.spectrumCanvas.addEventListener("pointerdown", (event) => {
  state.pointers.scope = true;
  refs.spectrumCanvas.setPointerCapture?.(event.pointerId);
  tuneFromPointer(event);
});
refs.spectrumCanvas.addEventListener("pointerup", (event) => {
  state.pointers.scope = false;
  refs.spectrumCanvas.releasePointerCapture?.(event.pointerId);
});
refs.spectrumCanvas.addEventListener("pointerleave", () => {
  refs.scopeHover.classList.remove("is-visible");
});

refs.compass.addEventListener("pointerdown", (event) => {
  state.pointers.compass = true;
  refs.compass.setPointerCapture?.(event.pointerId);
  setBearing(compassBearing(event));
  refreshStaticTelemetry();
});
refs.compass.addEventListener("pointermove", (event) => {
  if (!state.pointers.compass) return;
  setBearing(compassBearing(event));
  refreshStaticTelemetry();
});
refs.compass.addEventListener("pointerup", (event) => {
  state.pointers.compass = false;
  refs.compass.releasePointerCapture?.(event.pointerId);
});
refs.compass.addEventListener("keydown", (event) => {
  const delta = event.key === "ArrowRight" || event.key === "ArrowUp"
    ? 2
    : event.key === "ArrowLeft" || event.key === "ArrowDown"
      ? -2
      : 0;
  if (!delta) return;
  event.preventDefault();
  setBearing(state.receiver.bearing + delta);
  refreshStaticTelemetry();
});

refs.answerNodes.forEach((select, index) => {
  select.addEventListener("change", () => {
    state.answers[index] = select.value;
    syncAnswers();
  });
});

refs.startBtn.addEventListener("click", startListening);
refs.pauseBtn.addEventListener("click", pauseListening);
refs.restartBtn.addEventListener("click", restartCase);
refs.recordBtn.addEventListener("click", recordCurrentSource);
refs.submitBtn.addEventListener("click", openSubmitModal);
refs.confirmSubmitBtn.addEventListener("click", submitConclusion);
refs.loadSeedBtn.addEventListener("click", () => loadSeed(refs.seedInput.value));
refs.seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadSeed(refs.seedInput.value);
});
refs.helpBtn.addEventListener("click", () => {
  refs.helpModal.hidden = false;
});

$$("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    const modal = document.getElementById(button.dataset.close);
    if (modal) closeModal(modal);
  });
});

[refs.helpModal, refs.submitModal].forEach((modal) => {
  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) closeModal(modal);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!refs.helpModal.hidden) closeModal(refs.helpModal);
  else if (!refs.submitModal.hidden) closeModal(refs.submitModal);
});

refs.sMeter.innerHTML = Array.from({ length: 18 }, () => "<i></i>").join("");
window.addEventListener("beforeunload", () => {
  audio.pause();
});

resetForCase(state.caseData);
const initialUrl = new URL(window.location.href);
if (initialUrl.searchParams.get("seed") !== state.caseData.seed) {
  initialUrl.searchParams.set("seed", state.caseData.seed);
  window.history.replaceState({}, "", initialUrl);
}
requestAnimationFrame(frame);
