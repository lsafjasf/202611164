// Procedural harbor soundscape renderer. Every clue is synthesized in
// real time from the case parameters — no audio files are used.
// Segments are rendered once into AudioBuffers via OfflineAudioContext,
// so replay and pause never alter clue content.

import { mulberry32 } from './rng.js';

function addHorn(ctx, dest, seg) {
  // Low ship horn: stacked triangle/sine with slow vibrato, distinct
  // fundamental per segment (frequency-band clue).
  for (let h = 0; h < seg.hornCount; h++) {
    const t0 = 0.4 + h * (seg.duration - 1.5) / seg.hornCount;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = seg.hornFreq;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = seg.hornFreq / 2;
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.5;
    const vibGain = ctx.createGain();
    vibGain.gain.value = seg.hornFreq * 0.012;
    vib.connect(vibGain).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 0.25);
    g.gain.setValueAtTime(0.5, t0 + 1.1);
    g.gain.linearRampToValueAtTime(0, t0 + 1.6);
    osc.connect(g);
    sub.connect(g);
    g.connect(dest);
    for (const o of [osc, sub, vib]) {
      o.start(t0);
      o.stop(t0 + 1.7);
    }
  }
}

function noiseBuffer(ctx, seconds, rand) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  return buf;
}

function addFootsteps(ctx, dest, seg, noise) {
  // Dock footsteps: short band-passed noise thuds at footstepRate.
  const step = 1 / seg.footstepRate;
  for (let t = 0.3; t < seg.duration - 0.2; t += step) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 300 + (t * 137) % 120;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, 0.05, 0.15);
  }
}

function addMachinery(ctx, dest, seg, noise) {
  // Crane machinery: metallic clank (detuned squares) + noise burst.
  const step = 1 / seg.machineryRate;
  for (let t = 0.8; t < seg.duration - 0.3; t += step) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    for (const f of [1244, 1867]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f + (seg.id * 53) % 160;
      const og = ctx.createGain();
      og.gain.value = 0.12;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + 0.36);
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.15, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.connect(hp).connect(ng).connect(dest);
    src.start(t, 0.2, 0.1);
    g.connect(dest);
  }
}

function addBells(ctx, dest, seg) {
  // Time anchor: harbor bell strikes bellCount times. The count encodes
  // the transport order of this container.
  for (let k = 0; k < seg.bellCount; k++) {
    const t = seg.anchorOffset + k * 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    for (const [mult, amp] of [[1, 1], [2.76, 0.4], [5.4, 0.18]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 660 * mult;
      const og = ctx.createGain();
      og.gain.value = amp * 0.33;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + 0.85);
    }
    g.connect(dest);
  }
}

export async function renderSegment(seg, seed, sampleRate = 44100) {
  const ctx = new OfflineAudioContext(2, seg.duration * sampleRate, sampleRate);
  const panner = ctx.createStereoPanner();
  panner.pan.value = seg.panValue;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  panner.connect(master).connect(ctx.destination);

  const noise = noiseBuffer(ctx, 1, mulberry32((seed * 31 + seg.id * 1013) >>> 0));
  addHorn(ctx, panner, seg);
  addFootsteps(ctx, panner, seg, noise);
  addMachinery(ctx, panner, seg, noise);
  addBells(ctx, panner, seg);

  return ctx.startRendering();
}

export async function renderCase(caseData) {
  const buffers = [];
  for (const seg of caseData.segments) {
    buffers.push(await renderSegment(seg, caseData.seed));
  }
  return buffers;
}
