// test.js — 可复现性与规则校验（Node 环境运行：node test.js）
'use strict';
const Cave = require('./cave.js');
const { W, H, ROCK, FLOOR, WATER, PILLAR } = Cave;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

function boundaryOk(cave) {
  const g = cave.grid;
  for (let x = 0; x < W; x++)
    if (g[x] !== ROCK || g[(H - 1) * W + x] !== ROCK) return false;
  for (let y = 0; y < H; y++)
    if (g[y * W] !== ROCK || g[y * W + W - 1] !== ROCK) return false;
  return true;
}

function targetsOk(cave) {
  const seen = new Set();
  for (const t of cave.targets) {
    const key = t.x + ',' + t.y;
    if (seen.has(key)) return '目标重叠: ' + key;
    seen.add(key);
    const cell = cave.grid[t.y * W + t.x];
    if (cell !== FLOOR && cell !== WATER) return t.name + ' 所在格不可通行: ' + cell;
  }
  return null;
}

function pillarNotOnSpawn(cave) {
  const s = cave.targets[0];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (cave.grid[(s.y + dy) * W + (s.x + dx)] === PILLAR) return false;
  return true;
}

const SEEDS = ['alpha-cave-2026', 'beta-cave-2026'];
const caves = {};

console.log('== 1. 两个 seed 的基本规则校验 ==');
for (const seed of SEEDS) {
  const cave = Cave.generateCave({ seed, curvature: 0.6, chamberSize: 1.1 });
  caves[seed] = cave;
  console.log(' seed=' + seed + ' 布局哈希=' + cave.layoutHash +
              ' 目标数=' + cave.targets.length);
  check('[' + seed + '] 所有目标可达', cave.reachable,
        '不可达: ' + cave.unreachable.join(','));
  check('[' + seed + '] 场景边界封闭', boundaryOk(cave));
  check('[' + seed + '] 关键对象不重叠且可站立', !targetsOk(cave), targetsOk(cave));
  check('[' + seed + '] 岩柱不压出生点', pillarNotOnSpawn(cave));
  check('[' + seed + '] 路径已生成', cave.path.length > 0);
}
check('两个 seed 布局不同', caves[SEEDS[0]].layoutHash !== caves[SEEDS[1]].layoutHash);

console.log('== 2. 相同 seed 完全复现 ==');
for (const seed of SEEDS) {
  const again = Cave.generateCave({ seed, curvature: 0.6, chamberSize: 1.1 });
  check('[' + seed + '] 布局哈希一致', again.layoutHash === caves[seed].layoutHash,
        again.layoutHash + ' != ' + caves[seed].layoutHash);
}

console.log('== 3. 修改参数只重算受影响区域 ==');
{
  const base = caves[SEEDS[0]];
  // 只改曲率 -> 仅隧道重算，其余区域哈希与坐标不变
  const curved = Cave.generateCave(
    { seed: SEEDS[0], curvature: 0.95, chamberSize: 1.1 }, base);
  const sameRegions = ['entrance', 'exit', 'chamber0', 'chamber1', 'chamber2'];
  check('曲率变化仅重算隧道',
        curved.recomputed.every(r => r.startsWith('tunnel')) &&
        curved.recomputed.length === 4,
        '实际重算: ' + curved.recomputed.join(','));
  check('未受影响区域哈希不变',
        sameRegions.every(r => curved.regionHashes[r] === base.regionHashes[r]));
  let coordsSame = true;
  for (const r of sameRegions) {
    const a = base.regions[r].writes, b = curved.regions[r].writes;
    if (a.length !== b.length) { coordsSame = false; break; }
    for (let i = 0; i < a.length; i++)
      if (a[i].x !== b[i].x || a[i].y !== b[i].y || a[i].cell !== b[i].cell) {
        coordsSame = false; break;
      }
  }
  check('未受影响区域坐标不变', coordsSame);
  check('曲率变化后目标仍可达', curved.reachable, curved.unreachable.join(','));

  // 只改洞厅尺寸 -> 仅洞厅重算
  const sized = Cave.generateCave(
    { seed: SEEDS[0], curvature: 0.6, chamberSize: 1.6 }, base);
  check('洞厅尺寸变化仅重算洞厅',
        sized.recomputed.every(r => r.startsWith('chamber')) &&
        sized.recomputed.length === 3,
        '实际重算: ' + sized.recomputed.join(','));
  check('隧道与出入口哈希不变',
        ['entrance', 'exit', 'tunnel0', 'tunnel1', 'tunnel2', 'tunnel3']
          .every(r => sized.regionHashes[r] === base.regionHashes[r]));
}

console.log('== 4. 保存参数再载入，布局哈希一致 ==');
for (const seed of SEEDS) {
  const json = Cave.serializeParams(
    { seed, curvature: 0.6, chamberSize: 1.1, edits: { '10,10': PILLAR } });
  const loaded = Cave.deserializeParams(json);
  const cave = Cave.generateCave(loaded);
  const fresh = Cave.generateCave(
    { seed, curvature: 0.6, chamberSize: 1.1, edits: { '10,10': PILLAR } });
  check('[' + seed + '] 载入后哈希一致', cave.layoutHash === fresh.layoutHash);
}

console.log('== 5. 单对象修改：未受影响区域不变 + 阻断定位 ==');
{
  const base = caves[SEEDS[0]];
  // 在路径上取一点，整列封死制造断路
  const mid = base.path[Math.floor(base.path.length / 2)];
  const edits = {};
  for (let y = 1; y < H - 1; y++) edits[mid.x + ',' + y] = ROCK;
  const edited = Cave.generateCave(
    { seed: SEEDS[0], curvature: 0.6, chamberSize: 1.1, edits }, base);
  check('编辑后区域全部复用（无重算）', edited.recomputed.length === 0,
        '实际重算: ' + edited.recomputed.join(','));
  check('编辑后区域哈希全部不变',
        Cave.REGION_ORDER.every(r => edited.regionHashes[r] === base.regionHashes[r]));
  check('断路被检出', !edited.reachable && edited.unreachable.length > 0);
  check('阻断位置已定位', edited.blockedBy.length > 0,
        'blockedBy 为空');
  if (edited.blockedBy.length > 0) {
    const b = edited.blockedBy[0];
    console.log('   阻断位置: (' + b.x + ',' + b.y + ') 影响目标: ' +
                b.targets.join(','));
    check('阻断坐标位于封死列', b.x === mid.x);
  }
  // 移除编辑后恢复连通
  const restored = Cave.generateCave(
    { seed: SEEDS[0], curvature: 0.6, chamberSize: 1.1 }, edited);
  check('撤销编辑后恢复连通且哈希复原',
        restored.reachable && restored.layoutHash === base.layoutHash);
}

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
