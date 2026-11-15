import { CONFIG } from './config.js';
import {
  createGame,
  startGame,
  pauseGame,
  resumeGame,
  move,
  scan,
  listen,
  markReef,
  removeMarker,
  submitConclusions,
  publicState,
} from './engine.js';
import { ensureContext, suspendContext, playScan, playListen, playUi } from './audio.js';
import { drawMap, drawWaveform, drawGauges } from './render.js';

const $ = (id) => document.getElementById(id);
const els = {
  seed: $('seed-input'),
  start: $('btn-start'),
  pause: $('btn-pause'),
  resume: $('btn-resume'),
  reopen: $('btn-reopen'),
  submit: $('btn-submit'),
  scan: $('btn-scan'),
  listen: $('btn-listen'),
  mark: $('btn-mark'),
  status: $('status-line'),
  map: $('map-canvas'),
  wave: $('wave-canvas'),
  gauge: $('gauge-canvas'),
  waveMeta: $('wave-meta'),
  logList: $('log-list'),
  eventList: $('event-list'),
  band: $('band-select'),
  current: $('current-select'),
  reefX: $('reef-x'),
  reefY: $('reef-y'),
  settlement: $('settlement'),
};

let game = null;
let selectedLogId = null;

function initSelects() {
  for (const band of CONFIG.bands) {
    const opt = document.createElement('option');
    opt.value = band.id;
    opt.textContent = `${band.label}（${band.range[0]}-${band.range[1]}Hz）`;
    els.band.appendChild(opt);
  }
  for (const dir of CONFIG.dirs) {
    const opt = document.createElement('option');
    opt.value = dir.id;
    opt.textContent = `${dir.label}（${dir.id}）`;
    els.current.appendChild(opt);
  }
}

function newCase() {
  const seed = els.seed.value.trim() || 'abyss-771';
  els.seed.value = seed;
  game = createGame(seed);
  selectedLogId = null;
  els.settlement.classList.add('hidden');
  els.settlement.innerHTML = '';
  els.reefX.value = '';
  els.reefY.value = '';
  els.band.value = '';
  els.current.value = '';
  renderAll();
}

function setStatus() {
  const map = {
    idle: '待开始',
    running: '调查中（逻辑时间 %t s，能源 %e）',
    paused: '已暂停：声音与逻辑时间冻结，线索内容不变',
    ended: '已结算（同 seed 重开可复现全部线索）',
  };
  let text = map[game.status];
  text = text.replace('%t', game.time.toFixed(1)).replace('%e', Math.round(game.energy));
  if (game.status === 'running' || game.status === 'paused') {
    text += `；信标 ${game.collected.length}/${CONFIG.beaconCount}；扫描 ${game.scans} 次`;
  }
  els.status.textContent = `状态：${text}`;
  const running = game.status === 'running';
  els.start.disabled = game.status !== 'idle';
  els.pause.disabled = !running;
  els.resume.disabled = game.status !== 'paused';
  els.submit.disabled = game.status === 'idle' || game.status === 'ended';
  for (const id of ['scan', 'listen', 'mark']) els[id].disabled = !running;
  document.querySelectorAll('.dpad button').forEach((b) => (b.disabled = !running));
}

function renderAll() {
  const reveal = game.status === 'ended';
  drawMap(els.map, game, { reveal });
  drawGauges(els.gauge, game);
  const selected = game.log.find((e) => e.id === selectedLogId) || null;
  drawWaveform(els.wave, selected);
  renderWaveMeta(selected);
  renderLog();
  renderEvents();
  setStatus();
}

function renderWaveMeta(entry) {
  if (!entry) {
    els.waveMeta.textContent = '尚未选择线索';
    return;
  }
  if (entry.type === 'scan') {
    els.waveMeta.textContent =
      `${entry.id} @ ${entry.t.toFixed(1)}s 格(${entry.x},${entry.y})：` +
      `${entry.echoes.length} 组回波，本底噪声 ${entry.noiseFloor}，杂波 ${entry.clutter.length} 个`;
  } else {
    els.waveMeta.textContent =
      `${entry.id} @ ${entry.t.toFixed(1)}s 格(${entry.x},${entry.y})：` +
      `主频 ${entry.measuredFreq}Hz，声像偏向 ${entry.pan}，湍流 ${entry.turbulence}`;
  }
}

function renderLog() {
  els.logList.innerHTML = '';
  for (const entry of game.log) {
    const li = document.createElement('li');
    if (entry.id === selectedLogId) li.classList.add('active');
    li.textContent =
      entry.type === 'scan'
        ? `${entry.id} [扫描 t=${entry.t.toFixed(1)}s] 回波 ${entry.echoes.length} 组 / 杂波 ${entry.clutter.length} / 噪声 ${entry.noiseFloor}`
        : `${entry.id} [监听 t=${entry.t.toFixed(1)}s] ${entry.measuredFreq}Hz / 偏向 ${entry.pan} / 湍流 ${entry.turbulence}`;
    li.addEventListener('click', () => replayEntry(entry.id));
    els.logList.appendChild(li);
  }
}

function renderEvents() {
  els.eventList.innerHTML = '';
  for (const ev of game.events.slice(0, 12)) {
    const li = document.createElement('li');
    li.textContent = `t=${ev.t.toFixed(1)}s ${ev.text}`;
    els.eventList.appendChild(li);
  }
}

