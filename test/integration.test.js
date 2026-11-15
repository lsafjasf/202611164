import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAudioContext, ManualClock, MockOfflineContext } from './mock-audio.js';
import { defaultProject, serializeProject, deserializeProject } from '../src/project.js';
import { GlassAudioEngine } from '../src/audio.js';
import { GlassSequencer } from '../src/sequencer.js';
import { renderProject, planEvents, exportDurationSeconds } from '../src/exporter.js';

// 端到端：实时播放整条序列、保存重载对比、离线导出，模拟真实使用顺序。
test('端到端：首轮演奏 → 保存 → 重载 → 指标一致 → 从头再演 → 资源释放', async () => {
  // 第一轮
  const ctx1 = new MockAudioContext();
  const project1 = defaultProject();
  const engine1 = new GlassAudioEngine(ctx1, project1);
  const clock1 = new ManualClock(ctx1);
  const seq1 = new GlassSequencer(engine1, project1, clock1);
  let successCount = 0;
  seq1.onSuccess = () => { successCount += 1; };
  await seq1.play(0);
  clock1.runFor(4);
  assert.equal(successCount, 1);
  assert.equal(engine1.activeCount, 0, '首轮结束后无残留声源');
  const firstMetrics = {
    noteCount: planEvents(project1).length,
    beats: planEvents(project1).map((e) => e.beat),
    duration: exportDurationSeconds(project1),
  };

  // 保存 → 重新载入（模拟刷新页面）
  const json = serializeProject(project1);
  const project2 = deserializeProject(json);
  const reloadedMetrics = {
    noteCount: planEvents(project2).length,
    beats: planEvents(project2).map((e) => e.beat),
    duration: exportDurationSeconds(project2),
  };
  assert.deepEqual(reloadedMetrics, firstMetrics);

  // 第二轮：全新上下文，从第 0 拍开始
  const ctx2 = new MockAudioContext();
  const engine2 = new GlassAudioEngine(ctx2, project2);
  const clock2 = new ManualClock(ctx2);
  const seq2 = new GlassSequencer(engine2, project2, clock2);
  let secondSuccess = 0;
  seq2.onSuccess = () => { secondSuccess += 1; };
  await seq2.play(0);
  clock2.runFor(4);
  assert.equal(secondSuccess, 1);
  assert.equal(engine2.activeCount, 0);
  assert.equal(seq2.scheduler.step, 12, '重载后完整从头演了 12 步');

  // 离线导出与实时序列同长
  const exported = await renderProject(deserializeProject(json), {
    OfflineCtor: MockOfflineContext,
  });
  assert.equal(exported.noteCount, firstMetrics.noteCount);
  assert.ok(Math.abs(exported.duration - firstMetrics.duration) < 1e-12);
});

test('端到端：循环两轮 + 中途快速暂停恢复，节拍仍无偏移', async () => {
  const ctx = new MockAudioContext();
  const project = { ...defaultProject(), loop: true };
  const engine = new GlassAudioEngine(ctx, project);
  const clock = new ManualClock(ctx);
  const seq = new GlassSequencer(engine, project, clock);
  await seq.play(0);
  clock.runFor(1);
  await seq.pause();
  const stepAtPause = seq.scheduler.step;
  const timeAtPause = seq.scheduler.nextStepTime;
  // 连续快速暂停-恢复 10 次
  for (let i = 0; i < 10; i += 1) {
    await seq.resume();
    await seq.pause();
  }
  assert.equal(seq.scheduler.step, stepAtPause);
  assert.equal(seq.scheduler.nextStepTime, timeAtPause);
  await seq.resume();
  clock.runFor(6);
  seq.stop();
  assert.equal(engine.activeCount, 0, '停止后无残留声源');
  // 每个事件仍严格落在网格上
  const stepDur = 60 / project.tempo / 2;
  const events = planEvents(project, { loops: 2 });
  events.forEach((e, i) => {
    assert.ok(Math.abs(e.when - i * stepDur) < 1e-9);
  });
});

test('端到端：摩擦升温改变频率但不破坏杯子，冷却后复原', () => {
  const ctx = new MockAudioContext();
  const project = defaultProject();
  const engine = new GlassAudioEngine(ctx, project);
  const original = engine.frequencyFor(0);
  for (let i = 0; i < 5; i += 1) engine.rub(0, { when: i * 0.3, duration: 0.25 });
  assert.ok(engine.temperatures[0] > 0);
  assert.ok(engine.frequencyFor(0) < original);
  engine.cool(60);
  assert.equal(engine.temperatures[0], 0);
  assert.ok(Math.abs(engine.frequencyFor(0) - original) < 1e-12);
  engine.stopAll();
  assert.equal(engine.activeCount, 0);
});
