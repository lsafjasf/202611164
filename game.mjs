import {
  BANDS,
  CADENCES,
  SECTORS,
  buildClueSchedule,
  createCase,
  evaluateAnswers,
  getBand,
  getCadence,
  getSector,
  isBursting,
  sourceSignal,
  whiteoutIntensity
} from "./case-engine.mjs";
import { AudioEngine } from "./audio-engine.mjs";
import { CanvasWorld } from "./renderer.mjs";

const $ = (selector) => document.querySelector(selector);
const elements = {
  iceCanvas: $("#iceCanvas"),
  scopeCanvas: $("#scopeCanvas"),
  channelList: $("#channelList"),
  evidenceList: $("#evidenceList"),
  clueCount: $("#clueCount"),
  headerSeed: $("#headerSeed"),
  startScreen: $("#startScreen"),
  startSeed: $("#startSeed"),
  launchBtn: $("#launchBtn"),
  randomSeedBtn: $("#randomSeedBtn"),
  pauseScreen: $("#pauseScreen"),
  resumeBtn: $("#resumeBtn"),
  pauseSubmitBtn: $("#pauseSubmitBtn"),
  submitScreen: $("#submitScreen"),
  answerForm: $("#answerForm"),
  answerGrid: $("#answerGrid"),
  closeSubmitBtn: $("#closeSubmitBtn"),
  confirmSubmitBtn: $("#confirmSubmitBtn"),
  formProgress: $("#formProgress"),
  resultScreen: $("#resultScreen"),
  resultCard: $("#resultCard"),
  deadScreen: $("#deadScreen"),
  deadRestartBtn: $("#deadRestartBtn"),
  startBtn: $("#startBtn"),
  pauseBtn: $("#pauseBtn"),
  replayBtn: $("#replayBtn"),
  resetBtn: $("#resetBtn"),
  submitBtn: $("#submitBtn"),
  batteryText: $("#batteryText"),
  batteryFill: $("#batteryFill"),
  batteryTrack: $(".battery-track"),
  statusDot: $("#statusDot"),
  statusText: $("#statusText"),
  missionState: $("#missionState"),
  missionClock: $("#missionClock"),
  recDot: $("#recDot"),
  weatherPill: $("#weatherPill"),
  weatherText: $("#weatherText"),
  positionReadout: $("#positionReadout"),
  mapRssi: $("#mapRssi"),
  mapMode: $("#mapMode"),
  scopeFreq: $("#scopeFreq"),
  scopeDoppler: $("#scopeDoppler"),
  scopeState: $("#scopeState"),
  toast: $("#toast")
};

const audio = new AudioEngine();
const world = new CanvasWorld(elements.iceCanvas, elements.scopeCanvas);
const DIMENSION_CHOICES = {
  sector: SECTORS.map((sector) => ({
    value: sector.id,
    label: `${sector.short} · ${sector.label}`
  })),
  band: BANDS.map((band) => ({
    value: band.id,
    label: `${band.id} · ${band.label} / ${band.range}`
  })),
  cadence: CADENCES.map((cadence) => ({
    value: cadence.id,
    label: cadence.label
  }))
};

const state = {
  caseData: null,
  schedule: [],
  scheduleIndex: 0,
  runtime: "ready",
  time: 0,
  selectedIndex: 0,
  receiver: { x: 0.5, y: 0.5 },
  velocity: { x: 0, y: 0 },
  trail: [],
  trailTimer: 0,
  keys: new Set(),
  target: null,
  pointerDown: false,
  signals: [],
  weather: 0,
  frequency: 0,
  doppler: 0,
  unstable: false,
  bursting: false,
  observations: [],
  lastReplay: null,
  channelEls: [],
  answerDraft: [],
  answerReturnRuntime: "ready",
  toastTimer: null,
  lastTick: performance.now(),
  lastUi: 0
};

