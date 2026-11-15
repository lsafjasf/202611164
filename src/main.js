import "./styles.css";
import { DrumAudioEngine, renderProjectToWav } from "./audio.js";
import { runClosedLoopAudit } from "./audit.js";
import {
  BEATS_PER_STEP,
  TRACK_DEFS,
  applyRhythmJson,
  beatPositionLabel,
  cloneProject,
  createDemoProject,
  deserializeProject,
  noteNameFromMidi,
  normalizeProject,
  serializeProject,
  serializeRhythm,
  trackMidi,
} from "./project.js";
import { SequencerRenderer } from "./renderer.js";
import { DrumSequencer } from "./sequencer.js";

const STORAGE_KEY = "polygrid.project.v1";
const $ = (selector) => document.querySelector(selector);

const elements = {
  playButton: $("#playButton"),
  pauseButton: $("#pauseButton"),
  stopButton: $("#stopButton"),
  loopButton: $("#loopButton"),
  bpmSlider: $("#bpmSlider"),
  bpmValue: $("#bpmValue"),
  bpmDown: $("#bpmDown"),
  bpmUp: $("#bpmUp"),
  masterGain: $("#masterGain"),
  masterValue: $("#masterValue"),
  saveButton: $("#saveButton"),
  jsonSaveButton: $("#jsonSaveButton"),
  loadButton: $("#loadButton"),
  fileInput: $("#fileInput"),
  copyPatternButton: $("#copyPatternButton"),
  pastePatternButton: $("#pastePatternButton"),
  exportButton: $("#exportButton"),
  patternStatus: $("#patternStatus"),
  statusDot: $(".status-dot"),
  beatReadout: $("#beatReadout"),
  pitchReadout: $("#pitchReadout"),
  audioLed: $("#audioLed"),
  audioStateText: $("#audioStateText"),
  stepTitle: $("#stepTitle"),
  stepToggle: $("#stepToggle"),
  velocityControl: $("#velocityControl"),
  velocityValue: $("#velocityValue"),
  probabilityControl: $("#probabilityControl"),
  probabilityValue: $("#probabilityValue"),
  panControl: $("#panControl"),
  panValue: $("#panValue"),
  trackTabs: $("#trackTabs"),
  trackName: $("#trackName"),
  trackNote: $("#trackNote"),
  voiceLed: $("#voiceLed"),
  tuneControl: $("#tuneControl"),
  tuneValue: $("#tuneValue"),
  decayControl: $("#decayControl"),
  decayValue: $("#decayValue"),
  toneControl: $("#toneControl"),
  toneValue: $("#toneValue"),
  trackGainControl: $("#trackGainControl"),
  trackGainValue: $("#trackGainValue"),
  transposeControl: $("#transposeControl"),
  transposeValue: $("#transposeValue"),
  clearStepButton: $("#clearStepButton"),
  resetDemoButton: $("#resetDemoButton"),
  auditButton: $("#auditButton"),
  noteCountMetric: $("#noteCountMetric"),
  noteCountDetail: $("#noteCountDetail"),
  beatMetric: $("#beatMetric"),
  beatDetail: $("#beatDetail"),
  durationMetric: $("#durationMetric"),
  durationDetail: $("#durationDetail"),
  pauseMetric: $("#pauseMetric"),
  pauseDetail: $("#pauseDetail"),
  auditLog: $("#auditLog"),
  saveState: $("#saveState"),
  toast: $("#toast"),
};

let project = loadInitialProject();
let selectedTrack = 0;
let selectedStep = 0;
let memoryClipboard = "";
let saveTimer = null;
let toastTimer = null;
let auditRunning = false;
let lastAudit = null;
let lastTriggerLabel = `${TRACK_DEFS[0].name} · ${TRACK_DEFS[0].note}`;

const engine = new DrumAudioEngine();
const sequencer = new DrumSequencer(
  engine,
  () => project,
  {
    onStateChange: updateTransportState,
    onSchedule: scheduleVisualEvent,
  },
);
const renderer = new SequencerRenderer(
  $("#sequencerCanvas"),
  $("#meterCanvas"),
  {
    onSelect: selectStep,
    onToggle: setStepActive,
    onPaint: paintStep,
    onTrackSelect: selectTrack,
  },
);

function loadInitialProject() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? deserializeProject(saved) : createDemoProject();
  } catch {
    return createDemoProject();
  }
}

