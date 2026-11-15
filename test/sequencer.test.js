import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAudioContext, ManualClock, MockOfflineContext } from './mock-audio.js';
import { defaultProject } from '../src/project.js';
import { GlassAudioEngine } from '../src/audio.js';
import { GlassSequencer } from '../src/sequencer.js';
import { renderProject, exportDurationSeconds, planEvents } from '../src/exporter.js';

function setup(overrides = {}) {
  const ctx = new MockAudioContext();
  const project = { ...defaultProject(), ...overrides };
  const engine = new GlassAudioEngine(ctx, project);
  const clock = new ManualClock(ctx);
  const sequencer = new GlassSequencer(engine, project, clock);
  return { ctx, clock, project, engine, sequencer };
}

test('完整演奏十二音且未破杯 → onSuccess，结束后节点全部释放', async () => {
  const { clock, engine, sequencer, project } = setup();
  let successAt = null;
  let failed = false;
  sequencer.onSuccess = (at) => { successAt = at; };
  sequencer.onFail = () => { failed = true; };
  await sequencer.play(0);
  clock.runFor(4); // 12 个八分音符 @100BPM = 3.6s
  assert.equal(failed, false);
  assert.ok(successAt !== null);
  assert.equal(project.tracks.every((t) => !t.broken), true);
  // 尾音释放点之后推进，stopAll 已被调度（mock 立即执行 stopAll 调用）
  assert.equal(engine.activeCount, 0);
  assert.equal(sequencer.state, 'stopped');
});

test('循环模式下不会触发完成，停止后清空全部声源', async () => {
  const { clock, engine, sequencer } = setup({ loop: true });
  let completed = 0;
  sequencer.scheduler.onComplete = () => { completed += 1; };
  await sequencer.play(0);
  clock.runFor(8);
  assert.equal(completed, 0);
  assert.equal(sequencer.state, 'playing');
  engine.strike(0, { when: clock.now(), velocity: 0.5 });
  assert.ok(engine.activeCount > 0);
  sequencer.stop();
  assert.equal(engine.activeCount, 0);
  assert.equal(sequencer.state, 'stopped');
});

test('暂停后状态切换正确，恢复继续且不丢步', async () => {
  const { ctx, clock, sequencer } = setup();
  await sequencer.play(0);
  clock.runFor(0.5);
  await sequencer.pause();
  assert.equal(sequencer.state, 'paused');
  assert.equal(ctx.state, 'suspended');
  const stepAtPause = sequencer.scheduler.step;
  clock.runFor(1);
  assert.equal(sequencer.scheduler.step, stepAtPause);
  await sequencer.resume();
  assert.equal(sequencer.state, 'playing');
  clock.runFor(4);
  assert.equal(sequencer.scheduler.step, 12);
});

test('音符事件计划：节拍位置为步进/2，循环展开后全局拍号连续', () => {
  const project = defaultProject();
  const once = planEvents(project, { loops: 1 });
  assert.equal(once.length, 12);
  assert.deepEqual(once.map((e) => e.beat), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
  const looping = planEvents({ ...project, loop: true }, { loops: 2 });
  assert.equal(looping.length, 24);
  assert.equal(looping[12].lap, 1);
  assert.equal(looping[12].beat, 0); // 每轮内节拍位置回到 0
  assert.equal(looping[12].globalBeat, 6); // 全局拍号连续
  const stepDur = 60 / 100 / 2;
  assert.ok(Math.abs(looping[12].when - 12 * stepDur) < 1e-12);
});

test('导出时长由 BPM 与步进数精确决定', () => {
  const project = defaultProject();
  // 12 八分音符 = 6 拍 @100BPM = 3.6s
  assert.ok(Math.abs(exportDurationSeconds(project) - 3.6) < 1e-12);
  const faster = { ...project, tempo: 200 };
  assert.ok(Math.abs(exportDurationSeconds(faster) - 1.8) < 1e-12);
});

test('离线渲染返回 WAV、音符数与节拍位置，渲染后无活动节点', async () => {
  const project = defaultProject();
  const result = await renderProject(project, { OfflineCtor: MockOfflineContext });
  assert.ok(result.wav instanceof ArrayBuffer);
  assert.equal(result.noteCount, 12);
  assert.ok(Math.abs(result.duration - 3.6) < 1e-12);
  assert.deepEqual(result.beatPositions, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
  // RIFF 头校验
  const view = new DataView(result.wav);
  assert.equal(String.fromCharCode(view.getUint8(0), view.getUint8(1),
    view.getUint8(2), view.getUint8(3)), 'RIFF');
});

test('强力度音符在演奏中导致破裂并判定失败', async () => {
  const project = defaultProject();
  project.melody[6].velocity = 0.95;
  const { clock, sequencer } = setup(project);
  let failReason = null;
  sequencer.onFail = (info) => { failReason = info.reason; };
  await sequencer.play(0);
  clock.runFor(4);
  assert.equal(failReason, 'broken-cup');
  assert.equal(project.tracks[project.melody[6].glass].broken, true);
});
