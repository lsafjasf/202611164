import { AudioEngine } from "./audio.js";
import { collectNotes, compareProjects, noteStats } from "./notes.js";
import {
  automationAt,
  createDemoProject,
  deserializeProject,
  loadProject,
  normalizeProject,
  saveProject,
  serializeProject,
  STORAGE_KEY,
  updateTrack
} from "./project.js";
import { TimelineRenderer } from "./renderer.js";
import { signedBeatError, TransportClock } from "./transport.js";
import { durationOfBuffer, wavBlob } from "./wav.js";

const $ = (selector) => document.querySelector(selector);
const SNAP = 0.05;

let project = loadProject();
let selectedId = project.tracks[0]?.id || "rain";
let notes = collectNotes(project);
let dirty = true;
let savedAt = null;
let verificationRunning = false;
let toastTimer = null;
let dragState = null;
let paletteDragType = null;

const canvas = $("#timeline");
const renderer = new TimelineRenderer(canvas);
const engine = new AudioEngine(project);

const controls = {
  play: $("#playBtn"),
  pause: $("#pauseBtn"),
  stop: $("#stopBtn"),
  loop: $("#loopBtn"),
  speed: $("#speedRange"),
  speedReadout: $("#speedReadout"),
  save: $("#saveBtn"),
  reload: $("#reloadBtn"),
  export: $("#exportBtn"),
  verify: $("#verifyBtn"),
  time: $("#timeReadout"),
  audioDot: $("#audioDot"),
  audioStatus: $("#audioStatus"),
  activeSources: $("#activeSources"),
  latency: $("#latencyValue"),
  master: $("#masterReadout"),
  beat: $("#beatReadout"),
  note: $("#noteReadout"),
  clip: $("#clipReadout"),
  inspectorTitle: $("#inspectorTitle"),
  inspectorChip: $("#inspectorChip"),
  mute: $("#muteBtn"),
  solo: $("#soloBtn"),
  resetTrack: $("#resetTrackBtn"),
  gain: $("#gainControl"),
  gainValue: $("#gainValue"),
  pan: $("#panControl"),
  panValue: $("#panValue"),
  pitch: $("#pitchControl"),
  pitchValue: $("#pitchValue"),
  start: $("#startControl"),
  startValue: $("#startValue"),
  duration: $("#durationControl"),
  durationValue: $("#durationValue"),
  fadeIn: $("#fadeInControl"),
  fadeInValue: $("#fadeInValue"),
  fadeOut: $("#fadeOutControl"),
  fadeOutValue: $("#fadeOutValue"),
  pattern: $("#patternControl"),
  automationCount: $("#automationCount"),
  automationList: $("#automationList"),
  addPoint: $("#addPointBtn"),
  revision: $("#revisionReadout"),
  savedAt: $("#savedAt"),
  verifyResult: $("#verifyResult"),
  metricNotes: $("#metricNotes"),
  metricBeats: $("#metricBeats"),
  metricTracks: $("#metricTracks"),
  metricDuration: $("#metricDuration"),
  toast: $("#toast"),
  busy: $("#busyOverlay"),
  busyLabel: $("#busyLabel")
};

function selectedTrack() {
  return project.tracks.find((track) => track.id === selectedId) || project.tracks[0];
}

function formatPan(value) {
  if (Math.abs(value) < 0.01) return "C";
  return `${value < 0 ? "L" : "R"} ${Math.round(Math.abs(value) * 100)}`;
}

function snapTime(value) {
  return Math.round(value / SNAP) * SNAP;
}

function showToast(message, error = false) {
  if (toastTimer) clearTimeout(toastTimer);
  controls.toast.textContent = message;
  controls.toast.classList.toggle("error", error);
  controls.toast.classList.add("visible");
  toastTimer = setTimeout(() => controls.toast.classList.remove("visible"), 3400);
}

function setBusy(visible, label = "正在渲染离线音频…") {
  controls.busy.classList.toggle("visible", visible);
  controls.busy.setAttribute("aria-hidden", String(!visible));
  controls.busyLabel.textContent = label;
}

