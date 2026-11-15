export const BPM = 120;
export const BEATS_PER_BAR = 4;
export const TOTAL_BARS = 30;
export const CHART_BEATS = TOTAL_BARS * BEATS_PER_BAR;
export const SECONDS_PER_BEAT = 60 / BPM;
export const CHART_DURATION = CHART_BEATS * SECONDS_PER_BEAT;
export const SAMPLE_RATE = 48000;

export const LANES = [
  {
    id: "kick",
    key: "a",
    code: "KeyA",
    index: 0,
    name: "底鼓",
    instrument: "KICK",
    color: "#53e6d2",
    frequency: 58,
    pitch: 0,
    gain: 0.9
  },
  {
    id: "snare",
    key: "s",
    code: "KeyS",
    index: 1,
    name: "军鼓",
    instrument: "SNARE",
    color: "#ff5c9d",
    frequency: 185,
    pitch: 0,
    gain: 0.72
  },
  {
    id: "hat",
    key: "d",
    code: "KeyD",
    index: 2,
    name: "踩镲",
    instrument: "HAT",
    color: "#a88cff",
    frequency: 8200,
    pitch: 0,
    gain: 0.42
  },
  {
    id: "stab",
    key: "f",
    code: "KeyF",
    index: 3,
    name: "和声",
    instrument: "STAB",
    color: "#ffca67",
    frequency: 220,
    pitch: 0,
    gain: 0.56
  }
];

export const DIFFICULTIES = {
  easy: {
    id: "easy",
    label: "EASY",
    name: "轻松",
    windows: { perfect: 0.085, great: 0.145, good: 0.21 },
    score: { perfect: 1000, great: 700, good: 350 },
    travelSeconds: 2.35
  },
  normal: {
    id: "normal",
    label: "NORMAL",
    name: "标准",
    windows: { perfect: 0.055, great: 0.105, good: 0.16 },
    score: { perfect: 1000, great: 700, good: 350 },
    travelSeconds: 1.85
  },
  hard: {
    id: "hard",
    label: "HARD",
    name: "困难",
    windows: { perfect: 0.032, great: 0.065, good: 0.11 },
    score: { perfect: 1000, great: 700, good: 350 },
    travelSeconds: 1.5
  }
};

export const STORAGE_KEY = "pulse-grid-project-v1";
export const DEFAULT_PROJECT_NAME = "PULSE GRID / NEON CIRCUIT";
