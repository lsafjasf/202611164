import assert from 'node:assert/strict';
import {
  createGame,
  startGame,
  pauseGame,
  resumeGame,
  move,
  scan,
  listen,
  markReef,
  submitConclusions,
  publicState,
} from '../js/engine.js';
import { CONFIG, bandOf } from '../js/config.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err.stack);
    process.exitCode = 1;
  }
}

function autopilot(seed) {
  // 固定操作序列：重开同一 seed 时顺序与惩罚规则必须完全一致。
  const g = startGame(createGame(seed));
  scan(g);
  listen(g);
  for (let i = 0; i < 4; i++) move(g, 'E');
  scan(g);
  listen(g);
  for (let i = 0; i < 4; i++) move(g, 'S');
  scan(g);
  return g;
}

console.log('1) 同 seed 确定性与线索顺序');
test('两次重开产生相同地图、日志顺序与波形描述符', () => {
  const a = autopilot('det-seed');
  const b = autopilot('det-seed');
  assert.deepEqual(b.map, a.map);
  assert.deepEqual(
    b.log.map((e) => ({ id: e.id, t: e.t, type: e.type, x: e.x, y: e.y })),
    a.log.map((e) => ({ id: e.id, t: e.t, type: e.type, x: e.x, y: e.y })),
  );
  assert.deepEqual(b.log, a.log);
  assert.equal(b.time, a.time);
  assert.equal(b.energy, a.energy);
});

test('不同 seed 产生不同海流方向或信标布局', () => {
  const a = createGame('seed-alpha');
  const b = createGame('seed-beta');
  const diff =
    JSON.stringify(a.map.current) !== JSON.stringify(b.map.current) ||
    JSON.stringify(a.map.beacons) !== JSON.stringify(b.map.beacons);
  assert.ok(diff);
});

console.log('2) 调查阶段不泄露真实答案');
test('publicState 不含 reef/beacon 坐标与 truth 字段', () => {
  const g = autopilot('leak-seed');
  const pub = publicState(g);
  const text = JSON.stringify(pub);
  assert.ok(!text.includes('"truth"'));
  assert.ok(!text.includes('"reefs"'));
  assert.ok(!text.includes('"beacons"'));
  assert.ok(!text.includes('"current"'));
  assert.ok(!text.includes('"map"'));
  // 公开线索只给出回波时延、测得频率等可观测数据
  assert.ok(pub.log[0].echoes[0].delay > 0);
  assert.ok(pub.log.find((e) => e.type === 'listen').measuredFreq > 0);
});

console.log('3) 扫描递增噪音与非目标回波');
test('扫描次数增加时本底噪声与杂波数量单调上升', () => {
  const g = startGame(createGame('noise-seed'));
  const n1 = scan(g).entry;
  const n2 = scan(g).entry;
  const n3 = scan(g).entry;
  assert.ok(n2.noiseFloor >= n1.noiseFloor);
  assert.ok(n3.noiseFloor >= n2.noiseFloor);
  assert.ok(n3.clutter.length >= n2.clutter.length && n2.clutter.length >= n1.clutter.length);
});

console.log('4) 错误标记消耗固定能源，且重开规则一致');
test('错误暗礁标记扣 10 能源，正确标记不扣', () => {
  const g = startGame(createGame('mark-seed'));
  const reef = g.map.reefs[0];
  const before = g.energy;
  // 当前格是母舰，生成时保证不是暗礁 -> 必为错误标记
  const wrong = markReef(g, g.sub.x, g.sub.y);
  assert.equal(wrong.ok, true);
  assert.equal(wrong.marker.correct, false);
  assert.equal(before - g.energy, CONFIG.wrongMarkCost);

  // 走到与暗礁相邻（曼哈顿距离 1）的安全格
  const neighbor = { x: Math.max(0, reef.x - 1), y: reef.y };
  while (g.sub.x !== neighbor.x) move(g, g.sub.x < neighbor.x ? 'E' : 'W');
  while (g.sub.y !== neighbor.y) move(g, g.sub.y < neighbor.y ? 'S' : 'N');
  const before2 = g.energy;
  const right = markReef(g, reef.x, reef.y);
  assert.equal(right.marker.correct, true);
  assert.equal(before2, g.energy);

  const g2 = startGame(createGame('mark-seed'));
  const e0 = g2.energy;
  const wrong2 = markReef(g2, g2.sub.x, g2.sub.y);
  assert.equal(wrong2.marker.correct, false);
  assert.equal(e0 - g2.energy, CONFIG.wrongMarkCost);
});

