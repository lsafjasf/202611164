import { BPM, CHART_BEATS, CHART_DURATION, LANES } from "./config.js";
import { buildChart, chartSignature, validateChart } from "./chart.js";

export function defaultLaneSettings() {
  return LANES.map((lane) => ({
    id: lane.id,
    pitch: lane.pitch,
    gain: lane.gain
  }));
}

export function createProjectState(overrides = {}) {
  return {
    version: 1,
    name: "NEON CIRCUIT",
    difficulty: "normal",
    bpm: BPM,
    speed: 1,
    loop: true,
    metronome: false,
    transpose: 0,
    latencyMs: 0,
    lanes: defaultLaneSettings(),
    ...overrides
  };
}

export function normalizeProject(candidate) {
  const base = createProjectState();
  if (!candidate || typeof candidate !== "object") return base;

  const difficulty = ["easy", "normal", "hard"].includes(candidate.difficulty)
    ? candidate.difficulty
    : base.difficulty;

  const lanes = base.lanes.map((lane) => {
    const incoming = Array.isArray(candidate.lanes)
      ? candidate.lanes.find((item) => item && item.id === lane.id)
      : null;
    return {
      id: lane.id,
      pitch: clampNumber(incoming?.pitch, lane.pitch, -12, 12),
      gain: clampNumber(incoming?.gain, lane.gain, 0, 1)
    };
  });

  return {
    ...base,
    name: typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.slice(0, 80)
      : base.name,
    difficulty,
    speed: clampNumber(candidate.speed, base.speed, 0.7, 1.6),
    loop: Boolean(candidate.loop),
    metronome: Boolean(candidate.metronome),
    transpose: Math.round(clampNumber(candidate.transpose, 0, -12, 12)),
    latencyMs: Math.round(clampNumber(candidate.latencyMs, 0, -200, 200)),
    lanes
  };
}

export function createSerializableProject(project, extra = {}) {
  const chart = buildChart(project.difficulty);
  return {
    ...project,
    bpm: BPM,
    duration: CHART_DURATION,
    chartBeats: CHART_BEATS,
    noteCount: chart.notes.length,
    chartSignature: chartSignature(chart),
    savedAt: new Date().toISOString(),
    ...extra
  };
}

export function validateProject(candidate) {
  const project = normalizeProject(candidate);
  const chart = buildChart(project.difficulty);
  const result = validateChart(chart);
  return {
    project,
    chart,
    valid: result.valid,
    errors: result.errors
  };
}

export function saveProjectToStorage(project) {
  const payload = createSerializableProject(project);
  localStorage.setItem("pulse-grid-project-v1", JSON.stringify(payload));
  return payload;
}

export function loadProjectFromStorage() {
  const raw = localStorage.getItem("pulse-grid-project-v1");
  if (!raw) return null;
  try {
    return validateProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
