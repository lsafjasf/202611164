import { CONFIG } from './config.js';

let ctx = null;
let master = null;
let noiseBuffer = null;

export function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function suspendContext() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function getContext() {
  return ctx;
}

function ping(freq, start, duration, gainValue, type = 'sine') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function noiseBurst(start, duration, gainValue, filterFreq, panValue = 0, q = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  const panner = ctx.createStereoPanner();
  panner.pan.value = panValue;
  src.connect(filter).connect(gain).connect(panner).connect(master);
  src.start(start);
  src.stop(start + duration + 0.05);
}

// 主动声呐：发射脉冲 -> 按描述符时延回放真实回波 -> 持续本底噪声 + 杂波。
export function playScan(entry) {
  ensureContext();
  const now = ctx.currentTime + 0.05;
  ping(1200, now, 0.18, 0.5, 'triangle');
  const tail = Math.max(1.2, ...entry.echoes.map((e) => e.delay)) + 0.4;
  noiseBurst(now, tail, entry.noiseFloor * 0.25, 500, 0, 0.6);
  for (const echo of entry.echoes) {
    ping(880, now + echo.delay, 0.22, 0.35 * echo.amplitude, 'sine');
  }
  for (const delay of entry.clutter) {
    noiseBurst(now + delay, 0.12, 0.12, 1800 + delay * 200, 0, 2);
  }
  return now;
}

// 水听器：信标音调（公开频率）+ 带左右舷偏向的海流滤波噪声。
export function playListen(entry) {
  ensureContext();
  const now = ctx.currentTime + 0.05;
  ping(entry.measuredFreq, now, entry.duration, 0.3, 'sine');
  ping(entry.measuredFreq * 2, now, entry.duration, 0.08, 'sine');
  const flowGain = 0.12 + entry.turbulence * 0.18;
  noiseBurst(now, entry.duration, flowGain, 320 + entry.turbulence * 600, entry.pan, 1.2);
  return now;
}

export function playUi(kind) {
  ensureContext();
  const now = ctx.currentTime;
  if (kind === 'move') ping(520, now, 0.08, 0.12, 'square');
  if (kind === 'mark') ping(760, now, 0.1, 0.15, 'triangle');
  if (kind === 'error') {
    ping(180, now, 0.25, 0.25, 'sawtooth');
  }
  if (kind === 'collect') {
    ping(660, now, 0.12, 0.2, 'sine');
    ping(990, now + 0.12, 0.16, 0.2, 'sine');
  }
}

export { CONFIG };
