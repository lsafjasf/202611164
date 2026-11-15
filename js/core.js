// 纯逻辑模块：数据模型、音符事件构建、虚拟时钟 Transport、序列化。
// 不依赖 DOM / Web Audio，可直接在 Node 中测试。

export const PROJECT_VERSION = 1;
export const PITCH_COUNT = 12;
const BASE_FREQ = 523.25; // C5
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 声学模型阈值（单位：虚拟秒）
const MASK_WINDOW = 0.09;   // 同轨/同音高间隔小于该值 → 掩蔽衰减
const MASK_GAIN = 0.35;
const LEAK_GAP_BASE = 0.045; // 基准漏音间隔，按速度缩放：越快越容易漏
const LEAK_GAP_FLOOR = 0.03;
const MAX_POLYPHONY = 24;
const RELEASE_TAIL = 1.4;   // 导出时尾音预留

export function pitchName(index) {
  const octave = 5 + Math.floor(index / 12);
  return `${NOTE_NAMES[((index % 12) + 12) % 12]}${octave}`;
}

export function noteFrequency(pitchIndex, detuneCents = 0) {
  const semi = pitchIndex + (detuneCents || 0) / 100;
  return BASE_FREQ * Math.pow(2, semi / 12);
}

export function beatDurationSec(bpm) {
  return 60 / bpm;
}

// 工程总时长（虚拟秒，不含尾音）
export function durationSec(project) {
  return (project.totalBeats * beatDurationSec(project.bpm)) / project.speed;
}

export function exportDurationSec(project) {
  return durationSec(project) + RELEASE_TAIL;
}

function makeTrack(id, name, gain, detune, pan) {
  return { id, name, gain, detune, pan, mute: false };
}

export function defaultTracks() {
  return [
    makeTrack('t1', '高音轨', 0.9, 0, -0.25),
    makeTrack('t2', '旋律轨', 0.8, 4, 0),
    makeTrack('t3', '低音轨', 0.85, -6, 0.25),
  ];
}

let noteSeq = 0;
function n(track, pitch, beat) {
  return { id: `n${++noteSeq}`, track, pitch, beat };
}

// 完整示例：8 小节 × 4 拍，三轨；含密集音簇（触发掩蔽）与高速下的漏音。
export function defaultProject() {
  noteSeq = 0;
  const notes = [];
  // 旋律轨：C 大调乐句
  const melody = [
    [0, 4], [1, 6], [1.5, 7], [2, 9], [3, 7],
    [4, 6], [5, 4], [6, 6], [7, 9],
    [8, 11], [9, 9], [10, 7], [11, 6],
    [12, 4], [13, 6], [14, 7], [15, 4],
    [16, 4], [17, 6], [17.5, 7], [18, 9], [19, 7],
    [20, 6], [21, 4], [22, 6], [23, 2],
    [24, 4], [25, 7], [26, 9], [27, 11],
    [28, 9], [29, 7], [30, 6], [31, 4],
  ];
  for (const [beat, pitch] of melody) notes.push(n('t2', pitch, beat));
  // 高音轨：稀疏点缀 + 第 6 小节密集十六分音簇
  [[0, 11], [4, 12], [8, 14], [12, 12], [16, 11], [20, 12], [24, 14], [28, 12], [31, 11]]
    .forEach(([beat, pitch]) => notes.push(n('t1', pitch, beat)));
  [20.0, 20.125, 20.25, 20.375].forEach((beat, i) => notes.push(n('t1', 9 + i, beat)));
  // 低音轨：每小节根音，第 7 小节加入同音高密集触发
  [0, 4, 8, 12, 16, 20, 24, 28].forEach((beat, i) => notes.push(n('t3', (i % 2 === 0 ? 0 : 2), beat)));
  [24.0, 24.1].forEach((beat) => notes.push(n('t3', 0, beat)));

  return {
    version: PROJECT_VERSION,
    bpm: 100,
    speed: 1,
    loop: true,
    totalBeats: 32,
    tracks: defaultTracks(),
    notes,
  };
}

