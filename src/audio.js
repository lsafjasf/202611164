// Web Audio 玻璃杯引擎：泛音杯鸣 + 摩擦噪声 + 温升失谐 + 破裂。
// 所有发声节点都登记到 activeSources；stopAll 一律停止并断开，杜绝残留声音。

import { BASE_FREQS } from './project.js';

// 杯鸣近似泛音列（玻璃杯为非完全谐和分音）
const PARTIALS = [
  { ratio: 1.0, gain: 1.0, decay: 3.2 },
  { ratio: 2.0, gain: 0.34, decay: 1.8 },
  { ratio: 3.01, gain: 0.16, decay: 1.1 },
  { ratio: 4.16, gain: 0.08, decay: 0.7 },
];

export class GlassAudioEngine {
  constructor(ctx, project) {
    this.ctx = ctx;
    this.project = project;
    this.temperatures = new Array(project.tracks.length).fill(0);
    this.activeSources = new Map(); // source => { track, kind }
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.trackNodes = project.tracks.map((track) => {
      const gain = ctx.createGain();
      gain.gain.value = track.gain;
      let panner = null;
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        panner.pan.value = track.pan;
        gain.connect(panner);
        panner.connect(this.master);
      } else {
        gain.connect(this.master);
      }
      return { gain, panner };
    });
    this.trackInputs = this.trackNodes.map((nodes) => nodes.gain);
  }

  detuneCents(trackIndex) {
    return this.temperatures[trackIndex] * this.project.physics.detuneCentsPerDegree;
  }

  frequencyFor(trackIndex, transpose = 0) {
    const track = this.project.tracks[trackIndex];
    const base = BASE_FREQS[trackIndex];
    const waterShift = -track.water * 24; // 水越多音越低，最多低两个八度
    const tempShift = -this.detuneCents(trackIndex);
    const semitones = transpose + waterShift;
    return base * Math.pow(2, semitones / 12) * Math.pow(2, tempShift / 1200);
  }

  isBroken(trackIndex) {
    return this.project.tracks[trackIndex].broken;
  }

  // 敲击杯沿；力度超阈值 → 破裂。
  strike(trackIndex, { when = this.ctx.currentTime, velocity = 0.6, transpose = 0 } = {}) {
    if (this.isBroken(trackIndex)) return null;
    if (velocity >= this.project.physics.breakVelocity) {
      this.breakGlass(trackIndex, when);
      return { broken: true };
    }
    const freq = this.frequencyFor(trackIndex, transpose);
    const input = this.trackInputs[trackIndex];
    PARTIALS.forEach((partial) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * partial.ratio;
      const voiceGain = this.ctx.createGain();
      const peak = velocity * partial.gain * 0.5;
      voiceGain.gain.setValueAtTime(0.0001, when);
      voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.006);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + partial.decay);
      osc.connect(voiceGain);
      voiceGain.connect(input);
      osc.start(when);
      osc.stop(when + partial.decay + 0.05);
      this._register(osc, trackIndex, 'strike');
    });
    return { broken: false, freq };
  }

  // 沿杯口摩擦：带通噪声模拟摩擦声，同时让杯温升高。
  rub(trackIndex, { when = this.ctx.currentTime, duration = 0.25, transpose = 0 } = {}) {
    if (this.isBroken(trackIndex)) return null;
    this.heat(trackIndex, this.project.physics.rubHeat * (duration / 0.25));
    const freq = this.frequencyFor(trackIndex, transpose);
    const source = this._noiseSource(duration);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 6;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(0.18, when + duration * 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter);
    filter.connect(env);
    env.connect(this.trackInputs[trackIndex]);
    source.start(when);
    source.stop(when + duration + 0.02);
    this._register(source, trackIndex, 'rub');
    return { freq };
  }

  breakGlass(trackIndex, when = this.ctx.currentTime) {
    const track = this.project.tracks[trackIndex];
    if (track.broken) return;
    track.broken = true;
    this._stopTrackSources(trackIndex, when);
    // 破裂瞬态：宽频噪声爆裂
    const source = this._noiseSource(0.35);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.5, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    source.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    source.start(when);
    source.stop(when + 0.35);
    this._register(source, trackIndex, 'break');
  }

  heat(trackIndex, amount) {
    const max = this.project.physics.maxTemperature;
    this.temperatures[trackIndex] = Math.min(max, this.temperatures[trackIndex] + amount);
  }

  cool(dtSeconds) {
    const rate = this.project.physics.coolingPerSecond;
    this.temperatures = this.temperatures.map((t) => Math.max(0, t - rate * dtSeconds));
  }

  setTrackGain(trackIndex, value) {
    this.project.tracks[trackIndex].gain = value;
    this.trackInputs[trackIndex].gain.value = value;
  }

  setTrackPan(trackIndex, value) {
    this.project.tracks[trackIndex].pan = value;
    const { panner } = this.trackNodes[trackIndex];
    if (panner) panner.pan.value = value;
  }

  _noiseSource(duration) {
    const sampleRate = this.ctx.sampleRate || 44100;
    const length = Math.max(1, Math.ceil(sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  _register(source, trackIndex, kind) {
    this.activeSources.set(source, { track: trackIndex, kind });
    source.onended = () => this.activeSources.delete(source);
  }

  _stopTrackSources(trackIndex, when) {
    for (const [source, meta] of this.activeSources) {
      if (meta.track === trackIndex && meta.kind !== 'break') {
        safeStop(source, when);
        this.activeSources.delete(source);
      }
    }
  }

  // 全部停止：逐个 stop + disconnect，清空注册表，保证无任何节点残留发声。
  stopAll(when = this.ctx.currentTime) {
    for (const source of this.activeSources.keys()) {
      safeStop(source, when);
      try { source.disconnect(); } catch { /* 已断开 */ }
    }
    this.activeSources.clear();
  }

  get activeCount() {
    return this.activeSources.size;
  }

  suspend() { return this.ctx.state !== 'closed' && this.ctx.suspend && this.ctx.suspend(); }
  resume() { return this.ctx.resume && this.ctx.resume(); }
}

function safeStop(source, when) {
  try {
    if (typeof source.stop === 'function') source.stop(when);
  } catch {
    // 节点已停止
  }
}
