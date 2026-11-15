import {
  CHECK_DIMENSIONS,
  DIRECTIONS,
  DISTANCES,
  ORDER_OPTIONS,
  applyMarkCheck,
  createCase,
  evaluateSubmission,
} from "./engine.js";
import {
  CLIP_SECONDS,
  createPlaybackContext,
  renderAllClues,
} from "./audio.js";
import { drawWaveform } from "./waveform.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const screens = {
  briefing: $("#briefingScreen"),
  investigation: $("#investigationScreen"),
  result: $("#resultScreen"),
};

const audioCache = new Map();

const state = {
  runToken: 0,
  phase: "briefing",
  caseData: null,
  answers: {},
  checksRemaining: 0,
  verifiedRows: new Set(),
  activeClueId: null,
  buffers: new Map(),
  audioContext: null,
  waveformCanvases: new Map(),
  playback: {
    source: null,
    isPlaying: false,
    offset: 0,
    startedAt: 0,
    frame: 0,
  },
  toastTimer: 0,
};

function setScreen(name) {
  state.phase = name;
  for (const [screenName, element] of Object.entries(screens)) {
    element.hidden = screenName !== name;
  }
  $("#topbar").hidden = name === "briefing";
}

function showLoading(done, total, label = "") {
  const overlay = $("#loadingOverlay");
  overlay.hidden = false;
  const percentage = total ? Math.round((done / total) * 100) : 0;
  $("#synthesisBar").style.width = `${percentage}%`;
  $("#loadingText").textContent = label
    ? `已合成 ${done} / ${total} · ${label}`
    : "准备 Web Audio 渲染器…";
  $$(".synthesis-dots span").forEach((dot, index) => {
    dot.classList.toggle("is-ready", index < done);
  });
}

