import {
  Transport, defaultProject, durationSec, pitchName, PITCH_COUNT, projectStats,
} from './core.js';
import { AudioEngine } from './audio.js';
import { Renderer, transportRef } from './render.js';
import { storage, downloadProject, readProjectFile, downloadWav, reloadComparison } from './persistence.js';
import { runSelfCheck } from './selftest.js';

const $ = (id) => document.getElementById(id);

const state = {
  project: storage.load() ?? defaultProject(),
  transport: null,
  engine: null,
  renderer: null,
  raf: 0,
};

function init() {
  // 重新载入后从头播放：transport 起点恒为 0，由用户按下播放启动
  state.engine = new AudioEngine(state.project);
  state.transport = new Transport(() => state.engine.now(), durationSec(state.project));
  state.renderer = new Renderer($('score'), $('cylinder'), state.project, state.engine.events);
  buildTrackHeads();
  buildTrackEditors();
  buildPalette();
  bindControls();
  syncControls();
  window.addEventListener('resize', () => state.renderer.fit());;
  window.addEventListener('beforeunload', () => {
    state.engine.hardStopAll();
  });
  requestAnimationFrame(frame);
  runChecks();
  showReloadBanner();
  window.__engine = state.engine;
  window.__transport = state.transport;
  window.__stats = () => projectStats(state.project);
}

function frame() {
  const { transport, renderer, engine, project } = state;
  if (transport.running && transport.wrapIfNeeded()) {
    engine.cursor = 0;
    if (!project.loop) pauseAll();
  }
  transportRef.virtualTime = transport.virtualTime;
  renderer.pulseAt(transport.virtualTime);
  renderer.drawScore(transport);
  renderer.drawCylinder(transport);
  state.raf = requestAnimationFrame(frame);
}

// ---- 传输控制 ----
async function playAll() {
  const { transport, engine } = state;
  await engine.ensureContext();
  if (transport.virtualTime >= transport.duration - 1e-6) transport.seekToStart();
  transport.start();
  engine.cursor = Math.max(engine.cursor, transport.virtualTime);
  engine.startScheduler(transport);
}

function pauseAll() {
  const { transport, engine } = state;
  transport.pause();
  engine.stopScheduler();
  engine.hardStopAll(); // 任何节点停止后不残留声音
}

function stopAll() {
  const { transport, engine } = state;
  transport.stop();
  engine.hardStopAll();
  engine.cursor = 0;
}

function applySpeed() {
  const { transport, engine, project } = state;
  const wasRunning = transport.running;
  engine.stopScheduler();
  engine.hardStopAll();
  transport.reanchor(durationSec(project));
  engine.rebuildEvents();
  state.renderer.update(project, engine.events);
  if (wasRunning) {
    transport.start();
    engine.cursor = transport.virtualTime;
    engine.startScheduler(transport);
  }
  persist();
}

function rebuildAfterEdit() {
  const { transport, engine, project, renderer } = state;
  engine.rebuildEvents();
  transport.setDuration(durationSec(project));
  renderer.update(project, engine.events);
  buildTrackHeads();
  persist();
}

function persist() {
  storage.save(state.project);
}

// ---- 轨道 UI ----
function buildTrackHeads() {
  const wrap = $('trackHeads');
  wrap.innerHTML = '';
  wrap.style.gridTemplateColumns = `repeat(${state.project.tracks.length}, 1fr)`;
  for (const tr of state.project.tracks) {
    const div = document.createElement('div');
    div.className = 'track-head';
    div.innerHTML = `<span class="name">${tr.name}</span>
      <input type="range" min="0" max="1" step="0.01" value="${tr.gain}" data-gain="${tr.id}" />
      <span class="gain">${tr.gain.toFixed(2)}</span>`;
    div.querySelector('input').addEventListener('input', (e) => {
      tr.gain = Number(e.target.value);
      div.querySelector('.gain').textContent = tr.gain.toFixed(2);
      rebuildAfterEdit();
      syncEditors();
    });
    wrap.appendChild(div);
  }
}

