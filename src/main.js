import { CalibrationController } from "./calibration.js";
import { buildChart, beatSignature } from "./chart.js";
import { CHART_BEATS, CHART_DURATION, DIFFICULTIES, LANES } from "./config.js";
import { downloadExport, renderProjectAudio } from "./exporter.js";
import {
  createProjectState,
  defaultLaneSettings,
  loadProjectFromStorage,
  normalizeProject,
  saveProjectToStorage,
  validateProject
} from "./project.js";
import { GameRenderer } from "./renderer.js";
import { RhythmSession } from "./session.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  canvas: $("#gameCanvas"),
  startOverlay: $("#startOverlay"),
  pauseOverlay: $("#pauseOverlay"),
  resultOverlay: $("#resultOverlay"),
  judgmentFlash: $("#judgmentFlash"),
  score: $("#scoreValue"),
  combo: $("#comboValue"),
  accuracy: $("#accuracyValue"),
  difficultyLabel: $("#difficultyLabel"),
  sessionStatus: $("#sessionStatus"),
  clockReadout: $("#clockReadout"),
  beatPips: [...$("#beatPips").children],
  transportTime: $("#transportTime"),
  transportDuration: $("#transportDuration"),
  timelineProgress: $("#timelineProgress"),
  playIcon: $("#playIcon"),
  footerStatus: $("#footerStatus"),
  audioClock: $("#audioClock"),
  beatReadout: $("#beatReadout"),
  voiceCount: $("#voiceCount"),
  latencyValue: $("#latencyValue"),
  syncBadge: $("#syncBadge"),
  introNotes: $("#introNotes"),
  laneList: $("#laneList"),
  speedValue: $("#speedValue"),
  difficultySelect: $("#difficultySelect"),
  speedRange: $("#speedRange"),
  transposeRange: $("#transposeRange"),
  transposeValue: $("#transposeValue"),
  loopToggle: $("#loopToggle"),
  metronomeToggle: $("#metronomeToggle"),
  resultGrade: $("#resultGrade"),
  resultScore: $("#resultScore"),
  resultStats: $("#resultStats"),
  resultAccuracy: $("#resultAccuracy"),
  toastStack: $("#toastStack"),
  auditNotes: $("#auditNotes"),
  auditBeats: $("#auditBeats"),
  auditDuration: $("#auditDuration"),
  runAudit: $("#runAudit"),
  projectFileInput: $("#projectFileInput")
};

let project = createProjectState();
const restored = loadProjectFromStorage();
if (restored?.valid) project = restored.project;

const session = new RhythmSession({
  project,
  onEvent: handleSessionEvent
});
const renderer = new GameRenderer(elements.canvas);
renderer.setSession(session);
renderer.setProject(project);

const calibration = new CalibrationController({
  audio: session.audio,
  dialog: $("#calibrationDialog"),
  elements: {
    close: $("#closeCalibration"),
    pad: $("#calibrationPad"),
    apply: $("#applyCalibration"),
    reset: $("#resetCalibration"),
    visual: $("#calibrationVisual"),
    bars: $("#calibrationBars"),
    count: $("#calibrationCount"),
    offset: $("#calibrationOffset"),
    spread: $("#calibrationSpread")
  },
  onApply: (latencyMs) => {
    project.latencyMs = latencyMs;
    elements.latencyValue.textContent = formatLatency(latencyMs);
    showToast(`输入延迟校准为 <b>${formatLatency(latencyMs)}</b>`);
  }
});

buildLaneControls();
bindControls();
applyProjectToControls();
updateChartMeta();
updateHud();
updateTransportReadout();
showStartOverlay();
requestAnimationFrame(renderFrame);

