// 控件绑定与工程存取：保存每轨参数与增益；载入后自动从头播放并输出对比报告。

import {
  serializeProject, deserializeProject, saveToStorage, loadFromStorage,
  patternLength,
} from './project.js';
import { planEvents, exportDurationSeconds, renderProject } from './exporter.js';
import { downloadWav } from './wav.js';
import { $, setBadge, hideResult, renderVerifyReport, buildTrackPanel } from './ui.js';

const VERIFY_KEY = 'glass-harmonica-verify-v1';

export function bindControls(app) {
  $('btn-play').addEventListener('click', () => startPlayback(app));
  $('btn-pause').addEventListener('click', () => togglePause(app));
  $('btn-stop').addEventListener('click', () => {
    app.sequencer.stop();
    hideResult();
  });

  $('chk-loop').addEventListener('change', (e) => app.sequencer.setLoop(e.target.checked));
  $('rng-tempo').addEventListener('input', (e) => {
    app.sequencer.setTempo(Number(e.target.value));
    $('val-tempo').textContent = `${app.project.tempo} BPM`;
  });
  $('rng-transpose').addEventListener('input', (e) => {
    app.sequencer.setTranspose(Number(e.target.value));
    $('val-transpose').textContent = `${app.project.transpose} st`;
  });

  $('btn-save').addEventListener('click', () => saveProject(app));
  $('btn-save-file').addEventListener('click', () => {
    const blob = new Blob([serializeProject(app.project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'glass-project.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('btn-load-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const json = await file.text();
    await loadProject(app, json);
    e.target.value = '';
  });

  $('btn-export-wav').addEventListener('click', () => exportWav(app));
  $('btn-repair').addEventListener('click', () => {
    app.project.tracks.forEach((t) => { t.broken = false; });
    app.refreshReadout();
  });
  $('btn-cool').addEventListener('click', () => {
    app.engine.temperatures.fill(0);
    app.refreshReadout();
  });
}

async function startPlayback(app) {
  hideResult();
  app.project.tracks.forEach((t) => { t.broken = false; });
  await app.sequencer.play();
}

async function togglePause(app) {
  if (app.sequencer.state === 'playing') {
    await app.sequencer.pause();
  } else if (app.sequencer.state === 'paused') {
    await app.sequencer.resume();
  }
}

function saveProject(app) {
  saveToStorage(app.project);
  // 记录首轮指标，供下次重新载入后对比（至少比较节拍位置与导出时长）。
  localStorage.setItem(VERIFY_KEY, JSON.stringify(metricsSnapshot(app.project)));
  $('btn-save').textContent = '✓ 已保存';
  setTimeout(() => { $('btn-save').textContent = '💾 保存工程'; }, 1200);
}

async function loadProject(app, jsonOrProject) {
  const reloaded = deserializeProject(jsonOrProject);
  const previous = readVerifySnapshot();
  applyProject(app, reloaded);
  syncControlInputs(app, reloaded);
  if (previous) showComparison(previous, metricsSnapshot(reloaded));
  // 重新载入后从头播放。
  await startPlayback(app);
}

export function applyProject(app, reloaded) {
  app.sequencer.stop();
  app.project = reloaded;
  app.engine.project = reloaded;
  app.engine.temperatures.fill(0);
  reloaded.tracks.forEach((t, i) => app.engine.setTrackGain(i, t.gain));
  app.sequencer.project = reloaded;
  app.sequencer.notesByStep = buildNoteIndex(reloaded);
  app.sequencer.scheduler.load({
    tempo: reloaded.tempo, transpose: reloaded.transpose,
    loop: reloaded.loop, patternLength: patternLength(reloaded),
  });
  app.renderer.project = reloaded;
  app.renderer.heatMap.fill(0);
  buildTrackPanel(reloaded, (i, field, value) => app.onTrackChange(i, field, value));
}

function buildNoteIndex(project) {
  const map = new Map();
  for (const note of project.melody) map.set(note.step, note);
  return map;
}

function syncControlInputs(app, project) {
  $('chk-loop').checked = project.loop;
  $('rng-tempo').value = project.tempo;
  $('val-tempo').textContent = `${project.tempo} BPM`;
  $('rng-transpose').value = project.transpose;
  $('val-transpose').textContent = `${project.transpose} st`;
  setBadge(app.sequencer.state);
}

async function exportWav(app) {
  const snapshot = deserializeProject(serializeProject(app.project));
  const result = await renderProject(snapshot, { loops: 1 });
  downloadWav(result.wav, 'glass-melody.wav');
}

export function metricsSnapshot(project) {
  const events = planEvents(project, { loops: 1 });
  return {
    noteCount: events.length,
    beatPositions: events.map((e) => e.beat),
    exportDuration: exportDurationSeconds(project, 1),
    trackGains: project.tracks.map((t) => Number(t.gain.toFixed(4))),
    trackWaters: project.tracks.map((t) => Number(t.water.toFixed(4))),
  };
}

function readVerifySnapshot() {
  try {
    const raw = localStorage.getItem(VERIFY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function showComparison(first, reloaded) {
  const sameArray = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  const rows = [
    { label: '音符数量', first: first.noteCount, reloaded: reloaded.noteCount,
      match: first.noteCount === reloaded.noteCount },
    { label: '节拍位置(拍)',
      first: `[${first.beatPositions.join(', ')}]`,
      reloaded: `[${reloaded.beatPositions.join(', ')}]`,
      match: sameArray(first.beatPositions, reloaded.beatPositions) },
    { label: '导出时长(秒)',
      first: first.exportDuration.toFixed(3),
      reloaded: reloaded.exportDuration.toFixed(3),
      match: Math.abs(first.exportDuration - reloaded.exportDuration) < 1e-9 },
    { label: '每轨增益',
      first: `[${first.trackGains.join(', ')}]`,
      reloaded: `[${reloaded.trackGains.join(', ')}]`,
      match: sameArray(first.trackGains, reloaded.trackGains) },
    { label: '每轨水位',
      first: `[${first.trackWaters.join(', ')}]`,
      reloaded: `[${reloaded.trackWaters.join(', ')}]`,
      match: sameArray(first.trackWaters, reloaded.trackWaters) },
  ];
  renderVerifyReport({
    rows,
    note: `共 ${reloaded.noteCount} 个音符，首轮与重载后均从第 0 拍开始；导出时长 ${reloaded.exportDuration.toFixed(3)}s。`,
  });
  localStorage.removeItem(VERIFY_KEY);
}

export function bootstrapReloadCheck(app) {
  const saved = loadFromStorage();
  const verify = readVerifySnapshot();
  if (saved && verify) {
    return { project: saved, verify };
  }
  return null;
}