function buildTrackEditors() {
  const wrap = $('trackEditors');
  wrap.innerHTML = '';
  for (const tr of state.project.tracks) {
    const box = document.createElement('div');
    box.className = 'track-editor';
    box.dataset.track = tr.id;
    box.innerHTML = `
      <div class="row"><label>名称</label><input type="text" data-f="name" value="${tr.name}" /></div>
      <div class="row"><label>增益</label><input type="range" min="0" max="1" step="0.01" data-f="gain" value="${tr.gain}" /></div>
      <div class="row"><label>变调(cent)</label><input type="number" step="1" data-f="detune" value="${tr.detune}" /></div>
      <div class="row"><label>声像</label><input type="range" min="-1" max="1" step="0.05" data-f="pan" value="${tr.pan}" /></div>
      <div class="row"><label>静音</label><input type="checkbox" data-f="mute" ${tr.mute ? 'checked' : ''} /></div>`;
    box.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      if (f === 'mute') tr.mute = e.target.checked;
      else if (f === 'name') tr.name = e.target.value;
      else tr[f] = Number(e.target.value);
      rebuildAfterEdit();
      buildTrackHeads();
    });
    wrap.appendChild(box);
  }
}

function syncEditors() {
  for (const box of document.querySelectorAll('.track-editor')) {
    const tr = state.project.tracks.find((t) => t.id === box.dataset.track);
    if (!tr) continue;
    box.querySelector('[data-f=gain]').value = tr.gain;
  }
}

function buildPalette() {
  const pal = $('palette');
  pal.innerHTML = '<span style="color:#9aa0b5;align-self:center">拖入谱面：</span>';
  for (let p = 0; p < PITCH_COUNT; p += 1) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.draggable = true;
    chip.textContent = pitchName(p);
    chip.dataset.pitch = p;
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/pitch', String(p));
      e.dataTransfer.effectAllowed = 'copy';
    });
    pal.appendChild(chip);
  }
}