function buildLaneControls() {
  elements.laneList.innerHTML = LANES.map((lane) => `
    <div class="lane-row" data-lane="${lane.id}" style="--lane-color:${lane.color}">
      <div class="lane-key">${lane.key.toUpperCase()}</div>
      <div class="lane-channel">
        <label>
          <span>${lane.name}</span>
          <b>${lane.instrument}</b>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value="${getLane(lane.id).gain}"
          data-gain="${lane.id}"
          aria-label="${lane.name}增益"
        />
      </div>
      <div class="lane-pitch">
        <button type="button" data-pitch-step="-1" data-pitch-lane="${lane.id}" aria-label="${lane.name}降半音">−</button>
        <span data-pitch-value="${lane.id}">${formatPitch(getLane(lane.id).pitch)}</span>
        <button type="button" data-pitch-step="1" data-pitch-lane="${lane.id}" aria-label="${lane.name}升半音">+</button>
      </div>
    </div>
  `).join("");

  for (const input of elements.laneList.querySelectorAll("[data-gain]")) {
    input.addEventListener("input", () => {
      const lane = getLane(input.dataset.gain);
      lane.gain = Number(input.value);
      commitLiveProject();
    });
  }

  for (const button of elements.laneList.querySelectorAll("[data-pitch-step]")) {
    button.addEventListener("click", () => {
      const lane = getLane(button.dataset.pitchLane);
      const step = Number(button.dataset.pitchStep);
      lane.pitch = Math.max(-12, Math.min(12, lane.pitch + step));
      const label = elements.laneList.querySelector(`[data-pitch-value="${lane.id}"]`);
      if (label) label.textContent = formatPitch(lane.pitch);
      commitLiveProject();
    });
  }
}

function bindControls() {
  $("#startButton").addEventListener("click", startGame);
  $("#retryButton").addEventListener("click", startGame);
  $("#resumeButton").addEventListener("click", resumeGame);
  $("#playPause").addEventListener("click", togglePlayback);
  $("#calibrateButton").addEventListener("click", () => calibration.open());
  $("#closeCalibration").addEventListener("click", () => calibration.close());
  $("#saveProject").addEventListener("click", saveProject);
  $("#loadProject").addEventListener("click", (event) => {
    if (event.shiftKey) {
      elements.projectFileInput.click();
      return;
    }
    loadSavedProject({ autoplay: true });
  });
  $("#exportAudio").addEventListener("click", exportAudio);
  $("#runAudit").addEventListener("click", runReloadAudit);
  $("#loopToggle").addEventListener("click", () => {
    project.loop = !project.loop;
    updateToggle(elements.loopToggle, project.loop);
    showToast(project.loop ? "循环已开启" : "循环已关闭，本轮结束后结算");
  });
  $("#metronomeToggle").addEventListener("click", () => {
    project.metronome = !project.metronome;
    updateToggle(elements.metronomeToggle, project.metronome);
  });
  elements.speedRange.addEventListener("input", () => {
    project.speed = Number(elements.speedRange.value);
    elements.speedValue.textContent = `${project.speed.toFixed(1)}×`;
    renderer.setProject(project);
  });
  elements.transposeRange.addEventListener("input", () => {
    project.transpose = Number(elements.transposeRange.value);
    elements.transposeValue.textContent = formatPitch(project.transpose);
    commitLiveProject();
  });
  elements.difficultySelect.addEventListener("change", changeDifficulty);
  $("#resetMixer").addEventListener("click", resetMixer);
  elements.projectFileInput.addEventListener("change", importProjectFile);

  elements.canvas.addEventListener("pointerdown", (event) => {
    if (session.state !== "playing") return;
    const rect = elements.canvas.getBoundingClientRect();
    const geometry = renderer.getGeometry();
    const x = event.clientX - rect.left;
    if (x < geometry.left || x > geometry.left + geometry.laneAreaWidth) return;
    const laneIndex = Math.min(
      3,
      Math.floor((x - geometry.left) / geometry.laneWidth)
    );
    pressLane(LANES[laneIndex].id);
  });

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", handleProjectDrop);
}

