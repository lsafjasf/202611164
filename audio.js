import {
  BAND,
  bearingResponse,
  cyclePosition,
  isSourceActive,
  receiverTelemetry,
  tuningResponse,
} from "./engine.js";

const DISPLAY_MAX_HZ = 16000;

function seededNoise(length, seed) {
  const buffer = new Float32Array(length);
  let state = (seed || 1) >>> 0;
  let smooth = 0;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const white = ((state >>> 0) / 4294967296) * 2 - 1;
    smooth = smooth * 0.84 + white * 0.16;
    buffer[index] = white * 0.38 + smooth * 1.9;
  }
  return buffer;
}

function clipperCurve(amount = 2.4, samples = 4096) {
  const curve = new Float32Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

function toneForFrequency(frequency) {
  const normalized = (frequency - BAND.start) / (BAND.end - BAND.start);
  return 760 + normalized * 13740;
}

function sourcePulse(source, elapsed) {
  const local = cyclePosition(elapsed) - source.start;
  if (local < 0 || local > source.duration) return 0;
  const frame = Math.floor(local / 0.29) % source.pattern.length;
  return source.pattern[frame] ? 1 : 0.045;
}

export class ReceiverAudio {
  constructor() {
    this.context = null;
    this.caseData = null;
    this.sourceNodes = [];
    this.analyser = null;
    this.outputAnalyser = null;
    this.frequencyData = null;
    this.created = false;
  }

  async ensureContext() {
    if (this.context) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
    this.context = new AudioContextClass();

    this.outputBus = this.context.createGain();
    this.outputBus.gain.value = 0.52;
    this.masterDrive = this.context.createGain();
    this.masterDrive.gain.value = 0.82;
    this.masterShaper = this.context.createWaveShaper();
    this.masterShaper.curve = clipperCurve(2.25);
    this.masterShaper.oversample = "2x";
    this.outputAnalyser = this.context.createAnalyser();
    this.outputAnalyser.fftSize = 1024;
    this.outputAnalyser.smoothingTimeConstant = 0.72;
    this.outputBus.connect(this.masterDrive);
    this.masterDrive.connect(this.masterShaper);
    this.masterShaper.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.context.destination);

    this.visualBus = this.context.createGain();
    this.visualBus.gain.value = 0.72;
    this.visualDrive = this.context.createGain();
    this.visualDrive.gain.value = 1.05;
    this.visualShaper = this.context.createWaveShaper();
    this.visualShaper.curve = clipperCurve(2.25);
    this.visualAnalyser = this.context.createAnalyser();
    this.visualAnalyser.fftSize = 2048;
    this.visualAnalyser.smoothingTimeConstant = 0.78;
    this.visualBus.connect(this.visualDrive);
    this.visualDrive.connect(this.visualShaper);
    this.visualShaper.connect(this.visualAnalyser);
    this.frequencyData = new Float32Array(this.visualAnalyser.frequencyBinCount);
    this.timeData = new Float32Array(this.outputAnalyser.fftSize);

    this.noiseFilter = this.context.createBiquadFilter();
    this.noiseFilter.type = "lowpass";
    this.noiseFilter.frequency.value = 2600;
    this.noiseFilter.Q.value = 0.45;
    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = 0.02;
    this.noiseVisualGain = this.context.createGain();
    this.noiseVisualGain.gain.value = 0.055;
    this.noiseFilter.connect(this.noiseGain);
    this.noiseFilter.connect(this.noiseVisualGain);
    this.noiseGain.connect(this.outputBus);
    this.noiseVisualGain.connect(this.visualBus);
    this.created = true;
  }

  async start(caseData) {
    await this.ensureContext();
    if (!this.caseData || this.caseData.seed !== caseData.seed) {
      this.setCase(caseData);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  async pause() {
    if (this.context?.state === "running") await this.context.suspend();
  }

  async resume() {
    if (this.context?.state === "suspended") await this.context.resume();
  }

  setCase(caseData) {
    if (!this.created) return;
    this.disposeSources();
    this.caseData = caseData;
    this.createNoise(caseData);
    this.sourceNodes = caseData.sources.map((source) => this.createSourceNode(source));
  }

  createNoise(caseData) {
    if (this.noiseSource) {
      this.noiseSource.stop();
      this.noiseSource.disconnect();
    }
    const seconds = 5;
    const buffer = this.context.createBuffer(
      1,
      this.context.sampleRate * seconds,
      this.context.sampleRate,
    );
    buffer.copyToChannel(seededNoise(buffer.length, caseData.hash), 0);
    this.noiseSource = this.context.createBufferSource();
    this.noiseSource.buffer = buffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseFilter);
    this.noiseSource.start();
  }

  createSourceNode(source) {
    const mix = this.context.createGain();
    mix.gain.value = source.role === "decoy" ? 0.46 : 0.55;
    const pulse = this.context.createGain();
    pulse.gain.value = 0;
    const visualGain = this.context.createGain();
    visualGain.gain.value = 0;
    const audioGain = this.context.createGain();
    audioGain.gain.value = 0;
    const oscillators = [];
    const carrierTone = toneForFrequency(source.frequency);
    const carrier = this.context.createOscillator();
    carrier.type = source.role === "decoy" ? "triangle" : "sine";
    carrier.frequency.value = carrierTone;
    carrier.connect(mix);
    oscillators.push(carrier);

    if (source.role === "decoy") {
      for (const offset of [-760, 760]) {
        const sideband = this.context.createOscillator();
        sideband.type = "sine";
        sideband.frequency.value = carrierTone + offset;
        sideband.connect(mix);
        oscillators.push(sideband);
      }
      const hum = this.context.createOscillator();
      hum.type = "square";
      hum.frequency.value = 56;
      const humGain = this.context.createGain();
      humGain.gain.value = 0.018;
      hum.connect(humGain);
      humGain.connect(mix);
      oscillators.push(hum);
    }

    mix.connect(pulse);
    pulse.connect(visualGain);
    pulse.connect(audioGain);
    visualGain.connect(this.visualBus);
    audioGain.connect(this.outputBus);
    oscillators.forEach((oscillator) => oscillator.start());

    return { source, pulse, visualGain, audioGain, oscillators };
  }

  disposeSources() {
    for (const node of this.sourceNodes) {
      for (const oscillator of node.oscillators) {
        try {
          oscillator.stop();
        } catch {
          // The oscillator may already be stopped during a case reset.
        }
        oscillator.disconnect();
      }
      node.pulse.disconnect();
      node.visualGain.disconnect();
      node.audioGain.disconnect();
    }
    this.sourceNodes = [];
  }

  setMuted(muted) {
    if (!this.created) return;
    this.outputBus.gain.setTargetAtTime(muted ? 0 : 0.52, this.context.currentTime, 0.02);
  }

  update({ caseData, elapsed, receiver, running }) {
    if (!this.created || !this.caseData) return;
    const now = this.context.currentTime;
    const gain = Math.max(0, Math.min(100, Number(receiver.gain) || 0));
    const gainCurve = gain < 18
      ? Math.max(0, (gain - 4) / 14)
      : gain > 76
        ? Math.max(0.16, 1 - (gain - 76) / 34)
        : 1;

    for (const node of this.sourceNodes) {
      const { source } = node;
      const active = isSourceActive(source, elapsed);
      const pulse = active ? sourcePulse(source, elapsed) : 0;
      const tuning = tuningResponse(source, receiver.frequency);
      const direction = bearingResponse(source, receiver.bearing);
      const audioAmplitude = active
        ? pulse * tuning * direction * gainCurve * (source.role === "decoy" ? 0.105 : 0.095)
        : 0;
      const visualAmplitude = active
        ? Math.max(0.025, pulse) * (
          source.role === "decoy"
            ? 0.19
            : 0.035 + direction * 0.29
        )
        : 0;
      node.audioGain.gain.setTargetAtTime(audioAmplitude, now, 0.018);
      node.visualGain.gain.setTargetAtTime(visualAmplitude, now, 0.024);
      node.pulse.gain.setTargetAtTime(0.58 + pulse * 0.42, now, 0.028);
    }

    const ambience = running ? 0.011 + gain * 0.00009 : 0;
    this.noiseGain.gain.setTargetAtTime(ambience, now, 0.06);
    this.noiseVisualGain.gain.setTargetAtTime(0.026 + gain * 0.00062, now, 0.06);
    this.masterDrive.gain.setTargetAtTime(0.54 + gain * 0.0082, now, 0.055);
    this.visualDrive.gain.setTargetAtTime(0.86 + gain * 0.0185, now, 0.055);
  }

  getSpectrum() {
    if (!this.created) return null;
    this.visualAnalyser.getFloatFrequencyData(this.frequencyData);
    return this.frequencyData;
  }

  getAnalysis() {
    if (!this.created) return null;
    this.outputAnalyser.getFloatTimeDomainData(this.timeData);
    let peak = 0;
    let clippedSamples = 0;
    for (const value of this.timeData) {
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
      if (magnitude > 0.86) clippedSamples += 1;
    }
    return {
      peak,
      clipRatio: clippedSamples / this.timeData.length,
      binHz: this.context.sampleRate / this.visualAnalyser.fftSize,
      maxDisplayHz: DISPLAY_MAX_HZ,
    };
  }

  sectionTelemetry(caseData, receiver, elapsed) {
    return receiverTelemetry(caseData, receiver, elapsed);
  }
}
