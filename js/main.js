import { Engine, defaultProject } from './engine.js';
import { Maze, MAZE_DEPTH, MAX_PROBES } from './maze.js';
import {
  renderSequence, saveProject, loadProject,
  saveBaseline, loadBaseline, compareMetrics,
} from './render.js';
import { encodeWav } from './wav.js';

const $ = (id) => document.getElementById(id);

let project = loadProject() || defaultProject();
let engine = new Engine(project);
let maze = null;
let echoBlips = [];   // {time, pan, echoes[]} 供回响画布按音频时钟绘制

/* ---------- 走带控制 ---------- */

function refreshTransport() {
  $('btn-play').disabled = engine.playing && !engine.paused;
  $('btn-pause').disabled = !engine.playing || engine.paused;
  $('btn-stop').disabled = !engine.playing;
  $('btn-play').textContent = engine.paused ? '▶ 继续' : '▶ 播放';
}

function refreshParams() {
  $('rng-speed').value = project.speed;
  $('speed-val').textContent = `${Number(project.speed).toFixed(2)}×`;
  $('rng-pitch').value = project.pitch;
  $('pitch-val').textContent = project.pitch;
  $('chk-loop').checked = project.loop;
}

$('btn-play').addEventListener('click', () => {
  if (engine.paused) engine.resume();
  else engine.start();
  refreshTransport();
});
$('btn-pause').addEventListener('click', () => {
  engine.pause();
  refreshTransport();
});
$('btn-stop').addEventListener('click', () => {
  engine.stop();
  log('停止：所有音序节点已停止并断开，资源已释放。');
  refreshTransport();
});
$('chk-loop').addEventListener('change', (e) => engine.setLoop(e.target.checked));
$('rng-speed').addEventListener('input', (e) => {
  engine.setSpeed(Number(e.target.value));
  refreshParams();
});
$('rng-pitch').addEventListener('input', (e) => {
  engine.setPitch(Number(e.target.value));
  refreshParams();
});

/* ---------- 音轨表 ---------- */

function buildTrackTable() {
  const tbody = $('track-table').querySelector('tbody');
  tbody.innerHTML = '';
  for (const [name, tr] of Object.entries(project.tracks)) {
    const row = document.createElement('tr');
    const params = Object.entries(tr.params)
      .map(([k, v]) => `${k}=${v}`).join(', ');
    row.innerHTML = `
      <td>${name}</td>
      <td><input type="range" min="0" max="1" step="0.05"
           value="${tr.gain}" data-track="${name}">
          <span id="gain-${name}">${tr.gain}</span></td>
      <td>${params}</td>`;
    tbody.appendChild(row);
  }
  tbody.querySelectorAll('input[type=range]').forEach((sl) => {
    sl.addEventListener('input', () => {
      engine.setTrackGain(sl.dataset.track, Number(sl.value));
      $(`gain-${sl.dataset.track}`).textContent = sl.value;
    });
  });
}

/* ---------- 视觉同步：rAF 直接读音频时钟 ---------- */

function visualLoop() {
  requestAnimationFrame(visualLoop);
  if (!engine.ctx) return;
  const now = engine.ctx.currentTime;
  for (const ev of engine.drainVisualEvents(now)) {
    if (ev.type === 'beat') flashBeat(ev.data);
  }
  const pos = engine.beatPositionNow();
  if (pos >= 0) {
    $('beat-pos').textContent = `节拍: ${pos.toFixed(2)}`;
  }
  $('audio-state').textContent = `AudioContext: ${engine.ctx.state}`;
  drawEchoCanvas(now);
}

let lampTimer = null;
function flashBeat({ pos }) {
  const lamp = $('beat-lamp');
  lamp.classList.add('on');
  lamp.style.background = pos === 0 ? 'var(--ok)' : 'var(--accent)';
  clearTimeout(lampTimer);
  lampTimer = setTimeout(() => lamp.classList.remove('on'), 90);
}

/* ---------- 游戏 ---------- */