function handleKeyDown(event) {
  if (event.repeat || $("#calibrationDialog").open) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (session.state === "idle") startGame();
    else togglePlayback();
    return;
  }
  if (event.code === "KeyP") {
    event.preventDefault();
    togglePlayback();
    return;
  }
  if (event.code === "KeyL") {
    project.loop = !project.loop;
    updateToggle(elements.loopToggle, project.loop);
    return;
  }
  const lane = LANES.find((item) => item.code === event.code);
  if (lane) {
    event.preventDefault();
    pressLane(lane.id);
  }
}

function pressLane(laneId) {
  if (session.state !== "playing") return;
  const result = session.pressLane(laneId);
  if (result.accepted && !result.grade) renderer.flashLane(laneId, "empty");
}

async function startGame() {
  try {
    await session.start();
    elements.startOverlay.classList.add("closing");
    window.setTimeout(() => {
      elements.startOverlay.hidden = true;
      elements.startOverlay.classList.remove("closing");
    }, 260);
    elements.pauseOverlay.hidden = true;
    elements.resultOverlay.hidden = true;
    elements.footerStatus.textContent = "音频时钟运行中";
  } catch (error) {
    showToast(`无法启动音频：${error.message}`);
  }
}

async function resumeGame() {
  try {
    await session.resume();
    elements.pauseOverlay.hidden = true;
    elements.footerStatus.textContent = "音频锚点已重建";
  } catch (error) {
    showToast(`恢复失败：${error.message}`);
  }
}

async function togglePlayback() {
  if (session.state === "playing") {
    await session.pause();
    elements.pauseOverlay.hidden = false;
  } else if (session.state === "paused") {
    await resumeGame();
  } else {
    await startGame();
  }
}

function handleSessionEvent(event) {
  if (event.type === "judgment") {
    updateHud();
    renderer.flashLane(event.laneId, event.grade);
    showJudgment(event);
    return;
  }

  if (event.type === "empty") {
    elements.combo.textContent = 0;
    return;
  }

  if (event.type === "voices") {
    elements.voiceCount.textContent = String(event.count);
    return;
  }

  if (event.type === "state") {
    updateHud();
    updateTransportReadout();
    if (event.state === "paused") {
      elements.sessionStatus.textContent = "TRANSPORT PAUSED";
      elements.syncBadge.innerHTML = "<i></i> FROZEN";
      elements.syncBadge.style.color = "var(--gold)";
      elements.playIcon.textContent = "▶";
      elements.footerStatus.textContent = "暂停：音源已停止，时钟已冻结";
    } else if (event.state === "playing") {
      elements.sessionStatus.textContent = "PLAYING / SYNC LOCKED";
      elements.syncBadge.innerHTML = "<i></i> LOCKED";
      elements.syncBadge.style.color = "";
      elements.playIcon.textContent = "❚❚";
      elements.pauseOverlay.hidden = true;
      elements.footerStatus.textContent = "音频时钟运行中";
    } else if (event.state === "result") {
      elements.sessionStatus.textContent = "SESSION ARCHIVED";
      elements.syncBadge.innerHTML = "<i></i> COMPLETE";
      elements.playIcon.textContent = "▶";
      elements.footerStatus.textContent = "全部音源已释放";
    } else {
      elements.sessionStatus.textContent = "SYSTEM READY";
      elements.syncBadge.innerHTML = "<i></i> READY";
      elements.playIcon.textContent = "▶";
    }
    return;
  }

  if (event.type === "finish") {
    showResults(event.summary);
  }
}

function showJudgment(event) {
  const colors = {
    perfect: "#d8ff3e",
    great: "#53e6d2",
    good: "#ffca67",
    miss: "#ff6b70"
  };
  const flash = elements.judgmentFlash;
  flash.textContent = event.label;
  flash.style.color = colors[event.grade];
  flash.classList.remove("show");
  void flash.offsetWidth;
  flash.classList.add("show");
}

