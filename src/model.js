export const FORMAT = "SLICE04";
export const VERSION = 1;
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;
export const TOTAL_STEPS = 32;
export const TOTAL_BEATS = TOTAL_STEPS / STEPS_PER_BEAT;
export const EXPORT_SAMPLE_RATE = 48_000;

const STORE_KEY = "slice04.project.v1";

export const KEY_OPTIONS = ["1", "2", "3", "4", "Q", "W", "E", "R", "A", "S", "D", "F"];

export const TRACK_DEFS = [
  {
    id: "kick",
    index: 0,
    name: "KICK",
    detail: "SUB / BODY",
    color: "#f6b84c",
    key: "1",
    start: 0.035,
    end: 0.64,
    fadeIn: 0.004,
    fadeOut: 0.12,
    pitch: -1,
    gain: 0.9,
    steps: [0, 6, 8, 15, 16, 22, 24, 29],
  },
  {
    id: "snare",
    index: 1,
    name: "SNARE",
    detail: "NOISE / CRACK",
    color: "#ff6f86",
    key: "2",
    start: 0.025,
    end: 0.56,
    fadeIn: 0.002,
    fadeOut: 0.09,
    pitch: 2,
    gain: 0.67,
    steps: [4, 12, 20, 28],
  },
  {
    id: "hat",
    index: 2,
    name: "HAT",
    detail: "METAL / TICK",
    color: "#65e6dd",
    key: "3",
    start: 0.055,
    end: 0.34,
    fadeIn: 0.001,
    fadeOut: 0.05,
    pitch: 0,
    gain: 0.42,
    steps: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
  },
  {
    id: "tom",
    index: 3,
    name: "TOM",
    detail: "ROUND / LOW",
    color: "#b49aff",
    key: "4",
    start: 0.04,
    end: 0.72,
    fadeIn: 0.005,
    fadeOut: 0.16,
    pitch: -3,
    gain: 0.7,
    steps: [3, 10, 19, 26, 31],
  },
];

export const DEMO_PROJECT = freezeProject({
  format: FORMAT,
  version: VERSION,
  name: "NEON BREAK_01",
  bpm: 120,
  speed: 1,
  loop: true,
  loopStart: 0,
  loopEnd: TOTAL_BEATS,
  masterGain: 0.86,
  tracks: TRACK_DEFS.map(({ index, steps, ...track }) => ({
    ...track,
    muted: false,
    steps: Array.from({ length: TOTAL_STEPS }, (_, step) => steps.includes(step)),
  })),
});

