import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Transport, buildEvents, defaultProject, durationSec, exportDurationSec,
  serializeProject, deserializeProject, compareProjects, virtualToBeat,
  noteFrequency, beatDurationSec,
} from '../js/core.js';
import { runSelfCheck } from '../js/selftest.js';

class MockClock {
  constructor() { this.t = 1000; }
  now() { return this.t; }
  advance(sec) { this.t += sec; }
}

test('完整示例工程包含三轨与密集音簇', () => {
  const p = defaultProject();
  assert.equal(p.tracks.length, 3);
  assert.ok(p.notes.length >= 40);
  const ev = buildEvents(p);
  assert.ok(ev.all.some((e) => e.status === 'masked'), '应存在掩蔽事件');
});

test('高速 3× 产生漏音，正常速度不漏（或更少）', () => {
  const p = defaultProject();
  const normal = buildEvents(p).all.filter((e) => e.status === 'leak').length;
  const fast = buildEvents({ ...p, speed: 3 });
  const leaks = fast.all.filter((e) => e.status === 'leak').length;
  assert.ok(leaks > normal);
});

test('暂停期间虚拟时间冻结，快速暂停恢复不累积误差', () => {
  const clock = new MockClock();
  const p = defaultProject();
  const tr = new Transport(() => clock.now(), durationSec(p));
  tr.start();
  for (let i = 0; i < 6; i += 1) {
    clock.advance(0.25);
    tr.pause();
    const frozen = tr.virtualTime;
    clock.advance(10);
    assert.equal(tr.virtualTime, frozen);
    tr.start();
  }
  clock.advance(0.5);
  assert.ok(Math.abs(tr.virtualTime - (6 * 0.25 + 0.5)) < 1e-12);
});

test('循环回绕始终回到 0，不累积偏移', () => {
  const clock = new MockClock();
  const p = defaultProject();
  const dur = durationSec(p);
  const tr = new Transport(() => clock.now(), dur);
  tr.start();
  let wraps = 0;
  for (let i = 0; i < 1000; i += 1) {
    clock.advance(0.1);
    if (tr.wrapIfNeeded()) {
      wraps += 1;
      assert.equal(tr.virtualTime, 0);
    }
  }
  assert.ok(wraps >= 3);
  assert.ok(tr.virtualTime < dur);
});

test('变速重锚定保持位置连续', () => {
  const clock = new MockClock();
  const p = defaultProject();
  const tr = new Transport(() => clock.now(), durationSec(p));
  tr.start();
  clock.advance(1.2);
  const pos = tr.virtualTime;
  tr.reanchor(durationSec({ ...p, speed: 2.5 }));
  assert.equal(tr.virtualTime, pos);
  clock.advance(0.8);
  assert.ok(Math.abs(tr.virtualTime - (pos + 0.8)) < 1e-12);
});

test('变调改变频率但不改变任何事件时间', () => {
  const p = defaultProject();
  const shifted = JSON.parse(JSON.stringify(p));
  shifted.tracks[0].detune = 200;
  const a = buildEvents(p);
  const b = buildEvents(shifted);
  assert.deepEqual(a.all.map((e) => e.time), b.all.map((e) => e.time));
  const t1a = a.all.find((e) => e.trackId === 't1');
  const t1b = b.all.find((e) => e.trackId === 't1');
  assert.notEqual(t1a.freq, t1b.freq);
});

test('保存/重载后音符数量、节拍位置、导出时长完全一致', () => {
  const p = defaultProject();
  const rt = deserializeProject(serializeProject(p));
  const cmp = compareProjects(p, rt);
  assert.equal(cmp.noteCountMatch, true);
  assert.equal(cmp.beatsAligned, true);
  assert.equal(cmp.exportDurationMatch, true);
  assert.equal(cmp.exportDurationBefore, exportDurationSec(rt));
});

test('每轨增益与参数被完整记录', () => {
  const p = defaultProject();
  p.tracks[1].gain = 0.42;
  p.tracks[1].detune = -33;
  const rt = deserializeProject(serializeProject(p));
  assert.equal(rt.tracks[1].gain, 0.42);
  assert.equal(rt.tracks[1].detune, -33);
  assert.equal(rt.tracks.length, 3);
});

test('时间-节拍换算闭环到总拍数', () => {
  const p = defaultProject();
  const beat = virtualToBeat(durationSec(p), p.bpm, p.speed);
  assert.ok(Math.abs(beat - p.totalBeats) < 1e-9);
  assert.equal(beatDurationSec(120), 0.5);
});

test('音高频率按半音等比增长', () => {
  const f0 = noteFrequency(0);
  const f12 = noteFrequency(12);
  assert.ok(Math.abs(f12 / f0 - 2) < 1e-12);
});

test('非法工程被拒绝', () => {
  assert.throws(() => deserializeProject('{}'));
  assert.throws(() => deserializeProject(JSON.stringify({ ...defaultProject(), bpm: 0 })));
});

test('自检全部通过', () => {
  const report = runSelfCheck();
  for (const r of report.results) assert.equal(r.pass, true, r.detail);
});