// 由工程构建带声学判定的调度事件（虚拟时间轴，确定性、与播放上下文无关）。
export function buildEvents(project) {
  const beatSec = beatDurationSec(project.bpm) / project.speed;
  const trackMap = new Map(project.tracks.map((t) => [t.id, t]));
  const raw = [];
  for (const note of project.notes) {
    const track = trackMap.get(note.track);
    if (!track || track.mute) continue;
    raw.push({
      time: note.beat * beatSec,
      beat: note.beat,
      noteId: note.id,
      trackId: track.id,
      pitch: note.pitch,
      freq: noteFrequency(note.pitch, track.detune),
      gain: track.gain,
      pan: track.pan,
      status: 'ok',
      velocity: 1,
    });
  }
  raw.sort((a, b) => a.time - b.time || a.trackId.localeCompare(b.trackId));

  const lastByTrack = new Map();   // 同轨上次发声事件
  const lastByPitch = new Map();   // 同音高上次发声事件
  let lastGlobalTime = -Infinity;
  let activeCount = 0;
  const activeUntil = [];
  const sounded = [];
  for (const ev of raw) {
    while (activeUntil.length && activeUntil[0] <= ev.time) {
      activeUntil.shift();
      activeCount -= 1;
    }
    const tPrev = lastByTrack.get(ev.trackId);
    const pPrev = lastByPitch.get(ev.pitch);
    const crowded =
      (tPrev && ev.time - tPrev.time < MASK_WINDOW) ||
      (pPrev && ev.time - pPrev.time < MASK_WINDOW);
    if (crowded) {
      ev.status = 'masked';
      ev.velocity = MASK_GAIN;
    }
    // 高速漏音：拨齿机构在速度倍率下的最小响应间隔，或复音数超限。
    // 多轨同时发声（和弦）间隔为 0 但走掩蔽判定，不视为漏音。
    const leakGap = Math.max(LEAK_GAP_FLOOR, LEAK_GAP_BASE / project.speed);
    const sameMomentChord = ev.time === lastGlobalTime;
    if ((!sameMomentChord && ev.time - lastGlobalTime < leakGap) || activeCount >= MAX_POLYPHONY) {
      ev.status = 'leak';
      ev.velocity = 0;
      continue;
    }
    lastGlobalTime = ev.time;
    lastByTrack.set(ev.trackId, ev);
    lastByPitch.set(ev.pitch, ev);
    activeUntil.push(ev.time + RELEASE_TAIL);
    activeCount += 1;
    sounded.push(ev);
  }
  return { all: raw, sounded };
}

export function eventsInRange(events, fromExclusive, toInclusive) {
  return events.filter((e) => e.time > fromExclusive && e.time <= toInclusive && e.status !== 'leak');
}

// 单调虚拟时钟：所有调度都以 virtualTime 为唯一真相，audioCtx.currentTime 仅作换算。
// 暂停/恢复通过重锚定（re-anchor）实现，不累积任何偏移；变速只改变节拍推进速率。
export class Transport {
  constructor(nowProvider, duration) {
    this.now = nowProvider; // () => 秒（AudioContext.currentTime 或 Date/performance）
    this.setDuration(duration);
    this.running = false;
    this.anchorNow = 0;
    this.anchorVirtual = 0;
    this._virtual = 0;
  }

  setDuration(duration) {
    this.duration = Math.max(0.001, duration);
    this._virtual = Math.min(this._virtual, this.duration);
  }

  get virtualTime() {
    if (!this.running) return this._virtual;
    return Math.min(this.duration, this.anchorVirtual + (this.now() - this.anchorNow));
  }

  start() {
    if (this.running) return;
    this.anchorNow = this.now();
    this.anchorVirtual = this._virtual;
    this.running = true;
  }

  pause() {
    if (!this.running) return;
    this._virtual = this.virtualTime;
    this.running = false;
  }

  // 停止 = 回到起点；调用方必须同时硬停所有发声节点。
  stop() {
    this.running = false;
    this._virtual = 0;
    this.anchorVirtual = 0;
  }

  seekToStart() {
    const wasRunning = this.running;
    this.running = false;
    this._virtual = 0;
    this.anchorVirtual = 0;
    if (wasRunning) this.start();
  }

  // 变速：保持当前虚拟位置不变，仅重锚定；不产生跳变或偏移。
  reanchor(newDuration) {
    const wasRunning = this.running;
    this._virtual = this.virtualTime;
    if (newDuration !== undefined) this.setDuration(newDuration);
    this.running = false;
    if (wasRunning) this.start();
  }