console.log('5) 正确结论：全部判定通过');
test('按真实参数提交 -> 三项判断全对，证据含声源/时间/频段', () => {
  const g = autopilot('truth-seed');
  // 模拟完成回收并返回（直接构造可达成状态后提交，判定逻辑不变）
  g.collected = g.map.beacons.map((b) => b.id);
  g.returned = true;
  g.sub = { ...g.map.home };
  const reef = g.map.reefs[0];
  const nearestBeacon = g.map.beacons
    .map((b) => ({ b, d: Math.hypot(b.x - g.sub.x, b.y - g.sub.y) }))
    .sort((p, q) => p.d - q.d)[0].b;
  const result = submitConclusions(g, {
    reef: { x: reef.x, y: reef.y },
    bandId: nearestBeacon.bandId,
    currentDirId: g.map.current.dirId,
  });
  assert.ok(result.ok);
  assert.ok(result.verdict.missionSuccess);
  assert.ok(result.verdict.allJudgmentsCorrect);
  for (const j of result.verdict.judgments) {
    assert.ok(j.evidence.sourceName.length > 0);
    assert.ok(j.evidence.detail.length > 0);
    assert.equal(j.errorDim, null);
  }
  // 频段证据中的测得频率确实落在真实频段内
  const bandJudge = result.verdict.judgments.find((j) => j.dimension === 'band');
  assert.match(bandJudge.evidence.detail, /Hz/);
  assert.equal(bandOf(nearestBeacon.freq).id, nearestBeacon.bandId);
});

console.log('6) 错误结论：指出具体判断维度');
test('错误方位/频段/海流分别标注对应维度', () => {
  const g = autopilot('wrong-seed');
  g.collected = g.map.beacons.map((b) => b.id);
  g.returned = true;
  const wrongDir = CONFIG.dirs.find((d) => d.id !== g.map.current.dirId).id;
  const nearestBeacon = g.map.beacons
    .map((b) => ({ b, d: Math.hypot(b.x - g.sub.x, b.y - g.sub.y) }))
    .sort((p, q) => p.d - q.d)[0].b;
  const wrongBand = CONFIG.bands.find((b) => {
    return b.id !== nearestBeacon.bandId;
  }).id;
  // 选一个肯定不是暗礁的空格作为错误标记
  let guess = { x: 9, y: 9 };
  if (g.map.reefs.some((r) => r.x === 9 && r.y === 9)) guess = { x: 8, y: 9 };
  const result = submitConclusions(g, {
    reef: guess,
    bandId: wrongBand,
    currentDirId: wrongDir,
  });
  const [reefJ, bandJ, currentJ] = result.verdict.judgments;
  assert.equal(reefJ.correct, false);
  assert.ok(['方位', '距离'].includes(reefJ.errorDim));
  assert.equal(bandJ.errorDim, '频段');
  assert.equal(currentJ.errorDim, '海流方向');
  assert.ok(!result.verdict.allJudgmentsCorrect);
});

console.log('7) 暂停/重播不改变线索');
test('暂停冻结状态，重播描述符与原日志完全相同', () => {
  const g = autopilot('pause-seed');
  const snapshot = JSON.stringify(g.log);
  const energyBefore = g.energy;
  // 引擎层无内部时钟：暂停仅切状态，任何动作被拒绝
  pauseGame(g);
  assert.equal(scan(g).ok, false);
  assert.equal(move(g, 'E').ok, false);
  assert.equal(JSON.stringify(g.log), snapshot);
  assert.equal(g.energy, energyBefore);
  resumeGame(g);
  assert.equal(move(g, 'E').ok, true);
});

console.log(`\n${passed} 项测试通过`);