function persistNow(showToast = false) {
  window.clearTimeout(saveTimer);
  saveTimer = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeProject(project));
    elements.saveState.textContent = "LOCAL PROJECT SAVED";
    if (showToast) {
      showToastMessage("工程与全部轨道参数已保存");
    }
  } catch {
    elements.saveState.textContent = "LOCAL SAVE UNAVAILABLE";
    if (showToast) {
      showToastMessage("浏览器阻止了本地存储");
    }
  }
}

function persistSoon() {
  window.clearTimeout(saveTimer);
  elements.saveState.textContent = "SAVING PARAMETERS…";
  saveTimer = window.setTimeout(() => persistNow(false), 260);
}

function showToastMessage(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function setRangeValue(input, value, min = Number(input.min), max = Number(input.max)) {
  input.value = value;
  const percentage = ((Number(value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${Math.max(0, Math.min(100, percentage))}%`);
}

function refreshProjectUI() {
  renderer.setProject(project);
  renderer.setSelection(selectedTrack, selectedStep);
  setRangeValue(elements.bpmSlider, project.bpm);
  elements.bpmValue.textContent = project.bpm;
  setRangeValue(elements.masterGain, project.masterGain, 0, 1.2);
  elements.masterValue.textContent = Math.round(project.masterGain * 100);
  elements.loopButton.classList.toggle("active", project.loop);
  elements.loopButton.setAttribute("aria-pressed", String(project.loop));
  setRangeValue(elements.transposeControl, project.transpose, -12, 12);
  elements.transposeValue.textContent = formatSemitones(project.transpose);
  refreshTrackTabs();
  updateInspector();
}

function refreshTrackTabs() {
  const tabs = [...elements.trackTabs.querySelectorAll(".track-tab")];
  tabs.forEach((tab, index) => {
    tab.classList.toggle("active", index === selectedTrack);
    tab.setAttribute("aria-selected", String(index === selectedTrack));
  });
  const track = project.tracks[selectedTrack];
  const def = TRACK_DEFS[selectedTrack];
  elements.trackName.textContent = def.name;
  elements.voiceLed.style.setProperty("--track", track.color);
  elements.trackNote.textContent = noteNameFromMidi(trackMidi(project, selectedTrack));
}

function updateInspector() {
  const track = project.tracks[selectedTrack];
  const step = track.steps[selectedStep];
  elements.stepTitle.textContent = `${TRACK_DEFS[selectedTrack].name} / ${String(selectedStep + 1).padStart(2, "0")}`;
  elements.stepToggle.classList.toggle("active", step.on);
  elements.stepToggle.setAttribute("aria-pressed", String(step.on));
  setRangeValue(elements.velocityControl, step.velocity, 1, 127);
  elements.velocityValue.textContent = step.velocity;
  setRangeValue(elements.probabilityControl, step.probability, 0, 100);
  elements.probabilityValue.textContent = `${step.probability}%`;
  setRangeValue(elements.panControl, step.pan, -100, 100);
  elements.panValue.textContent = formatPan(step.pan);
  setRangeValue(elements.tuneControl, track.tune, -12, 12);
  elements.tuneValue.textContent = formatSemitones(track.tune);
  setRangeValue(elements.decayControl, track.decay, 0.05, 1.2);
  elements.decayValue.textContent = `${Number(track.decay).toFixed(2)}s`;
  setRangeValue(elements.toneControl, track.tone, 0, 1);
  elements.toneValue.textContent = `${Math.round(track.tone * 100)}%`;
  setRangeValue(elements.trackGainControl, track.gain, 0, 1.5);
  elements.trackGainValue.textContent = Number(track.gain).toFixed(2);
  refreshTrackTabs();
}

function formatSemitones(value) {
  return `${value >= 0 ? "+" : ""}${value} st`;
}

function formatPan(value) {
  if (value === 0) {
    return "C";
  }
  return `${value < 0 ? "L" : "R"}${Math.abs(value)}`;
}

function selectStep(trackIndex, stepIndex) {
  selectedTrack = trackIndex;
  selectedStep = stepIndex;
  renderer.setSelection(trackIndex, stepIndex);
  updateInspector();
}

function selectTrack(trackIndex) {
  selectedTrack = trackIndex;
  renderer.setSelection(selectedTrack, selectedStep);
  updateInspector();
}

function setStepActive(trackIndex, stepIndex, active) {
  project.tracks[trackIndex].steps[stepIndex].on = Boolean(active);
  if (active && project.tracks[trackIndex].steps[stepIndex].velocity < 8) {
    project.tracks[trackIndex].steps[stepIndex].velocity = 100;
  }
  updateInspector();
  persistSoon();
}

function paintStep(trackIndex, stepIndex, active) {
  project.tracks[trackIndex].steps[stepIndex].on = Boolean(active);
  persistSoon();
}

function updateTransportState(state) {
  const isPlaying = state.state === "playing";
  const isPaused = state.state === "paused";
  elements.patternStatus.textContent = isPlaying ? "PLAYING" : isPaused ? "PAUSED" : "STOPPED";
  elements.statusDot.classList.toggle("live", isPlaying);
  elements.audioLed.classList.toggle("live", isPlaying);
  elements.audioStateText.textContent = isPlaying
    ? "AUDIO RUNNING"
    : isPaused
      ? "AUDIO RELEASED"
      : "AUDIO READY";
  elements.playButton.classList.toggle("active", isPlaying);
  if (state.state === "stopped") {
    lastTriggerLabel = `${TRACK_DEFS[selectedTrack].name} · ${noteNameFromMidi(trackMidi(project, selectedTrack))}`;
    elements.pitchReadout.textContent = lastTriggerLabel;
  }
}

function scheduleVisualEvent(event) {
  if (!Number.isFinite(event.time)) {
    return;
  }
}

async function playTransport() {
  try {
    await sequencer.play();
  } catch (error) {
    showToastMessage(error.message || "无法启动音频");
  }
}

function setBpm(nextBpm) {
  const bpm = Math.max(60, Math.min(180, Math.round(Number(nextBpm) || project.bpm)));
  if (bpm === project.bpm) {
    return;
  }
  project.bpm = bpm;
  elements.bpmSlider.value = bpm;
  elements.bpmValue.textContent = bpm;
  setRangeValue(elements.bpmSlider, bpm);
  sequencer.setBpm(bpm, project);
  persistSoon();
}

function toggleLoop() {
  project.loop = !project.loop;
  elements.loopButton.classList.toggle("active", project.loop);
  elements.loopButton.setAttribute("aria-pressed", String(project.loop));
  sequencer.setLoop(project);
  persistSoon();
}

async function loadProject(nextProject, options = {}) {
  const wasPlaying = sequencer.state === "playing";
  const normalized = normalizeProject(nextProject);
  sequencer.stop();
  project = normalized;
  selectedTrack = Math.min(selectedTrack, project.tracks.length - 1);
  selectedStep = Math.min(selectedStep, 15);
  sequencer.clock.bpm = project.bpm;
  engine.syncProject(project);
  refreshProjectUI();
  lastTriggerLabel = `${TRACK_DEFS[selectedTrack].name} · ${noteNameFromMidi(trackMidi(project, selectedTrack))}`;
  elements.pitchReadout.textContent = lastTriggerLabel;
  if (options.persist !== false) {
    persistNow(false);
  }
  if (options.autoResume !== false && wasPlaying) {
    await playTransport();
  }
  if (options.message) {
    showToastMessage(options.message);
  }
}

async function copyPattern() {
  memoryClipboard = serializeRhythm(project);
  try {
    await navigator.clipboard.writeText(memoryClipboard);
    showToastMessage("16 步节奏片段已复制到剪贴板");
  } catch {
    showToastMessage("节奏片段已复制到应用内剪贴板");
  }
}

async function pastePattern() {
  let text = memoryClipboard;
  try {
    const clipboardText = await navigator.clipboard.readText();
    if (clipboardText && clipboardText.includes("polygrid")) {
      text = clipboardText;
    }
  } catch {
    // Permission can be denied; the in-app clipboard remains available.
  }
  if (!text) {
    showToastMessage("剪贴板中没有可粘贴的节奏");
    return;
  }
  try {
    const next = applyRhythmJson(project, text);
    await loadProject(next, {
      autoResume: false,
      message: "节奏片段已粘贴，播放将从头开始",
    });
  } catch (error) {
    showToastMessage(error.message);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function safeFilename(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "") || "polygrid";
}

function saveProjectJson() {
  persistNow(false);
  const content = serializeProject(project);
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `${safeFilename(project.name)}-${project.bpm}bpm.json`);
  showToastMessage("工程 JSON 已导出，包含每轨参数与增益");
}

async function importProjectFile() {
  const file = elements.fileInput.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const next = deserializeProject(text);
    await loadProject(next, {
      autoResume: true,
      message: "工程已重载，播放位置已归零",
    });
    showToastMessage("工程已重载，音序将从第一步开始");
  } catch (error) {
    showToastMessage(error.message || "无法读取工程文件");
  } finally {
    elements.fileInput.value = "";
  }
}

async function exportWav() {
  if (elements.exportButton.disabled) {
    return;
  }
  const original = elements.exportButton.innerHTML;
  elements.exportButton.disabled = true;
  elements.exportButton.textContent = "渲染中…";
  try {
    const result = await renderProjectToWav(project);
    const blob = new Blob([result.wav], { type: "audio/wav" });
    const filename = `${safeFilename(project.name)}-${project.bpm}bpm-${result.noteCount}notes.wav`;
    downloadBlob(blob, filename);
    showToastMessage(
      `WAV 已导出 · ${result.duration.toFixed(3)}s · ${result.noteCount} 个音符`,
    );
  } catch (error) {
    showToastMessage(error.message || "WAV 导出失败");
  } finally {
    elements.exportButton.disabled = false;
    elements.exportButton.innerHTML = original;
  }
}

function bindControls() {
  elements.playButton.addEventListener("click", playTransport);
  elements.pauseButton.addEventListener("click", () => sequencer.pause());
  elements.stopButton.addEventListener("click", () => sequencer.stop());
  elements.loopButton.addEventListener("click", toggleLoop);
  elements.bpmDown.addEventListener("click", () => setBpm(project.bpm - 1));
  elements.bpmUp.addEventListener("click", () => setBpm(project.bpm + 1));
  elements.bpmSlider.addEventListener("input", (event) => setBpm(event.target.value));

  elements.masterGain.addEventListener("input", (event) => {
    project.masterGain = Number(event.target.value);
    setRangeValue(elements.masterGain, project.masterGain, 0, 1.2);
    elements.masterValue.textContent = Math.round(project.masterGain * 100);
    engine.syncProject(project);
    persistSoon();
  });

  elements.saveButton.addEventListener("click", () => persistNow(true));
  elements.jsonSaveButton.addEventListener("click", saveProjectJson);
  elements.loadButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", importProjectFile);
  elements.copyPatternButton.addEventListener("click", copyPattern);
  elements.pastePatternButton.addEventListener("click", pastePattern);
  elements.exportButton.addEventListener("click", exportWav);

  elements.stepToggle.addEventListener("click", () => {
    const step = project.tracks[selectedTrack].steps[selectedStep];
    setStepActive(selectedTrack, selectedStep, !step.on);
  });

  elements.velocityControl.addEventListener("input", (event) => {
    const step = project.tracks[selectedTrack].steps[selectedStep];
    step.velocity = Number(event.target.value);
    elements.velocityValue.textContent = step.velocity;
    setRangeValue(elements.velocityControl, step.velocity, 1, 127);
    persistSoon();
  });

  elements.probabilityControl.addEventListener("input", (event) => {
    const step = project.tracks[selectedTrack].steps[selectedStep];
    step.probability = Number(event.target.value);
    elements.probabilityValue.textContent = `${step.probability}%`;
    setRangeValue(elements.probabilityControl, step.probability, 0, 100);
    persistSoon();
  });

  elements.panControl.addEventListener("input", (event) => {
    const step = project.tracks[selectedTrack].steps[selectedStep];
    step.pan = Number(event.target.value);
    elements.panValue.textContent = formatPan(step.pan);
    setRangeValue(elements.panControl, step.pan, -100, 100);
    persistSoon();
  });

  elements.tuneControl.addEventListener("input", (event) => {
    const track = project.tracks[selectedTrack];
    track.tune = Number(event.target.value);
    elements.tuneValue.textContent = formatSemitones(track.tune);
    setRangeValue(elements.tuneControl, track.tune, -12, 12);
    refreshTrackTabs();
    persistSoon();
  });

  elements.decayControl.addEventListener("input", (event) => {
    const track = project.tracks[selectedTrack];
    track.decay = Number(event.target.value);
    elements.decayValue.textContent = `${track.decay.toFixed(2)}s`;
    setRangeValue(elements.decayControl, track.decay, 0.05, 1.2);
    persistSoon();
  });

  elements.toneControl.addEventListener("input", (event) => {
    const track = project.tracks[selectedTrack];
    track.tone = Number(event.target.value);
    elements.toneValue.textContent = `${Math.round(track.tone * 100)}%`;
    setRangeValue(elements.toneControl, track.tone, 0, 1);
    persistSoon();
  });

  elements.trackGainControl.addEventListener("input", (event) => {
    const track = project.tracks[selectedTrack];
    track.gain = Number(event.target.value);
    elements.trackGainValue.textContent = track.gain.toFixed(2);
    setRangeValue(elements.trackGainControl, track.gain, 0, 1.5);
    engine.syncProject(project);
    persistSoon();
  });

  elements.transposeControl.addEventListener("input", (event) => {
    project.transpose = Number(event.target.value);
    elements.transposeValue.textContent = formatSemitones(project.transpose);
    setRangeValue(elements.transposeControl, project.transpose, -12, 12);
    refreshTrackTabs();
    persistSoon();
  });

  elements.trackTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".track-tab");
    if (button) {
      selectTrack(Number(button.dataset.track));
    }
  });

  elements.clearStepButton.addEventListener("click", () => {
    for (const step of project.tracks[selectedTrack].steps) {
      step.on = false;
    }
    updateInspector();
    persistSoon();
    showToastMessage(`${TRACK_DEFS[selectedTrack].name} 轨道已清空`);
  });

  elements.resetDemoButton.addEventListener("click", () => {
    loadProject(createDemoProject(), {
      autoResume: false,
      message: "完整示例已载入",
    });
  });
}

async function runAudit() {
  if (auditRunning) {
    return;
  }
  auditRunning = true;
  elements.auditButton.disabled = true;
  elements.auditButton.textContent = "校验中…";
  elements.auditLog.className = "audit-log";
  elements.auditLog.textContent = "读取工程并建立确定性音符计划…";
  try {
    const result = await runClosedLoopAudit(project, (message) => {
      elements.auditLog.textContent = message;
    });
    lastAudit = result;
    renderAudit(result);
  } catch (error) {
    elements.auditLog.className = "audit-log fail";
    elements.auditLog.textContent = `校验失败：${error.message || error}`;
  } finally {
    auditRunning = false;
    elements.auditButton.disabled = false;
    elements.auditButton.textContent = "运行闭环校验";
  }
}

function renderAudit(result) {
  const passClass = (pass) => (pass ? "pass" : "fail");
  elements.noteCountMetric.textContent = `${result.firstPass.noteCount} / ${result.reloaded.noteCount}`;
  elements.noteCountMetric.className = passClass(result.checks.notes && result.checks.exportNotes);
  elements.noteCountDetail.textContent =
    `首轮 ${result.firstPass.noteCount} · 重载 ${result.reloaded.noteCount} · 导出 Δ ${result.delta.noteCount}`;

  elements.beatMetric.textContent = `Δ ${formatDelta(result.delta.beat)}`;
  elements.beatMetric.className = passClass(result.checks.beats);
  elements.beatDetail.textContent =
    `拍点 ${formatBeatSequence(result.firstPass.beatPositions)}`;

  elements.durationMetric.textContent = `${result.firstPass.duration.toFixed(6)} s`;
  elements.durationMetric.className = passClass(result.checks.duration);
  elements.durationDetail.textContent =
    `首轮 ${result.firstPass.frames} / 重载 ${result.reloaded.frames} 帧 · Δ ${result.delta.frames}`;

  elements.pauseMetric.textContent = `${formatDelta(result.delta.pause)} beat`;
  elements.pauseMetric.className = passClass(
    result.checks.pause && result.checks.loop && result.checks.transpose,
  );
  elements.pauseDetail.textContent =
    `6 段暂停/变速 · 循环 Δ ${formatDelta(result.delta.loop)} · 变调 Δ ${formatDelta(result.delta.transpose)}`;

  elements.auditLog.className = `audit-log ${result.pass ? "pass" : "fail"}`;
  const status = result.pass ? "PASS" : "FAIL";
  elements.auditLog.textContent =
    `${status} · JSON ${result.jsonBytes} B · ` +
    `首轮拍点 [${formatBeatSequence(result.firstPass.beatPositions)}] · ` +
    `重载拍点 [${formatBeatSequence(result.reloaded.beatPositions)}] · ` +
    `导出 ${result.firstPass.loopDuration.toFixed(6)}s + 尾段 ${result.firstPass.tail.toFixed(2)}s`;
}

function formatDelta(value) {
  if (!Number.isFinite(value)) {
    return "∞";
  }
  if (value < 0.0000005) {
    return "0.000000";
  }
  return value.toFixed(6);
}

function formatBeatSequence(positions) {
  if (!positions?.length) {
    return "无音符";
  }
  const head = positions.slice(0, 8).map((beat) => beat.toFixed(3));
  const tail = positions.length > 8 ? `, … , ${positions.at(-1).toFixed(3)}` : "";
  return head.join(", ") + tail;
}

let lastDomUpdate = 0;
function animationFrame(timestamp) {
  const position = sequencer.getPosition();
  const lastTrigger = sequencer.getLastTrigger();
  if (lastTrigger) {
    const trackName = TRACK_DEFS[lastTrigger.trackIndex].name;
    lastTriggerLabel = `${trackName} · ${noteNameFromMidi(lastTrigger.midi)}`;
  }
  const levels = engine.readLevels();
  renderer.draw({
    project,
    position,
    state: sequencer.state,
    recentEvents: sequencer.getRecentEvents(0.14),
    audioTime: engine.context?.currentTime || 0,
    levels,
  });

  if (timestamp - lastDomUpdate > 48) {
    lastDomUpdate = timestamp;
    const label = beatPositionLabel(position.beat);
    const [bar, quarter, sixteenth] = label.split(".");
    elements.beatReadout.innerHTML =
      `${bar}<span>.</span>${quarter}<span>.</span>${sixteenth}`;
    elements.pitchReadout.textContent = lastTriggerLabel;
    if (engine.context) {
      elements.audioStateText.textContent =
        sequencer.state === "playing"
          ? `AUDIO ${engine.context.state.toUpperCase()}`
          : sequencer.state === "paused"
            ? "AUDIO RELEASED"
            : "AUDIO READY";
    }
  }
  window.requestAnimationFrame(animationFrame);
}

function bindKeyboard() {
  window.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select")) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      sequencer.togglePlayPause().catch((error) => showToastMessage(error.message));
    } else if (event.code === "Escape") {
      sequencer.stop();
    } else if (/^Digit[1-4]$/.test(event.code)) {
      selectTrack(Number(event.code.slice(-1)) - 1);
    }
  });
}

function exposeTestApi() {
  window.polygrid = {
    getProject: () => cloneProject(project),
    getState: () => ({
      ...sequencer.getPosition(),
      sequencerState: sequencer.state,
      bpm: project.bpm,
      audioTime: engine.context?.currentTime || null,
      audioState: engine.context?.state || "uninitialized",
      activeVoices: engine.voices.size,
      eventCount: sequencer.events.length,
      selectedTrack,
      selectedStep,
    }),
    getAudit: () => lastAudit,
    getLevels: () => engine.readLevels(),
    getEvents: () => sequencer.events.map((event) => ({ ...event })),
    runAudit,
    setBpm,
    play: playTransport,
    pause: () => sequencer.pause(),
    stop: () => sequencer.stop(),
    loadProject: (next) => loadProject(next, { autoResume: false }),
    exportWav: async () => {
      const result = await renderProjectToWav(project);
      return {
        duration: result.duration,
        frames: result.frames,
        noteCount: result.noteCount,
        beatPositions: result.beatPositions,
      };
    },
  };
}

async function initialize() {
  refreshProjectUI();
  updateTransportState({ state: "stopped" });
  bindControls();
  bindKeyboard();
  exposeTestApi();
  elements.auditButton.addEventListener("click", runAudit);
  elements.pitchReadout.textContent = lastTriggerLabel;
  persistNow(false);
  window.requestAnimationFrame(animationFrame);
  window.setTimeout(() => {
    if (!lastAudit && !auditRunning) {
      runAudit();
    }
  }, 700);
}

window.addEventListener("beforeunload", () => {
  persistNow(false);
  engine.dispose();
});

initialize();
