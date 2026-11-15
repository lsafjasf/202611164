import {
  KEY_OPTIONS,
  TOTAL_BEATS,
  TOTAL_STEPS,
  beatPositions,
  buildDemoProject,
  countNotes,
  getExportDuration,
  getPlaybackRange,
  loadProjectFromStorage,
  parseProject,
  sanitizeProject,
  saveProjectToStorage,
  serializeProject,
} from "./model.js";
import { AudioEngine } from "./audio-engine.js";
import { createDrumKit } from "./drums.js";
import { WaveformEditor } from "./waveform.js";

const kit = createDrumKit(48_000);
const dom = {
  projectName: byId("projectName"),
  engineStatus: byId("engineStatus"),
  engineStatusText: byId("engineStatusText"),
  saveProject: byId("saveProject"),
  loadProject: byId("loadProject"),
  projectFile: byId("projectFile"),
  previewSelected: byId("previewSelected"),
  waveformCanvas: byId("waveformCanvas"),
  padGrid: byId("padGrid"),
  inspectorTitle: byId("inspectorTitle"),
  inspectorNumber: byId("inspectorNumber"),
  inspectorDetail: byId("inspectorDetail"),
  cropDuration: byId("cropDuration"),
  triggerKeyButton: byId("triggerKeyButton"),
  triggerKey: byId("triggerKey"),
  keySelect: byId("keySelect"),
  muteTrack: byId("muteTrack"),
  startRange: byId("startRange"),
  endRange: byId("endRange"),
  fadeInRange: byId("fadeInRange"),
  fadeOutRange: byId("fadeOutRange"),
  pitchRange: byId("pitchRange"),
  gainRange: byId("gainRange"),
  startOutput: byId("startOutput"),
  endOutput: byId("endOutput"),
  fadeInOutput: byId("fadeInOutput"),
  fadeOutOutput: byId("fadeOutOutput"),
  pitchOutput: byId("pitchOutput"),
  gainOutput: byId("gainOutput"),
  resetTrack: byId("resetTrack"),
  noteCount: byId("noteCount"),
  tempoSummary: byId("tempoSummary"),
  stepRuler: byId("stepRuler"),
  sequencerGrid: byId("sequencerGrid"),
  auditBadge: byId("auditBadge"),
  auditNotesBefore: byId("auditNotesBefore"),
  auditNotesAfter: byId("auditNotesAfter"),
  auditBeatsBefore: byId("auditBeatsBefore"),
  auditBeatsAfter: byId("auditBeatsAfter"),
  auditDurationBefore: byId("auditDurationBefore"),
  auditDurationAfter: byId("auditDurationAfter"),
  auditLoopBefore: byId("auditLoopBefore"),
  auditLoopAfter: byId("auditLoopAfter"),
  auditVoices: byId("auditVoices"),
  auditPeak: byId("auditPeak"),
  auditBeatList: byId("auditBeatList"),
  runAudit: byId("runAudit"),
  transportTag: byId("transportTag"),
  barDisplay: byId("barDisplay"),
  beatDisplay: byId("beatDisplay"),
  timeDisplay: byId("timeDisplay"),
  pitchTrackName: byId("pitchTrackName"),
  pitchSteps: byId("pitchSteps"),
  pitchReadout: byId("pitchReadout"),
  levelMeter: byId("levelMeter"),
  voiceCount: byId("voiceCount"),
  playButton: byId("playButton"),
  playIcon: byId("playIcon"),
  stopButton: byId("stopButton"),
  loopButton: byId("loopButton"),
  tempoInput: byId("tempoInput"),
  speedRange: byId("speedRange"),
  speedOutput: byId("speedOutput"),
  loopStartInput: byId("loopStartInput"),
  loopEndInput: byId("loopEndInput"),
  transportPosition: byId("transportPosition"),
  transportDuration: byId("transportDuration"),
  masterRange: byId("masterRange"),
  exportWav: byId("exportWav"),
  toast: byId("toast"),
};

