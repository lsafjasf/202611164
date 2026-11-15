import { LANES, SAMPLE_RATE } from "./config.js";

const LANE_MAP = new Map(LANES.map((lane) => [lane.id, lane]));

export class AudioEngine {
  constructor({ context = null, onVoiceChange = null } = {}) {
    this.externalContext = context;
    this.ctx = context;
    this.onVoiceChange = onVoiceChange;
    this.master = null;
    this.compressor = null;
    this.channels = new Map();
    this.sources = new Set();
    this.calibrationSources = new Set();
    this.mix = new Map(LANES.map((lane) => [lane.id, { pitch: lane.pitch, gain: lane.gain }]));
    this.transpose = 0;
    this.noiseBuffer = null;
    this.initialized = false;
  }

  async ensureContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
      this.ctx = new AudioContextClass({ latencyHint: "interactive" });
    }
    this.initGraph();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  initGraph() {
    if (this.initialized || !this.ctx) return;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.78;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.22;

    for (const lane of LANES) {
      const channel = this.ctx.createGain();
      const settings = this.mix.get(lane.id);
      channel.gain.value = settings.gain;
      channel.connect(this.compressor);
      this.channels.set(lane.id, channel);
    }

    this.compressor.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = createNoiseBuffer(this.ctx);
    this.initialized = true;
  }

  setMix(lanes) {
    for (const lane of lanes) {
      const settings = this.mix.get(lane.id);
      if (!settings) continue;
      settings.pitch = lane.pitch;
      settings.gain = lane.gain;
      const channel = this.channels.get(lane.id);
      if (channel) channel.gain.setTargetAtTime(lane.gain, this.ctx.currentTime, 0.012);
    }
  }

  setTranspose(semitones) {
    this.transpose = semitones;
  }

  setMasterGain(value) {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }

  get activeVoiceCount() {
    return this.sources.size;
  }

  scheduleLane(laneId, when, { velocity = 1, extraPitch = 0, accent = false } = {}) {
    if (!this.initialized) return;
    const lane = LANE_MAP.get(laneId);
    const settings = this.mix.get(laneId);
    if (!lane || !settings) return;

    const safeWhen = Math.max(when, this.ctx.currentTime + 0.001);
    const pitch = this.transpose + settings.pitch + extraPitch;
    const voiceGain = velocity * (accent ? 1.18 : 0.78);

    if (lane.instrument === "KICK") {
      this.scheduleKick(laneId, safeWhen, pitch, voiceGain);
    } else if (lane.instrument === "SNARE") {
      this.scheduleSnare(laneId, safeWhen, pitch, voiceGain);
    } else if (lane.instrument === "HAT") {
      this.scheduleHat(laneId, safeWhen, pitch, voiceGain);
    } else {
      this.scheduleStab(laneId, safeWhen, pitch, voiceGain);
    }
  }

  scheduleClick(when, { calibration = false } = {}) {
    if (!this.initialized) return;
    const start = Math.max(when, this.ctx.currentTime + 0.001);
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1760, start);
    osc.frequency.exponentialRampToValueAtTime(1100, start + 0.035);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.3, start + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);
    osc.connect(env);
    env.connect(this.master);
    osc.start(start);
    osc.stop(start + 0.07);
    this.trackSource(osc, [osc, env], calibration);
  }

  scheduleKick(laneId, when, pitch, velocity) {
    const duration = 0.38;
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    const click = this.ctx.createBufferSource();
    const clickFilter = this.ctx.createBiquadFilter();
    const clickGain = this.ctx.createGain();
    const frequency = 132 * semitoneRatio(pitch);

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * 1.35, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * 0.36), when + 0.12);
    oscGain.gain.setValueAtTime(Math.max(0.0001, 0.92 * velocity), when);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(oscGain);
    oscGain.connect(this.channels.get(laneId));

    click.buffer = this.noiseBuffer;
    clickFilter.type = "highpass";
    clickFilter.frequency.value = 1400;
    clickGain.gain.setValueAtTime(0.14 * velocity, when);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.022);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.channels.get(laneId));

    osc.start(when);
    osc.stop(when + duration + 0.02);
    click.start(when, 0, 0.03);
    click.stop(when + 0.03);
    this.trackSource(osc, [osc, oscGain, click, clickFilter, clickGain]);
  }

  scheduleSnare(laneId, when, pitch, velocity) {
    const duration = 0.23;
    const noise = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();
    const body = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    const ratio = semitoneRatio(pitch);

    noise.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1800 * ratio, when);
    filter.Q.value = 0.7;
    noiseGain.gain.setValueAtTime(0.52 * velocity, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.channels.get(laneId));

    body.type = "triangle";
    body.frequency.setValueAtTime(185 * ratio, when);
    body.frequency.exponentialRampToValueAtTime(110 * ratio, when + 0.09);
    bodyGain.gain.setValueAtTime(0.18 * velocity, when);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
    body.connect(bodyGain);
    bodyGain.connect(this.channels.get(laneId));

    noise.start(when);
    noise.stop(when + duration + 0.02);
    body.start(when);
    body.stop(when + 0.16);
    this.trackSource(noise, [noise, filter, noiseGain, body, bodyGain]);
  }

  scheduleHat(laneId, when, pitch, velocity) {
    const duration = 0.075;
    const noise = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const ratio = semitoneRatio(pitch);

    noise.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(Math.min(16500, 7200 * ratio), when);
    filter.Q.value = 0.55;
    gain.gain.setValueAtTime(0.32 * velocity, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.channels.get(laneId));

    noise.start(when, 0, duration + 0.02);
    noise.stop(when + duration + 0.02);
    this.trackSource(noise, [noise, filter, gain]);
  }

  scheduleStab(laneId, when, pitch, velocity) {
    const duration = 0.22;
    const root = 220 * semitoneRatio(pitch);
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, when);
    filter.frequency.exponentialRampToValueAtTime(700, when + duration);
    filter.Q.value = 2.2;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.2 * velocity, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    filter.connect(gain);
    gain.connect(this.channels.get(laneId));

    const oscillators = [
      createOscillator(this.ctx, "sawtooth", root, when),
      createOscillator(this.ctx, "triangle", root * 1.5, when)
    ];
    for (const osc of oscillators) {
      osc.connect(filter);
      osc.start(when);
      osc.stop(when + duration + 0.02);
    }
    this.trackSource(oscillators[0], [filter, gain, ...oscillators]);
  }

  trackSource(primary, nodes, calibration = false) {
    const bucket = calibration ? this.calibrationSources : this.sources;
    bucket.add(primary);
    this.emitVoiceCount();
    primary.onended = () => {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // Node may already be disconnected by stopAll().
        }
      }
      bucket.delete(primary);
      this.emitVoiceCount();
    };
  }

  emitVoiceCount() {
    if (this.onVoiceChange) {
      this.onVoiceChange(this.sources.size + this.calibrationSources.size);
    }
  }

  stopSources(bucket) {
    for (const source of [...bucket]) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
      bucket.delete(source);
    }
    this.emitVoiceCount();
  }

  stopAll() {
    this.stopSources(this.sources);
  }

  stopCalibration() {
    this.stopSources(this.calibrationSources);
  }

  async suspend() {
    this.stopAll();
    if (this.ctx && this.ctx.state === "running" && !this.externalContext) {
      await this.ctx.suspend();
    }
  }

  async resume() {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  async dispose() {
    this.stopAll();
    this.stopCalibration();
    if (this.ctx && !this.externalContext && this.ctx.state !== "closed") {
      await this.ctx.close();
    }
    this.initialized = false;
  }
}

function createOscillator(ctx, type, frequency, when) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, when);
  return osc;
}

function semitoneRatio(semitones) {
  return Math.pow(2, semitones / 12);
}

function createNoiseBuffer(ctx) {
  const length = Math.max(1, Math.floor(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  let seed = 0x2f6e2b1;
  for (let index = 0; index < length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    channel[index] = (seed / 0xffffffff) * 2 - 1;
  }
  return buffer;
}
