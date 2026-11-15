// Reproducible verification suite. Run with: node tests/verify.mjs

import assert from 'node:assert/strict';
import { Scene } from '../src/scene.js';
import { findPath, euclidean } from '../src/pathfinding.js';
import { isWater } from '../src/terrain.js';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}

const SEEDS = [20261116, 'village-map-77'];

test('固定 seed 生成结果逐字节一致（两个 seed）', () => {
  for (const seed of SEEDS) {
    const a = new Scene(seed);
    const b = new Scene(seed);
    assert.equal(a.layoutHash(), b.layoutHash(), `seed=${seed} 布局哈希不一致`);
    assert.deepEqual(
      a.objects.map((o) => [o.id, o.x, o.y]),
      b.objects.map((o) => [o.id, o.x, o.y]),
      `seed=${seed} 对象坐标不一致`);
  }
});

test('不同 seed 产生不同布局', () => {
  const hashes = SEEDS.map((s) => new Scene(s).layoutHash());
  assert.notEqual(hashes[0], hashes[1]);
});

test('目标数量与配置一致且包含三种类型', () => {
  for (const seed of SEEDS) {
    const scene = new Scene(seed);
    assert.equal(scene.objects.length, scene.targetCount());
    const types = new Set(scene.objects.map((o) => o.type));
    assert.deepEqual([...types].sort(), ['supply', 'tower', 'village']);
  }
});

test('关键对象不重叠且满足最小间距', () => {
  for (const seed of SEEDS) {
    const scene = new Scene(seed);
    for (let i = 0; i < scene.objects.length; i++) {
      for (let j = i + 1; j < scene.objects.length; j++) {
        const d = euclidean(scene.objects[i].x, scene.objects[i].y,
          scene.objects[j].x, scene.objects[j].y);
        assert.ok(d >= scene.params.minObjectSpacing,
          `${scene.objects[i].id} 与 ${scene.objects[j].id} 间距 ${d} 过小`);
      }
    }
  }
});

test('所有地点位于陆地且场景边界正确', () => {
  for (const seed of SEEDS) {
    const scene = new Scene(seed);
    for (const obj of scene.objects) {
      assert.ok(!isWater(scene.terrain, obj.x, obj.y), `${obj.id} 位于水体`);
      assert.ok(obj.x >= 0 && obj.x < scene.params.width, `${obj.id} 越界 x`);
      assert.ok(obj.y >= 0 && obj.y < scene.params.height, `${obj.id} 越界 y`);
    }
  }
});

test('目标可达：任意两地之间存在陆地路线', () => {
  for (const seed of SEEDS) {
    const scene = new Scene(seed);
    for (let i = 0; i < scene.objects.length; i++) {
      for (let j = i + 1; j < scene.objects.length; j++) {
        const path = findPath(scene.terrain, scene.objects[i], scene.objects[j]);
        assert.ok(path, `${scene.objects[i].id} -> ${scene.objects[j].id} 不可达`);
      }
    }
    assert.equal(scene.edges.size, scene.objects.length - 1, '路线网络不是生成树');
  }
});

function findValidMove(scene, obj) {
  for (let dx = 1; dx < 30; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      const x = obj.x + dx;
      const y = obj.y + dy;
      if (scene.validateMove(obj.id, x, y).ok) return { x, y };
    }
  }
  return null;
}

test('修改单个对象后未受影响区域坐标与哈希不变', () => {
  const scene = new Scene(SEEDS[0]);
  const baseline = new Scene(SEEDS[0]);
  const moved = scene.objects[0];
  const target = findValidMove(scene, moved);
  assert.ok(target, '找不到合法移动目标');
  const before = Object.fromEntries(baseline.objects.map((o) => [o.id, o.hash]));
  const edgeBefore = Object.fromEntries([...baseline.edges].map(([k, e]) => [k, e.hash]));

  const result = scene.moveObject(moved.id, target.x, target.y);
  assert.ok(result.ok, result.reason);
  assert.deepEqual(result.changedObjects, [moved.id]);

  for (const obj of scene.objects) {
    if (obj.id === moved.id) continue;
    assert.equal(obj.hash, before[obj.id], `${obj.id} 哈希被意外修改`);
  }
  for (const [key, edge] of scene.edges) {
    const touchesMoved = edge.a === moved.id || edge.b === moved.id;
    if (!touchesMoved) assert.equal(edge.hash, edgeBefore[key], `边 ${key} 被意外重算`);
  }
});

test('非法移动被拒绝：水体 / 越界 / 间距过近', () => {
  const scene = new Scene(SEEDS[0]);
  const obj = scene.objects[0];
  const other = scene.objects[1];
  assert.equal(scene.validateMove(obj.id, -1, obj.y).ok, false);
  assert.equal(scene.validateMove(obj.id, scene.params.width, obj.y).ok, false);
  assert.equal(scene.validateMove(obj.id, other.x, other.y).ok, false);
  let waterCell = null;
  outer: for (let y = 0; y < scene.params.height; y++) {
    for (let x = 0; x < scene.params.width; x++) {
      if (isWater(scene.terrain, x, y)) { waterCell = { x, y }; break outer; }
    }
  }
  if (waterCell) assert.equal(scene.validateMove(obj.id, waterCell.x, waterCell.y).ok, false);
});