let wasRestoredFromStorage = false;
let project = loadInitialProject();
let selectedIndex = 0;
let restoredFromStorage = wasRestoredFromStorage;
let sequenceRows = [];
let padButtons = [];
let currentStepButtons = [];
let previewTimers = new Map();
let rebootTimer = null;
let toastTimer = null;
let auditRunning = false;
let auditCurrent = false;
let auditQueued = false;
let projectVersion = 0;

const engine = new AudioEngine({
  onState: updateTransportVisual,
  onPreview: flashTrack,
});
engine.setProject(project);

const waveform = new WaveformEditor(dom.waveformCanvas, kit, {
  onSelect: selectTrack,
  onCrop: () => {
    syncInspector();
    commitProject({ reboot: true });
  },
});
waveform.setProject(project);

function loadInitialProject() {
  try {
    const stored = loadProjectFromStorage();
    wasRestoredFromStorage = Boolean(stored);
    return stored ?? buildDemoProject();
  } catch {
    wasRestoredFromStorage = false;
    return buildDemoProject();
  }
}

function byId(id) {
  return document.getElementById(id);
}

function buildInterface() {
  dom.keySelect.replaceChildren(
    ...KEY_OPTIONS.map((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key;
      return option;
    }),
  );
  buildPads();
  buildRuler();
  buildSequencer();
  buildPitchSteps();
  bindControls();
  syncAll();

  if (restoredFromStorage) {
    showToast("已从本地工程恢复 · 播放头位于 0.00 拍");
  }
  setTimeout(runAudit, 350);
}

function buildPads() {
  dom.padGrid.replaceChildren(
    ...project.tracks.map((track, index) => {
      const button = document.createElement("button");
      button.className = "pad";
      button.type = "button";
      button.dataset.trackIndex = String(index);
      button.style.setProperty("--track-color", track.color);
      button.setAttribute("aria-label", `触发 ${track.name}，快捷键 ${track.key}`);
      button.setAttribute("aria-pressed", String(index === selectedIndex));
      button.innerHTML = `
        <span class="pad-key">${track.key}</span>
        <span class="pad-copy">
          <strong>0${index + 1} ${track.name}</strong>
          <small>${track.detail}</small>
        </span>
        <span class="pad-pitch">${formatPitch(track.pitch)}</span>
      `;
      button.addEventListener("pointerdown", () => {
        selectTrack(index);
        triggerTrack(track.id);
      });
      return button;
    }),
  );
  padButtons = [...dom.padGrid.querySelectorAll(".pad")];
}

function buildRuler() {
  dom.stepRuler.replaceChildren(
    ...Array.from({ length: TOTAL_STEPS }, (_, step) => {
      const cell = document.createElement("span");
      cell.className = "ruler-step";
      cell.dataset.step = String(step);
      if (step % 4 === 0) {
        cell.classList.add("bar-start");
        cell.textContent = `${Math.floor(step / 16) + 1}.${(step % 16) / 4 + 1}`;
      }
      return cell;
    }),
  );
}

function buildSequencer() {
  sequenceRows = project.tracks.map((track, trackIndex) => {
    const row = document.createElement("div");
    row.className = "seq-row";
    row.style.setProperty("--track-color", track.color);
    const label = document.createElement("div");
    label.className = "track-label";
    label.innerHTML = `
      <button class="track-select" type="button" aria-label="编辑 ${track.name}">
        <i class="track-color"></i>
        <span class="track-copy">
          <strong>${track.name}</strong>
          <small>KEY ${track.key} · ${formatPitch(track.pitch)}</small>
        </span>
      </button>
      <button class="row-mute" type="button" aria-label="静音 ${track.name}">M</button>
    `;
    const lane = document.createElement("div");
    lane.className = "step-lane";
    lane.setAttribute("role", "group");
    lane.setAttribute("aria-label", `${track.name} 音序步进`);
    const stepButtons = Array.from({ length: TOTAL_STEPS }, (_, step) => {
      const button = document.createElement("button");
      button.className = "step";
      button.type = "button";
      button.dataset.track = String(trackIndex);
      button.dataset.step = String(step);
      button.setAttribute("aria-label", `${track.name} 第 ${step + 1} 步`);
      button.title = `${track.name} · 拍 ${(step / 4).toFixed(2)}`;
      if (step % 4 === 0) button.classList.add("bar-start");
      button.addEventListener("click", () => {
        const current = project.tracks[trackIndex];
        current.steps[step] = !current.steps[step];
        commitProject({ reboot: true });
      });
      return button;
    });
    lane.append(...stepButtons);
    const gain = document.createElement("span");
    gain.className = "row-gain";
    gain.textContent = `${Math.round(track.gain * 100)}%`;
    row.append(label, lane, gain);

    const selectButton = label.querySelector(".track-select");
    selectButton.addEventListener("click", () => selectTrack(trackIndex));
    const muteButton = label.querySelector(".row-mute");
    muteButton.addEventListener("click", () => {
      const current = project.tracks[trackIndex];
      current.muted = !current.muted;
      commitProject({ reboot: true });
    });
    return { row, lane, stepButtons, selectButton, muteButton, gain, trackIndex };
  });
  dom.sequencerGrid.replaceChildren(...sequenceRows.map((row) => row.row));
}

