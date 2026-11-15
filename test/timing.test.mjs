import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spbFromBpm, beatTime, beatIndexAt, retuneAnchor, loopPosition, semitoneRatio,
} from '../js/timing.js';
import { Maze, MAZE_DEPTH } from '../js/maze.js';
import { compareMetrics } from '../js/render.js';
import { defaultProject, TOTAL_BEATS } from '../js/engine.js';

test('节拍位置由锚点网格推导，无累加误差', () => {
  const spb = spbFromBpm(96, 1);
  const anchor = 0.1;
  for (let i = 0; i < 10000; i += 1) {
    assert.equal(beatTime(anchor, i, spb), anchor + i * spb);
  }
});

test('暂停/恢复（时钟冻结）后节拍位置零漂移', () => {
  const spb = spbFromBpm(120, 1);
  const anchor = 0.1;
  let currentTime = 1.0;
  const before = [];
  for (let i = 0; i < 64; i += 1) before.push(beatTime(anchor, i, spb));
  for (let cycle = 0; cycle < 200; cycle += 1) {
    const frozen = currentTime;
    currentTime = frozen;
  }
  const idx = beatIndexAt(currentTime, anchor, spb);
  for (let i = idx; i < 64; i += 1) {
    assert.equal(beatTime(anchor, i, spb), before[i]);
  }
});

test('变速时锚点重算保持拍位置连续', () => {
  const oldSpb = spbFromBpm(96, 1);
  const newSpb = spbFromBpm(96, 2);
  const anchor = 0.1;
  const now = 3.7;
  const posBefore = (now - anchor) / oldSpb;
  const newAnchor = retuneAnchor(now, anchor, oldSpb, newSpb);
  const posAfter = (now - newAnchor) / newSpb;
  assert.ok(Math.abs(posBefore - posAfter) < 1e-12);
});

test('循环取模不重置全局网格', () => {
  const spb = spbFromBpm(96, 1.5);
  const anchor = 0.1;
  for (let i = 0; i < 1000; i += 1) {
    const pos = loopPosition(i, 8);
    assert.equal(pos, i % 8);
    assert.equal(beatTime(anchor, i, spb), anchor + i * spb);
  }
});

test('变调只影响频率倍率，不涉及时间', () => {
  assert.ok(Math.abs(semitoneRatio(12) - 2) < 1e-12);
  assert.ok(Math.abs(semitoneRatio(-12) - 0.5) < 1e-12);
  assert.equal(semitoneRatio(0), 1);
});

test('迷宫：全对通关到达 3 个检查点并可提交', () => {
  const maze = new Maze(42);
  for (let i = 0; i < MAZE_DEPTH; i += 1) {
    maze.choose(maze.correctPath[i]);
  }
  assert.equal(maze.checkpoints, 3);
  assert.ok(maze.canSubmit());
  const result = maze.submit();
  assert.equal(result.errors, 0);
});

test('迷宫：走错增加噪声，后退后可继续', () => {
  const maze = new Maze(7);
  const wrong = maze.correctPath[0] === 'L' ? 'R' : 'L';
  const res = maze.choose(wrong);
  assert.equal(res.correct, false);
  assert.ok(maze.noiseLevel() > 0);
  assert.equal(maze.choose(maze.correctPath[0]), null);
  assert.ok(maze.back());
  assert.equal(maze.choose(maze.correctPath[0]).correct, true);
});

test('指标对比：首轮与重载后一致', () => {
  const project = defaultProject();
  const spb = spbFromBpm(project.bpm, project.speed);
  const mk = () => ({
    noteCount: TOTAL_BEATS + 13,
    beatPositions: Array.from({ length: TOTAL_BEATS },
      (_, i) => Number((0.1 + i * spb).toFixed(6))),
    exportDuration: Number((0.1 + TOTAL_BEATS * spb + 1.5).toFixed(6)),
  });
  const a = mk();
  const b = mk();
  const cmp = compareMetrics(a, b);
  assert.ok(cmp.noteCountEqual);
  assert.ok(cmp.durationEqual);
  assert.ok(cmp.maxBeatDiff < 1e-6);
});
