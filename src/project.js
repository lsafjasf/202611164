export const PROJECT_LENGTH = 20;
export const STORAGE_KEY = "four-layer-soundscape:project:v1";
export const PROJECT_VERSION = 1;

export const TRACK_COLORS = {
  rain: "#63d9ff",
  wind: "#8ee3bd",
  machine: "#ffb85c",
  footsteps: "#ff7eaa"
};

export const DEFAULT_AUTOMATION = {
  rain: [
    { time: 0, value: 0.28 },
    { time: 3.2, value: 0.82 },
    { time: 10.4, value: 0.68 },
    { time: 16.8, value: 1 },
    { time: 20, value: 0.24 }
  ],
  wind: [
    { time: 0, value: 0.2 },
    { time: 4.8, value: 0.96 },
    { time: 11.6, value: 0.52 },
    { time: 16.2, value: 0.88 },
    { time: 18.5, value: 0.18 }
  ],
  machine: [
    { time: 0, value: 0.16 },
    { time: 2.1, value: 0.92 },
    { time: 7.4, value: 0.7 },
    { time: 10.2, value: 1 },
    { time: 14, value: 0.22 }
  ],
  footsteps: [
    { time: 0, value: 0.1 },
    { time: 1.5, value: 0.55 },
    { time: 4.5, value: 0.92 },
    { time: 8.8, value: 0.7 },
    { time: 11.5, value: 0.3 }
  ]
};

const DEMO_TRACKS = [
  {
    id: "rain",
    type: "rain",
    name: "雨",
    start: 0,
    duration: 20,
    gain: 0.58,
    pan: -0.28,
    pitch: 0,
    fadeIn: 2.2,
    fadeOut: 3.6,
    pattern: 0,
    muted: false,
    solo: false
  },
  {
    id: "wind",
    type: "wind",
    name: "风",
    start: 1.4,
    duration: 18.6,
    gain: 0.56,
    pan: 0.24,
    pitch: -2,
    fadeIn: 3.4,
    fadeOut: 3.2,
    pattern: 0,
    muted: false,
    solo: false
  },
  {
    id: "machine",
    type: "machine",
    name: "机器",
    start: 4.2,
    duration: 14,
    gain: 0.42,
    pan: -0.1,
    pitch: -5,
    fadeIn: 2.6,
    fadeOut: 2.4,
    pattern: 1,
    muted: false,
    solo: false
  },
  {
    id: "footsteps",
    type: "footsteps",
    name: "脚步",
    start: 7.4,
    duration: 11.8,
    gain: 0.5,
    pan: 0.12,
    pitch: 2,
    fadeIn: 1.7,
    fadeOut: 2.8,
    pattern: 0,
    muted: false,
    solo: false
  }
];

function cloneAutomation(type, duration) {
  return DEFAULT_AUTOMATION[type]
    .filter((point) => point.time <= duration)
    .map((point) => ({ ...point, time: Math.min(point.time, duration) }));
}

export function createDemoProject() {
  const tracks = DEMO_TRACKS.map((track, index) => normalizeTrack({
    ...track,
    color: TRACK_COLORS[track.type],
    automation: cloneAutomation(track.type, track.duration)
  }, index));
  return {
    version: PROJECT_VERSION,
    name: "雨巷 · 四层声景",
    length: PROJECT_LENGTH,
    bpm: 120,
    speed: 1,
    loop: true,
    masterGain: 0.78,
    tracks,
    revision: 0
  };
}