function buildPitchSteps() {
  dom.pitchSteps.replaceChildren(
    ...Array.from({ length: 25 }, (_, index) => {
      const mark = document.createElement("i");
      if (index === 12) mark.classList.add("center");
      return mark;
    }),
  );
}

function bindControls() {
  dom.previewSelected.addEventListener("click", () => triggerTrack(currentTrack().id));
  dom.triggerKeyButton.addEventListener("click", () => triggerTrack(currentTrack().id));
  dom.keySelect.addEventListener("change", () => {
    currentTrack().key = dom.keySelect.value;
    commitProject({ reboot: true });
  });
  dom.muteTrack.addEventListener("click", () => {
    currentTrack().muted = !currentTrack().muted;
    commitProject({ reboot: true });
  });
  dom.resetTrack.addEventListener("click", resetCurrentTrack);

  bindLiveRange(dom.startRange, (track, value) => {
    track.start = Math.min(value / 1000, track.end - 0.02);
  });
  bindLiveRange(dom.endRange, (track, value) => {
    track.end = Math.max(value / 1000, track.start + 0.02);
  });
  bindLiveRange(dom.fadeInRange, (track, value) => {
    track.fadeIn = value / 1000;
  });
  bindLiveRange(dom.fadeOutRange, (track, value) => {
    track.fadeOut = value / 1000;
  });
  bindLiveRange(dom.pitchRange, (track, value) => {
    track.pitch = value;
  });
  bindLiveRange(dom.gainRange, (track, value) => {
    track.gain = value / 100;
  });

  dom.playButton.addEventListener("click", togglePlayback);
  dom.stopButton.addEventListener("click", () => {
    engine.stop();
    showToast("已停止 · 所有音序声部与定时器已释放");
  });
  dom.loopButton.addEventListener("click", () => {
    project.loop = !project.loop;
    commitProject({ reboot: true });
  });
  dom.tempoInput.addEventListener("change", () => {
    project.bpm = Number(dom.tempoInput.value);
    commitProject({ reboot: true });
  });
  dom.speedRange.addEventListener("input", () => {
    project.speed = Number(dom.speedRange.value);
    dom.speedOutput.textContent = `${project.speed.toFixed(2)}×`;
    markAuditStale();
    scheduleAudioReboot();
  });
  dom.speedRange.addEventListener("change", () => commitProject({ reboot: true }));
  dom.loopStartInput.addEventListener("change", () => {
    project.loopStart = Number(dom.loopStartInput.value);
    commitProject({ reboot: true });
  });
  dom.loopEndInput.addEventListener("change", () => {
    const requested = Number(dom.loopEndInput.value);
    project.loopEnd = requested;
    commitProject({ reboot: true });
    if (requested > TOTAL_BEATS) {
      showToast(`循环终点 ${requested.toFixed(2)} 拍越界，已在 ${TOTAL_BEATS.toFixed(2)} 拍截断声音`);
    }
  });
  dom.masterRange.addEventListener("input", () => {
    project.masterGain = Number(dom.masterRange.value) / 100;
    engine.setProject(project);
    markAuditStale();
  });
  dom.projectName.addEventListener("change", () => {
    project.name = dom.projectName.value;
    commitProject({ reboot: false });
  });

  dom.exportWav.addEventListener("click", exportAudio);
  dom.saveProject.addEventListener("click", saveProject);
  dom.loadProject.addEventListener("click", () => dom.projectFile.click());
  dom.projectFile.addEventListener("change", loadProjectFile);
  dom.runAudit.addEventListener("click", runAudit);

  document.addEventListener("keydown", handleKeyDown);
  window.addEventListener("pagehide", () => engine.dispose());
}