function showResults(summary) {
  elements.resultScore.textContent = String(summary.score).padStart(6, "0");
  elements.resultGrade.textContent = summary.grade;
  elements.resultStats.innerHTML = [
    ["PERFECT", summary.counts.perfect],
    ["GREAT", summary.counts.great],
    ["GOOD", summary.counts.good],
    ["MISS", summary.counts.miss]
  ].map(([label, count]) => `
    <div class="result-stat"><span>${label}</span><b>${count}</b></div>
  `).join("");
  elements.resultAccuracy.textContent = `ACCURACY ${summary.accuracy.toFixed(1)}% · MAX COMBO ${summary.combo}`;
  elements.resultOverlay.hidden = false;
  elements.pauseOverlay.hidden = true;
}

function updateHud() {
  const summary = session.summary();
  elements.score.textContent = String(summary.score).padStart(6, "0");
  elements.combo.innerHTML = `${summary.combo}<small>×</small>`;
  elements.accuracy.innerHTML = `${session.liveAccuracy.toFixed(0)}<small>%</small>`;
}

function updateTransportReadout() {
  const position = session.currentPosition();
  const time = formatTime(position.seconds);
  elements.transportTime.textContent = time;
  elements.clockReadout.textContent = time;
  elements.timelineProgress.style.width = `${position.progress * 100}%`;
  elements.beatReadout.textContent = position.localBeat.toFixed(3);
  elements.audioClock.textContent = session.audio.ctx
    ? `${session.audio.ctx.currentTime.toFixed(3)} s`
    : "—";
  elements.latencyValue.textContent = formatLatency(project.latencyMs);

  const currentPip = Math.floor(position.localBeat) % 4;
  elements.beatPips.forEach((pip, index) => {
    pip.classList.toggle("on", index === currentPip && position.progress > 0);
  });
}

function renderFrame(now) {
  session.tick();
  renderer.render(now);
  updateTransportReadout();
  requestAnimationFrame(renderFrame);
}

async function changeDifficulty() {
  const wasActive = session.state === "playing" || session.state === "paused";
  project.difficulty = elements.difficultySelect.value;
  if (wasActive) await session.stop();
  session.updateProject(project, { rebuild: true });
  renderer.setProject(project);
  updateChartMeta();
  showStartOverlay();
  showToast(`难度切换为 <b>${DIFFICULTIES[project.difficulty].name}</b>，从起点就绪`);
}

function resetMixer() {
  project.lanes = defaultLaneSettings();
  project.transpose = 0;
  elements.transposeRange.value = "0";
  elements.transposeValue.textContent = "0 st";
  for (const lane of project.lanes) {
    const gain = elements.laneList.querySelector(`[data-gain="${lane.id}"]`);
    const pitch = elements.laneList.querySelector(`[data-pitch-value="${lane.id}"]`);
    if (gain) gain.value = lane.gain;
    if (pitch) pitch.textContent = formatPitch(lane.pitch);
  }
  commitLiveProject();
  showToast("每轨增益与音高已重置");
}

function commitLiveProject() {
  renderer.setProject(project);
  session.updateProject(project);
}

function getLane(laneId) {
  return project.lanes.find((lane) => lane.id === laneId);
}

function updateChartMeta() {
  const chart = buildChart(project.difficulty);
  elements.introNotes.textContent = String(chart.notes.length);
  elements.transportDuration.textContent = formatTime(CHART_DURATION);
  elements.difficultyLabel.textContent = `${DIFFICULTIES[project.difficulty].label} · ${project.bpm} BPM`;
}

function applyProjectToControls() {
  elements.difficultySelect.value = project.difficulty;
  elements.speedRange.value = String(project.speed);
  elements.speedValue.textContent = `${project.speed.toFixed(1)}×`;
  elements.transposeRange.value = String(project.transpose);
  elements.transposeValue.textContent = formatPitch(project.transpose);
  elements.latencyValue.textContent = formatLatency(project.latencyMs);
  updateToggle(elements.loopToggle, project.loop);
  updateToggle(elements.metronomeToggle, project.metronome);
  for (const lane of project.lanes) {
    const gain = elements.laneList.querySelector(`[data-gain="${lane.id}"]`);
    const pitch = elements.laneList.querySelector(`[data-pitch-value="${lane.id}"]`);
    if (gain) gain.value = lane.gain;
    if (pitch) pitch.textContent = formatPitch(lane.pitch);
  }
  session.updateProject(project, { rebuild: true });
  renderer.setProject(project);
}