test('仅改覆盖半径时坐标哈希不变，且只影响显示参数', () => {
  const scene = new Scene(SEEDS[0]);
  const hashesBefore = Object.fromEntries(scene.objects.map((o) => [o.id, o.hash]));
  const next = structuredClone(scene.params);
  next.coverage.tower = 99;
  const result = scene.updateParams(next);
  assert.equal(result.rebuilt, 'coverage-only');
  assert.deepEqual(result.changedObjects, []);
  for (const obj of scene.objects) assert.equal(obj.hash, hashesBefore[obj.id]);
  assert.equal(scene.getObject(scene.objects.find((o) => o.type === 'tower').id).radius, 99);
});

test('保存参数再载入：编辑记录保留且布局哈希一致', async () => {
  const scene = new Scene(SEEDS[1]);
  const moved = scene.objects[2];
  const target = findValidMove(scene, moved);
  scene.moveObject(moved.id, target.x, target.y);
  const saved = scene.toJSON();
  assert.ok(saved.editLog.length >= 1);

  const { restoredHash, savedHash, scene: restored } = await Scene.fromJSON(structuredClone(saved));
  assert.equal(restoredHash, savedHash);
  assert.equal(restoredHash, scene.layoutHash());
  assert.equal(restored.editLog.length, scene.editLog.length);
});

test('显式重新生成恢复初始布局', () => {
  const scene = new Scene(SEEDS[0]);
  const initial = scene.layoutHash();
  const moved = scene.objects[0];
  const target = findValidMove(scene, moved);
  scene.moveObject(moved.id, target.x, target.y);
  assert.notEqual(scene.layoutHash(), initial);
  scene.regenerate();
  assert.equal(scene.layoutHash(), initial);
  assert.equal(scene.editLog.length, 0);
});

test('新障碍切断路线时明确报告阻断位置', () => {
  const scene = new Scene(SEEDS[0]);
  const edge = [...scene.edges.values()][0];
  const middle = edge.path[Math.floor(edge.path.length / 2)];

  // 以阻断格为中心，横向封死一条墙，仅保留可验证的断点信息。
  const wall = [];
  for (let dx = -3; dx <= 3; dx++) {
    const x = middle.x + dx;
    for (let dy = -2; dy <= 2; dy++) {
      const y = middle.y + dy;
      if (x < 0 || y < 0 || x >= scene.params.width || y >= scene.params.height) continue;
      if (scene.objects.some((o) => o.x === x && o.y === y)) continue;
      wall.push([x, y]);
    }
  }
  const result = scene.addObstacle(wall);
  assert.ok(result.ok, result.reason);
  if (result.blocked.length) {
    const report = result.blocked[0];
    assert.ok(report.from && report.to, '阻断报告缺少端点');
    assert.ok(typeof report.fromPos.x === 'number', '阻断报告缺少坐标');
  }
  // 编辑日志必须记录障碍，便于 seed 恢复后重现。
  assert.ok(scene.editLog.some((e) => e.kind === 'obstacle'));
});

test('确定性阻断场景：瓶颈被封后两端不可达且给出阻断位置', () => {
  // 构造狭长走廊：宽度仅 3，中央唯一瓶颈被障碍封闭。
  const scene = new Scene('bridge-test', {
    width: 40, height: 7, waterLevel: 0.0, borderMargin: 0,
    minObjectSpacing: 4, villageCount: 1, towerCount: 1, supplyCount: 0,
    coverage: { village: 2, tower: 2, supply: 2 },
  });
  const [village, tower] = scene.objects;
  // 把整列墙放在两个端点之间的中点，保证它是唯一的横向瓶颈。
  const minX = Math.min(village.x, tower.x);
  const maxX = Math.max(village.x, tower.x);
  const midX = Math.floor((minX + maxX) / 2);
  assert.ok(maxX - minX >= 2, '端点应当被墙隔开');
  const wall = [];
  for (let y = 0; y < scene.params.height; y++) wall.push([midX, y]);
  const result = scene.addObstacle(wall);
  assert.ok(result.ok);
  assert.ok(result.blocked.length >= 1, '应当检测到路线断开');
  const blockedPath = findPath(scene.terrain, village, tower);
  assert.equal(blockedPath, null, '瓶颈封闭后两端必须不可达');
  const report = result.blocked[0];
  assert.equal(report.fromPos.x, village.x);
  assert.ok(report.toPos.x === tower.x);
});

test('障碍未切断路线时自动改道且保留连通性', () => {
  const scene = new Scene(SEEDS[1]);
  const edge = [...scene.edges.values()][0];
  const cell = edge.path[Math.floor(edge.path.length / 2)];
  if (scene.objects.some((o) => o.x === cell.x && o.y === cell.y)) return;
  const result = scene.addObstacle([[cell.x, cell.y]]);
  assert.ok(result.ok);
  for (let i = 0; i < scene.objects.length; i++) {
    for (let j = i + 1; j < scene.objects.length; j++) {
      assert.ok(findPath(scene.terrain, scene.objects[i], scene.objects[j]),
        '改道后仍应保持全连通');
    }
  }
});

const failed = results.filter((r) => !r.ok);
console.log('\n=== 可复现校验报告 ===');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : ' -> ' + r.message}`);
}
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
for (const seed of SEEDS) {
  const scene = new Scene(seed);
  console.log(`seed=${String(seed).padEnd(14)} 目标=${scene.targetCount()} 哈希=${scene.layoutHash()}`);
}
process.exit(failed.length ? 1 : 0);
