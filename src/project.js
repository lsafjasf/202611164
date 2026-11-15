export const STEPS_PER_BAR = 16;
export const BEATS_PER_BAR = 4;
export const BEATS_PER_STEP = BEATS_PER_BAR / STEPS_PER_BAR;
export const EXPORT_TAIL_SECONDS = 0.7;

export const TRACK_DEFS = [
  {
    id: "kick",
    name: "KICK",
    short: "K",
    color: "#ff6a3d",
    midi: 36,
    note: "C2",
    defaultParams: { gain: 0.92, tune: 0, decay: 0.44, tone: 0.72 },
  },
  {
    id: "snare",
    name: "SNARE",
    short: "S",
    color: "#ffce5c",
    midi: 38,
    note: "D2",
    defaultParams: { gain: 0.74, tune: 0, decay: 0.26, tone: 0.55 },
  },
  {
    id: "hat",
    name: "HI-HAT",
    short: "H",
    color: "#6ee7bf",
    midi: 42,
    note: "F#2",
    defaultParams: { gain: 0.48, tune: 0, decay: 0.09, tone: 0.84 },
  },
  {
    id: "perc",
    name: "PERC",
    short: "P",
    color: "#8da8ff",
    midi: 55,
    note: "G3",
    defaultParams: { gain: 0.58, tune: 0, decay: 0.2, tone: 0.4 },
  },
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function makeStep(active = false, velocity = 100, probability = 100, pan = 0) {
  return {
    on: Boolean(active),
    velocity: clamp(Math.round(velocity), 1, 127),
    probability: clamp(Math.round(probability), 0, 100),
    pan: clamp(Math.round(pan), -100, 100),
  };
}

function makeEmptySteps() {
  return Array.from({ length: STEPS_PER_BAR }, () => makeStep());
}

function activeAt(indices, values = {}) {
  const steps = makeEmptySteps();
  for (const index of indices) {
    steps[index] = makeStep(
      true,
      values[index]?.velocity ?? values.velocity ?? 104,
      values[index]?.probability ?? values.probability ?? 100,
      values[index]?.pan ?? values.pan ?? 0,
    );
  }
  return steps;
}

export function createDemoProject() {
  const kick = activeAt([0, 3, 4, 7, 10, 12, 14], {
    0: { velocity: 123, pan: 0 },
    3: { velocity: 74, probability: 64, pan: -12 },
    4: { velocity: 110 },
    7: { velocity: 78, probability: 72, pan: 10 },
    10: { velocity: 118, pan: 4 },
    12: { velocity: 108 },
    14: { velocity: 88, probability: 82, pan: -6 },
  });
  const snare = activeAt([4, 7, 12, 15], {
    4: { velocity: 120, pan: -4 },
    7: { velocity: 58, probability: 68, pan: 14 },
    12: { velocity: 116, pan: 4 },
    15: { velocity: 66, probability: 76, pan: -10 },
  });
  const hat = activeAt(
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    {
      probability: 88,
      pan: 18,
      0: { velocity: 72, probability: 100, pan: -22 },
      2: { velocity: 48, probability: 74, pan: 22 },
      3: { velocity: 66, probability: 92, pan: -8 },
      4: { velocity: 78, probability: 100, pan: 12 },
      6: { velocity: 42, probability: 78, pan: 24 },
      7: { velocity: 62, probability: 90, pan: -14 },
      8: { velocity: 68, probability: 100, pan: -22 },
      10: { velocity: 46, probability: 70, pan: 20 },
      11: { velocity: 60, probability: 94, pan: 2 },
      12: { velocity: 76, probability: 100, pan: 12 },
      13: { velocity: 54, probability: 82, pan: -18 },
      14: { velocity: 44, probability: 68, pan: 24 },
      15: { velocity: 64, probability: 90, pan: -6 },
    },
  );
  const perc = activeAt([2, 6, 9, 11, 14], {
    2: { velocity: 86, probability: 88, pan: -34 },
    6: { velocity: 72, probability: 92, pan: 30 },
    9: { velocity: 92, probability: 84, pan: -20 },
    11: { velocity: 66, probability: 76, pan: 36 },
    14: { velocity: 80, probability: 90, pan: -28 },
  });

  return {
    format: "polygrid-project",
    version: 1,
    name: "NEON BREAK",
    bpm: 112,
    loop: true,
    transpose: 0,
    masterGain: 0.82,
    seed: 778,
    exportBars: 1,
    tracks: TRACK_DEFS.map((def, index) => ({
      id: def.id,
      name: def.name,
      color: def.color,
      ...def.defaultParams,
      steps: [kick, snare, hat, perc][index].map((step) => ({ ...step })),
    })),
  };
}

export function createEmptyProject() {
  const project = createDemoProject();
  for (const track of project.tracks) {
    track.steps = makeEmptySteps();
  }
  return project;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStep(raw, fallback = makeStep()) {
  if (!raw || typeof raw !== "object") {
    return { ...fallback };
  }
  return {
    on: raw.on === undefined ? Boolean(fallback.on) : Boolean(raw.on),
    velocity: clamp(Math.round(finiteOr(raw.velocity, fallback.velocity)), 1, 127),
    probability: clamp(Math.round(finiteOr(raw.probability, fallback.probability)), 0, 100),
    pan: clamp(Math.round(finiteOr(raw.pan, fallback.pan)), -100, 100),
  };
}

export function normalizeProject(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("工程 JSON 无效");
  }
  const source = raw.project && typeof raw.project === "object" ? raw.project : raw;
  const defaults = createDemoProject();
  const sourceTracks = Array.isArray(source.tracks) ? source.tracks : [];
  const tracks = TRACK_DEFS.map((def, index) => {
    const rawTrack =
      sourceTracks.find((candidate) => candidate?.id === def.id) ??
      sourceTracks[index] ??
      {};
    const fallbackTrack = defaults.tracks[index];
    const rawSteps = Array.isArray(rawTrack.steps) ? rawTrack.steps : [];
    return {
      id: def.id,
      name: def.name,
      color: def.color,
      gain: clamp(finiteOr(rawTrack.gain, fallbackTrack.gain), 0, 1.5),
      tune: clamp(Math.round(finiteOr(rawTrack.tune, fallbackTrack.tune)), -12, 12),
      decay: clamp(finiteOr(rawTrack.decay, fallbackTrack.decay), 0.05, 1.2),
      tone: clamp(finiteOr(rawTrack.tone, fallbackTrack.tone), 0, 1),
      steps: Array.from({ length: STEPS_PER_BAR }, (_, stepIndex) =>
        normalizeStep(rawSteps[stepIndex], fallbackTrack.steps[stepIndex]),
      ),
    };
  });

  return {
    format: "polygrid-project",
    version: 1,
    name: String(source.name || defaults.name).slice(0, 40),
    bpm: clamp(Math.round(finiteOr(source.bpm, defaults.bpm)), 60, 180),
    loop: source.loop === undefined ? true : Boolean(source.loop),
    transpose: clamp(Math.round(finiteOr(source.transpose, defaults.transpose)), -12, 12),
    masterGain: clamp(finiteOr(source.masterGain, defaults.masterGain), 0, 1.2),
    seed: Math.abs(Math.round(finiteOr(source.seed, defaults.seed))) >>> 0,
    exportBars: clamp(Math.round(finiteOr(source.exportBars, 1)), 1, 8),
    tracks,
  };
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function serializeProject(project) {
  return JSON.stringify(normalizeProject(project), null, 2);
}

export function deserializeProject(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("无法解析 JSON 文件");
  }
  return normalizeProject(parsed);
}

export function serializeRhythm(project, start = 0, count = STEPS_PER_BAR) {
  const normalized = normalizeProject(project);
  const from = clamp(Math.round(start), 0, STEPS_PER_BAR - 1);
  const length = clamp(Math.round(count), 1, STEPS_PER_BAR - from);
  return JSON.stringify(
    {
      format: "polygrid-rhythm",
      version: 1,
      name: normalized.name,
      bpm: normalized.bpm,
      start: from,
      length,
      tracks: normalized.tracks.map((track) => ({
        id: track.id,
        steps: track.steps
          .slice(from, from + length)
          .map((step) => ({ ...step })),
      })),
    },
    null,
    2,
  );
}

export function applyRhythmJson(project, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("剪贴板中没有合法 JSON");
  }
  if (parsed.format === "polygrid-project") {
    return normalizeProject(parsed);
  }
  if (parsed?.format !== "polygrid-rhythm" || !Array.isArray(parsed.tracks)) {
    throw new Error("不是 POLYGRID 节奏片段");
  }
  const next = cloneProject(project);
  const from = clamp(Math.round(finiteOr(parsed.start, 0)), 0, STEPS_PER_BAR - 1);
  const length = clamp(Math.round(finiteOr(parsed.length, STEPS_PER_BAR - from)), 1, STEPS_PER_BAR - from);
  next.tracks.forEach((track, index) => {
    const sourceTrack =
      parsed.tracks.find((candidate) => candidate?.id === track.id) ?? parsed.tracks[index];
    if (!sourceTrack || !Array.isArray(sourceTrack.steps)) {
      return;
    }
    for (let offset = 0; offset < length; offset += 1) {
      track.steps[from + offset] = normalizeStep(
        sourceTrack.steps[offset],
        makeStep(),
      );
    }
  });
  return next;
}