function markDirty() {
  dirty = true;
  controls.savedAt.textContent = "有未保存改动";
}

function refreshProjectViews({ audio = true, reanchor = true } = {}) {
  notes = collectNotes(project);
  if (audio) engine.setProject(project, { reanchor });
  renderer.setProject(project, notes);
  renderer.setSelected(selectedId);
  updateInspector();
  updateStats();
  controls.loop.setAttribute("aria-pressed", String(project.loop));
  controls.speed.value = String(project.speed);
  controls.speedReadout.textContent = `${project.speed.toFixed(2)}×`;
  controls.master.textContent = project.masterGain.toFixed(2);
  markDirty();
}

function updateStats() {
  controls.note.textContent = String(notes.length);
  const onTimeline = project.tracks.filter((track) => track.duration > 0).length;
  controls.clip.textContent = `${onTimeline}/${project.tracks.length}`;
  controls.revision.textContent = String(project.revision).padStart(2, "0");
}

function updateInspector() {
  const track = selectedTrack();
  if (!track) return;
  controls.inspectorTitle.textContent = track.name;
  controls.inspectorChip.textContent = track.type.toUpperCase();
  controls.inspectorChip.style.color = track.color;
  controls.gain.value = String(track.gain);
  controls.gainValue.textContent = track.gain.toFixed(2);
  controls.pan.value = String(track.pan);
  controls.panValue.textContent = formatPan(track.pan);
  controls.pitch.value = String(track.pitch);
  controls.pitchValue.textContent = `${track.pitch > 0 ? "+" : ""}${track.pitch} st`;
  controls.start.max = String(Math.max(0, project.length - track.duration));
  controls.start.value = String(track.start);
  controls.startValue.textContent = `${track.start.toFixed(2)} s`;
  controls.duration.max = String(project.length - track.start);
  controls.duration.value = String(track.duration);
  controls.durationValue.textContent = `${track.duration.toFixed(2)} s`;
  controls.fadeIn.max = String(Math.min(8, track.duration));
  controls.fadeIn.value = String(track.fadeIn);
  controls.fadeInValue.textContent = `${track.fadeIn.toFixed(2)} s`;
  controls.fadeOut.max = String(Math.min(8, track.duration));
  controls.fadeOut.value = String(track.fadeOut);
  controls.fadeOutValue.textContent = `${track.fadeOut.toFixed(2)} s`;
  controls.pattern.value = String(track.pattern);
  controls.mute.classList.toggle("active", track.muted);
  controls.solo.classList.toggle("active", track.solo);
  renderAutomationList(track);
}

