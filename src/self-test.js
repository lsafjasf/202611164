// 可复现校验套件：可在 Node 中直接运行（npm test），也可在浏览器自检面板复用。

import { generateLayout, recomputeHashes, snapshotChunkHashes, snapshotObjectHashes } from "./layout.js";
import { moveBuoy, addObstacle, removeObstacle, updateParams } from "./edits.js";
import { serializeState, deserializeState } from "./persistence.js";
import { GRID, WORLD } from "./config.js";
import { shapesOverlap, insideWorld, pointInsideWorld } from "./geometry.js";
import { isReachable } from "./navigation.js";

const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}（期望 ${expected}，实际 ${actual}）`);
  }
}

const SEEDS = ["harbor-2026", "lighthouse-777", "atoll-042"];
const layouts = SEEDS.map((seed) => generateLayout(seed));

check("1. 固定 seed 确定性：同 seed 两次生成布局哈希一致", () => {
  for (const seed of SEEDS) {
    const a = generateLayout(seed);
    const b = generateLayout(seed);
    assertEqual(a.layoutHash, b.layoutHash, `seed=${seed} 布局哈希`);
    assertEqual(JSON.stringify(a.islands.map((s) => [s.x, s.y])),
      JSON.stringify(b.islands.map((s) => [s.x, s.y])), `seed=${seed} 岛屿坐标`);
  }
});

check("2. 不同 seed 产生不同布局", () => {
  const hashes = layouts.map((l) => l.layoutHash);
  assert(new Set(hashes).size === hashes.length, "三个 seed 的布局哈希必须互不相同");
});

check("3. 全部 seed 目标可达：码头→灯塔存在航线", () => {
  for (const layout of layouts) {
    assert(layout.reachable, `seed=${layout.seed} 码头到灯塔不可达`);
    assert(layout.routePoints.length >= 2, `seed=${layout.seed} 航线点过少`);
    assert(isReachable(layout.grid, layout.dock.cell, layout.lighthouse.cell),
      `seed=${layout.seed} 网格可达性校验失败`);
    assert(layout.waypointOk, `seed=${layout.seed} 浮标航点链必须连通`);
  }
});

check("4. 关键对象不重叠：岛屿/浅滩两两分离", () => {
  for (const layout of layouts) {
    const all = [...layout.islands, ...layout.shallows];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        assert(!shapesOverlap(all[i], all[j]),
          `seed=${layout.seed} 对象重叠：${all[i].id} / ${all[j].id}`);
      }
    }
  }
});

check("5. 场景边界正确：所有对象位于世界范围内", () => {
  for (const layout of layouts) {
    for (const shape of [...layout.islands, ...layout.shallows]) {
      assert(insideWorld(shape, 0), `seed=${layout.seed} 地形越界：${shape.id}`);
    }
    for (const point of [layout.dock, layout.lighthouse, ...layout.buoys]) {
      assert(pointInsideWorld(point, 2), `seed=${layout.seed} 关键点越界：${point.id}`);
    }
  }
});

check("6. 单对象移动：未受影响区块坐标与哈希保持不变", () => {
  const layout = generateLayout(SEEDS[0]);
  const chunkBefore = snapshotChunkHashes(layout);
  const objBefore = snapshotObjectHashes(layout);
  const target = findFreeWater(layout, 10, 10);
  const moved = layout.buoys[0];
  const res = moveBuoy(layout, moved.id, target.x, target.y);
  assert(res.ok, res.error || "浮标移动失败");
  const affected = new Set(res.changedChunks);
  for (const [key, hash] of Object.entries(chunkBefore)) {
    if (!affected.has(key)) assertEqual(layout.chunkHashes[key], hash, `区块 ${key} 不应变化`);
  }
  for (const island of layout.islands) {
    assertEqual(layout.objectHashes[island.id], objBefore[island.id],
      `岛屿 ${island.id} 哈希不应变化`);
  }
  assert(layout.objectHashes[moved.id] !== objBefore[moved.id], "被移动浮标哈希应变化");
});

check("7. 参数局部重算：仅浮标数量变化时地形哈希全部不变", () => {
  const layout = generateLayout(SEEDS[1]);
  const before = snapshotChunkHashes(layout);
  const res = updateParams(layout, { buoyCount: 3 });
  assert(res.ok, "参数更新失败");
  for (const [key, hash] of Object.entries(before)) {
    assertEqual(layout.chunkHashes[key], hash, `浮标数量变化不应改变地形区块 ${key}`);
  }
  assertEqual(layout.buoys.length, 3, "浮标数量");
});

check("8. 保存再载入：布局哈希必须一致", () => {
  for (const seed of [SEEDS[0], SEEDS[2]]) {
    const layout = generateLayout(seed);
    const text = serializeState(layout);
    const restored = deserializeState(text);
    assert(restored.hashMatched,
      `seed=${seed} 载入哈希不一致：${restored.savedHash} != ${restored.recomputedHash}`);
    assertEqual(restored.layout.layoutHash, layout.layoutHash, `seed=${seed} 布局哈希`);
    assertEqual(restored.layout.chunkHashes["0-0"], layout.chunkHashes["0-0"],
      `seed=${seed} 区块 0-0 哈希`);
  }
});

check("9. 新障碍断航：明确报告阻断位置，移除后恢复", () => {
  const layout = generateLayout(SEEDS[0]);
  const wall = buildBlockingWall(layout);
  assert(wall, "测试夹具无法构造阻断墙");
  let blockedLayout = null;
  let blockPoint = null;
  for (const cell of wall) {
    const center = cellCenterOf(cell.gx, cell.gy);
    const res = addObstacle(layout, center.x, center.y, 7.5);
    if (!res.ok) continue;
    if (!layout.reachable) {
      blockedLayout = res;
      blockPoint = layout.blockage;
      break;
    }
  }
  assert(blockedLayout, "障碍墙应导致航线断开");
  assert(blockPoint && blockPoint.blockPoint, "必须返回阻断位置坐标");
  assert(pointInsideWorld(blockPoint.blockPoint, 0), "阻断位置必须在场景内");
  const lastObstacle = layout.obstacles[layout.obstacles.length - 1];
  const restore = removeObstacle(layout, lastObstacle.id);
  assert(restore.ok && layout.reachable, "移除障碍后航线应恢复");
});

check("10. 浮标修复：移入阻塞格被拒绝，合法移动后航点链保持连通", () => {
  const layout = generateLayout(SEEDS[2]);
  const buoy = layout.buoys[0];
  const blockedCell = firstBlockedCell(layout);
  const bad = cellCenterOf(blockedCell.gx, blockedCell.gy);
  const rejected = moveBuoy(layout, buoy.id, bad.x, bad.y);
  assert(!rejected.ok, "浮标放入阻塞格必须被拒绝");
  const free = findFreeWater(layout, layout.dock.cell.gx + 3, layout.dock.cell.gy);
  const ok = moveBuoy(layout, buoy.id, free.x, free.y);
  assert(ok.ok, ok.error || "合法浮标移动失败");
  assert(layout.waypointOk, "移动后浮标航点链应保持连通");
});

check("11. 地形参数变化：重算后仍可达且对象不越界、不重叠", () => {
  const layout = generateLayout(SEEDS[1]);
  const res = updateParams(layout, { islandSlots: 18, shallowSlots: 12 });
  assert(res.ok, "地形参数更新失败");
  assert(res.fullTerrain, "应标记为全地形重算");
  assert(layout.reachable, "重算后码头到灯塔必须仍可达");
  const all = [...layout.islands, ...layout.shallows];
  for (const shape of all) assert(insideWorld(shape, 0), `重算后越界：${shape.id}`);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      assert(!shapesOverlap(all[i], all[j]), `重算后重叠：${all[i].id}/${all[j].id}`);
    }
  }
  const again = generateLayout(SEEDS[1], layout.params);
  assertEqual(again.layoutHash, layout.layoutHash, "同参数重生成哈希必须一致");
});

function firstBlockedCell(layout) {
  for (let gy = 0; gy < GRID.rows; gy++) {
    for (let gx = 0; gx < GRID.cols; gx++) {
      if (layout.grid.blocked[gy * GRID.cols + gx]) return { gx, gy };
    }
  }
  throw new Error("场景中没有阻塞格");
}

function findFreeWater(layout, gx, gy) {
  for (let radius = 0; radius < 20; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID.cols || ny >= GRID.rows) continue;
        if (!layout.grid.blocked[ny * GRID.cols + nx]) {
          return { x: nx * WORLD.cell + WORLD.cell / 2, y: ny * WORLD.cell + WORLD.cell / 2 };
        }
      }
    }
  }
  throw new Error("找不到可放置浮标的水面");
}

// 在码头与灯塔之间构造一整列障碍候选格（竖墙），逐个投放直到断航。
function buildBlockingWall(layout) {
  const owner = layout.grid.owner;
  for (let gx = layout.dock.cell.gx + 2; gx < layout.lighthouse.cell.gx - 1; gx++) {
    const column = [];
    for (let gy = 0; gy < GRID.rows; gy++) {
      if (owner[gy * GRID.cols + gx]) {
        column.length = 0;
        break;
      }
      column.push({ gx, gy });
    }
    if (column.length === GRID.rows) return column;
  }
  return null;
}

function cellCenterOf(gx, gy) {
  return { x: gx * WORLD.cell + WORLD.cell / 2, y: gy * WORLD.cell + WORLD.cell / 2 };
}

export function runSelfTests() {
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      → ${r.error}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
}
