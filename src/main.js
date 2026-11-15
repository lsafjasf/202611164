import { DEFAULT_RULES, DEFAULT_VIEW, clampRules, clampView, ruleSummary, ROOF_STYLES } from './rules.js';
import { generateCity } from './generator.js';
import { serializeCity, deserializeCity, layoutFingerprint, keyOf } from './model.js';
import { shortHash } from './hash.js';
import { renderCity, renderProfile, pickCell } from './render.js';
import { editCell } from './edit.js';
import { findPath, findBlockingBuildings, findCriticalRoadCell } from './path.js';
import { verifySeeds } from './verify.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'iso-city-snapshot-v1';
const CHECK_SEEDS = [20261116, 777, 4242];

const state = {
  rules: clampRules(DEFAULT_RULES),
  view: clampView(DEFAULT_VIEW),
  city: null,
  selected: null,
  route: null,
};

function log(lines) {
  const box = $('log');
  const stamp = new Date().toLocaleTimeString();
  box.textContent = `[${stamp}]\n${Array.isArray(lines) ? lines.join('\n') : lines}\n\n${box.textContent}`;
}

function syncRuleInputs() {
  $('seed').value = state.rules.seed;
  $('targetCount').value = state.rules.targetCount;
  $('width').value = state.rules.width;
  $('height').value = state.rules.height;
  $('minFloors').value = state.rules.minFloors;
  $('maxFloors').value = state.rules.maxFloors;
}

function syncViewInputs() {
  $('floorHeight').value = state.view.floorHeight;
  $('floorHeightVal').textContent = state.view.floorHeight;
  $('hideBelow').max = state.rules.maxFloors;
  $('hideBelow').value = state.view.hideBelow;
  $('hideBelowVal').textContent = state.view.hideBelow;
  $('sectionRow').max = state.rules.height - 1;
  if (state.view.sectionRow >= state.rules.height) state.view.sectionRow = -1;
  $('sectionRow').value = state.view.sectionRow;
  $('sectionRowVal').textContent = state.view.sectionRow < 0 ? '关闭' : state.view.sectionRow;
}

function refreshMeta() {
  $('ruleSummary').textContent = `规则摘要: ${ruleSummary(state.rules)}`;
  const hash = shortHash(layoutFingerprint(state.city));
  $('metaLine').textContent = `seed=${state.rules.seed} · 目标=${state.city.targets.length} · layout=${hash}`;
}

function draw() {
  const canvas = $('city');
  renderCity(canvas, state.city, state.view, { selected: state.selected, route: state.route });
  renderProfile($('profile'), state.city, state.view);
  refreshMeta();
}

function regenerate(rulesInput) {
  state.rules = clampRules(rulesInput ?? readRuleInputs());
  state.city = generateCity(state.rules);
  state.selected = null;
  state.route = null;
  $('editSection').hidden = true;
  syncRuleInputs();
  syncViewInputs();
  draw();
  const diagnosis = findBlockingBuildings(state.city);
  log([
    `已生成 seed=${state.rules.seed}`,
    `layout=${shortHash(layoutFingerprint(state.city))}`,
    diagnosis.blockers.length
      ? `警告: 存在阻断 ${diagnosis.blockers.length} 处`
      : '初始路线检查: 全部目标可达',
  ]);
}

function readRuleInputs() {
  return {
    ...state.rules,
    seed: Number($('seed').value) >>> 0,
    targetCount: Number($('targetCount').value),
    width: Number($('width').value),
    height: Number($('height').value),
    minFloors: Number($('minFloors').value),
    maxFloors: Number($('maxFloors').value),
  };
}

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}

function selectCell(cell) {
  state.selected = cell;
  const full = state.city.cells.get(keyOf(cell.x, cell.y));
  const section = $('editSection');
  if (!full || full.type === 'target') {
    section.hidden = true;
    state.route = null;
    draw();
    return;
  }
  section.hidden = false;
  $('selectedLabel').textContent = `(${cell.x}, ${cell.y}) ${full.type}`;
  $('editFloors').value = full.floors || 1;
  $('editRoof').value = ROOF_STYLES.includes(full.roof) ? full.roof : 'flat';
  // Show BFS route from the first target to the clicked cell when walkable.
  if (full.type === 'road') {
    state.route = findPath(state.city, state.city.targets[0], cell);
  } else {
    state.route = null;
  }
  draw();
}

