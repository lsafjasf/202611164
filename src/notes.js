import { trackAudibility, trackEnvelopeAt } from "./project.js";
import { secondsPerBeat } from "./transport.js";

const PATTERNS = {
  rain: [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0],
  wind: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  machine: [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0],
  footsteps: [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]
};

const SCALES = {
  rain: [24, 27, 31, 34, 36, 39, 43],
  wind: [-12, -10, -7, -5, 0, 2, 5],
  machine: [-24, -19, -17, -12, -10, -7, -5],
  footsteps: [-17, -12, -10, -5, -3, 0, 2]
};

const NOTE_LENGTH = {
  rain: 0.24,
  wind: 4.6,
  machine: 0.19,
  footsteps: 0.34
};

function hash32(value) {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function randomFor(track, step) {
  const typeSalt = [...track.type].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return hash32((step + 1) * 2654435761 + track.pattern * 97531 + typeSalt) / 4294967296;
}

function shouldTrigger(track, step) {
  if (track.type === "footsteps" && track.pattern > 0) {
    return step % (3 + track.pattern) === 0 || step % 16 === 11;
  }
  if (track.type === "machine" && track.pattern === 2) {
    return step % 4 === 0 || step % 8 === 3;
  }
  if (track.type === "wind") return PATTERNS.wind[step % 16] === 1;
  return PATTERNS[track.type][step % 16] === 1 && randomFor(track, step) > 0.08;
}

function pitchFor(track, step) {
  const scale = SCALES[track.type];
  const random = randomFor(track, step + 97);
  const octave = track.type === "wind" ? 0 : random > 0.84 ? 12 : 0;
  return scale[Math.floor(random * scale.length) % scale.length] + octave;
}

function durationFor(track, step, beatSeconds) {
  const base = NOTE_LENGTH[track.type];
  const variation = track.type === "wind" ? 1 + randomFor(track, step + 211) * 0.8 : 1;
  return Math.max(0.05, base * beatSeconds * variation);
}

export function collectNotes(project, { audibleOnly = false } = {}) {
  const beatSeconds = secondsPerBeat(project.bpm);
  const notes = [];
  const soloActive = project.tracks.some((track) => track.solo);

  for (const track of project.tracks) {
    if (audibleOnly && (track.muted || (soloActive && !track.solo))) continue;
    const totalSteps = Math.ceil(track.duration / (beatSeconds / 4));
    for (let step = 0; step < totalSteps; step += 1) {
      if (!shouldTrigger(track, step)) continue;
      const localBeats = step / 4;
      const localTime = localBeats * beatSeconds;
      if (localTime >= track.duration - 1e-7) continue;
      const time = track.start + localTime;
      if (time >= project.length - 1e-7) continue;
      const duration = Math.min(
        durationFor(track, step, beatSeconds),
        track.duration - localTime,
        project.length - time
      );
      notes.push({
        id: `${track.id}-${step}`,
        trackId: track.id,
        type: track.type,
        step,
        time,
        duration,
        beat: time / beatSeconds,
        localBeat: localBeats,
        pitch: pitchFor(track, step),
        velocity: 0.52 + randomFor(track, step + 503) * 0.48
      });
    }
  }
  return notes.sort((a, b) => a.time - b.time || a.trackId.localeCompare(b.trackId));
}

export function noteStats(project) {
  const notes = collectNotes(project);
  const positions = notes.map((note) => `${note.trackId}@${note.beat.toFixed(6)}`);
  let signature = 2166136261;
  for (const position of positions) {
    for (let index = 0; index < position.length; index += 1) {
      signature ^= position.charCodeAt(index);
      signature = Math.imul(signature, 16777619);
    }
  }
  return {
    count: notes.length,
    positions,
    beatPositions: notes.map((note) => Number(note.beat.toFixed(6))),
    signature: (signature >>> 0).toString(16).padStart(8, "0"),
    firstBeats: positions.slice(0, 12)
  };
}

export function compareProjects(before, after) {
  const statsBefore = noteStats(before);
  const statsAfter = noteStats(after);
  const trackState = (project) =>
    project.tracks.map((track) => [
      track.id,
      track.start.toFixed(6),
      track.duration.toFixed(6),
      track.gain.toFixed(6),
      track.pan.toFixed(6),
      track.pitch.toFixed(6)
    ].join(":"));
  return {
    before: statsBefore,
    after: statsAfter,
    noteCountMatches: statsBefore.count === statsAfter.count,
    beatSignatureMatches: statsBefore.signature === statsAfter.signature,
    trackPositionsMatch: trackState(before).join("|") === trackState(after).join("|")
  };
}

export function visibleNotes(project, track) {
  return collectNotes(project).filter((note) => note.trackId === track.id);
}

export function trackWaveform(track, project, columns = 240) {
  const notes = visibleNotes(project, track);
  const beatSeconds = secondsPerBeat(project.bpm);
  const samples = new Float32Array(columns);
  for (let column = 0; column < columns; column += 1) {
    const local = (column / Math.max(1, columns - 1)) * track.duration;
    const absolute = track.start + local;
    const automation = trackEnvelopeAt(track, absolute);
    let energy = 0;
    for (const note of notes) {
      const relative = local - (note.time - track.start);
      if (relative < -0.03 || relative > note.duration * 1.2) continue;
      const phase = Math.max(0, relative) / Math.max(0.04, note.duration);
      const pulse = Math.sin(Math.PI * Math.min(1, phase)) ** (track.type === "wind" ? 0.6 : 1.7);
      energy += pulse * note.velocity / (track.type === "wind" ? 2.4 : 1);
    }
    const texture = 0.12 + 0.1 * Math.sin(column * 0.43 + track.start * 3.7);
    samples[column] = Math.min(1, texture + energy * 0.74 * Math.max(0.08, automation));
  }
  return samples;
}

export function audibleLevelAt(project, track, time) {
  if (trackAudibility(project, track) <= 0) return 0;
  const envelope = trackEnvelopeAt(track, time);
  if (envelope <= 0) return 0;
  const local = time - track.start;
  const beat = local / secondsPerBeat(project.bpm);
  const step = Math.round(beat * 4);
  const phase = Math.abs(beat * 4 - step);
  const click = phase < 0.18 ? 1 - phase / 0.18 : 0;
  return Math.min(1, envelope * track.gain * (0.14 + click * 0.8));
}