function log(msg) {
  const el = $('game-log');
  el.textContent += `${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function refreshGameUI() {
  if (!maze) return;
  $('ui-depth').textContent = maze.depth;
  $('ui-noise').value = maze.noiseLevel();
  $('ui-probes').textContent = maze.probesLeft;
  $('ui-checkpoints').textContent = [0, 1, 2]
    .map((i) => (i < maze.checkpoints ? '●' : '○')).join(' ');
  const active = engine.playing && !maze.submitted;
  $('btn-left').disabled = !active || maze.inWrongNode || maze.depth >= MAZE_DEPTH;
  $('btn-right').disabled = !active || maze.inWrongNode || maze.depth >= MAZE_DEPTH;
  $('btn-back').disabled = !active || !maze.inWrongNode;
  $('btn-probe').disabled = !active || maze.probesLeft <= 0 || maze.inWrongNode;
  $('btn-submit').disabled = !maze.canSubmit();
}

function newGame() {
  maze = new Maze();
  if (!engine.playing) engine.start();
  engine.setNoiseLevel(0);
  echoBlips = [];
  $('route').classList.add('hidden');
  log(`新迷宫（种子 ${maze.seed}）：听声像与回响选择出口。`);
  scheduleCue();
  refreshTransport();
  refreshGameUI();
}

// 提示音量化到下一拍：节拍、音高、视觉共用同一时间网格
function scheduleCue() {
  const t = engine.nextBeatTime();
  const spec = maze.cueSpec();
  engine.cueTone(t, spec);
  echoBlips.push({ time: t, pan: spec.pan, echoes: [t + spec.echoTime, t + spec.echoTime * 2] });
}

function move(dir) {
  const res = maze.choose(dir);
  if (!res) return;
  const t = engine.nextBeatTime();
  if (res.correct) {
    log(`第 ${maze.depth} 步 ${dir === 'L' ? '左' : '右'}：正确${res.checkpoint ? '，到达检查点 ' + maze.checkpoints : ''}`);
    if (res.done) {
      engine.cueTone(t, { pan: 0, semis: 12, echoTime: 0.1, dur: 0.6 });
      log('已通过全部 3 个检查点，可以提交路径！');
    } else {
      scheduleCue();
    }
  } else {
    log(`走错通道！噪声增强到 ${(res.noiseLevel * 100).toFixed(0)}%，请后退。`);
    engine.noiseBurst(t, res.noiseLevel);
    engine.setNoiseLevel(res.noiseLevel);
  }
  refreshGameUI();
}

$('btn-left').addEventListener('click', () => move('L'));
$('btn-right').addEventListener('click', () => move('R'));
$('btn-back').addEventListener('click', () => {
  if (maze.back()) {
    log('已后退到上一个节点。');
    scheduleCue();
  }
  refreshGameUI();
});
$('btn-newgame').addEventListener('click', newGame);

$('btn-probe').addEventListener('click', () => {
  const p = maze.probe();
  if (!p) return;
  const t0 = engine.nextBeatTime();
  const t1 = t0 + engine.spb / 2;
  const eL = engine.probePing(t0, p.L.pan, p.L.echoTime);
  const eR = engine.probePing(t1, p.R.pan, p.R.echoTime);
  echoBlips.push({ time: t0, pan: p.L.pan, echoes: eL });
  echoBlips.push({ time: t1, pan: p.R.pan, echoes: eR });
  log(`探针：左回响 ${(p.L.echoTime * 1000).toFixed(0)}ms，右回响 ${(p.R.echoTime * 1000).toFixed(0)}ms（更短=更接近出口）`);
  refreshGameUI();
});

/* ---------- 回响画布 ---------- */

function drawEchoCanvas(now) {
  const cv = $('echo-canvas');
  const g = cv.getContext('2d');
  const span = 2.0; // 显示未来 2 秒
  g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#2a3540';
  g.beginPath();
  g.moveTo(0, cv.height / 2);
  g.lineTo(cv.width, cv.height / 2);
  g.stroke();
  echoBlips = echoBlips.filter((b) => b.time + 1.5 > now);
  for (const b of echoBlips) {
    const draw = (t, h, color) => {
      const x = ((t - now) / span) * cv.width;
      if (x < 0 || x > cv.width) return;
      const y = cv.height / 2 + b.pan * (cv.height / 2 - 10);
      g.fillStyle = color;
      g.fillRect(x - 1.5, y - h / 2, 3, h);
    };
    draw(b.time, 26, '#4fc3f7');
    b.echoes.forEach((t, i) => draw(t, 16 - i * 4, '#7bd88f'));
  }
}

/* ---------- 提交与路线回放 ---------- */

$('btn-submit').addEventListener('click', () => {
  const result = maze.submit();
  if (!result) return;
  log(`已提交路径：${result.moves.map((m) => m.choice).join('')}（错误 ${result.errors} 次，探针 ${result.probesUsed}/${MAX_PROBES}）`);
  drawRoute(result);
  refreshGameUI();
});

function drawRoute(result) {
  $('route').classList.remove('hidden');
  const cv = $('route-canvas');
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const x0 = 40;
  const stepX = (cv.width - 80) / MAZE_DEPTH;
  const yFor = (path, d) => {
    let y = cv.height / 2;
    let spread = cv.height / 4;
    for (let i = 0; i < d; i += 1) {
      y += (path[i] === 'L' ? -spread : spread) / 2;
      spread /= 2;
    }
    return y;
  };
  // 正确路径（绿色）
  g.strokeStyle = '#7bd88f';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x0, yFor(result.correctPath, 0));
  for (let d = 1; d <= MAZE_DEPTH; d += 1) {
    g.lineTo(x0 + stepX * d, yFor(result.correctPath, d));
  }
  g.stroke();
  // 玩家路径（蓝=正确步，红=错误步）
  const playerPath = result.moves.map((m) => m.choice);
  g.lineWidth = 2;
  let d = 0;
  let px = x0;
  let py = yFor(playerPath, 0);
  for (const m of result.moves) {
    d += 1;
    const nx = x0 + stepX * d;
    const ny = yFor(playerPath, d);
    g.strokeStyle = m.correct ? '#4fc3f7' : '#ff6b6b';
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(nx, ny);
    g.stroke();
    px = nx; py = ny;
  }
  $('route-stats').textContent =
    `正确路径 ${result.correctPath.join('')} ｜ 错误 ${result.errors} 次 ｜ 探针 ${result.probesUsed}/${MAX_PROBES}`;
}

/* ---------- 保存 / 载入 / 导出 ---------- */

$('btn-save').addEventListener('click', () => {
  saveProject(project);
  log('工程已保存（含每轨参数与增益）。');
});

$('btn-load').addEventListener('click', () => {
  const loaded = loadProject();
  if (!loaded) { log('没有已保存的工程。'); return; }
  engine.stop();
  project = loaded;
  engine = new Engine(project);   // 从头播放：位置归零
  buildTrackTable();
  refreshParams();
  refreshTransport();
  refreshGameUI();
  log('工程已重新载入，播放位置归零。');
});

$('btn-export').addEventListener('click', async () => {
  const { buffer, metrics } = await renderSequence(project);
  const blob = encodeWav(buffer);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'echo-maze.wav';
  a.click();
  URL.revokeObjectURL(a.href);
  log(`已导出 WAV：${metrics.exportDuration}s，${metrics.noteCount} 个音符。`);
});

/* ---------- 完整示例 + 重载前后对比 ---------- */

function showCompare(cmp, labelA, labelB) {
  const ok = cmp.noteCountEqual && cmp.durationEqual && cmp.maxBeatDiff < 1e-6;
  $('verify-result').innerHTML = `
    <table>
      <tr><th>指标</th><th>${labelA}</th><th>${labelB}</th><th>结论</th></tr>
      <tr><td>音符数量</td><td class="num">${cmp.noteCountA}</td>
          <td class="num">${cmp.noteCountB}</td>
          <td class="${cmp.noteCountEqual ? 'pass' : 'fail'}">${cmp.noteCountEqual ? '一致' : '不一致'}</td></tr>
      <tr><td>节拍数</td><td class="num">${cmp.beatCountA}</td>
          <td class="num">${cmp.beatCountB}</td><td></td></tr>
      <tr><td>节拍位置最大偏差</td><td class="num" colspan="2">${cmp.maxBeatDiff}s</td>
          <td class="${cmp.maxBeatDiff < 1e-6 ? 'pass' : 'fail'}">${cmp.maxBeatDiff < 1e-6 ? '无漂移' : '有漂移'}</td></tr>
      <tr><td>导出时长</td><td class="num">${cmp.durationA}s</td>
          <td class="num">${cmp.durationB}s</td>
          <td class="${cmp.durationEqual ? 'pass' : 'fail'}">${cmp.durationEqual ? '一致' : '不一致'}</td></tr>
    </table>
    <p class="${ok ? 'pass' : 'fail'}">${ok ? '✔ 重载前后完全一致' : '✘ 存在差异'}</p>`;
}

$('btn-selftest').addEventListener('click', async () => {
  engine.stop();
  // 1. 渲染当前工程的完整示例（首轮）
  const first = await renderSequence(project);
  // 2. 保存工程，再从存储重新载入（模拟重载）
  saveProject(project);
  saveBaseline(first.metrics);
  const reloaded = loadProject();
  // 3. 重载后从头渲染同一段示例
  const second = await renderSequence(reloaded);
  showCompare(compareMetrics(first.metrics, second.metrics), '首轮', '重载后');
  refreshTransport();
});

// 页面（重新）载入时：若存在基线，自动与上次保存的首轮指标对比
(async function autoVerifyOnReload() {
  const baseline = loadBaseline();
  const saved = loadProject();
  if (!baseline || !saved) return;
  const now = await renderSequence(saved);
  showCompare(compareMetrics(baseline, now.metrics), '上次保存的首轮', '本次重载后');
})();

/* ---------- 初始化 ---------- */

buildTrackTable();
refreshParams();
refreshTransport();
visualLoop();

// 供自动化测试/调试读取（只读用途）
window.__echoMaze = {
  get maze() { return maze; },
  get engine() { return engine; },
  get project() { return project; },
};