function bindLiveRange(input, mutate) {
  input.addEventListener("input", () => {
    mutate(currentTrack(), Number(input.value));
    syncInspector();
    waveform.setProject(project);
    markAuditStale();
    scheduleAudioReboot();
  });
  input.addEventListener("change", () => {
    commitProject({ reboot: true });
  });
}

function scheduleAudioReboot() {
  if (rebootTimer) clearTimeout(rebootTimer);
  rebootTimer = setTimeout(() => {
    project = sanitizeProject(project);
    engine.applyProject(project, { reboot: true });
    syncSummary();
  }, 90);
}

function commitProject({ reboot = true } = {}) {
  if (rebootTimer) clearTimeout(rebootTimer);
  rebootTimer = null;
  project = sanitizeProject(project);
  if (reboot) {
    engine.applyProject(project, { reboot: true });
  } else {
    engine.setProject(project);
  }
  syncAll();
  markAuditStale();
}

function selectTrack(index) {
  selectedIndex = Math.max(0, Math.min(project.tracks.length - 1, index));
  waveform.setSelected(selectedIndex);
  syncInspector();
  syncPads();
}

function currentTrack() {
  return project.tracks[selectedIndex];
}

function resetCurrentTrack() {
  const original = buildDemoProject().tracks[selectedIndex];
  project.tracks[selectedIndex] = original;
  commitProject({ reboot: true });
  showToast(`${original.name} 已恢复到示例参数`);
}

async function triggerTrack(trackId) {
  try {
    await engine.previewTrack(trackId);
    flashTrack({ trackId });
  } catch (error) {
    showToast(error.message || "音频初始化失败", true);
  }
}

async function togglePlayback() {
  try {
    await engine.toggle();
  } catch (error) {
    showToast(error.message || "无法启动音频引擎", true);
  }
}

function flashTrack({ trackId }) {
  const pad = padButtons.find((button) => {
    const track = project.tracks[Number(button.dataset.trackIndex)];
    return track?.id === trackId;
  });
  if (!pad) return;
  pad.classList.add("hit");
  if (previewTimers.has(trackId)) clearTimeout(previewTimers.get(trackId));
  previewTimers.set(
    trackId,
    setTimeout(() => {
      pad.classList.remove("hit");
      previewTimers.delete(trackId);
    }, 110),
  );
  waveform.setEnergy(trackId, 1);
  setTimeout(() => waveform.setEnergy(trackId, 0), 130);
}

function syncAll() {
  syncInspector();
  syncPads();
  syncSequence();
  syncTransportFields();
  syncSummary();
  waveform.setProject(project);
  waveform.setSelected(selectedIndex);
}

function syncSummary() {
  dom.noteCount.textContent = String(countNotes(project));
  dom.tempoSummary.textContent = String(project.bpm);
  dom.transportDuration.textContent = formatDurationSummary();
  updateLoopClasses();
}