function hideLoading() {
  $("#loadingOverlay").hidden = true;
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function hideToast() {
  clearTimeout(state.toastTimer);
  $("#toast").hidden = true;
}

function updateSeedUrl(seed) {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  window.history.replaceState({}, "", url);
}

function getAudioContext() {
  if (!state.audioContext) {
    state.audioContext = createPlaybackContext();
  }
  return state.audioContext;
}

async function beginCase(rawSeed) {
  const token = ++state.runToken;
  hideToast();
  stopPlayback(true);
  const seed = String(rawSeed ?? "").trim() || "ECHO-0417";
  const caseData = createCase(seed);
  state.caseData = caseData;
  state.answers = Object.fromEntries(
    caseData.clues.map((clue) => [
      clue.id,
      { order: "", direction: "", distance: "" },
    ]),
  );
  state.checksRemaining = caseData.checksPerCase;
  state.verifiedRows.clear();
  state.activeClueId = caseData.clues[0].id;
  state.buffers = new Map();
  state.waveformCanvases.clear();
  const cachedBuffers = audioCache.get(caseData.seed);

  updateSeedUrl(caseData.seed);
  $("#caseNumber").textContent = caseData.caseNumber;
  $("#seedStamp").textContent = `SEED ${caseData.seed}`;
  $("#phaseIndicator").innerHTML =
    '<span class="phase-dot"></span><span>调查进行中</span>';
  setScreen("investigation");
  renderInvestigation();
  showLoading(
    cachedBuffers ? caseData.clues.length : 0,
    caseData.clues.length,
    cachedBuffers ? "载入同一 seed 的声证" : "",
  );
  window.scrollTo({ top: 0, behavior: "auto" });

  try {
    const context = getAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
    if (token !== state.runToken) return;
    if (cachedBuffers) {
      state.buffers = cachedBuffers;
      hideLoading();
      drawAllWaveforms();
      updateTransportUi();
      return;
    }
    const buffers = await renderAllClues(
      caseData,
      (done, total, clue) => {
        if (token !== state.runToken) return;
        showLoading(done, total, clue ? `声证 ${clue.label}` : "");
      },
    );
    if (token !== state.runToken) return;
    state.buffers = buffers;
    audioCache.set(caseData.seed, buffers);
    if (audioCache.size > 8) {
      audioCache.delete(audioCache.keys().next().value);
    }
    hideLoading();
    drawAllWaveforms();
    updateTransportUi();
  } catch (error) {
    console.error(error);
    if (token !== state.runToken) return;
    hideLoading();
    setScreen("briefing");
    showToast(`合成失败：${error.message}`, true);
  }
}

function renderInvestigation() {
  renderEvidenceCards();
  renderInferenceRows();
  renderCheckBudget();
  hideCheckMessage();
  updateCompletion();
  bindInvestigationEvents();
  updateSelectionUi();
  updateTransportUi();
}

function renderEvidenceCards() {
  const caseData = state.caseData;
  const grid = $("#evidenceGrid");
  grid.innerHTML = caseData.clues
    .map(
      (clue, index) => `
        <article class="clue-card" data-clue-id="${clue.id}">
          <div class="clue-card-head">
            <div class="clue-identity">
              <span class="clue-glyph">${clue.label}</span>
              <div class="clue-identity-text">
                <span class="clue-channel">CHANNEL ${String(index + 1).padStart(2, "0")}</span>
                <strong>声证 ${clue.label}</strong>
              </div>
            </div>
            <button class="clue-play" type="button" data-play-clue="${clue.id}"
              aria-label="播放声证 ${clue.label}">
              <span class="mini-play" aria-hidden="true"></span>
              <span>监听</span>
            </button>
          </div>
          <div class="clue-wave">
            <canvas data-wave-clue="${clue.id}" aria-label="声证 ${clue.label} 波形"></canvas>
            <span class="wave-index">WAVE / ${clue.id.slice(-1).padStart(2, "0")}</span>
          </div>
          <div class="clue-foot">
            <span class="clue-state" data-clue-state="${clue.id}">待判读</span>
            <span>00:00 — 00:04.80</span>
          </div>
          <span class="clue-progress" aria-hidden="true"><span></span></span>
        </article>
      `,
    )
    .join("");

  state.waveformCanvases.clear();
  $$("[data-wave-clue]", grid).forEach((canvas) => {
    state.waveformCanvases.set(canvas.dataset.waveClue, canvas);
    drawWaveform(canvas, state.buffers.get(canvas.dataset.waveClue));
  });
}

function renderInferenceRows() {
  const body = $("#inferenceBody");
  body.innerHTML = state.caseData.clues
    .map(
      (clue) => `
        <tr data-row-clue="${clue.id}">
          <td class="row-label">${clue.label}</td>
          <td>
            <select data-field="order" data-clue-id="${clue.id}"
              aria-label="声证 ${clue.label} 的原序位">
              <option value="">—</option>
              ${ORDER_OPTIONS.map((value) => `<option value="${value}">${value}</option>`).join("")}
            </select>
          </td>
          <td>
            <select data-field="direction" data-clue-id="${clue.id}"
              aria-label="声证 ${clue.label} 的方位">
              <option value="">—</option>
              ${DIRECTIONS.map((value) => `<option value="${value}">${value}</option>`).join("")}
            </select>
          </td>
          <td>
            <select data-field="distance" data-clue-id="${clue.id}"
              aria-label="声证 ${clue.label} 的距离">
              <option value="">—</option>
              ${DISTANCES.map((value) => `<option value="${value}">${value}</option>`).join("")}
            </select>
          </td>
          <td>
            <button class="mark-check" type="button" data-check-clue="${clue.id}"
              aria-label="检查声证 ${clue.label} 的标记" title="检查此标记">检</button>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderCheckBudget() {
  const total = state.caseData.checksPerCase;
  const tokens = $("#checkTokens");
  tokens.innerHTML = Array.from(
    { length: total },
    (_, index) =>
      `<span class="check-token${index >= state.checksRemaining ? " is-spent" : ""}"></span>`,
  ).join("");
  tokens.setAttribute(
    "aria-label",
    `剩余 ${state.checksRemaining} 次检查机会，共 ${total} 次`,
  );
  $$(".mark-check").forEach((button) => {
    const clueId = button.dataset.checkClue;
    const passed = state.verifiedRows.has(clueId);
    button.disabled = passed || state.checksRemaining === 0;
    button.classList.toggle("is-pass", passed);
    button.textContent = passed ? "✓" : "检";
  });
}

function guessFor(clueId) {
  return state.answers[clueId] ?? { order: "", direction: "", distance: "" };
}

function isRowComplete(clueId) {
  const guess = guessFor(clueId);
  return Boolean(guess.order && guess.direction && guess.distance);
}

function updateCompletion() {
  const fields = state.caseData.clues.flatMap((clue) => {
    const guess = guessFor(clue.id);
    return [guess.order, guess.direction, guess.distance];
  });
  const complete = fields.filter(Boolean).length;
  const total = fields.length;
  $("#completionText").textContent = `${complete} / ${total}`;
  $("#completionBar").style.width = `${(complete / total) * 100}%`;
  $("#submitButton").disabled = complete !== total;
  $("#submitNote").textContent =
    complete === total
      ? "所有字段已填写。提交前不会揭示真实参数"
      : "提交前不会揭示真实参数";

  for (const clue of state.caseData.clues) {
    const cardState = $(`[data-clue-state="${clue.id}"]`);
    if (!cardState) continue;
    const verified = state.verifiedRows.has(clue.id);
    const drafted =
      guessFor(clue.id).order ||
      guessFor(clue.id).direction ||
      guessFor(clue.id).distance;
    cardState.textContent = verified ? "标记已通过" : drafted ? "判读草稿" : "待判读";
    cardState.className = `clue-state${verified ? " is-verified" : drafted ? " has-draft" : ""}`;
  }
}

function bindInvestigationEvents() {
  $("#evidenceGrid").onclick = (event) => {
    const playButton = event.target.closest("[data-play-clue]");
    if (playButton) {
      event.stopPropagation();
      const clueId = playButton.dataset.playClue;
      if (clueId !== state.activeClueId) {
        selectClue(clueId);
        playActive(0);
      } else {
        togglePlayback();
      }
      return;
    }
    const card = event.target.closest("[data-clue-id]");
    if (card) {
      selectClue(card.dataset.clueId);
    }
  };

  $("#inferenceBody").onchange = handleFieldChange;
  $("#inferenceBody").onclick = (event) => {
    const button = event.target.closest("[data-check-clue]");
    if (button) {
      handleCheck(button.dataset.checkClue);
    }
  };
}

function syncInferenceUi() {
  for (const clue of state.caseData.clues) {
    const guess = guessFor(clue.id);
    for (const field of ["order", "direction", "distance"]) {
      const select = $(
        `select[data-clue-id="${clue.id}"][data-field="${field}"]`,
      );
      if (!select) continue;
      select.value = String(guess[field] ?? "");
      select.classList.toggle("has-value", Boolean(select.value));
      select.disabled = state.verifiedRows.has(clue.id);
    }
    const row = $(`[data-row-clue="${clue.id}"]`);
    if (row) {
      row.classList.toggle("is-row-verified", state.verifiedRows.has(clue.id));
    }
  }
}

function handleFieldChange(event) {
  const select = event.target.closest("select[data-field]");
  if (!select) return;
  const clueId = select.dataset.clueId;
  const field = select.dataset.field;
  if (!state.answers[clueId] || state.verifiedRows.has(clueId)) return;
  const previous = state.answers[clueId][field];
  const next = select.value;

  if (field === "order" && next) {
    const occupied = state.caseData.clues.find(
      (clue) => clue.id !== clueId && state.answers[clue.id].order === next,
    );
    if (occupied && state.verifiedRows.has(occupied.id)) {
      select.value = String(previous ?? "");
      showToast("该原序位已被通过检查的标记占用。", true);
      return;
    }
    if (occupied) {
      state.answers[occupied.id].order = previous;
    }
  }

  state.answers[clueId][field] = next;
  syncInferenceUi();
  updateCompletion();
  hideCheckMessage();
}

function handleCheck(clueId) {
  if (state.verifiedRows.has(clueId)) return;
  if (state.checksRemaining <= 0) {
    showToast("检查机会已用尽，仍可提交当前结论。", true);
    return;
  }
  if (!isRowComplete(clueId)) {
    showToast("请先填完这段声证的原序、方位与距离。", true);
    return;
  }

  const result = applyMarkCheck(
    state.caseData,
    state.checksRemaining,
    clueId,
    guessFor(clueId),
  );
  state.checksRemaining = result.checksRemaining;
  if (result.correct) {
    state.verifiedRows.add(clueId);
  }
  renderCheckBudget();
  syncInferenceUi();
  updateCompletion();
  showCheckMessage(result);
}

function showCheckMessage(result) {
  const element = $("#checkMessage");
  element.hidden = false;
  element.classList.toggle("is-pass", result.correct);
  if (result.correct) {
    element.innerHTML = `
      <strong>检查通过 · 标记与声学线索一致</strong>
      <span>该行的原序、方位与距离均已确认，不消耗检查机会。</span>
    `;
    return;
  }
  const dimension = CHECK_DIMENSIONS[result.wrongDimension];
  const exhausted =
    state.checksRemaining === 0
      ? "<br /><span>检查机会已用尽。你仍可直接提交当前结论。</span>"
      : "";
  element.innerHTML = `
    <strong>检查未通过 · ${dimension.label}</strong>
    <span>${dimension.hint}${exhausted}</span>
  `;
  showToast(`检查未通过：${dimension.label}。已消耗 1 次检查机会。`, true);
}

function hideCheckMessage() {
  $("#checkMessage").hidden = true;
}

function selectClue(clueId) {
  if (!state.caseData?.clues.some((clue) => clue.id === clueId)) return;
  if (state.activeClueId === clueId) {
    updateSelectionUi();
    return;
  }
  stopPlayback(true);
  state.activeClueId = clueId;
  state.playback.offset = 0;
  updateSelectionUi();
  drawAllWaveforms();
  updateTransportUi();
}

function updateSelectionUi() {
  $$(".clue-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.clueId === state.activeClueId);
    card.classList.toggle(
      "is-verified",
      state.verifiedRows.has(card.dataset.clueId),
    );
  });
}

function activeClue() {
  return (
    state.caseData?.clues.find((clue) => clue.id === state.activeClueId) ?? null
  );
}

function activeBuffer() {
  return state.activeClueId ? state.buffers.get(state.activeClueId) : null;
}

async function playActive(offset = state.playback.offset) {
  if (!state.caseData || !state.activeClueId) return;
  const clueId = state.activeClueId;
  const buffer = state.buffers.get(clueId);
  if (!buffer) {
    showToast("声证仍在合成，请稍候。", true);
    return;
  }

  pausePlayback(false);
  const context = getAudioContext();
  if (context.state === "suspended") {
    await context.resume();
  }
  if (state.activeClueId !== clueId) return;

  const safeOffset = offset >= buffer.duration - 0.02 ? 0 : Math.max(0, offset);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start(0, safeOffset);
  state.playback.source = source;
  state.playback.isPlaying = true;
  state.playback.startedAt = context.currentTime - safeOffset;
  state.playback.offset = safeOffset;
  refreshPlaybackClasses();
  cancelAnimationFrame(state.playback.frame);
  state.playback.frame = requestAnimationFrame(playbackTick);
}

function pausePlayback(reset = false) {
  const playback = state.playback;
  if (playback.source) {
    const source = playback.source;
    playback.source = null;
    try {
      source.stop();
    } catch {}
    try {
      source.disconnect();
    } catch {}
  }
  if (playback.isPlaying && state.audioContext) {
    const duration = activeBuffer()?.duration ?? CLIP_SECONDS;
    playback.offset = Math.min(
      duration,
      Math.max(0, state.audioContext.currentTime - playback.startedAt),
    );
  }
  playback.isPlaying = false;
  cancelAnimationFrame(playback.frame);
  if (reset) playback.offset = 0;
  refreshPlaybackClasses();
  updateTransportUi();
  drawActiveWaveform();
}

function stopPlayback(reset = true) {
  pausePlayback(reset);
}

function togglePlayback() {
  if (state.playback.isPlaying) {
    pausePlayback(false);
  } else {
    playActive(state.playback.offset);
  }
}

function playbackTick() {
  if (!state.playback.isPlaying) return;
  const context = state.audioContext;
  const duration = activeBuffer()?.duration ?? CLIP_SECONDS;
  const elapsed = Math.min(
    duration,
    Math.max(0, context.currentTime - state.playback.startedAt),
  );
  state.playback.offset = elapsed;
  updateTransportUi(elapsed);
  drawActiveWaveform(elapsed / duration);
  if (elapsed >= duration) {
    state.playback.isPlaying = false;
    state.playback.offset = 0;
    state.playback.source = null;
    refreshPlaybackClasses();
    updateTransportUi();
    return;
  }
  state.playback.frame = requestAnimationFrame(playbackTick);
}

function refreshPlaybackClasses() {
  const playing = state.playback.isPlaying;
  $("#playPauseButton").classList.toggle("is-playing", playing);
  $("#playPauseButton").setAttribute(
    "aria-label",
    playing ? "暂停当前声证" : "播放当前声证",
  );
  $("#pauseButton").disabled = !playing;
  $$(".clue-card").forEach((card) => {
    const active = card.dataset.clueId === state.activeClueId;
    card.classList.toggle("is-playing", active && playing);
    const playLabel = $(".clue-play span:last-child", card);
    if (playLabel) playLabel.textContent = active && playing ? "暂停" : "监听";
  });
}

function updateTransportUi(elapsed = state.playback.offset) {
  const clue = activeClue();
  if (!clue) return;
  const buffer = activeBuffer();
  const duration = buffer?.duration ?? CLIP_SECONDS;
  const progress = Math.max(0, Math.min(1, elapsed / duration));
  $("#activeClueLabel").textContent = `声证 ${clue.label}`;
  $("#currentTime").textContent = formatAudioTime(elapsed);
  $("#durationTime").textContent = formatAudioTime(duration);
  $("#transportProgress").style.width = `${progress * 100}%`;
  $$(".clue-card").forEach((card) => {
    const bar = $(".clue-progress span", card);
    if (!bar) return;
    bar.style.width =
      card.dataset.clueId === state.activeClueId ? `${progress * 100}%` : "0";
  });
  refreshPlaybackClasses();
}

function drawActiveWaveform(progress) {
  const canvas = state.waveformCanvases.get(state.activeClueId);
  if (!canvas) return;
  const buffer = activeBuffer();
  const ratio =
    progress ??
    (buffer ? state.playback.offset / buffer.duration : 0);
  drawWaveform(canvas, buffer, {
    active: true,
    progress: ratio,
    complete: !!buffer && state.playback.offset >= buffer.duration - 0.02,
  });
}

function drawAllWaveforms() {
  for (const clue of state.caseData?.clues ?? []) {
    const canvas = state.waveformCanvases.get(clue.id);
    if (!canvas) continue;
    const buffer = state.buffers.get(clue.id);
    const active = clue.id === state.activeClueId;
    const progress =
      active && buffer ? Math.min(1, state.playback.offset / buffer.duration) : 0;
    drawWaveform(canvas, buffer, { active, progress });
  }
}

function formatAudioTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor((safe % 60) * 100);
  const wholeSeconds = Math.floor(remainder / 100);
  const hundredths = remainder % 100;
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function dimensionLabel(key) {
  return CHECK_DIMENSIONS[key]?.label ?? key;
}

function renderResult(evaluation) {
  const caseData = state.caseData;
  const overall = evaluation.overallCorrect;
  const firstWrong = evaluation.wrongDimensions[0];
  const wrongList = evaluation.wrongDimensions
    .map((key) => `${dimensionLabel(key)} ${evaluation.totals[key]}/6`)
    .join(" · ");

  $("#verdictTitle").textContent = overall
    ? "时间线完整复原"
    : `结论偏差 · ${dimensionLabel(firstWrong)}`;
  $("#verdictCopy").textContent = overall
    ? "六段声证的原序位、声源方位与距离层级全部吻合。真实声场参数现已解锁，可与你的判断逐项核对。"
    : `六段声证中有 ${evaluation.correctRows} 行完全吻合。具体偏差维度：${wrongList}。下方已将每个判断与真实声源、时间和频段并列。`;
  $("#verdictScore").textContent = `${evaluation.correctRows} / 6`;
  $("#verdictSeal").className = `verdict-seal ${overall ? "is-correct" : "is-wrong"}`;

  const metrics = [
    {
      label: "TIME / 原序位",
      value: evaluation.totals.timeline,
      perfect: evaluation.totals.timeline === 6,
    },
    {
      label: "DIRECTION / 方位",
      value: evaluation.totals.direction,
      perfect: evaluation.totals.direction === 6,
    },
    {
      label: "DISTANCE / 距离",
      value: evaluation.totals.distance,
      perfect: evaluation.totals.distance === 6,
    },
    {
      label: "CHECKS / 剩余检查",
      value: state.checksRemaining,
      perfect: null,
      suffix: `/ ${caseData.checksPerCase}`,
    },
  ];

  $("#resultMetrics").innerHTML = metrics
    .map(
      (metric) => `
        <div class="metric ${
          metric.perfect === true
            ? "is-perfect"
            : metric.perfect === false
              ? "is-off"
              : ""
        }">
          <span>${metric.label}</span>
          <strong>${metric.value}${metric.suffix ? "" : " / 6"}</strong>
          ${metric.suffix ? `<small>${metric.suffix}</small>` : ""}
        </div>
      `,
    )
    .join("");

  $("#comparisonBody").innerHTML = evaluation.rows
    .map((row) => {
      const event = row.event;
      return `
        <tr>
          <td>
            <div class="comparison-id">
              <span>${row.label}</span>
              <div>
                <strong>${event.title}</strong>
                <small>EVIDENCE ${row.label} · ${row.correct ? "全项一致" : "存在偏差"}</small>
              </div>
            </div>
          </td>
          <td>${judgementCell(row.guess.order, event.trueOrder, row.dimensions.timeline)}</td>
          <td>${judgementCell(row.guess.direction, event.direction, row.dimensions.direction)}</td>
          <td>${judgementCell(row.guess.distance, event.distance, row.dimensions.distance)}</td>
          <td class="source-cell">
            ${event.source}
            <small>距事故中心 ${event.distanceMeters} m</small>
          </td>
          <td class="time-cell">${event.time}</td>
          <td class="band-cell">
            ${event.band}
            <span>${event.bandName}</span>
          </td>
        </tr>
      `;
    })
    .join("");

  $("#resultSeed").textContent = caseData.seed;
  const indicator = $("#phaseIndicator");
  indicator.className = `phase-indicator ${overall ? "is-correct" : "is-wrong"}`;
  indicator.innerHTML =
    '<span class="phase-dot"></span><span>结论已封存</span>';
  setScreen("result");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function judgementCell(guess, truth, correct) {
  const safeGuess = guess === "" || guess === null ? "—" : guess;
  return `
    <div class="judgement ${correct ? "is-ok" : "is-off"}">
      <span class="guess">${safeGuess}</span>
      <span aria-hidden="true">→</span>
      <span class="truth">${truth}</span>
      ${correct ? "" : '<mark>偏差</mark>'}
    </div>
  `;
}

function submitInvestigation(event) {
  event.preventDefault();
  if (state.phase !== "investigation") return;
  const completion = state.caseData.clues.every((clue) => isRowComplete(clue.id));
  if (!completion) {
    showToast("请先完成全部 18 个判读字段，再提交结论。", true);
    return;
  }
  const evaluation = evaluateSubmission(state.caseData, state.answers);
  hideToast();
  stopPlayback(true);
  renderResult(evaluation);
}

function restartSameSeed() {
  if (!state.caseData) {
    beginCase($("#seedInput").value);
    return;
  }
  beginCase(state.caseData.seed);
}

function initialize() {
  const querySeed = new URL(window.location.href).searchParams.get("seed");
  if (querySeed) {
    $("#seedInput").value = querySeed;
  }

  $("#seedForm").addEventListener("submit", (event) => {
    event.preventDefault();
    beginCase($("#seedInput").value);
  });
  $("#inferenceForm").addEventListener("submit", submitInvestigation);
  $("#restartSameTop").addEventListener("click", restartSameSeed);
  $("#restartSameBottom").addEventListener("click", restartSameSeed);
  $("#playPauseButton").addEventListener("click", togglePlayback);
  $("#pauseButton").addEventListener("click", () => pausePlayback(false));
  $("#replayButton").addEventListener("click", () => playActive(0));
  $("#legendToggle").addEventListener("click", () => {
    const panel = $("#legendPanel");
    const open = panel.hidden;
    panel.hidden = !open;
    $("#legendToggle").setAttribute("aria-expanded", String(open));
    $("#legendToggle").innerHTML = open
      ? '收起声学判读卡 <span>−</span>'
      : '打开声学判读卡 <span>＋</span>';
  });
  $("#toast").addEventListener("click", () => {
    $("#toast").hidden = true;
  });

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(drawAllWaveforms);
  });
}

initialize();