// 重播：只读取已存描述符重新合成声音与波形，不新增日志、不改状态与时间。
function replayEntry(id) {
  if (game.status === 'idle') return;
  const entry = game.log.find((e) => e.id === id);
  if (!entry) return;
  selectedLogId = id;
  drawWaveform(els.wave, entry);
  renderWaveMeta(entry);
  renderLog();
  if (game.status !== 'paused') {
    ensureContext();
    if (entry.type === 'scan') playScan(entry);
    else playListen(entry);
  }
}

function afterAction(result, sound) {
  if (!result || result.ok === false) {
    if (result && result.reason !== 'not-running') playUi('error');
    return;
  }
  if (sound) playUi(sound);
  const entry = result.entry;
  if (entry) {
    selectedLogId = entry.id;
    ensureContext();
    if (entry.type === 'scan') playScan(entry);
    else playListen(entry);
  }
  renderAll();
}

function doMove(dirId) {
  const result = move(game, dirId);
  afterAction(result, result?.hitReef ? 'error' : 'move');
  if (result?.beacon) playUi('collect');
}

function renderSettlement(verdict) {
  const rows = verdict.judgments
    .map((j) => {
      const tag = j.correct ? '<span class="ok">正确</span>' : '<span class="bad">错误</span>';
      return `<tr>
        <td>${j.dimensionLabel}</td>
        <td>${j.player}</td>
        <td>${j.truth}</td>
        <td>${j.evidence.sourceName}<br>${j.evidence.detail}</td>
        <td>${tag}${j.errorDim ? `<br><span class="bad">错误维度：${j.errorDim}</span>` : ''}</td>
      </tr>`;
    })
    .join('');
  const errors = verdict.judgments.filter((j) => !j.correct);
  const errorBlock = errors.length
    ? `<div class="error-dim">错误提示：${errors
        .map((j) => `「${j.dimensionLabel}」判断有误，具体维度为 <b>${j.errorDim}</b>`)
        .join('；')}</div>`
    : '<div class="summary ok">全部判断正确，推断与真实参数完全对应。</div>';
  const mission = verdict.missionSuccess
    ? '<span class="ok">任务成功：三信标回收并返回母舰</span>'
    : '<span class="bad">任务未完成：未在能源耗尽前回收三信标并返回</span>';
  els.settlement.innerHTML = `
    <div class="summary">${mission}；判断正确率 ${verdict.judgments.filter((j) => j.correct).length}/${verdict.judgments.length}</div>
    <table>
      <thead><tr><th>判断维度</th><th>你的推断</th><th>真实参数</th><th>对应声源 / 时间 / 频段</th><th>结果</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${errorBlock}`;
  els.settlement.classList.remove('hidden');
}

function wire() {
  initSelects();
  newCase();

  els.start.addEventListener('click', () => {
    ensureContext();
    startGame(game);
    renderAll();
  });
  els.pause.addEventListener('click', () => {
    pauseGame(game);
    suspendContext();
    renderAll();
  });
  els.resume.addEventListener('click', () => {
    ensureContext();
    resumeGame(game);
    renderAll();
  });
  els.reopen.addEventListener('click', () => {
    ensureContext();
    newCase();
    startGame(game);
    renderAll();
  });
  els.scan.addEventListener('click', () => afterAction(scan(game)));
  els.listen.addEventListener('click', () => afterAction(listen(game)));

  els.mark.addEventListener('click', () => {
    const x = Number(els.reefX.value);
    const y = Number(els.reefY.value);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      playUi('error');
      return;
    }
    const result = markReef(game, x, y);
    afterAction(result, 'mark');
  });

  els.map.addEventListener('click', (ev) => {
    if (game.status !== 'running') return;
    const rect = els.map.getBoundingClientRect();
    const cell = rect.width / CONFIG.gridSize;
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * els.map.width / cell);
    const y = Math.floor(((ev.clientY - rect.top) / rect.height) * els.map.height / cell);
    const existing = game.markers.find((m) => m.x === x && m.y === y);
    const result = existing ? removeMarker(game, x, y) : markReef(game, x, y);
    afterAction(result, 'mark');
  });

  els.submit.addEventListener('click', () => {
    const guesses = {
      reef:
        els.reefX.value === '' || els.reefY.value === ''
          ? null
          : { x: Number(els.reefX.value), y: Number(els.reefY.value) },
      bandId: els.band.value || null,
      currentDirId: els.current.value || null,
    };
    const result = submitConclusions(game, guesses);
    if (result.ok) {
      renderAll();
      renderSettlement(result.verdict);
    }
  });

  document.querySelectorAll('.dpad button').forEach((btn) => {
    btn.addEventListener('click', () => doMove(btn.dataset.dir));
  });

  const keyMap = {
    ArrowUp: 'N', KeyW: 'N',
    ArrowDown: 'S', KeyS: 'S',
    ArrowLeft: 'W', KeyA: 'W',
    ArrowRight: 'E', KeyD: 'E',
    KeyQ: 'NW', KeyE: 'NE', KeyZ: 'SW', KeyC: 'SE',
  };
  window.addEventListener('keydown', (ev) => {
    const dir = keyMap[ev.code];
    if (dir && game.status === 'running') {
      ev.preventDefault();
      doMove(dir);
    }
  });
}

wire();