function renderAutomationList(track) {
  controls.automationCount.textContent = String(track.automation.length);
  controls.automationList.replaceChildren();
  if (!track.automation.length) {
    const empty = document.createElement("div");
    empty.className = "automation-empty";
    empty.textContent = "双击轨道添加自动化点";
    controls.automationList.append(empty);
    return;
  }
  track.automation.forEach((point, index) => {
    const row = document.createElement("div");
    row.className = "automation-item";
    const time = document.createElement("span");
    time.textContent = `${point.time.toFixed(2)}s`;
    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.min(100, (point.value / 1.5) * 100)}%`;
    bar.append(fill);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "删除自动化点";
    remove.textContent = "×";
    remove.addEventListener("click", () => removeAutomationPoint(index));
    row.append(time, bar, remove);
    controls.automationList.append(row);
  });
}

function removeAutomationPoint(index) {
  const track = selectedTrack();
  if (!track || track.automation.length <= 2) {
    showToast("至少保留两个自动化点", true);
    return;
  }
  const automation = track.automation.filter((_, pointIndex) => pointIndex !== index);
  project = updateTrack(project, track.id, { automation });
  refreshProjectViews();
}

function updateTrackFromControl(field, value) {
  project = updateTrack(project, selectedId, { [field]: value });
  refreshProjectViews({ audio: false });
}

function commitAudioProject() {
  engine.setProject(project, { reanchor: true });
  markDirty();
}

function bindRange(input, field, formatter, mapper = Number) {
  input.addEventListener("input", () => updateTrackFromControl(field, mapper(input.value)));
  input.addEventListener("change", commitAudioProject);
  input.addEventListener("blur", () => {
    const track = selectedTrack();
    if (track) formatter(track);
  });
}

bindRange(controls.gain, "gain", (track) => {
  controls.gainValue.textContent = track.gain.toFixed(2);
});
bindRange(controls.pan, "pan", (track) => {
  controls.panValue.textContent = formatPan(track.pan);
});
bindRange(controls.pitch, "pitch", (track) => {
  controls.pitchValue.textContent = `${track.pitch > 0 ? "+" : ""}${track.pitch} st`;
});
bindRange(controls.start, "start", (track) => {
  controls.startValue.textContent = `${track.start.toFixed(2)} s`;
}, (value) => snapTime(Number(value)));
bindRange(controls.duration, "duration", (track) => {
  controls.durationValue.textContent = `${track.duration.toFixed(2)} s`;
}, (value) => snapTime(Number(value)));
bindRange(controls.fadeIn, "fadeIn", (track) => {
  controls.fadeInValue.textContent = `${track.fadeIn.toFixed(2)} s`;
}, (value) => snapTime(Number(value)));
bindRange(controls.fadeOut, "fadeOut", (track) => {
  controls.fadeOutValue.textContent = `${track.fadeOut.toFixed(2)} s`;
}, (value) => snapTime(Number(value)));

controls.pattern.addEventListener("change", () => {
  updateTrackFromControl("pattern", Number(controls.pattern.value));
  commitAudioProject();
});

controls.mute.addEventListener("click", () => {
  const track = selectedTrack();
  project = updateTrack(project, track.id, { muted: !track.muted });
  refreshProjectViews();
});

controls.solo.addEventListener("click", () => {
  const track = selectedTrack();
  project = updateTrack(project, track.id, { solo: !track.solo });
  refreshProjectViews();
});

controls.resetTrack.addEventListener("click", () => {
  const original = createDemoProject().tracks.find((track) => track.id === selectedId);
  if (!original) return;
  project = {
    ...project,
    tracks: project.tracks.map((track) => track.id === selectedId ? original : track),
    revision: project.revision + 1
  };
  refreshProjectViews();
  showToast(`${original.name}层已恢复到示例参数`);
});

controls.addPoint.addEventListener("click", () => {
  const track = selectedTrack();
  const local = Math.max(0, Math.min(track.duration, engine.getPosition() - track.start));
  addAutomationAt(track, local, Math.max(0.25, automationAt(track, local)));
});

function addAutomationAt(track, local, value) {
  const automation = [...track.automation, { time: local, value }];
  project = updateTrack(project, track.id, { automation });
  refreshProjectViews();
  showToast(`已在 ${local.toFixed(2)}s 添加自动化点`);
}

controls.play.addEventListener("click", async () => {
  try {
    if (engine.isPlaying) engine.pause();
    else await engine.play();
    updateAudioStatus();
  } catch (error) {
    showToast(`无法启动音频：${error.message}`, true);
  }
});

controls.pause.addEventListener("click", () => {
  engine.pause();
  updateAudioStatus();
});

controls.stop.addEventListener("click", () => {
  engine.stop();
  updateAudioStatus();
});

controls.loop.addEventListener("click", () => {
  project = { ...project, loop: !project.loop, revision: project.revision + 1 };
  engine.project = project;
  controls.loop.setAttribute("aria-pressed", String(project.loop));
  markDirty();
});

controls.speed.addEventListener("input", () => {
  const speed = Number(controls.speed.value);
  project = { ...project, speed, revision: project.revision + 1 };
  engine.project = project;
  engine.setSpeed(speed);
  controls.speedReadout.textContent = `${speed.toFixed(2)}×`;
  markDirty();
});

function updateAudioStatus() {
  const live = engine.isPlaying;
  controls.audioDot.classList.toggle("live", live);
  controls.audioStatus.textContent = live
    ? "音频引擎运行中"
    : engine.context?.state === "suspended" ? "音频上下文已挂起" : "音频引擎待机";
  document.body.classList.toggle("is-playing", live);
  controls.latency.textContent = engine.context
    ? `${Math.round((engine.context.outputLatency || engine.context.baseLatency || 0) * 1000)} ms`
    : "—";
}

function addKeyboardListeners() {
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      controls.play.click();
    } else if (event.code === "Escape") {
      event.preventDefault();
      engine.stop();
      updateAudioStatus();
    }
  });
}

function selectTrack(id) {
  if (!project.tracks.some((track) => track.id === id)) return;
  selectedId = id;
  renderer.setSelected(id);
  updateInspector();
}

function editorProject(trackId, patch) {
  project = updateTrack(project, trackId, patch);
  refreshProjectViews({ audio: false });
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const hit = renderer.hitTest(event.clientX, event.clientY);
  if (!hit) return;
  if (hit.kind === "ruler") {
    engine.seek(hit.time);
    updateAudioStatus();
    return;
  }
  if (!hit.track) return;
  selectTrack(hit.track.id);
  if (hit.kind === "track") return;
  const originTrack = project.tracks.find((track) => track.id === hit.track.id);
  dragState = {
    pointerId: event.pointerId,
    kind: hit.kind,
    trackId: hit.track.id,
    pointIndex: hit.pointIndex,
    startX: event.clientX,
    startY: event.clientY,
    originStart: originTrack.start,
    originDuration: originTrack.duration,
    originFadeIn: originTrack.fadeIn,
    originFadeOut: originTrack.fadeOut,
    offset: hit.offset || 0,
    moved: false
  };
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragState) {
    const hit = renderer.hitTest(event.clientX, event.clientY);
    const cursors = {
      ruler: "crosshair",
      automation: "grab",
      fadeIn: "ew-resize",
      fadeOut: "ew-resize",
      resize: "ew-resize",
      clip: "grab",
      track: "default"
    };
    canvas.style.cursor = cursors[hit?.kind] || "default";
    return;
  }
  if (event.pointerId !== dragState.pointerId) return;
  const delta = ((event.clientX - dragState.startX) / renderer.timelineWidth) * project.length;
  const track = project.tracks.find((candidate) => candidate.id === dragState.trackId);
  if (!track) return;
  dragState.moved = true;
  if (dragState.kind === "clip") {
    const target = renderer.xToTime(event.clientX) - dragState.offset;
    editorProject(track.id, { start: snapTime(Math.max(0, target)) });
  } else if (dragState.kind === "resize") {
    const duration = Math.max(0.25, Math.min(project.length - dragState.originStart, dragState.originDuration + delta));
    editorProject(track.id, { duration: snapTime(duration) });
  } else if (dragState.kind === "fadeIn") {
    editorProject(track.id, { fadeIn: snapTime(Math.max(0, Math.min(track.duration, dragState.originFadeIn + delta))) });
  } else if (dragState.kind === "fadeOut") {
    editorProject(track.id, { fadeOut: snapTime(Math.max(0, Math.min(track.duration, dragState.originFadeOut - delta))) });
  } else if (dragState.kind === "automation") {
    const index = dragState.pointIndex;
    const lower = index > 0 ? track.automation[index - 1].time + 0.01 : 0;
    const upper = index < track.automation.length - 1
      ? track.automation[index + 1].time - 0.01
      : track.duration;
    const localTime = Math.max(lower, Math.min(upper, renderer.xToTime(event.clientX) - track.start));
    const value = renderer.automationValueFromY(track, event.clientY - canvas.getBoundingClientRect().top);
    const automation = track.automation.map((point, pointIndex) =>
      pointIndex === index ? { time: localTime, value } : point
    );
    editorProject(track.id, { automation });
  }
});

function finishPointerDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (dragState.moved) {
    engine.setProject(project, { reanchor: true });
    markDirty();
  }
  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch {
    // Capture may already be released.
  }
  dragState = null;
}

canvas.addEventListener("pointerup", finishPointerDrag);
canvas.addEventListener("pointercancel", finishPointerDrag);

canvas.addEventListener("dblclick", (event) => {
  const hit = renderer.hitTest(event.clientX, event.clientY);
  if (!hit?.track || !["clip", "track"].includes(hit.kind)) return;
  const track = hit.track;
  const local = Math.max(0, Math.min(track.duration, renderer.xToTime(event.clientX) - track.start));
  const value = renderer.automationValueFromY(track, event.clientY - canvas.getBoundingClientRect().top);
  addAutomationAt(track, local, value);
});

for (const card of document.querySelectorAll(".layer-card")) {
  const type = card.dataset.type;
  card.addEventListener("click", () => {
    const track = project.tracks.find((candidate) => candidate.type === type);
    if (track) selectTrack(track.id);
  });
  card.addEventListener("keydown", (event) => {
    if (event.code !== "Enter" && event.code !== "Space") return;
    event.preventDefault();
    const track = project.tracks.find((candidate) => candidate.type === type);
    if (track) selectTrack(track.id);
  });
  card.addEventListener("dragstart", (event) => {
    paletteDragType = type;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/x-soundscape-layer", type);
    document.body.classList.add("is-dragging");
  });
  card.addEventListener("dragend", () => {
    paletteDragType = null;
    document.body.classList.remove("is-dragging");
    renderer.setDropPreview(null);
  });
}

canvas.addEventListener("dragover", (event) => {
  if (!paletteDragType) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const track = project.tracks.find((candidate) => candidate.type === paletteDragType);
  if (!track) return;
  const time = Math.max(0, Math.min(project.length - track.duration, renderer.xToTime(event.clientX)));
  renderer.setDropPreview({ trackId: track.id, time });
});

canvas.addEventListener("dragleave", () => renderer.setDropPreview(null));

canvas.addEventListener("drop", (event) => {
  event.preventDefault();
  const type = event.dataTransfer.getData("text/x-soundscape-layer") || paletteDragType;
  const track = project.tracks.find((candidate) => candidate.type === type);
  renderer.setDropPreview(null);
  document.body.classList.remove("is-dragging");
  if (!track) return;
  const start = Math.max(0, Math.min(project.length - track.duration, renderer.xToTime(event.clientX)));
  selectTrack(track.id);
  project = updateTrack(project, track.id, { start: snapTime(start) });
  refreshProjectViews();
  showToast(`${track.name}层已放置到 ${project.tracks.find((item) => item.id === track.id).start.toFixed(2)}s`);
  paletteDragType = null;
});

function saveNow({ silent = false } = {}) {
  saveProject(project);
  dirty = false;
  savedAt = new Date();
  controls.savedAt.textContent = savedAt.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  if (!silent) showToast("工程已保存：4 条轨道的位置、增益、自动化与速度均已写入本地");
}

controls.save.addEventListener("click", () => saveNow());

function syncLoadedProject(next, message) {
  project = next;
  if (!project.tracks.some((track) => track.id === selectedId)) selectedId = project.tracks[0].id;
  notes = collectNotes(project);
  engine.setProject(project, { reset: true });
  renderer.setProject(project, notes);
  renderer.setSelected(selectedId);
  controls.loop.setAttribute("aria-pressed", String(project.loop));
  controls.speed.value = String(project.speed);
  controls.speedReadout.textContent = `${project.speed.toFixed(2)}×`;
  controls.master.textContent = project.masterGain.toFixed(2);
  updateInspector();
  updateStats();
  updateAudioStatus();
  dirty = false;
  if (message) showToast(message);
}

controls.reload.addEventListener("click", () => {
  engine.pause();
  const restored = loadProject();
  controls.savedAt.textContent = localStorage.getItem(STORAGE_KEY) ? "本地工程 · 已重载" : "示例工程 · 已重载";
  syncLoadedProject(restored, "工程已重新载入，播放头归零，等待从头播放");
});

function fileNameForProject() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `rain-lane-soundscape-${stamp}.wav`;
}

async function exportWav() {
  if (verificationRunning) return;
  engine.pause();
  updateAudioStatus();
  setBusy(true, "正在渲染 20 秒双声道 WAV…");
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const result = await engine.renderOffline(project);
    const blob = wavBlob(result.buffer);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileNameForProject();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(
      `WAV 已导出 · ${result.duration.toFixed(3)}s · 峰值 ${(result.peakAfter * 100).toFixed(1)}% · 无削波`
    );
  } catch (error) {
    showToast(`导出失败：${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

controls.export.addEventListener("click", exportWav);

function setMetric(element, text, good) {
  element.textContent = text;
  const card = element.closest(".metric-card");
  card.classList.toggle("good", good === true);
  card.classList.toggle("bad", good === false);
}

function transportDriftTest() {
  const clock = new TransportClock({ duration: 20, speed: 1 });
  const start = 100;
  const active = 0.05;
  const gap = 0.007;
  clock.play(start);
  let cursor = start;
  for (let index = 0; index < 80; index += 1) {
    cursor += active;
    clock.pause(cursor);
    cursor += gap;
    clock.play(cursor);
  }
  cursor += active;
  clock.pause(cursor);
  const expected = 81 * active;
  return Math.abs(signedBeatError(clock.basePosition, expected, 120));
}

async function runVerification() {
  if (verificationRunning) return;
  verificationRunning = true;
  controls.verify.disabled = true;
  engine.pause();
  updateAudioStatus();
  const releasedSources = engine.activeSourceCount;
  const driftBeats = transportDriftTest();
  setBusy(true, "正在执行重载对照与两次离线渲染…");
  controls.verifyResult.dataset.state = "idle";
  controls.verifyResult.textContent = "正在序列化工程、比较节拍位置并渲染首轮 WAV…";
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const source = normalizeProject(project);
    saveNow({ silent: true });
    const before = deserializeProject(serializeProject(source));
    const after = loadProject();
    const comparison = compareProjects(before, after);
    setMetric(controls.metricNotes, `${comparison.before.count} → ${comparison.after.count}`, comparison.noteCountMatches);
    setMetric(
      controls.metricBeats,
      comparison.beatSignatureMatches
        ? `${comparison.before.signature.slice(0, 8)} = ${comparison.after.signature.slice(0, 8)}`
        : `${comparison.before.signature.slice(0, 8)} ≠ ${comparison.after.signature.slice(0, 8)}`,
      comparison.beatSignatureMatches
    );
    setMetric(
      controls.metricTracks,
      comparison.trackPositionsMatch
        ? `${before.tracks.length}/${after.tracks.length} 一致`
        : "位置偏移",
      comparison.trackPositionsMatch
    );
    controls.verifyResult.textContent = "节拍位置一致；正在渲染重载后的第二个 WAV…";

    const firstRender = await engine.renderOffline(before);
    const secondRender = await engine.renderOffline(after);
    const durationMatches = firstRender.frames === secondRender.frames
      && Math.abs(firstRender.duration - secondRender.duration) < 1e-9;
    const peakSafe = firstRender.clipSafe && secondRender.clipSafe;
    setMetric(
      controls.metricDuration,
      `${firstRender.duration.toFixed(3)} → ${secondRender.duration.toFixed(3)}s`,
      durationMatches
    );

    syncLoadedProject(after);
    saveNow({ silent: true });
    controls.savedAt.textContent = "重载后从头播放";
    const allGood = comparison.noteCountMatches
      && comparison.beatSignatureMatches
      && comparison.trackPositionsMatch
      && durationMatches
      && peakSafe
      && releasedSources === 0
      && driftBeats < 1e-9;
    controls.verifyResult.dataset.state = allGood ? "good" : "bad";
    const matchingPositions = comparison.before.positions.filter(
      (position, index) => position === comparison.after.positions[index]
    ).length;
    controls.verifyResult.textContent =
      `${allGood ? "PASS" : "CHECK"} · 音符 ${comparison.before.count}/${comparison.after.count} · ` +
      `beat ${comparison.before.signature}/${comparison.after.signature} · ` +
      `位置 ${matchingPositions}/${comparison.before.count} · ` +
      `WAV ${firstRender.frames}/${secondRender.frames} frames @ ${firstRender.sampleRate}Hz · ` +
      `峰值 ${(Math.max(firstRender.peakAfter, secondRender.peakAfter) * 100).toFixed(1)}% · ` +
      `暂停恢复漂移 ${driftBeats.toFixed(9)} beat · 活动源 ${releasedSources}`;
    showToast(allGood ? "重载对照通过，导出时长与节拍位置完全一致" : "对照完成，但存在不一致项", !allGood);
    return {
      allGood,
      comparison,
      firstRender: {
        frames: firstRender.frames,
        duration: firstRender.duration,
        peak: firstRender.peakAfter
      },
      secondRender: {
        frames: secondRender.frames,
        duration: secondRender.duration,
        peak: secondRender.peakAfter
      },
      driftBeats,
      releasedSources
    };
  } catch (error) {
    controls.verifyResult.dataset.state = "bad";
    controls.verifyResult.textContent = `自检失败：${error.message}`;
    showToast(`自检失败：${error.message}`, true);
    throw error;
  } finally {
    verificationRunning = false;
    controls.verify.disabled = false;
    setBusy(false);
  }
}

controls.verify.addEventListener("click", () => {
  runVerification().catch(() => {});
});

function beatDisplay(position) {
  const beats = position / (60 / project.bpm);
  const bar = Math.floor(beats / 4) + 1;
  const quarter = Math.floor(beats % 4) + 1;
  const sixteenth = Math.floor((beats % 1) * 4) + 1;
  return `${String(bar).padStart(2, "0")}.${quarter}.${sixteenth}`;
}

let lastBeatLabel = "";
let lastSourceCount = -1;

function animationFrame() {
  const position = engine.getAudiblePosition();
  renderer.setPlayback(position, engine.isPlaying);
  renderer.draw();
  controls.time.textContent = position.toFixed(2).padStart(5, "0");
  const beatLabel = beatDisplay(position);
  if (beatLabel !== lastBeatLabel) {
    controls.beat.textContent = beatLabel;
    lastBeatLabel = beatLabel;
  }
  if (engine.activeSourceCount !== lastSourceCount) {
    lastSourceCount = engine.activeSourceCount;
    controls.activeSources.textContent = String(lastSourceCount);
  }
  requestAnimationFrame(animationFrame);
}

engine.subscribe((event) => {
  if (["transport", "activity", "context", "speed"].includes(event.type)) {
    updateAudioStatus();
    controls.activeSources.textContent = String(engine.activeSourceCount);
  }
  if (event.type === "transport" && event.state === "ended") {
    showToast("已播放到 20 秒终点，音频节点已全部释放");
  }
});

function initialize() {
  notes = collectNotes(project);
  renderer.setProject(project, notes);
  renderer.setSelected(selectedId);
  updateInspector();
  updateStats();
  controls.loop.setAttribute("aria-pressed", String(project.loop));
  controls.speed.value = String(project.speed);
  controls.speedReadout.textContent = `${project.speed.toFixed(2)}×`;
  controls.master.textContent = project.masterGain.toFixed(2);
  controls.note.textContent = String(notes.length);
  controls.savedAt.textContent = localStorage.getItem(STORAGE_KEY)
    ? "本地工程 · 已载入"
    : "示例工程 · 未保存";
  dirty = false;
  updateAudioStatus();
  addKeyboardListeners();
  requestAnimationFrame(animationFrame);
}

window.addEventListener("beforeunload", () => engine.panic());

globalThis.__soundscape = {
  getProject: () => JSON.parse(JSON.stringify(project)),
  getState: () => ({
    notes: notes.length,
    position: engine.getAudiblePosition(),
    playing: engine.isPlaying,
    activeSources: engine.activeSourceCount,
    dirty,
    sampleRate: engine.context?.sampleRate || null
  }),
  play: () => engine.play(),
  pause: () => engine.pause(),
  stop: () => engine.stop(),
  seek: (time) => engine.seek(time),
  save: () => saveNow({ silent: true }),
  reload: () => syncLoadedProject(loadProject()),
  exportWav,
  verify: runVerification,
  compare: () => compareProjects(project, loadProject()),
  stats: () => noteStats(project)
};

initialize();