// ---- 谱面拖放与点击编辑 ----
function bindCanvasEditing() {
  const canvas = $('score');
  const trash = $('trash');
  canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    trash.classList.add('armed');
  });
  canvas.addEventListener('dragleave', () => trash.classList.remove('armed'));
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    trash.classList.remove('armed');
    const pitch = Number(e.dataTransfer.getData('text/pitch'));
    if (Number.isNaN(pitch)) return;
    const loc = state.renderer.locate(e.clientX, e.clientY);
    addNote(state.project.tracks[loc.trackIdx].id, loc.pitch ?? pitch, loc.beat);
  });
  canvas.addEventListener('click', (e) => {
    const hit = state.renderer.locateNote(e.clientX, e.clientY);
    if (hit) {
      state.project.notes = state.project.notes.filter((nt) => nt.id !== hit.noteId);
    } else {
      const loc = state.renderer.locate(e.clientX, e.clientY);
      addNote(state.project.tracks[loc.trackIdx].id, loc.pitch, loc.beat);
    }
    rebuildAfterEdit();
  });
  let dragGhost = null;
  canvas.addEventListener('mousedown', (e) => {
    const hit = state.renderer.locateNote(e.clientX, e.clientY);
    if (!hit) return;
    dragGhost = hit;
    const move = (ev) => {
      trash.classList.toggle('armed', ev.clientX > canvas.getBoundingClientRect().right - 110);
    };
    const up = (ev) => {
      const inTrash = ev.clientX > canvas.getBoundingClientRect().right - 110;
      if (inTrash) {
        state.project.notes = state.project.notes.filter((nt) => nt.id !== dragGhost.noteId);
      } else {
        const loc = state.renderer.locate(ev.clientX, ev.clientY);
        const note = state.project.notes.find((nt) => nt.id === dragGhost.noteId);
        if (note) {
          note.track = state.project.tracks[loc.trackIdx].id;
          note.pitch = loc.pitch;
          note.beat = loc.beat;
        }
      }
      trash.classList.remove('armed');
      rebuildAfterEdit();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragGhost = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

let noteCounter = 0;
function addNote(trackId, pitch, beat) {
  if (beat > state.project.totalBeats) return;
  state.project.notes.push({
    id: `u${Date.now().toString(36)}${(noteCounter += 1)}`,
    track: trackId, pitch, beat,
  });
}

function bindControls() {
  $('btnPlay').addEventListener('click', playAll);
  $('btnPause').addEventListener('click', pauseAll);
  $('btnStop').addEventListener('click', stopAll);
  $('btnRunCheck').addEventListener('click', runChecks);
  $('chkLoop').addEventListener('change', (e) => {
    state.project.loop = e.target.checked;
    persist();
  });
  $('rngSpeed').addEventListener('input', (e) => {
    state.project.speed = Number(e.target.value);
    $('lblSpeed').textContent = `${state.project.speed.toFixed(2)}×`;
    applySpeed();
  });
  $('rngBpm').addEventListener('input', (e) => {
    state.project.bpm = Number(e.target.value);
    $('lblBpm').textContent = state.project.bpm;
    applySpeed();
  });
  $('btnSave').addEventListener('click', () => {
    persist();
    downloadProject(state.project);
  });
  $('btnLoad').addEventListener('click', () => $('fileLoad').click());
  $('fileLoad').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const loaded = await readProjectFile(file);
      replaceProject(loaded);
    } catch (err) {
      alert(err.message);
    }
    e.target.value = '';
  });
  $('btnExport').addEventListener('click', async () => {
    const btn = $('btnExport');
    btn.disabled = true;
    btn.textContent = '渲染中…';
    try {
      state.engine.rebuildEvents();
      const { wav, duration } = await state.engine.renderOffline();
      downloadWav(wav);
      console.info(`[musicbox] WAV 导出时长 ${duration.toFixed(3)}s`);
    } catch (err) {
      alert(`导出失败: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '🎵 导出 WAV';
    }
  });
  $('btnReloadCheck').addEventListener('click', () => {
    storage.setBaseline(state.project);
    storage.save(state.project);
    location.reload();
  });
  bindCanvasEditing();
}

function replaceProject(project) {
  stopAll();
  state.project = project;
  state.engine.project = project;
  state.engine.rebuildEvents();
  state.transport = new Transport(() => state.engine.now(), durationSec(project));
  state.renderer.update(project, state.engine.events);
  buildTrackHeads();
  buildTrackEditors();
  syncControls();
  persist();
  runChecks();
}

function syncControls() {
  $('rngSpeed').value = state.project.speed;
  $('lblSpeed').textContent = `${state.project.speed.toFixed(2)}×`;
  $('rngBpm').value = state.project.bpm;
  $('lblBpm').textContent = state.project.bpm;
  $('chkLoop').checked = state.project.loop;
}

function runChecks() {
  const report = runSelfCheck(state.project);
  const el = $('report');
  el.innerHTML = '';
  for (const r of report.results) {
    const div = document.createElement('div');
    div.className = `case ${r.pass ? 'pass' : 'fail'}`;
    div.innerHTML = `<span class="tag">${r.pass ? '✓' : '✗'}</span>
      <div><div>${r.name}</div><div class="detail">${r.detail}</div></div>`;
    el.appendChild(div);
  }
  const cmp = reloadComparison(state.project);
  if (cmp) {
    const h = document.createElement('h3');
    h.textContent = '刷新前后对照（基线来自 localStorage）';
    h.style.cssText = 'margin:10px 0 4px;font-size:13px';
    el.appendChild(h);
    const table = document.createElement('table');
    table.innerHTML = `<tr><th>指标</th><th>首轮</th><th>重载</th></tr>
      <tr><td>音符数量</td><td>${cmp.noteCountBefore}</td><td>${cmp.noteCountAfter}</td></tr>
      <tr><td>节拍对齐</td><td colspan="2">${cmp.beatsAligned ? '完全一致' : `${cmp.beatMismatch.length} 处不一致`}</td></tr>
      <tr><td>导出时长(s)</td><td>${cmp.exportDurationBefore.toFixed(4)}</td><td>${cmp.exportDurationAfter.toFixed(4)}</td></tr>
      <tr><td>每轨增益</td><td colspan="2">${cmp.baseline.gains.map((g) => `${g.id}:${g.gain.toFixed(2)}`).join(' ')}</td></tr>`;
    el.appendChild(table);
  }
  console.info('[musicbox] 自检', report);
}

function showReloadBanner() {
  const cmp = reloadComparison(state.project);
  if (!cmp) return;
  const el = $('report');
  const banner = document.createElement('div');
  banner.className = `case ${cmp.noteCountMatch && cmp.beatsAligned && cmp.exportDurationMatch ? 'pass' : 'fail'}`;
  banner.innerHTML = `<span class="tag">${cmp.noteCountMatch && cmp.beatsAligned && cmp.exportDurationMatch ? '✓' : '✗'}</span>
    <div><div>页面重载完成：工程已从头加载</div>
    <div class="detail">音符 ${cmp.noteCountBefore}→${cmp.noteCountAfter}；导出时长 ${cmp.exportDurationBefore.toFixed(4)}→${cmp.exportDurationAfter.toFixed(4)}s</div></div>`;
  el.prepend(banner);
}

init();
