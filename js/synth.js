// Web Audio synthesis + mixer graph. Mirrors js/render.js so the live
// monitor and the WAV export share the same structure.

import { midiToFreq, collectNotes, stepToBeat, secondsPerBeat, loopDurationSeconds } from './engine.js';

export const CLIP_THRESHOLD = 0.999;

// Per-track chain:
// input -> trackGain -> panner -> bypassGain -> dryOut -> bus
//                              \-> delaySend -> delay <-> feedback -> delayOut -> bus
export function createTrackChain(ctx, track, bus) {
  const input = ctx.createGain();
  const trackGain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const bypassGain = ctx.createGain();
  const delaySend = ctx.createGain();
  const delay = ctx.createDelay(2);
  const feedback = ctx.createGain();
  const delayOut = ctx.createGain();

  trackGain.gain.value = track.volume;
  panner.pan.value = track.pan;
  bypassGain.gain.value = track.bypass ? 0 : 1;
  delaySend.gain.value = track.delaySend;
  delay.delayTime.value = 0.375; // dotted 8th at 120bpm reference
  feedback.gain.value = 0.35;
  delayOut.gain.value = 0.8;

  input.connect(trackGain);
  trackGain.connect(panner);
  panner.connect(bypassGain);
  bypassGain.connect(bus);
  bypassGain.connect(delaySend);
  delaySend.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(delayOut);
  delayOut.connect(bus);

  return { input, trackGain, panner, bypassGain, delaySend, delay, feedback, delayOut };
}

// Master bus: busGain -> compressor -> masterGain -> destination (+ analyser tap).
export function createMasterBus(ctx, master, destination) {
  const busGain = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  const masterGain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  compressor.threshold.value = master.compThreshold;
  compressor.ratio.value = master.compRatio;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  masterGain.gain.value = master.gain;
  busGain.connect(compressor);
  compressor.connect(masterGain);
  masterGain.connect(destination);
  masterGain.connect(analyser);
  return { busGain, compressor, masterGain, analyser };
}

// Trigger one note. Registers the voice so pause/stop can kill it instantly.
export function triggerVoice(ctx, chain, track, midi, vel, time, registry) {
  const nodes = [];
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  let stopAt;
  if (track.type === 'kick') {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    env.gain.linearRampToValueAtTime(vel, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    osc.connect(env);
    osc.start(time);
    stopAt = time + 0.3;
    osc.stop(stopAt);
    nodes.push(osc);
  } else if (track.type === 'hat') {
    const len = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    env.gain.setValueAtTime(vel * 0.6, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    src.connect(hp);
    hp.connect(env);
    src.start(time);
    stopAt = time + 0.08;
    nodes.push(src);
  } else {
    const osc = ctx.createOscillator();
    osc.type = track.type === 'bass' ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(midiToFreq(midi), time);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = track.type === 'bass' ? 900 : 3200;
    const dur = track.type === 'bass' ? 0.22 : 0.3;
    env.gain.linearRampToValueAtTime(vel * 0.6, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(lp);
    lp.connect(env);
    osc.start(time);
    stopAt = time + dur + 0.05;
    osc.stop(stopAt);
    nodes.push(osc);
  }
  env.connect(chain.input);
  nodes.push(env);
  const voice = {
    nodes,
    stop(when) {
      for (const n of nodes) {
        try { if (n.stop) n.stop(when); } catch { /* already stopped */ }
        try { n.disconnect(); } catch { /* already disconnected */ }
      }
    },
  };
  if (registry) {
    registry.add(voice);
    // Auto-release the registry entry after the voice ends.
    setTimeout(() => registry.delete(voice), Math.max(0, (stopAt - ctx.currentTime) * 1000) + 100);
  }
  return voice;
}

// Stop every live voice and silence delay tails, then release references.
export function releaseAllVoices(registry, chains, ctx) {
  const now = ctx.currentTime;
  for (const voice of registry) voice.stop(now);
  registry.clear();
  for (const chain of chains) {
    chain.delayOut.gain.cancelScheduledValues(now);
    chain.delayOut.gain.setTargetAtTime(0, now, 0.02); // kill delay tails fast
    chain.delaySend.gain.setTargetAtTime(0, now, 0.02);
  }
}

// Restore delay sends after a pause (values come from the project).
export function restoreDelaySends(chains, tracks, ctx) {
  const now = ctx.currentTime;
  chains.forEach((chain, i) => {
    chain.delaySend.gain.setTargetAtTime(tracks[i].delaySend, now, 0.02);
    chain.delayOut.gain.setTargetAtTime(0.8, now, 0.02);
  });
}

// Offline render of exactly one loop for WAV export.
export async function renderOffline(project, sampleRate = 44100) {
  const duration = loopDurationSeconds(project);
  const frames = Math.round(duration * sampleRate);
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const master = createMasterBus(ctx, project.master, ctx.destination);
  const chains = project.tracks.map((t) => createTrackChain(ctx, t, master.busGain));
  const spb = secondsPerBeat(project.tempo);
  for (const note of collectNotes(project)) {
    const track = project.tracks[note.track];
    triggerVoice(ctx, chains[note.track], track, note.midi, note.vel, stepToBeat(note.step) * spb, null);
  }
  const buffer = await ctx.startRendering();
  return { buffer, duration, frames };
}

export function encodeWavFromBuffer(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const frames = left.length;
  const dataSize = frames * 2 * 2;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    view.setInt16(off, Math.max(-1, Math.min(1, left[i])) * 0x7fff, true); off += 2;
    view.setInt16(off, Math.max(-1, Math.min(1, right[i])) * 0x7fff, true); off += 2;
  }
  return out;
}
