import {
  BEATS_PER_BAR,
  BPM,
  CHART_BEATS,
  CHART_DURATION,
  LANES,
  SECONDS_PER_BEAT,
  TOTAL_BARS
} from "./config.js";

const BAR_PATTERNS = [
  [0, 1.5, 2.5, 3],
  [0, 1, 2, 3],
  [0, 0.5, 1.5, 2, 3],
  [0, 1, 2.5, 3]
];

const LANE_ORDER = [0, 2, 1, 3, 0, 1, 3, 2, 0, 3, 1, 2];

function laneAt(step, bar) {
  return (LANE_ORDER[step % LANE_ORDER.length] + bar * 3) % 4;
}

export function buildChart(difficulty = "normal") {
  const notes = [];
  let id = 0;

  for (let bar = 1; bar < TOTAL_BARS - 1; bar += 1) {
    const barStart = bar * BEATS_PER_BAR;
    const pattern = BAR_PATTERNS[(bar - 1) % BAR_PATTERNS.length];
    let step = bar * 2;

    for (const offset of pattern) {
      const beat = barStart + offset;
      notes.push({
        id: id++,
        beat,
        lane: laneAt(step++, bar),
        velocity: offset % 1 === 0 ? 1 : 0.76
      });
    }

    if (bar % 4 === 0) {
      const chordBeat = barStart + 2;
      const chordLane = (laneAt(step, bar) + 2) % 4;
      if (!notes.some((note) => note.beat === chordBeat && note.lane === chordLane)) {
        notes.push({
          id: id++,
          beat: chordBeat,
          lane: chordLane,
          velocity: 0.82
        });
      }
    }
  }

  notes.sort((a, b) => a.beat - b.beat || a.lane - b.lane);
  notes.forEach((note, index) => {
    note.id = index;
    note.laneId = LANES[note.lane].id;
    note.time = note.beat * SECONDS_PER_BEAT;
  });

  return {
    difficulty,
    bpm: BPM,
    beats: CHART_BEATS,
    duration: CHART_DURATION,
    secondsPerBeat: SECONDS_PER_BEAT,
    notes
  };
}

export function beatSignature(chart) {
  let hash = 2166136261;
  for (const note of chart.notes) {
    const token = `${note.beat.toFixed(4)}:${note.lane}|`;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function chartSignature(chart) {
  return `${chart.notes.length}:${chart.beats}:${beatSignature(chart)}`;
}

export function beatsToSeconds(beat) {
  return beat * SECONDS_PER_BEAT;
}

export function secondsToBeats(seconds) {
  return seconds / SECONDS_PER_BEAT;
}

export function validateChart(chart) {
  const valid = Array.isArray(chart.notes)
    && chart.notes.length > 0
    && chart.notes.every((note) => (
      Number.isFinite(note.beat)
      && note.beat >= 0
      && note.beat < chart.beats
      && Number.isInteger(note.lane)
      && note.lane >= 0
      && note.lane < 4
    ));
  return { valid, errors: valid ? [] : ["谱面数据无效"] };
}
