import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEST_PATH,
  applyMove,
  collectedCount,
  createExportSnapshot,
  createGame,
  describeState,
  fingerprint,
  getStateView,
  getTarget,
  restoreState,
  restartGame,
  undoMove
} from "../src/game.js";

function play(state, directions) {
  return directions.reduce((current, direction) => applyMove(current, direction).state, state);
}

test("默认：完整路径可通关，读屏摘要与状态一致", () => {
  const finalState = play(createGame(), DEFAULT_TEST_PATH);
  const view = getStateView(finalState);
  assert.equal(finalState.status, "won");
  assert.deepEqual(finalState.player, finalState.config.beacon);
  assert.equal(view.collected, 3);
  assert.equal(view.required, 3);
  assert.equal(view.failureReason, "");
  assert.match(describeState(finalState), /位置：第 8 列，第 1 行/);
  assert.match(describeState(finalState), /目标方向：已抵达信标/);
  assert.match(describeState(finalState), /碎片 3\/3/);
  assert.match(describeState(finalState), /状态：已完成/);
});

test("默认：目标方向随资源进度从碎片切换到信标", () => {
  let state = createGame();
  assert.equal(getTarget(state).kind, "fragment");
  state = play(state, DEFAULT_TEST_PATH.slice(0, 18));
  assert.equal(collectedCount(state), 3);
  assert.equal(getTarget(state).kind, "beacon");
  assert.match(describeState(state), /目标方向：东北/);
});

test("边界：越界不移动、不耗能，并给出具体失败原因", () => {
  const before = createGame();
  const result = applyMove(before, "left");
  assert.equal(result.ok, false);
  assert.equal(result.type, "boundary");
  assert.deepEqual(result.state.player, before.player);
  assert.equal(result.state.energy, before.energy);
  assert.match(result.reason, /地图边界/);
  assert.match(describeState(result.state), /失败原因：地图边界/);

  const recovered = applyMove(result.state, "up");
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.state.player, { x: 0, y: 4 });
  assert.equal(recovered.state.failureReason, "");
});

test("边界：雾墙阻挡同样保留位置和能量", () => {
  let state = createGame();
  state = applyMove(state, "up").state;
  const before = structuredClone(state);
  const result = applyMove(state, "right");
  assert.equal(result.ok, false);
  assert.equal(result.type, "obstacle");
  assert.deepEqual(result.state.player, before.player);
  assert.equal(result.state.energy, before.energy);
  assert.match(result.reason, /雾墙阻挡/);
});

test("错误：能量耗尽阻止继续移动，撤回后恢复安全状态", () => {
  let state = createGame({ startEnergy: 1 });
  const failed = applyMove(state, "up");
  assert.equal(failed.state.status, "failed");
  assert.equal(failed.state.energy, 0);
  assert.match(failed.reason, /能量耗尽/);
  const blocked = applyMove(failed.state, "up");
  assert.equal(blocked.type, "round-ended");

  const recovered = undoMove(failed.state);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.state.status, "playing");
  assert.equal(recovered.state.energy, 1);
  assert.deepEqual(recovered.state.player, { x: 0, y: 5 });
  assert.equal(recovered.state.failureReason, "");
  assert.match(describeState(recovered.state), /状态：航行中/);
});

test("错误：资源不足时信标拒绝进入，原因包含缺少数量", () => {
  const state = createGame({
    cols: 2,
    rows: 2,
    start: { x: 0, y: 0 },
    beacon: { x: 1, y: 0 },
    obstacles: [],
    fragments: [{ id: "far", x: 1, y: 1 }],
    requiredFragments: 1,
    startEnergy: 10
  });
  const result = applyMove(state, "right");
  assert.equal(result.type, "beacon-locked");
  assert.match(result.reason, /还缺 1 枚/);
  assert.equal(result.state.status, "playing");
});

test("错误恢复：重新开始恢复完整能量和默认目标", () => {
  let state = createGame({ startEnergy: 1 });
  state = applyMove(state, "up").state;
  const restarted = restartGame(state);
  assert.equal(restarted.state.status, "playing");
  assert.equal(restarted.state.energy, 1);
  assert.deepEqual(restarted.state.player, { x: 0, y: 5 });
  assert.equal(restarted.state.moves, 0);
});

test("持久化：序列化恢复不会改变状态或目标", () => {
  const state = play(createGame(), ["up", "up", "right"]);
  const before = fingerprint(state);
  const restored = restoreState(JSON.stringify(state));
  assert.equal(restored.ok, true);
  assert.equal(fingerprint(restored.state), before);
  assert.deepEqual(getTarget(restored.state), getTarget(state));
  assert.equal(describeState(restored.state), describeState(state));
});

test("持久化：损坏存档返回具体错误而不抛出", () => {
  const restored = restoreState('{"version":1,"player":{"x":99,"y":0}}');
  assert.equal(restored.ok, false);
  assert.match(restored.error, /存档/);
});

test("导出：快照包含状态、设置和摘要，且导出前后指纹不变", () => {
  const state = play(createGame(), ["up", "up", "right"]);
  const settings = { sound: false, routeHint: true, highContrast: true };
  const before = fingerprint(state);
  const snapshot = createExportSnapshot(state, settings, "2026-11-16T00:00:00.000Z");
  const after = fingerprint(state);
  assert.equal(before, after);
  assert.equal(snapshot.stateFingerprint, before);
  assert.equal(snapshot.format, "lumen-relay-project");
  assert.deepEqual(snapshot.settings, settings);
  assert.equal(snapshot.state.player.x, state.player.x);
  assert.match(snapshot.summary.resources, /碎片/);
  assert.match(snapshot.snapshotFingerprint, /^[0-9a-f]{8}$/);
});
