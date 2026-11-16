function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoiseBuffer(context, duration, seed, channels = 1) {
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(channels, length, context.sampleRate);
  const random = seededRandom(seed);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = random() * 2 - 1;
      previous = previous * 0.58 + white * 0.42;
      data[index] = previous;
    }
  }
  return buffer;
}

function makeEventBuffer(context, materialId, seed) {
  const durationByMaterial = {
    leaf: 0.44,
    gravel: 0.5,
    moss: 0.88,
    pine: 0.72
  };
  const duration = durationByMaterial[materialId] ?? 0.55;
  const length = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededRandom(seed);

  if (materialId === "leaf") {
    for (let grain = 0; grain < 9; grain += 1) {
      const start = Math.floor((0.012 + grain * 0.027 + random() * 0.018) * context.sampleRate);
      const grainLength = Math.floor((0.010 + random() * 0.019) * context.sampleRate);
      const amplitude = 0.4 + random() * 0.6;
      for (let index = 0; index < grainLength && start + index < length; index += 1) {
        const progress = index / grainLength;
        const crackle = (random() * 2 - 1) * Math.exp(-progress * 4.8);
        data[start + index] += crackle * amplitude * (index % 2 ? -1 : 1);
      }
    }
    for (let index = 0; index < length; index += 1) {
      data[index] += (random() * 2 - 1) * 0.07 * Math.exp(-index / (0.12 * context.sampleRate));
    }
  } else if (materialId === "gravel") {
    for (let tick = 0; tick < 6; tick += 1) {
      const start = Math.floor((0.008 + tick * 0.064 + random() * 0.025) * context.sampleRate);
      const tickLength = Math.floor((0.018 + random() * 0.016) * context.sampleRate);
      const gain = 0.55 + random() * 0.5;
      for (let index = 0; index < tickLength && start + index < length; index += 1) {
        const envelope = Math.exp(-(index / tickLength) * 5);
        const impact = random() * 2 - 1;
        data[start + index] += impact * envelope * gain;
      }
    }
  } else if (materialId === "moss") {
    let smoothed = 0;
    for (let index = 0; index < length; index += 1) {
      const time = index / context.sampleRate;
      const envelope = Math.exp(-time * 3.5) * (1 - Math.exp(-time * 22));
      smoothed = smoothed * 0.82 + (random() * 2 - 1) * 0.18;
      const thump = Math.sin(time * Math.PI * 2 * (92 + time * 26)) * Math.exp(-time * 9);
      data[index] = (smoothed * 0.38 + thump * 0.52) * envelope;
    }
  } else {
    let smoothed = 0;
    for (let index = 0; index < length; index += 1) {
      const time = index / context.sampleRate;
      const primary = Math.exp(-time * 4.2) * (1 - Math.exp(-time * 35));
      const secondary = time > 0.18 ? Math.exp(-(time - 0.18) * 6.5) * 0.38 : 0;
      smoothed = smoothed * 0.45 + (random() * 2 - 1) * 0.55;
      data[index] = smoothed * (primary + secondary) * 0.82;
    }
  }

  let peak = 0.0001;
  for (let index = 0; index < length; index += 1) {
    peak = Math.max(peak, Math.abs(data[index]));
  }
  for (let index = 0; index < length; index += 1) {
    data[index] = (data[index] / peak) * 0.9;
  }
  return buffer;
}