function updateToggle(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
}

function saveProject({ silent = false } = {}) {
  const saved = saveProjectToStorage({
    ...project,
    lanes: project.lanes.map((lane) => ({ ...lane }))
  });
  if (!silent) {
    showToast(`工程已保存 · <b>${saved.noteCount}</b> 音符 · ${formatTime(saved.duration)}`);
  }
  return saved;
}

async function loadSavedProject({ autoplay = false, silent = false } = {}) {
  const loaded = loadProjectFromStorage();
  if (!loaded || !loaded.valid) {
    if (!silent) showToast("没有可载入的工程，请先保存");
    return false;
  }
  resetToProject(loaded.project);
  if (!silent) showToast("工程已载入，播放位置归零");
  if (autoplay) await startGame();
  return true;
}

async function resetToProject(nextProject) {
  await session.stop();
  project = normalizeProject(nextProject);
  session.updateProject(project, { rebuild: true });
  session.resetScore();
  session.judged.clear();
  renderer.setProject(project);
  applyProjectToControls();
  updateChartMeta();
  updateHud();
  showStartOverlay();
  elements.resultOverlay.hidden = true;
  updateTransportReadout();
}

async function importProjectFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const candidate = JSON.parse(await file.text());
    const result = validateProject(candidate);
    if (!result.valid) throw new Error(result.errors.join("；") || "工程格式无效");
    await resetToProject(result.project);
    showToast(`已导入 <b>${file.name}</b>，从头就绪`);
  } catch (error) {
    showToast(`载入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function handleProjectDrop(event) {
  const file = event.dataTransfer?.files?.[0];
  if (!file || !file.name.endsWith(".json")) return;
  event.preventDefault();
  const transfer = new DataTransfer();
  transfer.items.add(file);
  elements.projectFileInput.files = transfer.files;
  elements.projectFileInput.dispatchEvent(new Event("change"));
}

async function exportAudio() {
  const button = $("#exportAudio");
  button.disabled = true;
  button.querySelector("span:last-child").textContent = "渲染中";
  try {
    const rendered = await renderProjectAudio(project);
    downloadExport(rendered, `pulse-grid-${project.difficulty}-${rendered.duration.toFixed(3)}s.wav`);
    showToast(`已导出 <b>${rendered.duration.toFixed(3)}s</b> WAV · ${rendered.noteCount} 音符`);
  } catch (error) {
    showToast(`导出失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.querySelector("span:last-child").textContent = "导出";
  }
}

let lastAudit = null;

