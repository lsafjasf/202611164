// Pure-JS offline renderer mirroring the browser signal chain:
// voice -> track gain -> pan -> [dry + feedback-delay send] -> compressor -> master gain.
// Used by the Node verification script and as a reference for the Web Audio graph.

import { collectNotes, loopDurationSeconds, midiToFreq, stepToBeat, secondsPerBeat } from './engine.js';

export const CLIP_THRESHOLD = 0.999;

// Render one loop of the project to interleaved-ready stereo Float32Arrays.
export function renderProject(project, sampleRate = 44100) {
  const duration = loopDurationSeconds(project);
  const frames = Math.round(duration * sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const spb = secondsPerBeat(project.tempo);
  const notes = collectNotes(project);

  for (const note of notes) {
    const track = project.tracks[note.track];
    if (track.bypass) continue; // bypassed tracks contribute nothing
    const startSec = stepToBeat(note.step) * spb;
    renderVoice(track, note, startSec, sampleRate, (frame, l, r) => {
      if (frame < 0 || frame >= frames) return;
      left[frame] += l;
      right[frame] += r;
    });
  }

  // Per-track feedback delay sends (offline, whole-loop at once).
  const wet = applyDelaySends(project, notes, sampleRate, frames);
  for (let i = 0; i < frames; i++) {
    left[i] += wet.left[i];
    right[i] += wet.right[i];
  }

  // Bus compressor (simple envelope follower) then master gain.
  if (project.master.compEnabled !== false) {
    applyCompressor(left, right, sampleRate, project.master.compThreshold, project.master.compRatio);
  }
  const masterGain = project.master.gain;
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    left[i] *= masterGain;
    right[i] *= masterGain;
    const p = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (p > peak) peak = p;
  }
  return { left, right, frames, duration, sampleRate, peak, clipped: peak >= CLIP_THRESHOLD, noteCount: notes.length };
}

function renderVoice(track, note, startSec, sampleRate, emit) {
  const start = Math.floor(startSec * sampleRate);
  const freq = midiToFreq(note.midi);
  const vel = note.vel;
  const gain = track.volume;
  // Equal-power pan.
  const angle = ((track.pan + 1) * Math.PI) / 4;
  const panL = Math.cos(angle);
  const panR = Math.sin(angle);
  let dur;
  switch (track.type) {
    case 'kick': dur = 0.25; break;
    case 'hat': dur = 0.06; break;
    case 'bass': dur = 0.22; break;
    default: dur = 0.3;
  }
  const n = Math.floor(dur * sampleRate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * (track.type === 'hat' ? 60 : track.type === 'kick' ? 18 : 12));
    let s;
    if (track.type === 'kick') {
      const f = 120 * Math.exp(-t * 30) + 45;
      phase += (2 * Math.PI * f) / sampleRate;
      s = Math.sin(phase);
    } else if (track.type === 'hat') {
      s = (Math.random() * 2 - 1) * 0.6;
    } else if (track.type === 'bass') {
      phase += (2 * Math.PI * freq) / sampleRate;
      s = Math.tanh(Math.sin(phase) * 1.5) * 0.8;
    } else {
      phase += (2 * Math.PI * freq) / sampleRate;
      s = (Math.sin(phase) + 0.3 * Math.sin(2 * phase)) * 0.6;
    }
    const sample = s * env * vel * gain;
    emit(start + i, sample * panL, sample * panR);
    // Also feed the delay send bus.
    emitDelay(track, start + i, sample);
  }
}

// Delay send taps are collected per renderVoice call into a shared buffer.
let delayTap = null;
function emitDelay(track, frame, sample) {
  if (!delayTap || track.delaySend <= 0) return;
  const idx = frame * 2;
  if (idx + 1 < delayTap.length) {
    delayTap[idx] += sample * track.delaySend;
    delayTap[idx + 1] += sample * track.delaySend;
  }
}

function applyDelaySends(project, notes, sampleRate, frames) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const hasSend = project.tracks.some((t) => !t.bypass && t.delaySend > 0);
  if (!hasSend || notes.length === 0) return { left, right };
  delayTap = new Float32Array(frames * 2);
  // Re-render only the send taps: walk notes again cheaply.
  const spb = secondsPerBeat(project.tempo);
  for (const note of notes) {
    const track = project.tracks[note.track];
    if (track.bypass || track.delaySend <= 0) continue;
    renderVoice(track, note, stepToBeat(note.step) * spb, sampleRate, () => {});
  }
  delayTapFinish(delayTap, left, right, sampleRate);
  delayTap = null;
  return { left, right };
}

// 3/16 feedback delay (dotted eighth feel at 4/4), 35% feedback.
function delayTapFinish(tap, left, right, sampleRate) {
  const delayFrames = Math.floor(0.375 * (sampleRate / 2)); // ~dotted 8th at 120bpm reference
  const feedback = 0.35;
  const line = new Float32Array(delayFrames * 2);
  let w = 0;
  for (let i = 0; i < left.length; i++) {
    const ri = w;
    const dl = line[ri * 2];
    const dr = line[ri * 2 + 1];
    left[i] += dl * 0.8;
    right[i] += dr * 0.8;
    line[ri * 2] = tap[i * 2] + dl * feedback;
    line[ri * 2 + 1] = tap[i * 2 + 1] + dr * feedback;
    w = (w + 1) % delayFrames;
  }
}

function applyCompressor(left, right, sampleRate, thresholdDb, ratio) {
  const threshold = Math.pow(10, thresholdDb / 20);
  const attack = Math.exp(-1 / (0.003 * sampleRate));
  const release = Math.exp(-1 / (0.25 * sampleRate));
  let env = 0;
  for (let i = 0; i < left.length; i++) {
    const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    env = level > env ? attack * env + (1 - attack) * level : release * env + (1 - release) * level;
    if (env > threshold) {
      const overDb = 20 * Math.log10(env / threshold);
      const gainDb = -overDb * (1 - 1 / ratio);
      const g = Math.pow(10, gainDb / 20);
      left[i] *= g;
      right[i] *= g;
    }
  }
}

// Encode stereo float buffers as 16-bit PCM WAV.
export function encodeWav(left, right, sampleRate) {
  const frames = left.length;
  const dataSize = frames * 2 * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    view.setInt16(off, Math.max(-1, Math.min(1, left[i])) * 0x7fff, true); off += 2;
    view.setInt16(off, Math.max(-1, Math.min(1, right[i])) * 0x7fff, true); off += 2;
  }
  return buffer;
}