function syncInspector() {
  const track = currentTrack();
  const index = selectedIndex;
  const slice = kit.slices[index];
  const cropSeconds = Math.max(0, (track.end - track.start) * slice.duration);
  dom.inspectorTitle.textContent = track.name;
  dom.inspectorNumber.textContent = String(index + 1).padStart(2, "0");
  dom.inspectorDetail.textContent = track.detail;
  dom.cropDuration.textContent = `${cropSeconds.toFixed(2)} s crop`;
  dom.triggerKey.textContent = track.key;
  dom.keySelect.value = track.key;
  dom.muteTrack.setAttribute("aria-pressed", String(track.muted));
  dom.muteTrack.textContent = track.muted ? "MUTED" : "MUTE";

  dom.startRange.value = String(Math.round(track.start * 1000));
  dom.startRange.max = String(Math.max(0, Math.round((track.end - 0.02) * 1000)));
  dom.endRange.value = String(Math.round(track.end * 1000));
  dom.endRange.min = String(Math.min(1000, Math.round((track.start + 0.02) * 1000)));
  dom.fadeInRange.value = String(Math.round(track.fadeIn * 1000));
  dom.fadeOutRange.value = String(Math.round(track.fadeOut * 1000));
  dom.pitchRange.value = String(track.pitch);
  dom.gainRange.value = String(Math.round(track.gain * 100));
  dom.startOutput.textContent = `${Math.round(track.start * slice.duration * 1000)} ms`;
  dom.endOutput.textContent = `${Math.round(track.end * slice.duration * 1000)} ms`;
  dom.fadeInOutput.textContent = `${Math.round(track.fadeIn * 1000)} ms`;
  dom.fadeOutOutput.textContent = `${Math.round(track.fadeOut * 1000)} ms`;
  dom.pitchOutput.textContent = formatPitch(track.pitch);
  dom.gainOutput.textContent = `${Math.round(track.gain * 100)}%`;
  dom.inspectorTitle
    .closest(".inspector")
    .style.setProperty("--track-accent", track.color);
  [dom.startRange, dom.endRange, dom.fadeInRange, dom.fadeOutRange, dom.pitchRange, dom.gainRange]
    .forEach(updateRangeFill);

  dom.pitchTrackName.textContent = track.name;
  dom.pitchReadout.textContent = formatPitch(track.pitch);
  const marks = [...dom.pitchSteps.children];
  marks.forEach((mark, markIndex) => {
    const low = Math.min(12, 12 + track.pitch);
    const high = Math.max(12, 12 + track.pitch);
    mark.classList.toggle("lit", markIndex >= low && markIndex <= high);
  });
}

function syncPads() {
  padButtons.forEach((button, index) => {
    const track = project.tracks[index];
    button.style.setProperty("--track-color", track.color);
    button.querySelector(".pad-key").textContent = track.key;
    button.querySelector(".pad-copy strong").textContent = `0${index + 1} ${track.name}`;
    button.querySelector(".pad-pitch").textContent = formatPitch(track.pitch);
    button.classList.toggle("selected", index === selectedIndex);
    button.classList.toggle("muted", track.muted);
    button.setAttribute("aria-pressed", String(index === selectedIndex));
    button.setAttribute("aria-label", `触发 ${track.name}，快捷键 ${track.key}`);
  });
}

function syncSequence() {
  sequenceRows.forEach(({ row, stepButtons, selectButton, muteButton, gain, trackIndex }) => {
    const track = project.tracks[trackIndex];
    row.style.setProperty("--track-color", track.color);
    row.classList.toggle("is-muted", track.muted);
    selectButton.querySelector(".track-copy small").textContent =
      `KEY ${track.key} · ${formatPitch(track.pitch)}`;
    muteButton.setAttribute("aria-pressed", String(track.muted));
    gain.textContent = `${Math.round(track.gain * 100)}%`;
    stepButtons.forEach((button, step) => {
      button.classList.toggle("active", track.steps[step]);
      button.setAttribute("aria-pressed", String(track.steps[step]));
    });
  });
  updateLoopClasses();
}

function updateLoopClasses() {
  const range = getPlaybackRange(project);
  const rulerCells = [...dom.stepRuler.children];
  sequenceRows.forEach(({ stepButtons }) => {
    stepButtons.forEach((button, step) => {
      const beat = step / 4;
      const inside = project.loop && beat >= range.start - 1e-9 && beat < range.end - 1e-9;
      button.classList.toggle("in-loop", inside);
      button.classList.toggle("outside-loop", project.loop && !inside);
    });
  });
  rulerCells.forEach((cell, step) => {
    const beat = step / 4;
    const inside = project.loop && beat >= range.start - 1e-9 && beat < range.end - 1e-9;
    cell.classList.toggle("in-loop", inside);
  });
}