function clock(seconds, tenths = true) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  const output = tenths ? remainder.toFixed(1).padStart(4, "0") : Math.floor(remainder).toString().padStart(2, "0");
  return `${String(minutes).padStart(2, "0")}:${output}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2800);
}

function currentSource() {
  return state.caseData.sources[state.selectedIndex];
}

function setDraftEmpty() {
  state.answerDraft = state.caseData.sources.map(() => ({
    sector: "",
    band: "",
    cadence: ""
  }));
}

function initializeCase(seedValue) {
  const caseData = createCase(seedValue);
  state.caseData = caseData;
  state.schedule = buildClueSchedule(caseData);
  state.scheduleIndex = 0;
  state.runtime = "ready";
  state.time = 0;
  state.selectedIndex = 0;
  state.receiver = { x: 0.5, y: 0.5 };
  state.velocity = { x: 0, y: 0 };
  state.trail = [{ x: 0.5, y: 0.5 }];
  state.trailTimer = 0;
  state.keys.clear();
  state.target = null;
  state.pointerDown = false;
  state.weather = 0;
  state.frequency = caseData.sources[0].carrierHz;
  state.doppler = 0;
  state.unstable = false;
  state.bursting = false;
  state.observations = [];
  state.lastReplay = null;
  setDraftEmpty();
  elements.headerSeed.textContent = caseData.seed;
  elements.startSeed.value = caseData.seed;
  elements.evidenceList.innerHTML = `
    <li class="empty-evidence">
      <span class="empty-ring"></span>
      <p>等待首个起报窗口</p>
      <small>时序、强度与频点将在此实时记录</small>
    </li>`;
  elements.clueCount.textContent = "0 条证据";
  elements.replayBtn.disabled = true;
  world.setCase(caseData);
  renderChannels();
  updateStaticCaseLabels();
  syncRuntimeUi();
}

function updateStaticCaseLabels() {
  elements.missionClock.textContent = "00:00.0";
  elements.batteryText.textContent = clock(state.caseData.batterySeconds, false);
  elements.batteryFill.style.width = "100%";
  elements.batteryTrack.setAttribute("aria-valuenow", "100");
  elements.positionReadout.textContent = "0.50 / 0.50";
}

function renderChannels() {
  elements.channelList.innerHTML = state.caseData.sources.map((source, index) => `
    <article
      class="channel-card${index === state.selectedIndex ? " selected" : ""}"
      data-index="${index}"
      role="button"
      tabindex="0"
      aria-label="监听 ${source.name} 信道"
      style="--channel-color: ${source.color}"
    >
      <div class="channel-top">
        <span class="channel-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="channel-name">
          <strong>${source.name}</strong>
          <small>CH ${source.channel}</small>
        </span>
        <span class="burst-badge" data-role="burst">IDLE</span>
      </div>
      <div class="channel-metrics">
        <div class="channel-metric"><span>RSSI</span><strong data-role="rssi">--</strong></div>
        <div class="channel-metric"><span>FREQ</span><strong data-role="freq">---.-</strong></div>
      </div>
      <div class="signal-track"><span data-role="bar"></span></div>
      <div class="channel-bottom">
        <span class="reading" data-role="reading">等待开始</span>
        <span class="listen-label">${index === state.selectedIndex ? "● 监听中" : "○ 调谐"}</span>
      </div>
    </article>
  `).join("");
  state.channelEls = Array.from(elements.channelList.querySelectorAll(".channel-card")).map((card) => ({
    card,
    burst: card.querySelector('[data-role="burst"]'),
    rssi: card.querySelector('[data-role="rssi"]'),
    freq: card.querySelector('[data-role="freq"]'),
    bar: card.querySelector('[data-role="bar"]'),
    reading: card.querySelector('[data-role="reading"]'),
    listen: card.querySelector(".listen-label")
  }));
}

function tuneChannel(index) {
  if (index < 0 || index >= state.caseData.sources.length) return;
  state.selectedIndex = index;
  state.channelEls.forEach((entry, entryIndex) => {
    entry.card.classList.toggle("selected", entryIndex === index);
    entry.listen.textContent = entryIndex === index ? "● 监听中" : "○ 调谐";
  });
}

function syncRuntimeUi() {
  const running = state.runtime === "running";
  const paused = state.runtime === "paused";
  const ready = state.runtime === "ready";
  const answerable = running || paused;
  elements.startBtn.disabled = !ready;
  elements.pauseBtn.disabled = !(running || paused);
  elements.pauseBtn.innerHTML = paused
    ? '<span class="control-icon">▶</span>继续'
    : '<span class="control-icon">Ⅱ</span>暂停';
  elements.submitBtn.disabled = !answerable;
  elements.pauseScreen.hidden = !paused;
  elements.statusDot.className = "signal-dot";
  elements.recDot.className = "rec-dot";

  if (running) {
    elements.statusDot.classList.add("live");
    elements.recDot.classList.add("live");
    elements.statusText.textContent = "实时监听";
    elements.missionState.textContent = "LIVE / 正在接收";
  } else if (paused) {
    elements.statusDot.classList.add("warning");
    elements.recDot.classList.add("warning");
    elements.statusText.textContent = "已暂停";
    elements.missionState.textContent = "PAUSED / 时钟冻结";
  } else if (state.runtime === "depleted") {
    elements.statusDot.classList.add("warning");
    elements.statusText.textContent = "电量耗尽";
    elements.missionState.textContent = "POWER DEPLETED";
  } else if (state.runtime === "submitted") {
    elements.statusText.textContent = "已结算";
    elements.missionState.textContent = "SUBMITTED / 结论封存";
  } else {
    elements.statusText.textContent = "待启动";
    elements.missionState.textContent = "READY / 尚未开始计时";
  }
}

function refreshSignals() {
  state.signals = state.caseData.sources.map((source) =>
    sourceSignal(state.caseData, source, state.receiver)
  );
  return state.signals;
}

function updateReceiver(dt) {
  let moveX = 0;
  let moveY = 0;
  if (state.keys.has("KeyW") || state.keys.has("ArrowUp")) moveY -= 1;
  if (state.keys.has("KeyS") || state.keys.has("ArrowDown")) moveY += 1;
  if (state.keys.has("KeyA") || state.keys.has("ArrowLeft")) moveX -= 1;
  if (state.keys.has("KeyD") || state.keys.has("ArrowRight")) moveX += 1;

  if (moveX === 0 && moveY === 0 && state.target) {
    const dx = state.target.x - state.receiver.x;
    const dy = state.target.y - state.receiver.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.008) {
      state.target = null;
    } else {
      moveX = dx / distance;
      moveY = dy / distance;
    }
  } else if (moveX !== 0 || moveY !== 0) {
    state.target = null;
  }

  const magnitude = Math.hypot(moveX, moveY);
  if (magnitude === 0) {
    state.velocity.x = 0;
    state.velocity.y = 0;
    state.unstable = false;
    return;
  }

  moveX /= magnitude;
  moveY /= magnitude;
  const sprinting = state.keys.has("ShiftLeft") || state.keys.has("ShiftRight");
  const speed = sprinting ? 0.285 : 0.112;
  state.velocity.x = moveX * speed;
  state.velocity.y = moveY * speed;
  state.receiver.x = Math.min(0.972, Math.max(0.028, state.receiver.x + state.velocity.x * dt));
  state.receiver.y = Math.min(0.94, Math.max(0.06, state.receiver.y + state.velocity.y * dt));
  state.unstable = speed > 0.18;

  if (state.trailTimer <= 0) {
    state.trail.push({ ...state.receiver });
    if (state.trail.length > 95) state.trail.shift();
    state.trailTimer = 0.16;
  } else {
    state.trailTimer -= dt;
  }
}

function recordObservation(event) {
  const source = state.caseData.sources[event.sourceIndex];
  const weather = whiteoutIntensity(state.caseData, event.time);
  const masked = weather > 0.48;
  const signal = sourceSignal(state.caseData, source, state.receiver);
  const reading = masked
    ? event.carrierHz
    : event.carrierHz + Math.sin(event.time * 3.7 + source.index) * 0.45;
  const observation = {
    id: `${event.time}-${event.sourceIndex}`,
    time: event.time,
    sourceIndex: event.sourceIndex,
    sourceName: source.name,
    channel: source.channel,
    color: source.color,
    frequency: reading,
    strength: signal.strength,
    masked,
    event
  };
  state.observations.push(observation);
  if (!masked) state.lastReplay = observation;
  elements.replayBtn.disabled = !state.lastReplay;
  renderEvidence();
}

function processSchedule() {
  while (
    state.scheduleIndex < state.schedule.length &&
    state.schedule[state.scheduleIndex].time <= state.time
  ) {
    recordObservation(state.schedule[state.scheduleIndex]);
    state.scheduleIndex += 1;
  }
}

function renderEvidence() {
  elements.clueCount.textContent = `${state.observations.length} 条证据`;
  if (!state.observations.length) return;
  elements.evidenceList.innerHTML = state.observations.map((observation) => `
    <li class="evidence-item" data-source="${observation.sourceIndex}" title="点击调谐到 ${observation.channel}">
      <time>${clock(observation.time)}</time>
      <span class="evidence-main">
        <strong style="color:${observation.color}">${observation.channel} / ${observation.sourceName}</strong>
        <span>${observation.masked ? "频点被风雪掩蔽" : `${observation.frequency.toFixed(1)} Hz`} · RSSI ${Math.round(observation.strength)}%</span>
      </span>
      <span class="evidence-tag${observation.masked ? " masked" : ""}">${observation.masked ? "掩蔽" : "清晰"}</span>
    </li>
  `).join("");
  elements.evidenceList.scrollTop = elements.evidenceList.scrollHeight;
}

function computeLiveFrequency() {
  const source = currentSource();
  const signal = sourceSignal(state.caseData, source, state.receiver);
  const length = Math.max(0.0001, Math.hypot(signal.dx, signal.dy));
  const unitX = signal.dx / length;
  const unitY = signal.dy / length;
  const radial = state.velocity.x * unitX + state.velocity.y * unitY;
  let doppler = radial * 82;
  if (state.unstable) {
    doppler +=
      Math.sin(state.time * 29.3 + state.caseData.seedHash) * 21 +
      Math.sin(state.time * 51.7) * 9;
  }
  const drift = Math.sin(state.time * 1.9 + source.index) * 0.22;
  state.doppler = doppler;
  state.frequency = source.carrierHz + doppler + drift;
}

function tick(dt) {
  state.time += dt;
  updateReceiver(dt);
  refreshSignals();
  state.weather = whiteoutIntensity(state.caseData, state.time);
  const source = currentSource();
  state.bursting = isBursting(source, state.time);
  computeLiveFrequency();
  processSchedule();
  audio.update({
    running: true,
    frequency: Math.max(120, state.frequency),
    strength: state.signals[state.selectedIndex]?.strength ?? 0,
    bursting: state.bursting,
    whiteout: state.weather,
    unstable: state.unstable,
    paused: false
  });
  if (state.time >= state.caseData.batterySeconds) {
    state.time = state.caseData.batterySeconds;
    depleteGame();
  }
}

function renderLiveUi() {
  const remaining = Math.max(0, state.caseData.batterySeconds - state.time);
  const percent = (remaining / state.caseData.batterySeconds) * 100;
  elements.batteryText.textContent = clock(remaining, false);
  elements.batteryFill.style.width = `${percent}%`;
  elements.batteryFill.style.background = percent < 24
    ? "linear-gradient(90deg, #e08b57, #ff6e82)"
    : "linear-gradient(90deg, #56b8ad, #7fe7d4)";
  elements.batteryTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
  elements.missionClock.textContent = clock(state.time);
  elements.positionReadout.textContent = `${state.receiver.x.toFixed(2)} / ${state.receiver.y.toFixed(2)}`;

  const selected = state.signals[state.selectedIndex];
  const readiness = state.runtime === "ready";
  const masked = state.weather > 0.52;
  elements.mapRssi.textContent = readiness || !selected ? "--" : `${Math.round(selected.strength)}%`;
  elements.mapMode.textContent = readiness
    ? "STANDBY"
    : masked
      ? "WHITEOUT"
      : state.unstable
        ? "MOTION NOISE"
        : state.runtime === "paused"
          ? "HOLD"
          : "SEARCH";

  if (readiness) {
    elements.scopeFreq.textContent = "---.- Hz";
    elements.scopeDoppler.textContent = "±0.0 Hz";
  } else if (masked) {
    elements.scopeFreq.textContent = "MASKED";
    elements.scopeDoppler.textContent = `${state.doppler >= 0 ? "+" : ""}${state.doppler.toFixed(1)} Hz`;
  } else {
    elements.scopeFreq.textContent = `${state.frequency.toFixed(1)} Hz`;
    elements.scopeDoppler.textContent = `${state.doppler >= 0 ? "+" : ""}${state.doppler.toFixed(1)} Hz`;
  }
  elements.scopeState.className = "scope-state";
  if (state.unstable) {
    elements.scopeState.classList.add("storm");
    elements.scopeState.textContent = "UNSTABLE";
  } else if (masked && !readiness) {
    elements.scopeState.classList.add("storm");
    elements.scopeState.textContent = "MASKED";
  } else if (state.bursting && !readiness) {
    elements.scopeState.classList.add("active");
    elements.scopeState.textContent = "BURST";
  } else {
    elements.scopeState.textContent = "IDLE";
  }

  if (state.weather > 0.12 && !readiness) {
    elements.weatherPill.classList.add("storm");
    elements.weatherText.textContent = `白障 · 遮挡 ${Math.round(state.weather * 100)}%`;
  } else {
    elements.weatherPill.classList.remove("storm");
    elements.weatherText.textContent = "风速 11 m/s";
  }

  state.channelEls.forEach((entry, index) => {
    const signal = state.signals[index];
    const source = state.caseData.sources[index];
    const isSelected = index === state.selectedIndex;
    const strength = readiness ? 0 : signal?.strength ?? 0;
    entry.rssi.textContent = readiness ? "--" : `${Math.round(strength)}%`;
    entry.bar.style.width = `${strength}%`;
    if (readiness) {
      entry.freq.textContent = "---.-";
      entry.burst.textContent = "IDLE";
      entry.burst.classList.remove("active");
      entry.reading.textContent = "等待开始";
      return;
    }
    entry.freq.textContent = isSelected
      ? masked
        ? "MASK"
        : state.frequency.toFixed(1)
      : "—";
    const active = isBursting(source, state.time);
    entry.burst.textContent = active ? "BURST" : "WAIT";
    entry.burst.classList.toggle("active", active && !masked);
    if (state.runtime === "paused") {
      entry.reading.textContent = "冻结 / 线索不变";
    } else if (isSelected && state.unstable) {
      entry.reading.textContent = "疾行噪声 / 频差失稳";
    } else if (masked) {
      entry.reading.textContent = "风雪掩蔽";
    } else if (isSelected) {
      entry.reading.textContent = "载波锁定";
    } else {
      entry.reading.textContent = "点选调谐";
    }
  });
}

function hideInterruptions() {
  elements.startScreen.hidden = true;
  elements.pauseScreen.hidden = true;
  elements.submitScreen.hidden = true;
  elements.resultScreen.hidden = true;
  elements.deadScreen.hidden = true;
}

async function startGame() {
  if (state.runtime !== "ready") return;
  try {
    await audio.enable();
  } catch {
    showToast("浏览器未允许 Web Audio，画面线索仍可继续使用。");
  }
  hideInterruptions();
  state.runtime = "running";
  state.keys.clear();
  state.lastTick = performance.now();
  syncRuntimeUi();
  showToast("接收机上线。停稳读取频点，移动观察多普勒频差。");
}

function pauseGame() {
  if (state.runtime !== "running") return;
  state.runtime = "paused";
  state.keys.clear();
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.unstable = false;
  syncRuntimeUi();
  audio.update({
    running: false,
    frequency: state.frequency,
    strength: state.signals[state.selectedIndex]?.strength ?? 0,
    bursting: state.bursting,
    whiteout: state.weather,
    unstable: false,
    paused: true
  });
}

async function resumeGame() {
  if (state.runtime !== "paused") return;
  try {
    await audio.enable();
  } catch {
    showToast("音频未启动，继续使用画面线索。");
  }
  elements.pauseScreen.hidden = true;
  state.runtime = "running";
  state.lastTick = performance.now();
  syncRuntimeUi();
}

function depleteGame() {
  if (state.runtime === "depleted" || state.runtime === "submitted") return;
  state.runtime = "depleted";
  state.keys.clear();
  state.velocity.x = 0;
  state.velocity.y = 0;
  elements.pauseScreen.hidden = true;
  elements.submitScreen.hidden = true;
  elements.deadScreen.hidden = false;
  syncRuntimeUi();
  audio.update({
    running: false,
    frequency: state.frequency,
    strength: 0,
    bursting: false,
    whiteout: state.weather,
    unstable: false,
    paused: true
  });
}

function restartSameSeed(autoStart = true) {
  const seed = state.caseData?.seed || elements.startSeed.value;
  hideInterruptions();
  initializeCase(seed);
  refreshSignals();
  renderLiveUi();
  if (autoStart) {
    startGame();
  } else {
    elements.startScreen.hidden = false;
  }
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - state.lastTick) / 1000));
  state.lastTick = now;
  if (state.runtime === "running") tick(dt);

  if (now - state.lastUi > 60) {
    renderLiveUi();
    state.lastUi = now;
  }

  const visualActive = state.runtime !== "ready";
  world.drawIce({
    caseData: state.caseData,
    receiver: state.receiver,
    velocity: state.velocity,
    trail: state.trail,
    selectedIndex: state.selectedIndex,
    signals: state.signals,
    time: state.time,
    weather: state.weather,
    bursting: state.bursting,
    unstable: state.unstable,
    running: visualActive
  });
  world.drawScope({
    time: state.time,
    frequency: state.frequency,
    doppler: state.doppler,
    strength: state.signals[state.selectedIndex]?.strength ?? 0,
    bursting: state.bursting,
    weather: state.weather,
    unstable: state.unstable,
    color: currentSource().color,
    running: visualActive
  });
  window.requestAnimationFrame(frame);
}

function valueLabel(dimension, value) {
  if (!value) return "未选择";
  if (dimension === "sector") {
    const sector = getSector(value);
    return sector ? `${sector.short} · ${sector.label}` : value;
  }
  if (dimension === "frequency") {
    const band = getBand(value);
    return band ? `${band.id} · ${band.label}（${band.range}）` : value;
  }
  const cadence = getCadence(value);
  return cadence ? cadence.label : value;
}

function renderAnswerForm() {
  elements.answerGrid.innerHTML = state.caseData.sources.map((source, sourceIndex) => `
    <section class="answer-source" style="--source-color:${source.color}">
      <div class="answer-source-head">
        <i></i>
        <strong>${source.name}</strong>
        <span>CH ${source.channel}</span>
      </div>
      <div class="answer-fields">
        ${[
          ["sector", "所在扇区"],
          ["band", "载波频段"],
          ["cadence", "起报周期"]
        ].map(([dimension, label]) => `
          <div class="answer-field">
            <label for="answer-${sourceIndex}-${dimension}">${label}</label>
            <select
              id="answer-${sourceIndex}-${dimension}"
              name="source-${sourceIndex}-${dimension}"
              data-source="${sourceIndex}"
              data-dimension="${dimension}"
              required
            >
              <option value="">请选择</option>
              ${DIMENSION_CHOICES[dimension].map((choice) => `
                <option value="${choice.value}"${state.answerDraft[sourceIndex][dimension] === choice.value ? " selected" : ""}>
                  ${choice.label}
                </option>
              `).join("")}
            </select>
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");
  updateFormProgress();
}

function updateFormProgress() {
  const filled = state.answerDraft.flatMap((answer) => Object.values(answer)).filter(Boolean).length;
  elements.formProgress.textContent = `${filled} / 9 项已填写`;
  elements.confirmSubmitBtn.disabled = filled !== 9;
}

function openSubmit() {
  if (state.runtime !== "running" && state.runtime !== "paused") return;
  state.answerReturnRuntime = state.runtime;
  state.runtime = "answering";
  state.keys.clear();
  state.velocity.x = 0;
  state.velocity.y = 0;
  state.unstable = false;
  elements.pauseScreen.hidden = true;
  elements.submitScreen.hidden = false;
  renderAnswerForm();
  syncRuntimeUi();
  audio.update({
    running: false,
    frequency: state.frequency,
    strength: state.signals[state.selectedIndex]?.strength ?? 0,
    bursting: state.bursting,
    whiteout: state.weather,
    unstable: false,
    paused: true
  });
}

async function closeSubmit() {
  if (state.runtime !== "answering") return;
  elements.submitScreen.hidden = true;
  if (state.answerReturnRuntime === "running") {
    state.runtime = "paused";
    await resumeGame();
  } else {
    state.runtime = "paused";
    syncRuntimeUi();
  }
}

function submitAnswers(event) {
  event.preventDefault();
  const filled = state.answerDraft.flatMap((answer) => Object.values(answer)).filter(Boolean).length;
  if (filled !== 9) {
    showToast("还有判断项未填写。");
    return;
  }
  const result = evaluateAnswers(state.caseData, state.answerDraft);
  state.runtime = "submitted";
  state.keys.clear();
  state.velocity.x = 0;
  state.velocity.y = 0;
  elements.submitScreen.hidden = true;
  elements.resultCard.classList.toggle("failed", !result.passed);
  elements.resultCard.innerHTML = buildResultHtml(result);
  elements.resultScreen.hidden = false;
  syncRuntimeUi();
  audio.update({
    running: false,
    frequency: state.frequency,
    strength: 0,
    bursting: false,
    whiteout: state.weather,
    unstable: false,
    paused: true
  });
  $("#resultRestartBtn").addEventListener("click", () => restartSameSeed(true));
}

function buildResultHtml(result) {
  const elapsed = state.time;
  const batteryLeft = Math.max(0, state.caseData.batterySeconds - elapsed);
  const score = Math.max(0, Math.round(result.score));
  const feedback = result.feedback.length
    ? `<div class="feedback-list">
        ${result.feedback.map((item) => `
          <div class="feedback-item">
            <b>${escapeHtml(item.dimensionLabel)}</b>
            <span>${escapeHtml(item.message)}</span>
          </div>
        `).join("")}
      </div>`
    : "";

  const rows = result.fields.map((field) => {
    const source = state.caseData.sources[field.sourceIndex];
    return `
      <tr>
        <td class="source-cell">${source.name}<span>CH ${source.channel}</span></td>
        <td>${field.dimensionLabel}</td>
        <td>${escapeHtml(valueLabel(field.dimension, field.given))}</td>
        <td>${escapeHtml(valueLabel(field.dimension, field.actual))}</td>
        <td><span class="verdict${field.correct ? "" : " bad"}">${field.correct ? "✓ 一致" : `× −${field.penalty}`}</span></td>
        <td class="evidence-cell">${escapeHtml(field.evidence)}</td>
      </tr>
    `;
  }).join("");

  return `
    <header class="result-hero">
      <div class="result-status">
        <span class="result-glyph">${result.passed ? "✓" : "×"}</span>
        <div>
          <span class="eyebrow">FIELD DETERMINATION · ${escapeHtml(state.caseData.seed)}</span>
          <h2>${result.passed ? "定位成功" : "结论未通过"}</h2>
          <p>
            ${result.passed
              ? "三处声源的全部判断与原始遥测一致，接收任务在电池耗尽前完成。"
              : `九项判断中 ${result.correctCount} 项一致。以下已并列展示你的结论、真实参数及对应证据。`}
          </p>
        </div>
      </div>
      <div class="score-board">
        <div class="score-ring" style="--score:${score}">
          <strong>${score}</strong>
          <small>SCORE</small>
        </div>
        <div class="result-facts">
          <span>正确判断<strong>${result.correctCount} / ${result.total}</strong></span>
          <span>错误扣分<strong>−${result.penalty}</strong></span>
          <span>任务用时<strong>${clock(elapsed)}</strong></span>
          <span>剩余电量<strong>${clock(batteryLeft, false)}</strong></span>
        </div>
      </div>
    </header>
    ${feedback}
    <div class="result-table-wrap">
      <h3>逐项判断 / 实测证据</h3>
      <table class="result-table">
        <thead>
          <tr>
            <th>对应声源</th>
            <th>判断维度</th>
            <th>你的判断</th>
            <th>真实参数</th>
            <th>判定</th>
            <th>对应证据（时间 / 频段）</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <footer class="result-footer">
      <p>同一 seed 重开将复现完全相同的声音参数、发报顺序与扣分规则。<br />本页参数仅在提交后生成。</p>
      <div class="transport-buttons">
        <button class="control primary" id="resultRestartBtn" type="button">同 seed 重开</button>
      </div>
    </footer>
  `;
}

function launchWithSeed() {
  const seed = elements.startSeed.value.trim() || "AURORA-774";
  initializeCase(seed);
  refreshSignals();
  renderLiveUi();
  startGame();
}

function bindEvents() {
  elements.launchBtn.addEventListener("click", launchWithSeed);
  elements.startSeed.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      launchWithSeed();
    }
  });
  elements.randomSeedBtn.addEventListener("click", () => {
    const random = Math.floor(1000 + Math.random() * 9000);
    elements.startSeed.value = `POLAR-${random}`;
  });

  elements.startBtn.addEventListener("click", startGame);
  elements.pauseBtn.addEventListener("click", () => {
    if (state.runtime === "running") pauseGame();
    else if (state.runtime === "paused") resumeGame();
  });
  elements.resumeBtn.addEventListener("click", resumeGame);
  elements.pauseSubmitBtn.addEventListener("click", openSubmit);
  elements.submitBtn.addEventListener("click", openSubmit);
  elements.closeSubmitBtn.addEventListener("click", closeSubmit);
  elements.resetBtn.addEventListener("click", () => {
    restartSameSeed(true);
    showToast("已用同一 seed 重置：发报顺序与扣分规则保持不变。");
  });
  elements.deadRestartBtn.addEventListener("click", () => restartSameSeed(true));

  elements.answerForm.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-dimension]");
    if (!select) return;
    const sourceIndex = Number(select.dataset.source);
    const dimension = select.dataset.dimension;
    state.answerDraft[sourceIndex][dimension] = select.value;
    updateFormProgress();
  });
  elements.answerForm.addEventListener("submit", submitAnswers);

  elements.channelList.addEventListener("click", (event) => {
    const card = event.target.closest(".channel-card");
    if (card) tuneChannel(Number(card.dataset.index));
  });
  elements.channelList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".channel-card");
    if (!card) return;
    event.preventDefault();
    tuneChannel(Number(card.dataset.index));
  });
  elements.evidenceList.addEventListener("click", (event) => {
    const item = event.target.closest(".evidence-item");
    if (item) tuneChannel(Number(item.dataset.source));
  });

  elements.replayBtn.addEventListener("click", () => {
    if (!state.lastReplay) {
      showToast("尚无清晰的末次起报可回放。");
      return;
    }
    const replay = state.lastReplay;
    audio.replayBurst(replay.event.carrierHz, state.caseData.seedHash ^ replay.sourceIndex).catch(() => {
      showToast("浏览器未允许音频回放。");
    });
    showToast(`回放存档：${replay.channel} · ${clock(replay.time)} · ${replay.event.carrierHz} Hz。时钟与线索不变。`);
  });

  const moveTarget = (event) => {
    if (state.runtime !== "running") return;
    const rect = elements.iceCanvas.getBoundingClientRect();
    state.target = {
      x: Math.min(0.97, Math.max(0.03, (event.clientX - rect.left) / rect.width)),
      y: Math.min(0.94, Math.max(0.06, (event.clientY - rect.top) / rect.height))
    };
  };
  elements.iceCanvas.addEventListener("pointerdown", (event) => {
    if (state.runtime !== "running") return;
    state.pointerDown = true;
    elements.iceCanvas.setPointerCapture?.(event.pointerId);
    moveTarget(event);
  });
  elements.iceCanvas.addEventListener("pointermove", (event) => {
    if (state.pointerDown) moveTarget(event);
  });
  elements.iceCanvas.addEventListener("pointerup", () => {
    state.pointerDown = false;
  });
  elements.iceCanvas.addEventListener("pointercancel", () => {
    state.pointerDown = false;
  });

  const movementCodes = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD",
    "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight",
    "ShiftLeft", "ShiftRight"
  ]);
  window.addEventListener("keydown", (event) => {
    const typing = event.target.matches("input, select, textarea, button");
    if (typing) return;
    if (event.code === "Space") {
      if (state.runtime === "running" || state.runtime === "paused") {
        event.preventDefault();
        if (state.runtime === "running") pauseGame();
        else resumeGame();
      }
      return;
    }
    if (event.code === "Digit1" || event.code === "Digit2" || event.code === "Digit3") {
      tuneChannel(Number(event.code.slice(-1)) - 1);
      return;
    }
    if (!movementCodes.has(event.code) || state.runtime !== "running") return;
    event.preventDefault();
    state.keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => {
    state.keys.delete(event.code);
  });
  window.addEventListener("blur", () => {
    state.keys.clear();
    state.pointerDown = false;
    if (state.runtime === "running") pauseGame();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.runtime === "running") pauseGame();
  });
}

bindEvents();
initializeCase(elements.startSeed.value);
refreshSignals();
renderLiveUi();
window.requestAnimationFrame(frame);
