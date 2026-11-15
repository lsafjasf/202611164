import { Engine, TOTAL_BEATS } from './engine.js';
import { beatTime, loopPosition } from './timing.js';

const STORAGE_KEY = 'echoMaze.project.v1';
const BASELINE_KEY = 'echoMaze.baseline.v1';

// 一段完整示例：确定性演示脚本（提示音/探针/噪声都落在拍网格上）
export function demoScript() {
  return [
    { beat: 0,  type: 'cue',   pan: -0.8, semis: 0,  echoTime: 0.30 },
    { beat: 4,  type: 'cue',   pan: 0.8,  semis: 2,  echoTime: 0.26 },
    { beat: 8,  type: 'probe', pan: -0.9, echoTime: 0.32 },
    { beat: 10, type: 'probe', pan: 0.9,  echoTime: 0.18 },
    { beat: 12, type: 'cue',   pan: 0.8,  semis: 4,  echoTime: 0.22 },
    { beat: 16, type: 'noise', level: 0.4 },
    { beat: 20, type: 'cue',   pan: -0.8, semis: 5,  echoTime: 0.20 },
    { beat: 24, type: 'cue',   pan: -0.8, semis: 7,  echoTime: 0.16 },
    { beat: 28, type: 'probe', pan: -0.9, echoTime: 0.14 },
    { beat: 30, type: 'probe', pan: 0.9,  echoTime: 0.24 },
    { beat: 32, type: 'cue',   pan: 0.8,  semis: 9,  echoTime: 0.12 },
    { beat: 36, type: 'noise', level: 0.2 },
    { beat: 40, type: 'cue',   pan: 0.0,  semis: 12, echoTime: 0.10 },
  ];
}

// 用 OfflineAudioContext 渲染整段序列，返回指标与音频。
// 指标只由工程参数推导，与渲染先后无关，可用于重载前后对比。
export async function renderSequence(project, totalBeats = TOTAL_BEATS) {
  const spb = 60 / (project.bpm * project.speed);
  const tail = 1.5;
  const duration = 0.1 + totalBeats * spb + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
  const engine = new Engine(project, { offline: true, context: ctx });
  engine.buildGraph();
  engine._startNoiseBed();

  const anchor = 0.1;
  for (let i = 0; i < totalBeats; i += 1) {
    const pos = project.loop ? loopPosition(i, project.loopBeats) : i;
    engine._scheduleBeat(i, pos, beatTime(anchor, i, spb));
  }
  for (const ev of demoScript()) {
    const t = beatTime(anchor, ev.beat, spb);
    if (ev.type === 'cue') {
      engine.cueTone(t, { pan: ev.pan, semis: ev.semis, echoTime: ev.echoTime });
    } else if (ev.type === 'probe') {
      engine.probePing(t, ev.pan, ev.echoTime);
    } else if (ev.type === 'noise') {
      engine.noiseBurst(t, ev.level);
    }
  }
  const buffer = await ctx.startRendering();
  return {
    metrics: {
      noteCount: engine.noteCount,
      beatPositions: engine.beatPositions.map((t) => Number(t.toFixed(6))),
      exportDuration: Number(buffer.duration.toFixed(6)),
      bpm: project.bpm,
      speed: project.speed,
      pitch: project.pitch,
      loop: project.loop,
    },
    buffer,
  };
}

export function saveProject(project) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function loadProject() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export function saveBaseline(metrics) {
  localStorage.setItem(BASELINE_KEY, JSON.stringify(metrics));
}

export function loadBaseline() {
  const raw = localStorage.getItem(BASELINE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// 对比两次渲染指标：音符数量、节拍位置、导出时长
export function compareMetrics(a, b) {
  const maxBeatDiff = Math.max(
    ...a.beatPositions.map((t, i) => Math.abs(t - (b.beatPositions[i] ?? NaN))),
  );
  return {
    noteCountA: a.noteCount,
    noteCountB: b.noteCount,
    noteCountEqual: a.noteCount === b.noteCount,
    beatCountA: a.beatPositions.length,
    beatCountB: b.beatPositions.length,
    maxBeatDiff: Number(maxBeatDiff.toFixed(9)),
    durationA: a.exportDuration,
    durationB: b.exportDuration,
    durationEqual: a.exportDuration === b.exportDuration,
  };
}