function freezeProject(project) {
  return deepFreeze(structuredClone(project));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function buildDemoProject() {
  return structuredClone(DEMO_PROJECT);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function roundTo(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function sanitizeProject(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const sourceTracks = Array.isArray(source.tracks) ? source.tracks : [];
  const tracks = TRACK_DEFS.map((definition) => {
    const candidate =
      sourceTracks.find((track) => track?.id === definition.id) ??
      sourceTracks[definition.index] ??
      {};
    const start = clamp(Number(candidate.start), 0, 0.94);
    const end = clamp(Number(candidate.end), start + 0.02, 1);
    const sourceSteps = Array.isArray(candidate.steps) ? candidate.steps : [];
    return {
      id: definition.id,
      name: definition.name,
      detail: definition.detail,
      color: definition.color,
      key: KEY_OPTIONS.includes(candidate.key) ? candidate.key : definition.key,
      start: roundTo(start, 4),
      end: roundTo(end, 4),
      fadeIn: roundTo(clamp(Number(candidate.fadeIn), 0, 0.5), 4),
      fadeOut: roundTo(clamp(Number(candidate.fadeOut), 0, 0.5), 4),
      pitch: Math.round(clamp(Number(candidate.pitch), -24, 24)),
      gain: roundTo(clamp(Number(candidate.gain), 0, 1.5), 3),
      muted: Boolean(candidate.muted),
      steps: Array.from({ length: TOTAL_STEPS }, (_, step) =>
        step < sourceSteps.length
          ? Boolean(sourceSteps[step])
          : definition.steps.includes(step),
      ),
    };
  });

  const loopStart = roundTo(clamp(Number(source.loopStart), 0, TOTAL_BEATS - 0.25), 3);
  const rawLoopEnd = Number(source.loopEnd);
  const loopEnd = roundTo(
    clamp(Number.isFinite(rawLoopEnd) ? rawLoopEnd : TOTAL_BEATS, loopStart + 0.25, TOTAL_BEATS),
    3,
  );

  return {
    format: FORMAT,
    version: VERSION,
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name.trim().slice(0, 40)
        : "UNTITLED KIT",
    bpm: roundTo(clamp(Number(source.bpm), 60, 180), 1),
    speed: roundTo(clamp(Number(source.speed), 0.5, 2), 2),
    loop: source.loop !== false,
    loopStart,
    loopEnd,
    masterGain: roundTo(clamp(Number(source.masterGain), 0, 1.25), 3),
    tracks,
  };
}

export function serializeProject(project) {
  return JSON.stringify(sanitizeProject(project), null, 2);
}

export function parseProject(text) {
  const parsed = typeof text === "string" ? JSON.parse(text) : text;
  if (!parsed || parsed.format !== FORMAT) {
    throw new Error("不是有效的 SLICE04 工程文件");
  }
  return sanitizeProject(parsed);
}

export function saveProjectToStorage(project) {
  const projectText = serializeProject(project);
  localStorage.setItem(STORE_KEY, projectText);
  return projectText;
}

export function loadProjectFromStorage() {
  const stored = localStorage.getItem(STORE_KEY);
  return stored ? parseProject(stored) : null;
}

export function clearProjectStorage() {
  localStorage.removeItem(STORE_KEY);
}

export function noteEvents(project, startBeat = 0, endBeat = TOTAL_BEATS) {
  const events = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
    track.steps.forEach((active, step) => {
      const beat = step / STEPS_PER_BEAT;
      if (active && beat >= startBeat - 1e-9 && beat < endBeat - 1e-9) {
        events.push({ trackId: track.id, step, beat });
      }
    });
  }
  return events.sort((a, b) =>
    a.beat === b.beat ? a.trackId.localeCompare(b.trackId) : a.beat - b.beat,
  );
}

export function countNotes(project) {
  return project.tracks.reduce(
    (sum, track) => sum + (track.muted ? 0 : track.steps.filter(Boolean).length),
    0,
  );
}

export function beatPositions(project, range = getPlaybackRange(project)) {
  return noteEvents(project, range.start, range.end).map((event) => event.beat);
}

export function beatFingerprint(project, range = getPlaybackRange(project)) {
  const positions = [...new Set(beatPositions(project, range))];
  return positions.map((beat) => roundTo(beat, 6)).join("|");
}

export function getPlaybackRange(project) {
  return project.loop
    ? { start: project.loopStart, end: project.loopEnd }
    : { start: 0, end: TOTAL_BEATS };
}

export function secondsPerBeat(project) {
  return 60 / (project.bpm * project.speed);
}

export function getExportDuration(project) {
  const range = getPlaybackRange(project);
  return (range.end - range.start) * secondsPerBeat(project);
}

export function pitchRatio(semitones) {
  return 2 ** (Number(semitones) / 12);
}

export function wrapBeat(beat, start, end) {
  const length = end - start;
  if (length <= 0) return start;
  return start + ((((beat - start) % length) + length) % length);
}

export function transportBeatAt(anchorBeat, anchorTime, now, bps, range) {
  const elapsedBeats = Math.max(0, now - anchorTime) * bps;
  return wrapBeat(anchorBeat + elapsedBeats, range.start, range.end);
}

export function projectSummary(project) {
  const range = getPlaybackRange(project);
  return {
    notes: countNotes(project),
    beats: beatPositions(project, range).length,
    fingerprint: beatFingerprint(project, range),
    duration: getExportDuration(project),
    range: { ...range },
  };
}
