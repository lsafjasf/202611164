// Pure sequencing / timing core. Shared by the browser app and the Node
// verification script. No Web Audio or DOM dependencies in this module.

export const STEPS_PER_BAR = 16; // 16th notes
export const TRACK_COUNT = 4;

export function createDefaultProject() {
  const empty = () => Array.from({ length: STEPS_PER_BAR * 2 }, () => null);
  const tracks = [
    { name: 'Kick', type: 'kick', volume: 0.9, pan: 0, delaySend: 0, bypass: false, transpose: 0, pattern: empty() },
    { name: 'Hat', type: 'hat', volume: 0.5, pan: 0.25, delaySend: 0.1, bypass: false, transpose: 0, pattern: empty() },
    { name: 'Bass', type: 'bass', volume: 0.7, pan: -0.15, delaySend: 0.05, bypass: false, transpose: 0, pattern: empty() },
    { name: 'Lead', type: 'lead', volume: 0.6, pan: 0.1, delaySend: 0.35, bypass: false, transpose: 0, pattern: empty() },
  ];
  // Kick: four on the floor, both bars.
  for (const s of [0, 4, 8, 12, 16, 20, 24, 28]) tracks[0].pattern[s] = { n: 36, v: 1 };
  // Hat: offbeats + 16th run at the end of bar 2.
  for (const s of [2, 6, 10, 14, 18, 22, 26, 28, 29, 30, 31]) tracks[1].pattern[s] = { n: 42, v: s >= 28 ? 0.7 : 0.9 };
  // Bass: simple minor riff (A1 root area).
  const bassLine = { 0: 33, 3: 33, 6: 36, 8: 33, 11: 31, 14: 36, 16: 33, 19: 33, 22: 38, 24: 36, 27: 31, 30: 29 };
  for (const [s, n] of Object.entries(bassLine)) tracks[2].pattern[s] = { n: Number(n), v: 0.85 };
  // Lead: sparse melody on top.
  const leadLine = { 0: 69, 2: 72, 4: 76, 6: 72, 8: 74, 12: 69, 16: 69, 18: 72, 20: 77, 22: 76, 24: 74, 26: 72, 28: 71, 30: 72 };
  for (const [s, n] of Object.entries(leadLine)) tracks[3].pattern[s] = { n: Number(n), v: 0.8 };
  return {
    version: 1,
    tempo: 120,
    loopBars: 2,
    tracks,
    master: { gain: 0.8, compThreshold: -18, compRatio: 4, compEnabled: true },
  };
}

export function stepsPerLoop(project) {
  return STEPS_PER_BAR * project.loopBars;
}

// One 16th step = 1/4 beat.
export function stepToBeat(step) {
  return step / 4;
}

export function secondsPerBeat(tempo) {
  return 60 / tempo;
}

// Anchor-based timing: every absolute time is derived from a single anchor
// {time, beat} so pause/resume, tempo changes and looping never accumulate
// floating point or scheduling drift.
export function beatAtTime(anchor, tempo, time) {
  return anchor.beat + (time - anchor.time) / secondsPerBeat(tempo);
}

export function timeAtBeat(anchor, tempo, beat) {
  return anchor.time + (beat - anchor.beat) * secondsPerBeat(tempo);
}

export function loopDurationBeats(project) {
  return stepToBeat(stepsPerLoop(project));
}

export function loopDurationSeconds(project) {
  return loopDurationBeats(project) * secondsPerBeat(project.tempo);
}

// Flatten the pattern grid into a deterministic, sorted note list.
// Beat positions are computed from the step index only, never accumulated.
export function collectNotes(project) {
  const notes = [];
  const total = stepsPerLoop(project);
  project.tracks.forEach((track, ti) => {
    for (let step = 0; step < total; step++) {
      const cell = track.pattern[step];
      if (!cell) continue;
      notes.push({
        track: ti,
        step,
        beat: stepToBeat(step),
        midi: cell.n + (track.transpose || 0),
        vel: cell.v,
      });
    }
  });
  notes.sort((a, b) => a.step - b.step || a.track - b.track);
  return notes;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function serializeProject(project) {
  return JSON.stringify(project);
}

// Parse + validate + fill defaults so old or partial saves still load.
export function deserializeProject(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const base = createDefaultProject();
  const loopBars = clampNumber(data.loopBars, 1, 8, base.loopBars);
  const total = STEPS_PER_BAR * loopBars;
  return {
    version: 1,
    tempo: clampNumber(data.tempo, 40, 240, base.tempo),
    loopBars,
    master: { ...base.master, ...(data.master || {}) },
    tracks: base.tracks.map((fallback, i) => {
      const t = (data.tracks || [])[i] || {};
      const pattern = Array.from({ length: total }, (_, s) => {
        const cell = Array.isArray(t.pattern) ? t.pattern[s] : null;
        return cell && Number.isFinite(cell.n) ? { n: cell.n, v: clampNumber(cell.v, 0, 1, 1) } : null;
      });
      return {
        name: typeof t.name === 'string' ? t.name : fallback.name,
        type: fallback.type,
        volume: clampNumber(t.volume, 0, 1, fallback.volume),
        pan: clampNumber(t.pan, -1, 1, fallback.pan),
        delaySend: clampNumber(t.delaySend, 0, 1, fallback.delaySend),
        bypass: Boolean(t.bypass),
        transpose: clampNumber(t.transpose, -24, 24, 0),
        pattern,
      };
    }),
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
