import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scheduler, STEPS_PER_BEAT, clampTempo } from '../src/scheduler.js';
import { defaultProject } from '../src/project.js';
import { MockAudioContext, ManualClock } from './mock-audio.js';

function makeScheduler(overrides = {}) {
  const ctx = new MockAudioContext();
  const clock = new ManualClock(ctx);
  const scheduler = new Scheduler({ clock });
  const project = { ...defaultProject(), ...overrides };
  scheduler.load({
    tempo: project.tempo,
    transpose: project.transpose,
    loop: project.loop,
    patternLength: project.melody.length,
  });
  const events = [];
  scheduler.onStep = (e) => events.push(e);
  return { ctx, clock, scheduler, events, project };
}

test('调度事件时间严格落在 BPM 网格上，无漂移', () => {
  const { scheduler, events, project } = makeScheduler({ tempo: 100 });
  scheduler.play(0);
  const stepDur = 60 / 100 / STEPS_PER_BEAT;
  for (let i = 0; i < 40; i += 1) scheduler.runStep();
  assert.equal(events.length, project.melody.length);
  events.forEach((e, i) => {
    assert.equal(e.stepIndex, i);
    assert.equal(e.beat, i / STEPS_PER_BEAT);
    assert.ok(Math.abs(e.when - i * stepDur) < 1e-12);
  });
});

test('播放完成时回调一次，且末事件节拍正确', () => {
  const { scheduler } = makeScheduler();
  let finishedAt = null;
  scheduler.onComplete = (at) => { finishedAt = at; };
  scheduler.play(0);
  for (let i = 0; i < 20; i += 1) scheduler.runStep();
  assert.ok(finishedAt !== null);
  // 12 个八分音符 @100BPM = 3.6 秒
  assert.ok(Math.abs(finishedAt - 3.6) < 1e-12);
});

test('暂停/快速恢复后事件时间与节拍位置零累积误差', () => {
  const { ctx, clock, scheduler, events } = makeScheduler({ tempo: 120 });
  scheduler.play(0);
  // 跑两个轮询（50ms），暂停
  clock.runFor(0.05);
  ctx.suspend();
  scheduler.pause();
  const frozenTime = ctx.currentTime;
  // 挂起期间即使轮询触发，时间不前进、不调度新事件
  clock.runFor(2.0);
  assert.equal(ctx.currentTime, frozenTime);
  const countWhilePaused = events.length;
  // 快速恢复（模拟连续多次暂停-恢复）
  for (let i = 0; i < 5; i += 1) {
    ctx.resume();
    scheduler.resume();
    ctx.suspend();
    scheduler.pause();
  }
  ctx.resume();
  scheduler.resume();
  clock.runFor(5);
  const stepDur = 60 / 120 / STEPS_PER_BEAT;
  events.forEach((e, i) => {
    assert.ok(Math.abs(e.when - i * stepDur) < 1e-12,
      `事件 ${i} 时间偏移: ${e.when} vs ${i * stepDur}`);
  });
  assert.ok(events.length > countWhilePaused);
  assert.equal(events.length, 12);
});

test('循环播放：接缝无间隙，全局节拍连续且不重置', () => {
  const { scheduler, events } = makeScheduler({ loop: true });
  scheduler.play(0);
  for (let i = 0; i < 60; i += 1) scheduler.runStep();
  assert.ok(events.length >= 20);
  const stepDur = 60 / 100 / STEPS_PER_BEAT;
  events.forEach((e, i) => {
    assert.equal(e.stepIndex, i);
    assert.equal(e.patternStep, i % 12);
    assert.ok(Math.abs(e.when - i * stepDur) < 1e-12);
    // 每轮内节拍位置始终在 [0, 6)
    assert.ok(e.beat % 6 >= 0 && e.beat % 6 < 6);
  });
  // 第二圈首事件紧接第一圈尾事件
  assert.ok(Math.abs((events[12].when - events[11].when) - stepDur) < 1e-9);
  scheduler.stop();
});

test('变调只影响音高参数，不改变任何事件时间', () => {
  const a = makeScheduler();
  a.scheduler.play(0);
  for (let i = 0; i < 20; i += 1) a.scheduler.runStep();
  const b = makeScheduler();
  b.scheduler.setTranspose(7);
  b.scheduler.play(0);
  for (let i = 0; i < 20; i += 1) b.scheduler.runStep();
  b.events.forEach((e, i) => {
    assert.equal(e.when, a.events[i].when);
    assert.equal(e.transpose, 7);
  });
});

test('速度调整只影响后续步进，历史时间不被重写', () => {
  const { scheduler, events } = makeScheduler({ tempo: 100 });
  scheduler.play(0);
  scheduler.runStep(); // 第 0 步 @0
  scheduler.runStep(); // 第 1 步
  const early = events[1].when;
  scheduler.setTempo(200);
  scheduler.runStep(); // 第 2 步 @0.6（提速前已排程，时间保持不变）
  scheduler.runStep(); // 第 3 步 @0.75（新步进时长 0.15 生效）
  assert.equal(events[1].when, early); // 历史事件时间不被重写
  const oldStep = 60 / 100 / STEPS_PER_BEAT;
  const newStep = 60 / 200 / STEPS_PER_BEAT;
  assert.equal(events[2].when, oldStep * 2);
  assert.ok(Math.abs(events[3].when - (oldStep * 2 + newStep)) < 1e-10);
  assert.ok(Math.abs(events[1].when - oldStep) < 1e-10);
});

test('节拍钳制与默认值', () => {
  assert.equal(clampTempo(9999), 300);
  assert.equal(clampTempo(1), 30);
  assert.equal(clampTempo('bad'), 120);
});
