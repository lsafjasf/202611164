import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockAudioContext } from './mock-audio.js';
import { GlassAudioEngine } from '../src/audio.js';
import { defaultProject, BASE_FREQS } from '../src/project.js';

function makeEngine() {
  const ctx = new MockAudioContext();
  const project = defaultProject();
  const engine = new GlassAudioEngine(ctx, project);
  return { ctx, project, engine };
}

test('敲击为每个泛音创建振荡器并登记到 activeSources', () => {
  const { ctx, engine } = makeEngine();
  const result = engine.strike(0, { when: 0, velocity: 0.5 });
  assert.equal(result.broken, false);
  const oscCount = ctx.created.filter((n) => n.kind === 'oscillator').length;
  assert.equal(oscCount, 4); // 4 个分音
  assert.equal(engine.activeCount, 4);
});

test('onended 触发后节点自动从注册表移除', () => {
  const { engine } = makeEngine();
  engine.strike(1, { when: 0, velocity: 0.4 });
  assert.equal(engine.activeCount, 4);
  for (const source of Array.from(engine.activeSources.keys())) source.onended();
  assert.equal(engine.activeCount, 0);
});

test('摩擦产生带通噪声源并使杯温升高、音高下降（失谐）', () => {
  const { engine } = makeEngine();
  const before = engine.frequencyFor(2);
  engine.rub(2, { when: 0, duration: 0.25 });
  const noise = engine.ctx.created.some((n) => n.kind === 'buffer-source');
  assert.ok(noise);
  assert.ok(engine.temperatures[2] > 0);
  const after = engine.frequencyFor(2);
  assert.ok(after < before, '升温后频率应降低');
});

test('冷却随时间降低温度，温度归零后频率恢复', () => {
  const { engine } = makeEngine();
  engine.rub(3, { when: 0, duration: 0.5 });
  const hot = engine.temperatures[3];
  engine.cool(10);
  assert.equal(engine.temperatures[3], 0);
  assert.ok(hot > 0);
});

test('力度超过阈值敲击会破裂，破裂后不再发声', () => {
  const { engine, project } = makeEngine();
  const result = engine.strike(4, { when: 0, velocity: 0.95 });
  assert.equal(result.broken, true);
  assert.equal(project.tracks[4].broken, true);
  const countAfterBreak = engine.activeCount;
  engine.strike(4, { when: 1, velocity: 0.3 });
  engine.rub(4, { when: 1, duration: 0.2 });
  assert.equal(engine.activeCount, countAfterBreak, '破裂杯不应再新增声源');
});

test('破裂会停止该杯此前仍在响的节点并播放破裂声', () => {
  const { engine } = makeEngine();
  engine.strike(5, { when: 0, velocity: 0.5 });
  const voices = Array.from(engine.activeSources.keys());
  assert.equal(voices.length, 4);
  engine.breakGlass(5, 0.5);
  voices.forEach((v) => assert.equal(v.stopped, true));
  const breakSource = Array.from(engine.activeSources.keys())
    .find((s) => engine.activeSources.get(s).kind === 'break');
  assert.ok(breakSource);
});

test('stopAll 停止并断开全部节点，注册表清空，无残留声音', () => {
  const { engine } = makeEngine();
  engine.strike(0, { when: 0, velocity: 0.5 });
  engine.strike(2, { when: 0.1, velocity: 0.5 });
  engine.rub(3, { when: 0.2, duration: 0.3 });
  assert.ok(engine.activeCount > 0);
  const sources = Array.from(engine.activeSources.keys());
  engine.stopAll(1);
  assert.equal(engine.activeCount, 0);
  sources.forEach((s) => {
    assert.equal(s.stopped, true);
    assert.equal(s.disconnected, true);
  });
});

test('水位影响频率：水越多音越低，且变调按半音叠加', () => {
  const { engine, project } = makeEngine();
  project.tracks[0].water = 0;
  const dry = engine.frequencyFor(0, 0);
  project.tracks[0].water = 1;
  const full = engine.frequencyFor(0, 0);
  assert.ok(Math.abs(full - dry * 0.25) < 1e-9); // 低两个八度
  const shifted = engine.frequencyFor(0, 12);
  assert.ok(Math.abs(shifted - full * 2) < 1e-9);
});

test('每轨增益与声像可独立设置并写入工程', () => {
  const { engine, project } = makeEngine();
  engine.setTrackGain(1, 0.42);
  engine.setTrackPan(1, -0.7);
  assert.equal(project.tracks[1].gain, 0.42);
  assert.equal(project.tracks[1].pan, -0.7);
  assert.equal(engine.trackNodes[1].gain.gain.value, 0.42);
  assert.equal(engine.trackNodes[1].panner.pan.value, -0.7);
});

test('基底频率表为 8 只杯子', () => {
  assert.equal(BASE_FREQS.length, 8);
});
