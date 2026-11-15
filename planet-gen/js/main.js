// UI wiring: seed switching, explicit regenerate, sliders (incremental),
// screenshot, param save/load with hash check, obstacle & move modes.
import { Planet, angularDist } from './planet.js';
import { Renderer } from './render.js';
import { runAllChecks } from './verify.js';

const $ = id => document.getElementById(id);
const canvas = $('gl');
const planet = new Planet({ seed: 764001 });
const renderer = new Renderer(canvas);

let mode = null; // 'obstacle' | 'move' | null
let lastChangedChunks = null;

function resize() {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.floor(r.width * devicePixelRatio);
  canvas.height = Math.floor(r.height * devicePixelRatio);
}
addEventListener('resize', resize);
resize();

function syncSliders() {
  const p = planet.params;
  for (const k of ['seaLevel', 'polarCap', 'cloudCoverage', 'targetCount', 'rotationSpeed']) {
    $(k).value = p[k];
    $(k + 'V').textContent = p[k];
  }
  $('seedInput').value = p.seed;
}

function refresh(rebuild = true) {
  if (rebuild) renderer.buildMeshes(planet);
  const s = planet.stats;
  const routeBroken = planet.routes.filter(r => !r.ok);
  let txt =
    `Seed: ${planet.params.seed}\n` +
    `目标数量: ${planet.objects.length} (请求 ${planet.params.targetCount})\n` +
    `规则摘要: ${planet.ruleSummary()}\n` +
    `布局哈希: ${planet.layoutHash()}\n` +
    `重算区块: ${s.recomputedChunks}/${s.totalChunks}` +
    `，云层${s.cloudRecomputed ? '已重算' : '复用缓存'}\n` +
    `路线: ${routeBroken.length === 0 ? `全部 ${planet.routes.length} 段连通` : `${routeBroken.length} 段断开!`}`;
  if (routeBroken.length) {
    txt += '\n' + routeBroken.map(r => '⛔ ' + r.blocking.message).join('\n');
  }
  if (lastChangedChunks) {
    txt += `\n移动目标影响区块: [${lastChangedChunks.join(', ')}]，其余区块坐标与哈希不变`;
  }
  $('statusBox').textContent = txt;
}

function regenerate(seed) {
  planet.obstacles = [];
  planet.updateParams({ seed: seed >>> 0 });
  lastChangedChunks = null;
  syncSliders();
  refresh();
}

// ---- seed controls ----
$('applySeed').onclick = () => regenerate(parseInt($('seedInput').value, 10) || 1);
$('seedA').onclick = () => regenerate(764001);
$('seedB').onclick = () => regenerate(924202);
$('seedRand').onclick = () => regenerate(Math.floor(Math.random() * 1e9));
$('regen').onclick = () => { // explicit regenerate, same seed -> same hash
  const before = planet.layoutHash();
  planet.chunkCache.clear();
  planet.cloudCache = null;
  planet.regenerate();
  const after = planet.layoutHash();
  refresh();
  $('statusBox').textContent +=
    `\n显式重生成: 哈希 ${before === after ? '一致 ✓' : '不一致 ✗'} (${after})`;
};

// ---- sliders: incremental recompute ----
for (const k of ['seaLevel', 'polarCap', 'cloudCoverage', 'targetCount', 'rotationSpeed']) {
  $(k).oninput = () => {
    const v = parseFloat($(k).value);
    $(k + 'V').textContent = v;
    if (k === 'rotationSpeed') { planet.params.rotationSpeed = v; return; }
    lastChangedChunks = null;
    planet.updateParams({ [k]: k === 'targetCount' ? v | 0 : v });
    refresh();
  };
}

// ---- screenshot & param save/load ----
$('screenshot').onclick = () => renderer.screenshot(`planet_seed${planet.params.seed}.png`);