function applyEdit() {
  if (!state.selected) return;
  const hashBefore = shortHash(layoutFingerprint(state.city));
  const patch = {
    kind: 'building',
    floors: Number($('editFloors').value),
    roof: $('editRoof').value,
  };
  const { city: next, changed } = editCell(state.city, state.selected.x, state.selected.y, patch);
  state.city = next;
  // Only the affected cell changes; view/route caches for other cells stay valid.
  draw();
  const diagnosis = findBlockingBuildings(state.city);
  const lines = [
    `局部重算单元格 (${state.selected.x}, ${state.selected.y})`,
    `旧 hash: ${changed[0].slice(0, 16)}…`,
    `新 hash: ${changed[1].slice(0, 16)}…`,
    `整体布局: ${hashBefore.slice(0, 10)} → ${shortHash(layoutFingerprint(state.city)).slice(0, 10)}`,
  ];
  if (diagnosis.broken.length) {
    lines.push('阻断发生:');
    for (const pair of diagnosis.broken) lines.push(`  路线断开: ${pair.from} ✕ ${pair.to}`);
    for (const b of diagnosis.blockers) {
      lines.push(`  阻断位置: 建筑 (${b.x}, ${b.y}) ${b.floors}F，分隔连通分量 ${b.between.join(' / ')}`);
    }
  } else {
    lines.push('路线检查: 目标仍全部可达');
  }
  log(lines);
}

function saveSnapshot() {
  const payload = {
    savedAt: new Date().toISOString(),
    rules: state.rules,
    view: state.view,
    cityText: serializeCity(state.city),
    layoutHash: shortHash(layoutFingerprint(state.city)),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  log([`已保存快照`, `layout=${payload.layoutHash}`]);
}

function loadSnapshot() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return log('没有可载入的快照');
  const payload = JSON.parse(raw);
  const restored = deserializeCity(payload.cityText);
  const hashNow = shortHash(layoutFingerprint(restored));
  state.rules = clampRules(payload.rules);
  state.view = clampView(payload.view);
  state.city = restored;
  state.selected = null;
  state.route = null;
  syncRuleInputs();
  syncViewInputs();
  draw();
  log([
    '已载入快照',
    `保存时 hash=${payload.layoutHash}`,
    `载入后 hash=${hashNow}`,
    hashNow === payload.layoutHash ? '校验: 布局哈希一致 ✓' : '校验: 哈希不一致 ✗',
  ]);
}

function runVerification() {
  const reports = verifySeeds(CHECK_SEEDS);
  const lines = ['固定 seed 复现校验:'];
  let allPass = true;
  for (const r of reports) {
    allPass = allPass && r.passed;
    lines.push(
      `  seed ${r.seed}: ${r.passed ? 'PASS' : 'FAIL'} hash=${r.layoutHash} 复现=${r.reproducible} 可达=${r.allTargetsReachable} 目标=${r.targetCount}`,
    );
    r.overlapIssues.forEach((issue) => lines.push(`    - ${issue}`));
  }
  lines.push(allPass ? '结论: 可达/不重叠/边界/复现 全部通过' : '结论: 存在失败项');
  log(lines);
}

function exportCanvas(canvas, name) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
    log(`已导出 ${name}`);
  }, 'image/png');
}

function bindEvents() {
  $('regenerate').addEventListener('click', () => regenerate());
  $('applyEdit').addEventListener('click', applyEdit);
  $('clearSelect').addEventListener('click', () => {
    state.selected = null;
    state.route = null;
    $('editSection').hidden = true;
    draw();
  });
  $('runVerify').addEventListener('click', runVerification);
  $('demoBlock').addEventListener('click', () => {
    const critical = findCriticalRoadCell(state.city);
    if (!critical) return log('当前路网足够冗余，单个格无法切断目标连通');
    selectCell(critical);
    $('editFloors').value = 10;
    $('editRoof').value = 'flat';
    applyEdit();
  });
  $('save').addEventListener('click', saveSnapshot);
  $('load').addEventListener('click', loadSnapshot);
  $('exportCity').addEventListener('click', () => {
    draw();
    exportCanvas($('city'), `iso-city-seed${state.rules.seed}.png`);
  });
  $('exportProfile').addEventListener('click', () => {
    draw();
    exportCanvas($('profile'), `iso-profile-y${state.view.sectionRow}.png`);
  });

  $('floorHeight').addEventListener('input', (e) => {
    state.view.floorHeight = Number(e.target.value);
    syncViewInputs();
    draw();
  });
  $('hideBelow').addEventListener('input', (e) => {
    state.view.hideBelow = Number(e.target.value);
    syncViewInputs();
    draw();
  });
  $('sectionRow').addEventListener('input', (e) => {
    state.view.sectionRow = Number(e.target.value);
    syncViewInputs();
    draw();
  });

  $('city').addEventListener('click', (e) => {
    const rect = e.target.getBoundingClientRect();
    const cell = pickCell(e.target, state.city, state.view, e.clientX - rect.left, e.clientY - rect.top);
    if (cell) selectCell(cell);
  });

  window.addEventListener('resize', () => {
    sizeCanvas($('city'));
    sizeCanvas($('profile'));
    draw();
  });
}

function init() {
  sizeCanvas($('city'));
  sizeCanvas($('profile'));
  bindEvents();
  regenerate(state.rules);
  runVerification();
}

init();

// Automation/debug handle used by the headless verification suite.
window.__isoCity = {
  state,
  selectCell,
  applyEdit,
  saveSnapshot,
  loadSnapshot,
  draw,
};
