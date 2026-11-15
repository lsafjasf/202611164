import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultProject, serializeProject, deserializeProject,
  patternLength, GLASS_COUNT, saveToStorage, loadFromStorage, clearStorage,
} from '../src/project.js';
import { planEvents, exportDurationSeconds } from '../src/exporter.js';
import { encodeWav } from '../src/wav.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

function metrics(project) {
  const events = planEvents(project, { loops: 1 });
  return {
    noteCount: events.length,
    beatPositions: events.map((e) => e.beat),
    exportDuration: exportDurationSeconds(project, 1),
    gains: project.tracks.map((t) => t.gain),
    waters: project.tracks.map((t) => t.water),
  };
}

test('默认工程为 8 轨 12 音，每音占据独立步进', () => {
  const project = defaultProject();
  assert.equal(project.tracks.length, GLASS_COUNT);
  assert.equal(project.melody.length, 12);
  assert.equal(patternLength(project), 12);
  const glasses = new Set(project.melody.map((n) => n.glass));
  assert.equal(glasses.size, 8);
  assert.deepEqual(project.melody.map((n) => n.step), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('保存并重新载入：音符数量、节拍位置、导出时长完全一致', () => {
  const original = defaultProject();
  original.tracks[2].gain = 0.33;
  original.tracks[5].water = 0.81;
  original.tempo = 132;
  original.transpose = -3;
  const before = metrics(original);

  const json = serializeProject(original);
  const reloaded = deserializeProject(json);
  const after = metrics(reloaded);

  assert.equal(after.noteCount, before.noteCount);
  assert.deepEqual(after.beatPositions, before.beatPositions);
  assert.equal(after.exportDuration, before.exportDuration);
  assert.deepEqual(after.gains, before.gains);
  assert.deepEqual(after.waters, before.waters);
  assert.equal(reloaded.tempo, 132);
  assert.equal(reloaded.transpose, -3);
  // 重新载入后可从头播放：首事件节拍为 0
  assert.equal(planEvents(reloaded)[0].beat, 0);
});

test('localStorage 往返保存每轨参数与增益', () => {
  const storage = new MemoryStorage();
  const project = defaultProject();
  project.tracks[0].gain = 0.11;
  project.tracks[7].pan = 0.9;
  saveToStorage(project, storage);
  const loaded = loadFromStorage(storage);
  assert.equal(loaded.tracks[0].gain, 0.11);
  assert.equal(loaded.tracks[7].pan, 0.9);
  clearStorage(storage);
  assert.equal(loadFromStorage(storage), null);
});

test('损坏工程被拒绝', () => {
  assert.throws(() => deserializeProject('{"version":99}'));
  assert.throws(() => deserializeProject('not-json'));
  const bad = defaultProject();
  bad.tracks = bad.tracks.slice(0, 4);
  assert.throws(() => deserializeProject(serializeProject(bad)));
});

test('循环工程导出 N 轮时音符数倍增而单轮节拍位置不变', () => {
  const project = { ...defaultProject(), loop: true };
  const one = planEvents(project, { loops: 1 });
  const two = planEvents(project, { loops: 2 });
  assert.equal(two.length, one.length * 2);
  assert.deepEqual(two.slice(0, 12).map((e) => e.beat), one.map((e) => e.beat));
  assert.equal(exportDurationSeconds(project, 2), exportDurationSeconds(project, 1) * 2);
});

test('WAV 编码：44 字节头 + 交错 PCM16 数据长度', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1]);
  const right = new Float32Array([0.25, -0.25, 0.75, -1]);
  const buffer = encodeWav([left, right], 48000);
  const view = new DataView(buffer);
  assert.equal(buffer.byteLength, 44 + 4 * 2 * 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(40, true), 16);
  // 削波：1.0 饱和到 0x7fff，-1 到 -0x8000
  const lastFrame = 44 + 3 * 4;
  assert.equal(view.getInt16(lastFrame, true), 0x7fff);
  assert.equal(view.getInt16(lastFrame + 2, true), -0x8000);
});

test('空声道编码抛错', () => {
  assert.throws(() => encodeWav([], 44100));
});
