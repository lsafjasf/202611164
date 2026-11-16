import {
  MATERIALS,
  generateCase,
  getMaterial,
  gradeSubmission,
  hasDuplicateMaterials,
  isCompleteSubmission,
  normalizeSeed
} from "./case.js";
import { AudioEngine } from "./audio.js";

const byId = (id) => document.getElementById(id);
const refs = {
  audioDot: byId("audioDot"),
  audioStatus: byId("audioStatus"),
  caseCode: byId("caseCode"),
  seedForm: byId("seedForm"),
  seedInput: byId("seedInput"),
  startBtn: byId("startBtn"),
  pauseBtn: byId("pauseBtn"),
  replayBtn: byId("replayBtn"),
  forestField: byId("forestField"),
  listener: byId("listener"),
  speedReadout: byId("speedReadout"),
  moveReadout: document.querySelector(".move-readout"),
  noiseCard: byId("noiseCard"),
  noiseLabel: byId("noiseLabel"),
  noiseHint: byId("noiseHint"),
  positionReadout: byId("positionReadout"),
  recDot: byId("recDot"),
  tapeState: byId("tapeState"),
  tapeTime: byId("tapeTime"),
  scopeCanvas: byId("scopeCanvas"),
  progressFill: byId("progressFill"),
  penaltyText: byId("penaltyText"),
  slotGrid: byId("slotGrid"),
  guessSelects: [byId("guess1"), byId("guess2"), byId("guess3")],
  slotStatuses: [byId("slotStatus1"), byId("slotStatus2"), byId("slotStatus3")],
  submitBtn: byId("submitBtn"),
  formMessage: byId("formMessage"),
  resultOverlay: byId("resultOverlay"),
  resultCard: byId("resultCard"),
  resultTitle: byId("resultTitle"),
  resultMessage: byId("resultMessage"),
  scoreDial: byId("scoreDial"),
  scoreValue: byId("scoreValue"),
  dimensionRow: byId("dimensionRow"),
  comparisonBody: byId("comparisonBody"),
  resultSeed: byId("resultSeed"),
  resultRule: byId("resultRule"),
  resultClose: byId("resultClose"),
  restartSeedBtn: byId("restartSeedBtn"),
  newSeedBtn: byId("newSeedBtn")
};

const audio = new AudioEngine();
const canvasContext = refs.scopeCanvas.getContext("2d");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  caseData: generateCase("NIGHT-001"),
  phase: "ready",
  audioReady: false,
  listener: { x: 50, y: 50 },
  playhead: 0,
  lastFrame: performance.now(),
  nextSourceIndex: 0,
  captured: [false, false, false],
  logs: [],
  windLogged: new Set(),
  guesses: ["", "", ""],
  speed: 0,
  lastMoveAt: 0,
  lastMovePoint: null,
  lastFootstepAt: 0,
  lastFootstepLogAt: 0,
  lastWindUpdate: 0,
  dragging: false,
  result: null,
  canvasSize: { width: 0, height: 0, dpr: 1 }
};