function syncTransportFields() {
  dom.projectName.value = project.name;
  dom.tempoInput.value = String(project.bpm);
  dom.speedRange.value = String(project.speed);
  dom.speedOutput.textContent = `${project.speed.toFixed(2)}×`;
  dom.loopStartInput.value = String(project.loopStart);
  dom.loopEndInput.value = String(project.loopEnd);
  dom.masterRange.value = String(Math.round(project.masterGain * 100));
  dom.loopButton.classList.toggle("active", project.loop);
  dom.loopButton.setAttribute("aria-pressed", String(project.loop));
  updateRangeFill(dom.speedRange);
  updateRangeFill(dom.masterRange);
}

function updateTransportVisual(state) {
  const playing = Boolean(state.playing);
  dom.engineStatus.classList.toggle("playing", playing);
  dom.engineStatus.classList.toggle("ready", state.audioReady && !playing);
  dom.engineStatusText.textContent = playing
    ? `PLAYING · ${state.activeVoices} VOICE${state.activeVoices === 1 ? "" : "S"}`
    : state.audioReady
      ? "音频引擎就绪"
      : "等待音频手势";

  dom.playButton.classList.toggle("playing", playing);
  dom.playButton.setAttribute("aria-label", playing ? "暂停" : "播放");
  dom.playIcon.textContent = playing ? "Ⅱ" : "▶";
  dom.transportTag.classList.toggle("playing", playing);
  dom.transportTag.textContent = playing ? "RUNNING" : state.audioReady ? "READY" : "STOPPED";
  dom.voiceCount.textContent = `${state.activeVoices} VOICE${state.activeVoices === 1 ? "" : "S"}`;
  dom.auditVoices.textContent = String(state.activeVoices);
  dom.levelMeter.style.width = `${playing ? Math.round(engine.getLevel() * 100) : 0}%`;

  const beat = Math.max(0, Math.min(TOTAL_BEATS, state.positionBeat));
  const bar = Math.min(2, Math.floor(beat / 4) + 1);
  const beatInBar = Math.floor(beat % 4) + 1;
  const subdivision = Math.min(4, Math.floor((beat % 1) * 4) + 1);
  dom.barDisplay.textContent = String(bar).padStart(2, "0");
  dom.beatDisplay.textContent = `${beatInBar}.${subdivision}`;
  dom.transportPosition.textContent =
    `0${bar} : ${beatInBar}.${subdivision}`;
  const clockProject = engine.project ?? project;
  const seconds = beat * (60 / (clockProject.bpm * clockProject.speed));
  dom.timeDisplay.textContent = formatTime(seconds);

  for (const button of currentStepButtons) button.classList.remove("current");
  currentStepButtons = [];
  const step = playing ? state.currentStep : -1;
  if (step >= 0 && step < TOTAL_STEPS) {
    currentStepButtons = sequenceRows.map((row) => row.stepButtons[step]);
    currentStepButtons.forEach((button) => button.classList.add("current"));
    dom.stepRuler.children[step]?.classList.add("current");
  }
  [...dom.stepRuler.children].forEach((cell, index) => {
    if (index !== step) cell.classList.remove("current");
  });
  padButtons.forEach((button, index) => {
    const track = project.tracks[index];
    button.classList.toggle("live", playing && track.steps[step] && !track.muted);
  });
}

function updateRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value);
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100));
  input.style.setProperty("--fill", `${percent}%`);
}

function formatPitch(pitch) {
  return `${pitch >= 0 ? "+" : ""}${pitch} st`;
}