$('saveParams').onclick = () => {
  const data = {
    version: 1,
    params: planet.params,
    obstacles: planet.obstacles.map(o => ({ pos: o.pos, radius: o.radius })),
    objects: planet.objects.map(o => ({ face: o.face, pos: o.pos })),
    layoutHash: planet.layoutHash(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `planet_params_seed${planet.params.seed}.json`;
  a.click();
};

$('loadParams').onclick = () => $('fileInput').click();
$('fileInput').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  planet.obstacles = [];
  planet.updateParams(data.params);
  for (const o of data.obstacles || []) planet.addObstacle(o.pos, o.radius);
  if (data.objects) {
    planet.objects = data.objects.map((o, i) => ({
      id: i, face: o.face, pos: o.pos, chunk: planet.geo.chunkOf[o.face],
    }));
    planet.chunkCache.clear();
    planet.regenerate();
  }
  const hashNow = planet.layoutHash();
  const match = hashNow === data.layoutHash;
  syncSliders();
  refresh();
  $('statusBox').textContent +=
    `\n载入参数: 布局哈希 ${match ? '一致 ✓' : `不一致 ✗\n保存=${data.layoutHash}\n当前=${hashNow}`}`;
};

// ---- checks ----
$('runChecks').onclick = () => {
  const r = runAllChecks(planet);
  const line = (name, c) =>
    `${c.ok ? '✅' : '❌'} ${name}\n${c.details}`;
  $('checkBox').textContent =
    line('场景边界', r.boundary) + '\n\n' +
    line('关键对象不重叠', r.nonOverlap) + '\n\n' +
    line('目标可达性', r.reachability) + '\n\n' +
    line('可复现校验(布局哈希)', r.reproducibility);
};

// ---- obstacle / move modes ----
function setMode(m) {
  mode = mode === m ? null : m;
  $('obstacleMode').classList.toggle('active', mode === 'obstacle');
  $('moveMode').classList.toggle('active', mode === 'move');
}
$('obstacleMode').onclick = () => setMode('obstacle');
$('moveMode').onclick = () => setMode('move');

function nearestFace(pos) {
  let best = -1, bestD = Infinity;
  for (let f = 0; f < planet.geo.faces.length; f++) {
    const d = angularDist(planet.faceCenter(f), pos);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

// Unproject a click to a point on the unit sphere (model space).
function pickSphere(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
  const ndcY = 1 - ((clientY - r.top) / r.height) * 2;
  const aspect = r.width / r.height;
  const t = Math.tan(Math.PI / 8); // fov/2, fov = PI/4
  const dir = [ndcX * t * aspect, ndcY * t, -1];
  const dl = Math.hypot(...dir);
  const d = dir.map(v => v / dl);
  const o = [0, 0, 2.6];
  // |o + t d|^2 = 1
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const tt = -b - Math.sqrt(disc);
  const hit = [o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt];
  // inverse model rotation: RotY(-rotY) then RotX(-rotX)
  const [x1, y1, z1] = rotY(hit, -renderer.rotY);
  return rotX([x1, y1, z1], -renderer.rotX);
}
function rotY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
function rotX(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

// ---- drag rotate + click modes ----
let dragging = false, moved = 0, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => {
  dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  moved += Math.abs(dx) + Math.abs(dy);
  renderer.rotY += dx * 0.005;
  renderer.rotX = Math.max(-1.4, Math.min(1.4, renderer.rotX + dy * 0.005));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', e => {
  dragging = false;
  if (moved > 6 || !mode) return; // treat as drag, not click
  const pos = pickSphere(e.clientX, e.clientY);
  if (!pos) return;
  if (mode === 'obstacle') {
    const o = planet.addObstacle(pos, 0.18);
    lastChangedChunks = null;
    refresh();
    $('statusBox').textContent +=
      `\n添加障碍#${o.id} @区块${o.chunk}，重算 ${planet.stats.recomputedChunks} 个受影响区块`;
  } else if (mode === 'move') {
    const face = nearestFace(pos);
    // move the target nearest to the click
    let best = -1, bestD = Infinity;
    for (const o of planet.objects) {
      const d = angularDist(o.pos, pos);
      if (d < bestD) { bestD = d; best = o.id; }
    }
    if (best < 0) return;
    const res = planet.moveObject(best, face);
    if (!res) {
      $('statusBox').textContent += '\n目标位置不可放置（非陆地）';
      return;
    }
    lastChangedChunks = res.changedChunks;
    refresh();
  }
});

// ---- animation loop ----
let prevT = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - prevT) / 1000);
  prevT = t;
  renderer.render(dt, planet.params.rotationSpeed);
  requestAnimationFrame(loop);
}

syncSliders();
refresh();
requestAnimationFrame(loop);

// debug/e2e hooks
window.__planet = planet;
window.__renderer = renderer;