async function runReloadAudit() {
  const button = elements.runAudit;
  button.disabled = true;
  button.textContent = "渲染中";
  try {
    const firstProject = normalizeProject(structuredClone(project));
    const firstChart = buildChart(firstProject.difficulty);
    const firstRender = await renderProjectAudio(firstProject, { encode: false });
    const first = {
      noteCount: firstChart.notes.length,
      beatSignature: beatSignature(firstChart),
      firstBeat: firstChart.notes[0].beat,
      lastBeat: firstChart.notes.at(-1).beat,
      duration: firstRender.duration
    };

    const saved = saveProject({ silent: true });
    await resetToProject(saved);
    const secondChart = buildChart(project.difficulty);
    const secondRender = await renderProjectAudio(project, { encode: false });
    const second = {
      noteCount: secondChart.notes.length,
      beatSignature: beatSignature(secondChart),
      firstBeat: secondChart.notes[0].beat,
      lastBeat: secondChart.notes.at(-1).beat,
      duration: secondRender.duration
    };

    const matches = {
      notes: first.noteCount === second.noteCount,
      beats: first.beatSignature === second.beatSignature
        && first.firstBeat === second.firstBeat
        && first.lastBeat === second.lastBeat,
      duration: Math.abs(first.duration - second.duration) < 0.0000001
    };
    lastAudit = {
      first,
      second,
      matches,
      allMatch: Object.values(matches).every(Boolean),
      savedAt: saved.savedAt,
      noteCount: saved.noteCount,
      chartBeats: saved.chartBeats
    };
    renderAuditResult();
    showStartOverlay();
    showToast(
      lastAudit.allMatch
        ? "重载审计通过：音符、节拍与导出时长完全一致"
        : "重载审计发现差异，请检查参数"
    );
  } catch (error) {
    showToast(`审计失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "重测";
  }
}

function renderAuditResult() {
  if (!lastAudit) return;
  const { first, second, matches } = lastAudit;
  elements.auditNotes.textContent = `${first.noteCount} = ${second.noteCount} ${matches.notes ? "✓" : "×"}`;
  elements.auditBeats.textContent = `${first.beatSignature} = ${second.beatSignature} ${matches.beats ? "✓" : "×"}`;
  elements.auditDuration.textContent = `${first.duration.toFixed(4)}s = ${second.duration.toFixed(4)}s ${matches.duration ? "✓" : "×"}`;
}

function showStartOverlay() {
  elements.startOverlay.hidden = false;
  elements.startOverlay.classList.remove("closing");
  elements.pauseOverlay.hidden = true;
  elements.resultOverlay.hidden = true;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = message;
  elements.toastStack.append(toast);
  window.setTimeout(() => toast.remove(), 3400);
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatLatency(value) {
  const rounded = Math.round(Number(value) || 0);
  return `${rounded >= 0 ? "+" : ""}${rounded} ms`;
}

function formatPitch(value) {
  const rounded = Math.round(Number(value) || 0);
  return `${rounded >= 0 ? "+" : ""}${rounded} st`;
}

window.addEventListener("beforeunload", () => {
  session.audio.stopAll();
  session.audio.stopCalibration();
});

window.__PULSE__ = {
  session,
  renderer,
  getProject: () => structuredClone(project),
  getSnapshot: () => ({
    project: structuredClone(project),
    diagnostics: session.diagnostics(),
    summary: session.summary(),
    duration: CHART_DURATION,
    chartBeats: CHART_BEATS,
    beatSignature: beatSignature(session.chart),
    noteCount: session.chart.notes.length
  }),
  startGame,
  pauseGame: () => session.pause(),
  resumeGame,
  pressLane,
  save: () => saveProject({ silent: true }),
  loadSaved: (autoplay = false) => loadSavedProject({ autoplay, silent: true }),
  runReloadAudit,
  exportDuration: async () => (await renderProjectAudio(project, { encode: false })).duration,
  renderStats: async () => {
    const rendered = await renderProjectAudio(project, { encode: false });
    const channel = rendered.buffer.getChannelData(0);
    let peak = 0;
    let sumSquares = 0;
    for (let index = 0; index < channel.length; index += 32) {
      const sample = channel[index];
      peak = Math.max(peak, Math.abs(sample));
      sumSquares += sample * sample;
    }
    return {
      duration: rendered.duration,
      frames: rendered.frames,
      sampleRate: rendered.sampleRate,
      peak,
      rms: Math.sqrt(sumSquares / Math.ceil(channel.length / 32)),
      noteCount: rendered.noteCount
    };
  },
  setLoop: (enabled) => {
    project.loop = Boolean(enabled);
    updateToggle(elements.loopToggle, project.loop);
  },
  setTranspose: (semitones) => {
    project.transpose = Math.max(-12, Math.min(12, Number(semitones) || 0));
    elements.transposeRange.value = String(project.transpose);
    elements.transposeValue.textContent = formatPitch(project.transpose);
    commitLiveProject();
  },
  setSpeed: (speed) => {
    project.speed = Math.max(0.7, Math.min(1.6, Number(speed) || 1));
    elements.speedRange.value = String(project.speed);
    elements.speedValue.textContent = `${project.speed.toFixed(1)}×`;
    renderer.setProject(project);
  },
  getLastAudit: () => lastAudit
};