function formatDurationSummary() {
  const range = getPlaybackRange(project);
  const bars = (range.end - range.start) / 4;
  const barLabel = Math.abs(bars - 1) < 1e-9 ? "BAR" : "BARS";
  const prefix = project.loop ? "LOOP " : "";
  return `${prefix}${Number(bars.toFixed(3))} ${barLabel} · ${getExportDuration(project).toFixed(3)} s`;
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function markAuditStale() {
  projectVersion += 1;
  if (auditRunning) return;
  auditCurrent = false;
  setAuditBadge("pending", "STALE");
}

function setAuditBadge(kind, text) {
  dom.auditBadge.className = `audit-badge ${kind}`;
  dom.auditBadge.replaceChildren(
    Object.assign(document.createElement("span"), { textContent: "" }),
    document.createTextNode(text),
  );
}

async function runAudit() {
  if (auditRunning) {
    auditQueued = true;
    return;
  }
  auditRunning = true;
  const startingVersion = projectVersion;
  dom.runAudit.disabled = true;
  setAuditBadge("running", "RUNNING");
  dom.auditBeatList.textContent = "保存工程 → 解析重载 → 双缓冲离线渲染…";

  try {
    const savedText = serializeProject(project);
    const reloaded = parseProject(savedText);
    const notesBefore = countNotes(project);
    const notesAfter = countNotes(reloaded);
    const positionsBefore = beatPositions(project);
    const positionsAfter = beatPositions(reloaded);
    const beatHash = hashText(positionsBefore.join("|"));
    const beatHashAfter = hashText(positionsAfter.join("|"));
    const maxBeatDelta = Math.max(
      0,
      ...positionsBefore.map((beat, index) =>
        Math.abs(beat - (positionsAfter[index] ?? Infinity)),
      ),
    );

    const [bufferBefore, bufferAfter] = await Promise.all([
      engine.renderProject(project),
      engine.renderProject(reloaded),
    ]);
    const durationBefore = bufferBefore.duration;
    const durationAfter = bufferAfter.duration;
    const fingerprintBefore = engineFingerprint(bufferBefore);
    const fingerprintAfter = engineFingerprint(bufferAfter);

    const loopProbe = structuredClone(project);
    loopProbe.loopStart = 0;
    loopProbe.loopEnd = TOTAL_BEATS + 4;
    const repairedLoop = sanitizeProject(loopProbe);
    const loopClamped = repairedLoop.loopEnd === TOTAL_BEATS;
    const notesMatch = notesBefore === notesAfter;
    const beatsMatch =
      positionsBefore.length === positionsAfter.length &&
      maxBeatDelta < 1e-9 &&
      beatHash === beatHashAfter;
    const durationMatch = Math.abs(durationBefore - durationAfter) < 1e-9;
    const audioMatch = Math.abs(fingerprintBefore - fingerprintAfter) < 1e-9;
    const resourcesClear = engine.playing || engine.voices.length === 0;
    const pass =
      notesMatch &&
      beatsMatch &&
      durationMatch &&
      audioMatch &&
      loopClamped &&
      resourcesClear;

    dom.auditNotesBefore.textContent = String(notesBefore);
    dom.auditNotesAfter.textContent = String(notesAfter);
    dom.auditBeatsBefore.textContent =
      `${(positionsBefore[0] ?? 0).toFixed(2)}–${(positionsBefore.at(-1) ?? 0).toFixed(2)}`;
    dom.auditBeatsAfter.textContent =
      `${(positionsAfter[0] ?? 0).toFixed(2)}–${(positionsAfter.at(-1) ?? 0).toFixed(2)}`;
    dom.auditDurationBefore.textContent = `${durationBefore.toFixed(3)} s`;
    dom.auditDurationAfter.textContent = `${durationAfter.toFixed(3)} s`;
    dom.auditLoopBefore.textContent = `${(TOTAL_BEATS + 4).toFixed(2)}`;
    dom.auditLoopAfter.textContent = `${repairedLoop.loopEnd.toFixed(2)}`;
    dom.auditPeak.textContent = Math.max(
      fingerprintBefore,
      fingerprintAfter,
    ).toFixed(4);
    const firstPositions = [...new Set(positionsBefore)].slice(0, 5).map((beat) =>
      beat.toFixed(2),
    );
    dom.auditBeatList.textContent =
      `${firstPositions.join(" / ")} … ${positionsBefore.at(-1)?.toFixed(2) ?? "0.00"} · ` +
      `位置哈希 ${beatHash} · Δ ${maxBeatDelta.toFixed(6)} 拍 · PCM Δ ${Math.abs(fingerprintBefore - fingerprintAfter).toFixed(6)}`;

    if (startingVersion !== projectVersion) {
      auditCurrent = false;
      setAuditBadge("pending", "STALE");
      dom.auditBeatList.textContent = "校验期间工程已变更，请重新运行一致性校验";
    } else {
      auditCurrent = pass;
      setAuditBadge(pass ? "pass" : "fail", pass ? "PASS" : "CHECK");
    }
  } catch (error) {
    console.error(error);
    auditCurrent = false;
    setAuditBadge("fail", "ERROR");
    dom.auditBeatList.textContent = error.message || "一致性校验失败";
  } finally {
    auditRunning = false;
    dom.runAudit.disabled = false;
    if (auditQueued) {
      auditQueued = false;
      setTimeout(runAudit, 0);
    }
  }
}

function engineFingerprint(buffer) {
  let sum = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 113) {
      sum += data[index] * data[index];
      count += 1;
    }
  }
  return sum / Math.max(1, count);
}