function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = (safe % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${rest}`;
}

function formatShortTime(seconds) {
  return `${seconds.toFixed(1)}s`;
}

function formatPan(pan) {
  if (Math.abs(pan) < 0.055) return "C 0.00";
  return `${pan < 0 ? "L" : "R"} ${Math.abs(pan).toFixed(2)}`;
}

function statusForPhase(phase) {
  return {
    ready: ["音频待机", "000"],
    playing: ["实时监听", "100"],
    paused: ["磁带暂停", "050"],
    ended: ["磁带结束", "000"],
    submitted: ["结算锁定", "000"]
  }[phase];
}

function materialLabel(material) {
  return `${material.name} · ${material.hint}`;
}

function populateMaterialOptions() {
  const selects = refs.guessSelects;
  selects.forEach((select) => {
    const placeholder = select.querySelector('option[value=""]');
    MATERIALS.forEach((material) => {
      const option = document.createElement("option");
      option.value = material.id;
      option.textContent = materialLabel(material);
      select.append(option);
    });
    if (placeholder) placeholder.textContent = "尚未判断";
  });
}

function setFormMessage(message, tone = "error") {
  refs.formMessage.textContent = message;
  refs.formMessage.classList.toggle("is-ok", tone === "ok");
}

function updateSlotStyles() {
  refs.guessSelects.forEach((select, index) => {
    const card = select.closest(".slot-card");
    card.classList.toggle("is-filled", Boolean(select.value));
    card.classList.remove("is-result-correct", "is-result-wrong");
    if (state.result) {
      const row = state.result.rows[index];
      if (row) card.classList.add(row.materialCorrect ? "is-result-correct" : "is-result-wrong");
    }
  });
}

function updateSubmitState() {
  if (state.result) {
    refs.submitBtn.disabled = false;
    refs.submitBtn.querySelector("span").textContent = "查看结算";
    return;
  }
  refs.submitBtn.querySelector("span").textContent = "提交推断";
  const complete = isCompleteSubmission(state.guesses);
  const canSubmit = complete
    && state.phase !== "ready"
    && state.phase !== "submitted"
    && !state.result;
  refs.submitBtn.disabled = !canSubmit;
}

function updateListenerUi() {
  refs.listener.style.left = `${state.listener.x}%`;
  refs.listener.style.top = `${state.listener.y}%`;
  refs.positionReadout.textContent = `X ${state.listener.x.toFixed(1)} / Y ${state.listener.y.toFixed(1)}`;
}

function updateNoiseUi(speed) {
  const noisy = speed > 34;
  refs.speedReadout.textContent = speed.toFixed(1);
  refs.moveReadout.classList.toggle("is-fast", noisy);
  refs.noiseCard.classList.toggle("is-noisy", noisy);
  refs.forestField.classList.toggle("is-noisy", noisy);
  refs.noiseLabel.textContent = noisy ? "脚步干扰" : speed > 6 ? "轻步移动" : "安静";
  refs.noiseHint.textContent = noisy
    ? "过快移动正在抬高低频底噪，风声细节会被遮住。"
    : "缓速拖动可压低自身脚步噪声。";
}

function setPhase(phase) {
  state.phase = phase;
  const [label] = statusForPhase(phase);
  refs.audioStatus.textContent = label;
  refs.audioDot.classList.toggle("is-live", phase === "playing");
  refs.audioDot.style.background = phase === "paused"
    ? "var(--amber)"
    : phase === "submitted"
      ? "var(--mint)"
      : "";
  refs.recDot.classList.toggle("is-live", phase === "playing");
  refs.recDot.classList.toggle("is-paused", phase === "paused");
  refs.tapeState.textContent = {
    ready: "STANDBY",
    playing: "RECORDING",
    paused: "PAUSED",
    ended: "TAPE END",
    submitted: "LOCKED"
  }[phase];
  refs.forestField.classList.toggle("is-playing", phase === "playing");
  refs.pauseBtn.disabled = !["playing", "paused"].includes(phase) || Boolean(state.result);
  refs.pauseBtn.textContent = phase === "paused" ? "继续" : "暂停";
  refs.replayBtn.disabled = phase === "ready" || phase === "submitted";

  const startStrong = refs.startBtn.querySelector("strong");
  const startSmall = refs.startBtn.querySelector("small");
  if (phase === "ready") {
    refs.startBtn.disabled = false;
    startStrong.textContent = "开始监听";
    startSmall.textContent = "BEGIN 22s TAPE";
  } else if (phase === "ended") {
    refs.startBtn.disabled = false;
    startStrong.textContent = "重放磁带";
    startSmall.textContent = "REPLAY SAME TAPE";
  } else if (phase === "submitted") {
    refs.startBtn.disabled = true;
    startStrong.textContent = "结论已锁定";
    startSmall.textContent = "DEBRIEF LOCKED";
  } else {
    refs.startBtn.disabled = true;
    startStrong.textContent = phase === "paused" ? "磁带已暂停" : "监听进行中";
    startSmall.textContent = phase === "paused" ? "PAUSED" : "TAPE RUNNING";
  }
  updateSubmitState();
}

function updateTapeUi() {
  refs.tapeTime.textContent = formatTime(state.playhead);
  refs.progressFill.style.width = `${Math.min(100, (state.playhead / state.caseData.duration) * 100)}%`;
}

function updateSlotStatuses() {
  state.caseData.sources.forEach((source, index) => {
    const status = refs.slotStatuses[index];
    if (state.captured[index]) {
      const material = getMaterial(source.materialId);
      const capture = state.logs.find((entry) => entry.sourceIndex === index && entry.kind === "source");
      status.textContent = capture
        ? `已录入 · ${capture.panText} · 回波 ${source.echoMs}ms`
        : `已捕捉 · ${material.band}`;
    } else if (state.phase === "playing" && state.playhead > source.time) {
      status.textContent = "脉冲已结束 · 可重放捕捉";
    } else if (state.phase === "ended") {
      status.textContent = "本段未捕捉 · 请重放";
    } else {
      status.textContent = "等待监听";
    }
  });
}

function resetTape() {
  audio.resetVoices();
  state.playhead = 0;
  state.lastFrame = performance.now();
  state.nextSourceIndex = 0;
  state.captured = [false, false, false];
  state.logs = [];
  state.windLogged = new Set();
  state.speed = 0;
  state.lastMovePoint = null;
  state.lastFootstepAt = 0;
  state.lastFootstepLogAt = 0;
  state.lastWindUpdate = 0;
  updateNoiseUi(0);
  updateTapeUi();
  updateSlotStatuses();
}

function resetCase(seedValue) {
  if (state.audioReady) {
    audio.resetVoices();
    audio.pause();
  }
  state.caseData = generateCase(seedValue);
  state.listener = { ...state.caseData.listenerStart };
  state.guesses = ["", "", ""];
  state.result = null;
  state.lastFrame = performance.now();
  state.speed = 0;
  refs.seedInput.value = state.caseData.seed;
  refs.caseCode.textContent = `CASE ${state.caseData.caseCode}`;
  refs.penaltyText.textContent = `材质 −${state.caseData.penalty.material} / 顺序 −${state.caseData.penalty.sequence}`;
  refs.guessSelects.forEach((select, index) => {
    select.value = "";
    select.disabled = false;
    select.closest(".slot-card").classList.remove("is-result-correct", "is-result-wrong", "is-filled");
    refs.slotStatuses[index].textContent = "等待监听";
  });
  refs.resultOverlay.hidden = true;
  document.body.classList.remove("has-result");
  refs.resultCard.classList.remove("is-failure");
  refs.comparisonBody.replaceChildren();
  refs.dimensionRow.replaceChildren();
  setFormMessage("");
  updateListenerUi();
  resetTape();
  setPhase("ready");
  updateSlotStyles();
  updateTimelineMarkers();
  updateUrlSeed(state.caseData.seed);
}

function addLog(entry) {
  state.logs.push({ time: state.playhead, ...entry });
  if (state.logs.length > 30) state.logs.splice(0, state.logs.length - 30);
}

async function startTape() {
  if (!state.audioReady) {
    try {
      await audio.init(state.caseData.audioSeed);
      state.audioReady = true;
    } catch (error) {
      setFormMessage(`无法启动音频：${error.message}`);
      refs.audioStatus.textContent = "音频不可用";
      return;
    }
  }
  resetTape();
  try {
    await audio.play();
  } catch {
    setFormMessage("浏览器阻止了音频播放，请再次点击开始。");
    return;
  }
  state.lastFrame = performance.now();
  setPhase("playing");
  updateSlotStatuses();
}

async function togglePause() {
  if (state.phase === "playing") {
    setPhase("paused");
    updateNoiseUi(0);
    await audio.pause();
    updateSlotStatuses();
  } else if (state.phase === "paused") {
    try {
      await audio.play();
      state.lastFrame = performance.now();
      setPhase("playing");
      updateSlotStatuses();
    } catch {
      setFormMessage("无法继续播放，请重新开始磁带。");
    }
  }
}

async function replayTape() {
  if (state.phase === "ready") return;
  await startTape();
}

function endTape() {
  state.playhead = state.caseData.duration;
  updateTapeUi();
  audio.setWind(0, 0);
  audio.pause();
  setPhase("ended");
  updateSlotStatuses();
}

function gustEnvelope(event, time) {
  if (time < event.start || time > event.end) return 0;
  const progress = (time - event.start) / Math.max(0.01, event.end - event.start);
  return Math.sin(progress * Math.PI) ** 0.72 * event.intensity;
}

function updateWind() {
  let strongest = null;
  let strength = 0;
  for (const event of state.caseData.windEvents) {
    const value = gustEnvelope(event, state.playhead);
    if (value > strength) {
      strength = value;
      strongest = event;
    }
    if (!state.windLogged.has(event.id) && state.playhead >= event.start && state.playhead <= event.end) {
      state.windLogged.add(event.id);
      addLog({
        kind: "wind",
        code: "WIND",
        label: "风穿叶隙",
        detail: `${formatPan(event.pan)} · 干扰 ${Math.round(event.intensity * 100)}%`,
        panText: formatPan(event.pan)
      });
    }
  }
  audio.setWind(strength, strongest?.pan ?? 0);
}

function processTimeline() {
  while (
    state.nextSourceIndex < state.caseData.sources.length
    && state.caseData.sources[state.nextSourceIndex].time <= state.playhead
  ) {
    const source = state.caseData.sources[state.nextSourceIndex];
    const index = state.nextSourceIndex;
    const spatial = audio.triggerSource(source, state.listener);
    const pan = spatial?.pan ?? 0;
    const panText = formatPan(pan);
    state.captured[index] = true;
    addLog({
      kind: "source",
      code: `SRC ${source.id.slice(2)}`,
      label: `第 ${index + 1} 声源脉冲`,
      detail: `${panText} · 回波 ${source.echoMs}ms`,
      panText,
      sourceIndex: index
    });
    state.nextSourceIndex += 1;
  }
  updateSlotStatuses();
}

function applyListenerPosition(x, y, options = {}) {
  const safeX = Math.min(96, Math.max(4, x));
  const safeY = Math.min(94, Math.max(6, y));
  state.listener = { x: safeX, y: safeY };
  updateListenerUi();
  const speed = options.speed ?? 0;
  if (state.phase === "playing") {
    state.speed = speed;
    updateNoiseUi(speed);
    if (speed > 34) triggerFootstepNoise(options.pan ?? clampPan(safeX), speed);
  } else {
    state.speed = 0;
    updateNoiseUi(0);
  }
}

function clampPan(x) {
  return Math.max(-0.7, Math.min(0.7, (x - 50) / 50));
}

function triggerFootstepNoise(pan, speed) {
  const now = performance.now();
  if (now - state.lastFootstepAt < 260) return;
  state.lastFootstepAt = now;
  const intensity = Math.min(1, Math.max(0.32, (speed - 20) / 125));
  audio.triggerFootstep(
    state.caseData.audioSeed ^ Math.floor(now / 260),
    pan,
    intensity
  );
  if (now - state.lastFootstepLogAt > 620) {
    state.lastFootstepLogAt = now;
    addLog({
      kind: "step",
      code: "STEP",
      label: "自身脚步",
      detail: `${formatPan(pan)} · 低频遮罩增强`,
      panText: formatPan(pan)
    });
  }
}

function pointerPosition(event) {
  const rect = refs.forestField.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: ((event.clientY - rect.top) / rect.height) * 100
  };
}

function handlePointerMove(event) {
  if (!state.lastMovePoint) {
    state.lastMovePoint = { ...pointerPosition(event), at: performance.now() };
    return;
  }
  const point = pointerPosition(event);
  const now = performance.now();
  const dt = Math.max(12, now - state.lastMovePoint.at);
  const distance = Math.hypot(point.x - state.lastMovePoint.x, point.y - state.lastMovePoint.y);
  const speed = Math.min(220, (distance / dt) * 1000);
  const pan = Math.max(-0.7, Math.min(0.7, (point.x - state.lastMovePoint.x) / 14));
  applyListenerPosition(point.x, point.y, { speed, pan });
  state.lastMoveAt = now;
  state.lastMovePoint = { ...point, at: now };
}

function handleKeyboardMove(event) {
  const keyMap = {
    ArrowLeft: [-4, 0],
    ArrowRight: [4, 0],
    ArrowUp: [0, -4],
    ArrowDown: [0, 4]
  };
  const delta = keyMap[event.key];
  if (!delta) return;
  event.preventDefault();
  const [dx, dy] = delta;
  applyListenerPosition(state.listener.x + dx, state.listener.y + dy, {
    speed: event.repeat ? 54 : 38,
    pan: Math.max(-0.7, Math.min(0.7, dx / 9))
  });
  state.lastMoveAt = performance.now();
}

function resizeCanvas() {
  const rect = refs.scopeCanvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (
    state.canvasSize.width === width
    && state.canvasSize.height === height
    && state.canvasSize.dpr === dpr
  ) return;
  state.canvasSize = { width, height, dpr };
  refs.scopeCanvas.width = Math.round(width * dpr);
  refs.scopeCanvas.height = Math.round(height * dpr);
  canvasContext.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawScope(levels, width, height, time) {
  const context = canvasContext;
  const padding = 14;
  const scopeBottom = height - 74;
  context.save();
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();

  const glow = context.createRadialGradient(
    width * 0.44,
    (height - 74) * 0.52,
    10,
    width * 0.44,
    (height - 74) * 0.52,
    width * 0.7
  );
  glow.addColorStop(0, "rgba(136, 190, 139, 0.055)");
  glow.addColorStop(1, "rgba(3, 9, 7, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.font = "8px ui-monospace, 'Echo Sans', monospace";
  context.letterSpacing = "0.08em";
  context.fillStyle = "rgba(155, 182, 160, 0.52)";
  context.fillText("BINAURAL PRESSURE", padding, 20);
  context.fillStyle = "rgba(107, 133, 116, 0.55)";
  context.textAlign = "right";
  context.fillText(state.phase === "playing" ? "● REC" : "○ HOLD", width - padding, 20);
  context.textAlign = "left";

  const scopeTop = 34;
  const centerY = scopeTop + (scopeBottom - scopeTop) * 0.5;
  context.strokeStyle = "rgba(150, 183, 158, 0.075)";
  context.lineWidth = 1;
  for (let x = padding; x <= width - padding; x += 38) {
    context.beginPath();
    context.moveTo(x, scopeTop);
    context.lineTo(x, scopeBottom);
    context.stroke();
  }
  for (let y = scopeTop + 12; y < scopeBottom; y += 27) {
    context.beginPath();
    context.moveTo(padding, y);
    context.lineTo(width - padding, y);
    context.stroke();
  }
  context.strokeStyle = "rgba(159, 196, 166, 0.17)";
  context.beginPath();
  context.moveTo(padding, centerY);
  context.lineTo(width - padding, centerY);
  context.stroke();

  const waveform = levels.waveform;
  const plotWidth = Math.max(1, width - padding * 2);
  const amplitude = Math.max(16, (scopeBottom - scopeTop) * 0.44);
  context.beginPath();
  if (waveform) {
    const step = Math.max(1, Math.floor(waveform.length / plotWidth));
    for (let x = 0; x <= plotWidth; x += 1) {
      const sampleIndex = Math.min(waveform.length - 1, Math.floor(x * (waveform.length / plotWidth)));
      const sample = (waveform[sampleIndex] - 128) / 128;
      const y = centerY + sample * amplitude;
      if (x === 0) context.moveTo(padding + x, y);
      else context.lineTo(padding + x, y);
    }
  } else {
    context.moveTo(padding, centerY);
    context.lineTo(width - padding, centerY);
  }
  context.strokeStyle = "rgba(175, 225, 181, 0.78)";
  context.lineWidth = 1.1;
  context.shadowBlur = 7;
  context.shadowColor = "rgba(151, 218, 159, 0.3)";
  context.stroke();
  context.shadowBlur = 0;

  const dbText = levels.db <= -59.5 ? "−∞" : levels.db.toFixed(1);
  context.textAlign = "right";
  context.font = "500 19px ui-monospace, 'Echo Sans', monospace";
  context.fillStyle = "rgba(220, 239, 211, 0.84)";
  context.fillText(dbText, width - padding, scopeTop + 23);
  context.font = "7px ui-monospace, 'Echo Sans', monospace";
  context.fillStyle = "rgba(112, 139, 120, 0.7)";
  context.fillText("dBFS", width - padding, scopeTop + 35);

  const meterWidth = Math.max(54, (width - padding * 2 - 34) / 2);
  const meterY = height - 47;
  [
    { label: "L", value: levels.left, x: padding },
    { label: "R", value: levels.right, x: padding + meterWidth + 34 }
  ].forEach((meter) => {
    context.textAlign = "left";
    context.font = "8px ui-monospace, 'Echo Sans', monospace";
    context.fillStyle = "rgba(124, 151, 132, 0.8)";
    context.fillText(meter.label, meter.x, meterY + 8);
    context.fillStyle = "rgba(155, 186, 163, 0.1)";
    context.fillRect(meter.x + 12, meterY, meterWidth, 5);
    const meterGradient = context.createLinearGradient(meter.x + 12, 0, meter.x + 12 + meterWidth, 0);
    meterGradient.addColorStop(0, "rgba(133, 194, 149, 0.65)");
    meterGradient.addColorStop(0.72, "rgba(190, 219, 125, 0.9)");
    meterGradient.addColorStop(1, "rgba(219, 130, 111, 0.9)");
    context.fillStyle = meterGradient;
    context.fillRect(meter.x + 12, meterY, meterWidth * meter.value, 5);
  });

  context.strokeStyle = "rgba(149, 181, 157, 0.11)";
  context.beginPath();
  context.moveTo(padding, height - 23);
  context.lineTo(width - padding, height - 23);
  context.stroke();
  context.font = "7px ui-monospace, 'Echo Sans', monospace";
  context.fillStyle = "rgba(105, 130, 112, 0.64)";
  context.textAlign = "left";
  context.fillText(`T+${formatTime(state.playhead)}`, padding, height - 10);
  context.textAlign = "right";
  context.fillText(`${formatShortTime(time)} CLOCK`, width - padding, height - 10);
  context.restore();
}

function drawRecords(width, height) {
  const context = canvasContext;
  const padding = 13;
  const compact = width < 180;
  context.save();
  context.fillStyle = "rgba(4, 11, 8, 0.52)";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(154, 188, 162, 0.11)";
  context.setLineDash([3, 5]);
  context.beginPath();
  context.moveTo(0.5, 12);
  context.lineTo(0.5, height - 12);
  context.stroke();
  context.setLineDash([]);

  context.textAlign = "left";
  context.font = "8px ui-monospace, 'Echo Sans', monospace";
  context.fillStyle = "rgba(155, 182, 160, 0.57)";
  context.fillText(compact ? "RECORDS" : "OBSERVATION TAPE", padding, 20);
  if (!compact) {
    context.textAlign = "right";
    context.fillStyle = "rgba(104, 130, 111, 0.55)";
    context.fillText(`${state.logs.length} ENTRIES`, width - padding, 20);
  }

  const rowHeight = 38;
  const available = Math.max(1, Math.floor((height - 76) / rowHeight));
  const visibleLogs = state.logs.slice(-available).reverse();
  const colorMap = {
    source: "#a7d8b4",
    wind: "#d5a65d",
    step: "#db826f"
  };

  let y = 44;
  if (visibleLogs.length === 0) {
    context.textAlign = "left";
    context.font = "9px ui-monospace, 'Echo Sans', monospace";
    context.fillStyle = "rgba(112, 137, 119, 0.55)";
    context.fillText(state.phase === "playing" ? "等待第一段脉冲…" : "磁带待机 / 尚无记录", padding, y + 9);
    context.fillStyle = "rgba(84, 106, 91, 0.48)";
    context.fillText(compact ? "播放时实时写入" : "声音线索将在播放时实时写入", padding, y + 25);
  } else {
    for (const entry of visibleLogs) {
      if (y > height - 29) break;
      const color = colorMap[entry.kind] ?? "#a7d8b4";
      context.fillStyle = color;
      context.beginPath();
      context.arc(padding + 3, y + 5, 2.1, 0, Math.PI * 2);
      context.fill();
      context.font = "8px ui-monospace, 'Echo Sans', monospace";
      context.fillStyle = "rgba(126, 152, 134, 0.68)";
      context.textAlign = "left";
      context.fillText(`+${formatShortTime(entry.time).padStart(5, "0")}`, padding + 12, y + 8);
      context.textAlign = "right";
      context.fillStyle = color;
      context.globalAlpha = 0.8;
      context.fillText(entry.code, width - padding, y + 8);
      context.globalAlpha = 1;
      context.textAlign = "left";
      context.font = "9px 'Echo Sans', sans-serif";
      context.fillStyle = "rgba(208, 225, 207, 0.8)";
      context.fillText(entry.label, padding + 12, y + 23);
      context.font = "7px ui-monospace, 'Echo Sans', monospace";
      context.fillStyle = "rgba(108, 133, 115, 0.68)";
      context.fillText(entry.detail, padding + 12, y + 34);
      context.strokeStyle = "rgba(153, 186, 161, 0.065)";
      context.beginPath();
      context.moveTo(padding, y + 42);
      context.lineTo(width - padding, y + 42);
      context.stroke();
      y += rowHeight;
    }
  }

  context.font = "7px ui-monospace, 'Echo Sans', monospace";
  context.fillStyle = "rgba(111, 137, 118, 0.58)";
  context.textAlign = "left";
  context.fillText(state.phase === "playing" ? "RECORDING TO TAPE" : "TAPE HELD", padding, height - 9);
  context.restore();
}

function drawCanvas(time) {
  resizeCanvas();
  const { width, height } = state.canvasSize;
  if (!width || !height) return;
  const context = canvasContext;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#030907";
  context.fillRect(0, 0, width, height);

  const levels = audio.getLevels();
  const split = width < 520 ? width * 0.56 : width * 0.61;
  drawScope(levels, split, height, time);
  context.save();
  context.translate(split, 0);
  drawRecords(width - split, height);
  context.restore();
}

function animationLoop(now) {
  const dt = Math.min(0.12, Math.max(0, (now - state.lastFrame) / 1000));
  if (state.phase === "playing") {
    state.lastFrame = now;
    state.playhead = Math.min(state.caseData.duration, state.playhead + dt);
    processTimeline();
    if (now - state.lastWindUpdate > 90) {
      updateWind();
      state.lastWindUpdate = now;
    }
    updateTapeUi();
    updateSlotStatuses();
    if (state.playhead >= state.caseData.duration) endTape();
  } else {
    state.lastFrame = now;
  }

  if (state.speed > 0 && now - state.lastMoveAt > 230) {
    state.speed = 0;
    updateNoiseUi(0);
  }
  drawCanvas(now);
  requestAnimationFrame(animationLoop);
}

function fileTime(seconds) {
  return `00:${seconds.toFixed(1).padStart(4, "0")}`;
}

function createMaterialPill(material, status = "") {
  const pill = document.createElement("span");
  pill.className = `material-pill${status ? ` ${status}` : ""}`;
  pill.style.setProperty("--material-color", material.color);
  pill.textContent = material.name;
  return pill;
}

function renderComparison(result) {
  refs.comparisonBody.replaceChildren();
  result.rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (!row.materialCorrect) tr.classList.add("is-mismatch");

    const judgmentCell = document.createElement("td");
    judgmentCell.className = "judgment-cell";
    const slotLine = document.createElement("div");
    slotLine.className = "judgment-line";
    const slotLabel = document.createElement("span");
    slotLabel.className = "judgment-tag";
    slotLabel.textContent = `0${row.slot}`;
    const guess = createMaterialPill(row.guessMaterial, row.materialCorrect ? "is-correct" : "is-wrong");
    slotLine.append(slotLabel, guess);
    const note = document.createElement("div");
    note.className = "judgment-line";
    const noteTag = document.createElement("span");
    noteTag.className = "judgment-tag";
    noteTag.textContent = "判定";
    const noteText = document.createElement("span");
    noteText.className = "muted-cell";
    noteText.textContent = row.materialCorrect
      ? "材质与时间槽一致"
      : result.dimension === "order"
        ? "材质集合正确，时间槽错位"
        : "该时间槽材质不符";
    note.append(noteTag, noteText);
    judgmentCell.append(slotLine, note);

    const sourceCell = document.createElement("td");
    const sourceCode = document.createElement("span");
    sourceCode.className = "source-code";
    sourceCode.textContent = row.sourceId;
    const sourceMeta = document.createElement("div");
    sourceMeta.className = "judgment-line";
    sourceMeta.style.marginTop = "5px";
    sourceMeta.textContent = `初始声像 ${row.pan} · X${row.position.x.toFixed(0)} Y${row.position.y.toFixed(0)}`;
    sourceCell.append(sourceCode, sourceMeta);

    const actualCell = document.createElement("td");
    actualCell.append(createMaterialPill(row.actualMaterial));
    const actualHint = document.createElement("div");
    actualHint.className = "judgment-line";
    actualHint.style.marginTop = "5px";
    actualHint.textContent = row.actualMaterial.hint;
    actualCell.append(actualHint);

    const timeCell = document.createElement("td");
    timeCell.className = "mono-cell";
    timeCell.textContent = fileTime(row.time);

    const frequencyCell = document.createElement("td");
    const frequency = document.createElement("span");
    frequency.className = "mono-cell";
    frequency.textContent = `${(row.frequency / 1000).toFixed(2)} kHz`;
    const band = document.createElement("div");
    band.className = "judgment-line";
    band.style.marginTop = "5px";
    band.textContent = row.band;
    frequencyCell.append(frequency, band);

    const echoCell = document.createElement("td");
    const echo = document.createElement("span");
    echo.className = "mono-cell";
    echo.textContent = `${row.echoMs} ms`;
    const echoText = document.createElement("div");
    echoText.className = "judgment-line";
    echoText.style.marginTop = "5px";
    echoText.textContent = row.echo;
    echoCell.append(echo, echoText);

    tr.append(judgmentCell, sourceCell, actualCell, timeCell, frequencyCell, echoCell);
    refs.comparisonBody.append(tr);
  });
}

function renderDimensions(result) {
  refs.dimensionRow.replaceChildren();
  result.breakdown.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = `dimension-chip is-${item.status}`;
    const dimension = document.createElement("strong");
    dimension.textContent = item.dimension;
    const detail = document.createElement("span");
    detail.textContent = item.detail;
    chip.append(dimension, detail);
    refs.dimensionRow.append(chip);
  });
}

function showResult(result) {
  refs.resultCard.classList.toggle("is-failure", !result.success);
  refs.resultTitle.textContent = result.success
    ? "声景重建完成"
    : result.dimension === "order"
      ? "材质已识别，时间顺序偏移"
      : "材质判断存在偏差";
  refs.resultMessage.textContent = result.message;
  refs.scoreValue.textContent = String(result.score);
  refs.resultSeed.textContent = state.caseData.seed;
  refs.resultRule.textContent =
    `线索顺序与惩罚固定：材质 −${state.caseData.penalty.material} / 项，顺序 −${state.caseData.penalty.sequence} / 次`;
  renderDimensions(result);
  renderComparison(result);
  refs.resultOverlay.hidden = false;
  document.body.classList.add("has-result");
  window.setTimeout(() => refs.resultClose.focus(), 20);
}

async function submitInference() {
  if (state.result) {
    showResult(state.result);
    return;
  }
  const guesses = [...state.guesses];
  if (!isCompleteSubmission(guesses)) {
    setFormMessage("材质判断不完整：请选择全部 3 个时间槽。");
    return;
  }
  if (hasDuplicateMaterials(guesses)) {
    setFormMessage("材质维度错误：三个声源来自不同地面材质，不能重复。");
    return;
  }

  const result = gradeSubmission(state.caseData, guesses);
  state.result = result;
  await audio.pause();
  setPhase("submitted");
  refs.guessSelects.forEach((select) => {
    select.disabled = true;
  });
  state.caseData.sources.forEach((source, index) => {
    const row = result.rows[index];
    const status = refs.slotStatuses[index];
    if (row?.materialCorrect) {
      status.textContent = "材质与顺序命中";
    } else if (result.dimension === "order") {
      status.textContent = "材质已识别 · 时间槽错位";
    } else {
      status.textContent = `材质不符 · 真实回波 ${source.echoMs}ms`;
    }
  });
  updateSlotStyles();
  setFormMessage(result.success ? "结论已锁定：全部维度通过。" : `结论已锁定：${result.message}`, result.success ? "ok" : "error");
  showResult(result);
}

function closeResult() {
  refs.resultOverlay.hidden = true;
  document.body.classList.remove("has-result");
}

function updateUrlSeed(seed) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("seed", seed);
    window.history.replaceState({}, "", url);
  } catch {
    // History may be unavailable in embedded previews.
  }
}

function updateTimelineMarkers() {
  const markers = document.querySelectorAll(".progress-track i");
  markers.forEach((marker, index) => {
    const source = state.caseData.sources[index];
    if (source) marker.style.left = `${(source.time / state.caseData.duration) * 100}%`;
  });
  const approximateWindows = ["约 00:05", "约 00:11", "约 00:16"];
  const slotWindows = document.querySelectorAll(".slot-window");
  slotWindows.forEach((windowLabel, index) => {
    windowLabel.textContent = approximateWindows[index] ?? "时间窗";
  });
}

function wireEvents() {
  refs.startBtn.addEventListener("click", () => {
    if (state.phase === "ended") replayTape();
    else if (state.phase === "ready") startTape();
  });
  refs.pauseBtn.addEventListener("click", togglePause);
  refs.replayBtn.addEventListener("click", replayTape);
  refs.submitBtn.addEventListener("click", submitInference);
  refs.resultClose.addEventListener("click", closeResult);
  refs.restartSeedBtn.addEventListener("click", () => {
    resetCase(state.caseData.seed);
    closeResult();
    refs.seedInput.focus();
  });
  refs.newSeedBtn.addEventListener("click", () => {
    const randomSeed = `NIGHT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    resetCase(randomSeed);
    closeResult();
    refs.seedInput.focus();
  });
  refs.resultOverlay.addEventListener("click", (event) => {
    if (event.target === refs.resultOverlay) closeResult();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !refs.resultOverlay.hidden) closeResult();
  });

  refs.seedForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const normalized = normalizeSeed(refs.seedInput.value);
    resetCase(normalized);
    setFormMessage(`已载入 Seed ${normalized}，线索与惩罚规则固定。`, "ok");
  });

  refs.guessSelects.forEach((select, index) => {
    select.addEventListener("change", () => {
      state.guesses[index] = select.value;
      if (hasDuplicateMaterials(state.guesses.filter(Boolean))) {
        setFormMessage("材质维度提示：三个来源应选择不同材质。");
      } else {
        setFormMessage("");
      }
      updateSlotStyles();
      updateSubmitState();
    });
  });

  refs.forestField.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    refs.forestField.focus();
    refs.forestField.setPointerCapture?.(event.pointerId);
    state.dragging = true;
    refs.forestField.classList.add("is-dragging");
    const point = pointerPosition(event);
    state.lastMovePoint = { ...point, at: performance.now() };
    applyListenerPosition(point.x, point.y, { speed: 0 });
  });
  refs.forestField.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    event.preventDefault();
    handlePointerMove(event);
  });
  const stopDragging = () => {
    state.dragging = false;
    state.lastMovePoint = null;
    refs.forestField.classList.remove("is-dragging");
  };
  refs.forestField.addEventListener("pointerup", stopDragging);
  refs.forestField.addEventListener("pointercancel", stopDragging);
  refs.forestField.addEventListener("keydown", handleKeyboardMove);
}

function init() {
  populateMaterialOptions();
  const seedFromUrl = new URLSearchParams(window.location.search).get("seed") || "NIGHT-001";
  resetCase(seedFromUrl);
  wireEvents();
  new ResizeObserver(resizeCanvas).observe(refs.scopeCanvas);
  window.addEventListener("resize", resizeCanvas);
  requestAnimationFrame(animationLoop);
}

init();