export function seededUnit(seed, absoluteStep, trackIndex) {
  let value =
    (seed ^
      Math.imul((absoluteStep + 1) | 0, 0x9e3779b1) ^
      Math.imul((trackIndex + 1) | 0, 0x85ebca6b)) >>>
    0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

export function shouldTrigger(project, step, trackIndex, absoluteStep) {
  if (!step.on || step.probability <= 0) {
    return false;
  }
  if (step.probability >= 100) {
    return true;
  }
  return seededUnit(project.seed, absoluteStep, trackIndex) * 100 < step.probability;
}

export function noteNameFromMidi(midi) {
  const rounded = Math.round(midi);
  const index = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[index]}${octave}`;
}

export function trackMidi(project, trackIndex) {
  return TRACK_DEFS[trackIndex].midi + project.tracks[trackIndex].tune + project.transpose;
}

export function buildNotePlan(project, bars = 1) {
  const normalized = normalizeProject(project);
  const totalSteps = Math.max(1, Math.round(bars)) * STEPS_PER_BAR;
  const notes = [];
  for (let absoluteStep = 0; absoluteStep < totalSteps; absoluteStep += 1) {
    const patternStep = absoluteStep % STEPS_PER_BAR;
    normalized.tracks.forEach((track, trackIndex) => {
      const step = track.steps[patternStep];
      if (!shouldTrigger(normalized, step, trackIndex, absoluteStep)) {
        return;
      }
      notes.push({
        trackIndex,
        trackId: track.id,
        step: patternStep,
        absoluteStep,
        beat: absoluteStep * BEATS_PER_STEP,
        velocity: step.velocity,
        probability: step.probability,
        pan: step.pan,
        midi: trackMidi(normalized, trackIndex),
      });
    });
  }
  return notes.sort((a, b) => a.beat - b.beat || a.trackIndex - b.trackIndex);
}

export function exportDurationSeconds(project) {
  const normalized = normalizeProject(project);
  const bars = normalized.exportBars;
  const longestDecay = Math.max(...normalized.tracks.map((track) => track.decay), 0);
  return (
    (bars * BEATS_PER_BAR * 60) / normalized.bpm +
    Math.max(EXPORT_TAIL_SECONDS, longestDecay + 0.12)
  );
}

export function beatPositionLabel(beat) {
  const safeBeat = Math.max(0, Number(beat) || 0);
  const bar = Math.floor(safeBeat / BEATS_PER_BAR) + 1;
  const inBar = safeBeat % BEATS_PER_BAR;
  const quarter = Math.floor(inBar) + 1;
  const sixteenth = Math.floor((inBar % 1) / BEATS_PER_STEP) + 1;
  return `${String(bar).padStart(2, "0")}.${quarter}.${String(sixteenth).padStart(2, "0")}`;
}