function hashText(text) {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

async function exportAudio() {
  if (dom.exportWav.classList.contains("busy")) return;
  dom.exportWav.classList.add("busy");
  dom.exportWav.setAttribute("aria-busy", "true");
  try {
    const result = await engine.exportWav(project);
    const filename = `${slug(project.name)}-${result.duration.toFixed(2)}s.wav`;
    downloadBlob(result.blob, filename);
    dom.auditPeak.textContent = result.fingerprint.toFixed(4);
    showToast(
      `WAV 已导出 · ${result.duration.toFixed(3)} s · ${filename}`,
    );
  } catch (error) {
    showToast(error.message || "WAV 导出失败", true);
  } finally {
    dom.exportWav.classList.remove("busy");
    dom.exportWav.removeAttribute("aria-busy");
  }
}

function saveProject() {
  const text = serializeProject(project);
  try {
    saveProjectToStorage(project);
  } catch {
    showToast("浏览器本地存储不可用，仍会下载工程文件", true);
  }
  downloadBlob(
    new Blob([text], { type: "application/json" }),
    `${slug(project.name)}.slice04.json`,
  );
  showToast("工程已保存：每轨参数、增益、音序与循环区均已记录");
}

async function loadProjectFile(event) {
  const [file] = event.target.files ?? [];
  if (!file) return;
  try {
    const loaded = parseProject(await file.text());
    await loadProject(loaded, { autoplay: true });
    showToast("工程已重新载入 · 从头开始播放并重新校验");
  } catch (error) {
    showToast(error.message || "工程文件载入失败", true);
  } finally {
    dom.projectFile.value = "";
  }
}

async function loadProject(nextProject, { autoplay = false } = {}) {
  engine.stop();
  project = sanitizeProject(nextProject);
  selectedIndex = 0;
  engine.setProject(project);
  syncAll();
  markAuditStale();
  setTimeout(runAudit, 280);
  if (autoplay) {
    try {
      await engine.play();
    } catch (error) {
      showToast(`工程已载入，点击播放开始：${error.message}`, true);
    }
  }
}

function handleKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  const inField =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
  if (inField) return;

  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
    return;
  }
  if (event.code === "Escape") {
    event.preventDefault();
    engine.stop();
    showToast("已停止 · 活动声部归零");
    return;
  }
  if (event.repeat) return;
  const pressed = String(event.key).toUpperCase();
  const trackIndex = project.tracks.findIndex(
    (track) => String(track.key).toUpperCase() === pressed,
  );
  if (trackIndex >= 0) {
    event.preventDefault();
    selectTrack(trackIndex);
    triggerTrack(project.tracks[trackIndex].id);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function slug(value) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "") || "slice04-project"
  );
}

function showToast(message, isError = false) {
  if (toastTimer) clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle("error", isError);
  dom.toast.classList.add("visible");
  toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), 3200);
}

buildInterface();

globalThis.slice04 = Object.freeze({
  engine,
  runAudit,
  getProject: () => structuredClone(project),
  getState: () => engine.getState(),
  getAudit: () => ({
    current: auditCurrent,
    running: auditRunning,
    version: projectVersion,
  }),
  pause: () => engine.pause(),
  stop: () => engine.stop(),
});