  // 循环回绕：虚拟时间取模；返回是否发生了回绕。
  wrapIfNeeded() {
    if (this.virtualTime >= this.duration) {
      this._virtual = 0;
      this.anchorVirtual = 0;
      this.anchorNow = this.now();
      this.running = true;
      return true;
    }
    return false;
  }
}

export function virtualToBeat(virtualTime, bpm, speed) {
  return (virtualTime * bpm * speed) / 60;
}

// ---- 序列化：保存每轨参数与增益，深拷贝去除运行时态 ----
export function serializeProject(project) {
  return JSON.stringify({
    version: PROJECT_VERSION,
    bpm: project.bpm,
    speed: project.speed,
    loop: project.loop,
    totalBeats: project.totalBeats,
    tracks: project.tracks.map((t) => ({
      id: t.id, name: t.name, gain: t.gain, detune: t.detune, pan: t.pan, mute: !!t.mute,
    })),
    notes: project.notes.map((nt) => ({ id: nt.id, track: nt.track, pitch: nt.pitch, beat: nt.beat })),
    savedAt: new Date().toISOString(),
  }, null, 2);
}

export function validateProject(data) {
  const errors = [];
  if (!data || typeof data !== 'object') errors.push('工程不是对象');
  if (!Array.isArray(data?.tracks) || data.tracks.length === 0) errors.push('缺少音轨');
  if (!Array.isArray(data?.notes)) errors.push('缺少音符数组');
  if (typeof data?.bpm !== 'number' || data.bpm <= 0) errors.push('BPM 非法');
  if (typeof data?.speed !== 'number' || data.speed <= 0) errors.push('速度非法');
  if (typeof data?.totalBeats !== 'number' || data.totalBeats <= 0) errors.push('总拍数非法');
  for (const nt of data?.notes ?? []) {
    if (typeof nt.beat !== 'number' || nt.beat < 0 || nt.beat > data.totalBeats)
      errors.push(`音符 ${nt.id ?? '?'} 节拍越界`);
    if (typeof nt.pitch !== 'number' || !Number.isInteger(nt.pitch))
      errors.push(`音符 ${nt.id ?? '?'} 音高非法`);
  }
  return errors;
}

export function deserializeProject(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const errors = validateProject(data);
  if (errors.length) throw new Error(`工程校验失败: ${errors.join('；')}`);
  return {
    version: PROJECT_VERSION,
    bpm: data.bpm,
    speed: data.speed,
    loop: !!data.loop,
    totalBeats: data.totalBeats,
    tracks: data.tracks.map((t) => ({
      id: String(t.id), name: String(t.name),
      gain: Number(t.gain), detune: Number(t.detune || 0),
      pan: Number(t.pan || 0), mute: !!t.mute,
    })),
    notes: data.notes.map((nt, i) => ({
      id: String(nt.id ?? `imp${i}`), track: String(nt.track),
      pitch: Math.round(nt.pitch), beat: Number(nt.beat),
    })),
  };
}

export function projectStats(project) {
  return {
    noteCount: project.notes.length,
    totalBeats: project.totalBeats,
    bpm: project.bpm,
    speed: project.speed,
    trackCount: project.tracks.length,
    gains: project.tracks.map((t) => ({ id: t.id, gain: t.gain, detune: t.detune, pan: t.pan, mute: t.mute })),
    duration: durationSec(project),
    exportDuration: exportDurationSec(project),
  };
}

// 比较两份工程在同一参数下的节拍位置与导出时长（容差：浮点级）。
export function compareProjects(before, after) {
  const a = [...before.notes].sort((x, y) => x.beat - y.beat || x.id.localeCompare(y.id));
  const b = [...after.notes].sort((x, y) => x.beat - y.beat || x.id.localeCompare(y.id));
  const beatMismatch = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (!a[i] || !b[i] || a[i].beat !== b[i].beat || a[i].pitch !== b[i].pitch || a[i].track !== b[i].track) {
      beatMismatch.push({ index: i, before: a[i] ?? null, after: b[i] ?? null });
    }
  }
  return {
    noteCountBefore: before.notes.length,
    noteCountAfter: after.notes.length,
    noteCountMatch: before.notes.length === after.notes.length,
    beatMismatch,
    beatsAligned: beatMismatch.length === 0,
    exportDurationBefore: exportDurationSec(before),
    exportDurationAfter: exportDurationSec(after),
    exportDurationMatch: exportDurationSec(before) === exportDurationSec(after),
  };
}