function finite(value, fallback, min = -Infinity, max = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function rounded(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function normalizeAutomation(points, duration) {
  const safe = Array.isArray(points) ? points : [];
  const cleaned = safe
    .map((point) => ({
      time: rounded(finite(point?.time, 0, 0, duration)),
      value: rounded(finite(point?.value, 1, 0, 1.5))
    }))
    .sort((a, b) => a.time - b.time);
  if (!cleaned.length) return [{ time: 0, value: 1 }, { time: duration, value: 1 }];
  if (cleaned[0].time > 0) cleaned.unshift({ time: 0, value: cleaned[0].value });
  if (cleaned.at(-1).time < duration) cleaned.push({ time: duration, value: cleaned.at(-1).value });
  return cleaned;
}

export function normalizeTrack(track, index) {
  const type = Object.hasOwn(TRACK_COLORS, track?.type) ? track.type : "rain";
  const duration = rounded(finite(track?.duration, 8, 0.25, PROJECT_LENGTH));
  const start = rounded(finite(track?.start, 0, 0, PROJECT_LENGTH - duration));
  return {
    id: String(track?.id || `${type}-${index}`),
    type,
    name: String(track?.name || type),
    color: TRACK_COLORS[type],
    start,
    duration,
    gain: rounded(finite(track?.gain, 0.5, 0, 1.5)),
    pan: rounded(finite(track?.pan, 0, -1, 1)),
    pitch: finite(track?.pitch, 0, -12, 12),
    fadeIn: rounded(finite(track?.fadeIn, 1, 0, duration)),
    fadeOut: rounded(finite(track?.fadeOut, 1, 0, duration)),
    pattern: Math.round(finite(track?.pattern, 0, 0, 3)),
    muted: Boolean(track?.muted),
    solo: Boolean(track?.solo),
    automation: normalizeAutomation(track?.automation, duration)
  };
}

export function normalizeProject(project) {
  const source = project && typeof project === "object" ? project : createDemoProject();
  const tracks = (Array.isArray(source.tracks) ? source.tracks : []).map(normalizeTrack);
  return {
    version: PROJECT_VERSION,
    name: String(source.name || "未命名声景"),
    length: PROJECT_LENGTH,
    bpm: Math.round(finite(source.bpm, 120, 50, 220)),
    speed: finite(source.speed, 1, 0.5, 1.5),
    loop: source.loop !== false,
    masterGain: finite(source.masterGain, 0.78, 0, 1),
    tracks: tracks.length ? tracks : createDemoProject().tracks,
    revision: Math.round(finite(source.revision, 0, 0, Number.MAX_SAFE_INTEGER))
  };
}

export function serializeProject(project) {
  return JSON.stringify(normalizeProject(project), null, 2);
}

export function deserializeProject(text) {
  if (!text) throw new Error("工程内容为空");
  return normalizeProject(JSON.parse(text));
}

export function saveProject(project, storage = globalThis.localStorage) {
  const json = serializeProject(project);
  storage?.setItem(STORAGE_KEY, json);
  return json;
}

export function loadProject(storage = globalThis.localStorage) {
  try {
    return deserializeProject(storage?.getItem(STORAGE_KEY));
  } catch {
    return createDemoProject();
  }
}

export function automationAt(track, localTime) {
  const points = track.automation;
  if (!points.length) return 1;
  const time = Math.min(track.duration, Math.max(0, localTime));
  let right = points.findIndex((point) => point.time >= time);
  if (right <= 0) return points[Math.max(0, right)]?.value ?? points[0].value;
  const left = points[right - 1];
  const rightPoint = points[right];
  const span = rightPoint.time - left.time;
  const mix = span <= 1e-8 ? 1 : (time - left.time) / span;
  return left.value + (rightPoint.value - left.value) * mix;
}

export function trackEnvelopeAt(track, absoluteTime) {
  const local = absoluteTime - track.start;
  if (local < 0 || local > track.duration) return 0;
  const fadeIn = track.fadeIn <= 1e-6 ? 1 : Math.min(1, local / track.fadeIn);
  const fadeOut = track.fadeOut <= 1e-6 ? 1 : Math.min(1, (track.duration - local) / track.fadeOut);
  return Math.max(0, Math.min(fadeIn, fadeOut)) * automationAt(track, local);
}

export function trackAudibility(project, track) {
  const anySolo = project.tracks.some((candidate) => candidate.solo);
  if (track.muted) return 0;
  if (anySolo && !track.solo) return 0;
  return track.gain;
}

export function updateTrack(project, id, patch) {
  const tracks = project.tracks.map((track) => {
    if (track.id !== id) return track;
    const next = { ...track, ...patch };
    if (patch.duration !== undefined) {
      next.start = Math.min(track.start, PROJECT_LENGTH - next.duration);
    }
    if (patch.start !== undefined) {
      next.start = Math.max(0, Math.min(PROJECT_LENGTH - next.duration, patch.start));
    }
    return normalizeTrack(next, 0);
  });
  return { ...project, tracks, revision: project.revision + 1 };
}

export function addAutomationPoint(project, id, localTime, value) {
  const track = project.tracks.find((candidate) => candidate.id === id);
  if (!track) return project;
  const points = [...track.automation, { time: localTime, value }];
  return updateTrack(project, id, { automation: points });
}