function makeImpulse(context, materialId, seed) {
  const secondsByMaterial = { leaf: 0.22, gravel: 0.3, moss: 0.52, pine: 0.4 };
  const duration = secondsByMaterial[materialId] ?? 0.34;
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  const random = seededRandom(seed ^ 0x9e3779b9);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      const sparkle = channel ? 0.28 : 0.18;
      data[index] = (random() * 2 - 1) * (1 - progress) ** 2.4 * sparkle;
      if (index < 32) data[index] += (random() * 2 - 1) * 0.08;
    }
  }
  return buffer;
}

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.analyser = null;
    this.windGain = null;
    this.windPan = null;
    this.windStarted = false;
    this.voiceBuses = new Set();
    this.sourceVoices = new Set();
    this.timeData = null;
    this.seed = 1;
  }

  get isReady() {
    return Boolean(this.context && this.master);
  }

  get isPaused() {
    return this.context?.state === "suspended";
  }

  async init(seed) {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error("当前浏览器不支持 Web Audio");

    this.seed = seed;
    this.context = new Context({ latencyHint: "interactive" });
    this.master = this.context.createGain();
    this.master.gain.value = 0.62;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.68;
    this.analyserLeft = this.context.createAnalyser();
    this.analyserRight = this.context.createAnalyser();
    this.analyserLeft.fftSize = 1024;
    this.analyserRight.fftSize = 1024;
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.timeLeft = new Uint8Array(this.analyserLeft.fftSize);
    this.timeRight = new Uint8Array(this.analyserRight.fftSize);
    const splitter = this.context.createChannelSplitter(2);
    const merger = this.context.createChannelMerger(2);
    this.master.connect(this.analyser);
    this.analyser.connect(splitter);
    splitter.connect(this.analyserLeft, 0);
    splitter.connect(this.analyserRight, 1);
    this.analyserLeft.connect(merger, 0, 0);
    this.analyserRight.connect(merger, 0, 1);
    merger.connect(this.context.destination);
    this.startWind();
    await this.context.resume();
  }

  startWind() {
    if (!this.context || this.windStarted) return;
    const source = this.context.createBufferSource();
    source.buffer = makeNoiseBuffer(this.context, 7, this.seed ^ 0xa53c9e1d, 2);
    source.loop = true;

    const rumble = this.context.createBiquadFilter();
    rumble.type = "highpass";
    rumble.frequency.value = 420;
    rumble.Q.value = 0.45;

    const leaves = this.context.createBiquadFilter();
    leaves.type = "bandpass";
    leaves.frequency.value = 2950;
    leaves.Q.value = 0.58;

    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.012;
    this.windPan = this.context.createStereoPanner();
    this.windPan.pan.value = 0;

    source.connect(rumble);
    rumble.connect(leaves);
    leaves.connect(this.windGain);
    this.windGain.connect(this.windPan);
    this.windPan.connect(this.master);
    source.start();
    this.windStarted = true;
  }

  setWind(intensity = 0, pan = 0) {
    if (!this.windGain || !this.context) return;
    const now = this.context.currentTime;
    const safeIntensity = clamp(intensity, 0, 1);
    this.windGain.gain.setTargetAtTime(0.012 + safeIntensity * 0.12, now, 0.18);
    this.windPan.pan.setTargetAtTime(clamp(pan, -0.9, 0.9), now, 0.22);
  }

  async play() {
    if (!this.context) return;
    if (this.context.state !== "running") await this.context.resume();
  }

  async pause() {
    if (!this.context || this.context.state !== "running") return;
    await this.context.suspend();
  }

  resetVoices() {
    for (const voice of this.sourceVoices) {
      try {
        voice.stop();
      } catch {
        // Already stopped.
      }
    }
    for (const bus of this.voiceBuses) {
      try {
        bus.gain.cancelScheduledValues(0);
        bus.gain.value = 0;
        bus.disconnect();
      } catch {
        // Already detached.
      }
    }
    this.sourceVoices.clear();
    this.voiceBuses.clear();
    this.setWind(0, 0);
  }

  makeVoiceBus() {
    const bus = this.context.createGain();
    bus.gain.value = 1;
    bus.connect(this.master);
    this.voiceBuses.add(bus);
    return bus;
  }

  triggerSource(source, listener) {
    if (!this.context || !this.master) return null;
    const now = this.context.currentTime + 0.015;
    const dx = source.x - listener.x;
    const dy = source.y - listener.y;
    const distance = Math.hypot(dx, dy);
    const pan = clamp(dx / 54, -0.88, 0.88);
    const proximity = clamp(1.08 - distance / 145, 0.34, 0.92);
    const duration = { leaf: 0.44, gravel: 0.5, moss: 0.88, pine: 0.72 }[source.materialId] ?? 0.56;

    const voice = this.context.createBufferSource();
    voice.buffer = makeEventBuffer(this.context, source.materialId, source.audioSeed);
    const filter = this.context.createBiquadFilter();
    const filterProfiles = {
      leaf: { type: "highpass", frequency: 1700, Q: 0.75 },
      gravel: { type: "bandpass", frequency: source.frequency, Q: 1.35 },
      moss: { type: "lowpass", frequency: 740, Q: 0.7 },
      pine: { type: "bandpass", frequency: source.frequency, Q: 0.72 }
    };
    const profile = filterProfiles[source.materialId] ?? filterProfiles.pine;
    filter.type = profile.type;
    filter.frequency.value = profile.frequency;
    filter.Q.value = profile.Q;

    const directGain = this.context.createGain();
    directGain.gain.value = proximity * 0.67;
    const directPan = this.context.createStereoPanner();
    directPan.pan.value = pan;
    const bus = this.makeVoiceBus();

    voice.connect(filter);
    filter.connect(directGain);
    directGain.connect(directPan);
    directPan.connect(bus);

    const delay = this.context.createDelay(1.2);
    delay.delayTime.value = source.echoMs / 1000;
    const echoGain = this.context.createGain();
    echoGain.gain.value = proximity * 0.22;
    const echoPan = this.context.createStereoPanner();
    echoPan.pan.value = clamp(-pan * 0.72 + (pan >= 0 ? -0.1 : 0.1), -0.85, 0.85);
    voice.connect(delay);
    delay.connect(echoGain);
    echoGain.connect(echoPan);
    echoPan.connect(bus);

    const convolver = this.context.createConvolver();
    convolver.buffer = makeImpulse(this.context, source.materialId, source.audioSeed);
    const tailGain = this.context.createGain();
    tailGain.gain.value = proximity * 0.12;
    const tailPan = this.context.createStereoPanner();
    tailPan.pan.value = clamp(pan * 0.4, -0.7, 0.7);
    voice.connect(convolver);
    convolver.connect(tailGain);
    tailGain.connect(tailPan);
    tailPan.connect(bus);

    voice.start(now);
    this.sourceVoices.add(voice);
    voice.onended = () => {
      this.sourceVoices.delete(voice);
      setTimeout(() => {
        bus.gain.setTargetAtTime(0, this.context.currentTime, 0.025);
        setTimeout(() => {
          bus.disconnect();
          this.voiceBuses.delete(bus);
        }, 150);
      }, (duration + source.echoMs / 1000 + 0.48) * 1000);
    };

    return { pan, proximity, distance };
  }

  triggerFootstep(seed, pan = 0, intensity = 0.6) {
    if (!this.context) return;
    const now = this.context.currentTime + 0.006;
    const source = this.context.createBufferSource();
    source.buffer = makeNoiseBuffer(this.context, 0.22, seed, 1);
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 290;
    filter.Q.value = 0.6;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(clamp(intensity, 0.1, 1) * 0.32, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    const panner = this.context.createStereoPanner();
    panner.pan.value = clamp(pan, -0.7, 0.7);
    const bus = this.makeVoiceBus();
    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(bus);
    source.start(now);
    source.stop(now + 0.24);
    source.onended = () => {
      setTimeout(() => {
        bus.disconnect();
        this.voiceBuses.delete(bus);
      }, 80);
    };
  }

  getLevels() {
    if (!this.analyser || !this.timeData) {
      return { level: 0, db: -60, left: 0, right: 0, waveform: null };
    }
    this.analyser.getByteTimeDomainData(this.timeData);
    let sumSquares = 0;
    let peak = 0;
    for (let index = 0; index < this.timeData.length; index += 1) {
      const sample = (this.timeData[index] - 128) / 128;
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(sumSquares / this.timeData.length);
    const db = rms > 0.00001 ? 20 * Math.log10(rms) : -60;
    const channelLevels = [this.timeLeft, this.timeRight].map((data, channel) => {
      const analyser = channel === 0 ? this.analyserLeft : this.analyserRight;
      analyser.getByteTimeDomainData(data);
      let channelSquares = 0;
      for (let index = 0; index < data.length; index += 1) {
        const sample = (data[index] - 128) / 128;
        channelSquares += sample * sample;
      }
      return clamp(Math.sqrt(channelSquares / data.length) * 5.5, 0, 1);
    });
    return {
      level: clamp(peak, 0, 1),
      db: clamp(db, -60, 0),
      left: channelLevels[0],
      right: channelLevels[1],
      waveform: this.timeData
    };
  }
}
