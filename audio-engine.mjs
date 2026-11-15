function noiseBuffer(context, seconds, seed, warmth = 1) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let state = seed >>> 0;
  let smoothed = 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const white = (state / 4294967296) * 2 - 1;
    smoothed = smoothed * (0.94 - warmth * 0.06) + white * (0.06 + warmth * 0.06);
    data[index] = smoothed;
  }
  return buffer;
}

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.carrier = null;
    this.harmonic = null;
    this.harmonicGain = null;
    this.toneGain = null;
    this.toneFilter = null;
    this.windGain = null;
    this.staticGain = null;
    this.ready = false;
    this.lastUpdate = 0;
  }

  async ensure() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }

    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error("Web Audio is unavailable");
    const context = new Context();
    this.context = context;

    const master = context.createGain();
    master.gain.value = 0.0001;
    master.connect(context.destination);
    this.master = master;

    const wind = context.createBufferSource();
    wind.buffer = noiseBuffer(context, 3, 0x71af, 0.8);
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 520;
    const windGain = context.createGain();
    windGain.gain.value = 0.025;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();
    this.windGain = windGain;

    const staticNoise = context.createBufferSource();
    staticNoise.buffer = noiseBuffer(context, 1.4, 0x9c42, 0.1);
    staticNoise.loop = true;
    const staticFilter = context.createBiquadFilter();
    staticFilter.type = "highpass";
    staticFilter.frequency.value = 1280;
    const staticGain = context.createGain();
    staticGain.gain.value = 0.0001;
    staticNoise.connect(staticFilter).connect(staticGain).connect(master);
    staticNoise.start();
    this.staticGain = staticGain;

    const carrier = context.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = 482;
    const harmonic = context.createOscillator();
    harmonic.type = "triangle";
    harmonic.frequency.value = 964;
    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.18;
    const toneFilter = context.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = 1800;
    const toneGain = context.createGain();
    toneGain.gain.value = 0.0001;
    carrier.connect(toneFilter);
    harmonic.connect(harmonicGain).connect(toneFilter);
    toneFilter.connect(toneGain).connect(master);
    carrier.start();
    harmonic.start();

    this.carrier = carrier;
    this.harmonic = harmonic;
    this.harmonicGain = harmonicGain;
    this.toneFilter = toneFilter;
    this.toneGain = toneGain;
    this.ready = true;
    await context.resume();
    master.gain.setTargetAtTime(0.16, context.currentTime, 0.08);
  }

  async enable() {
    await this.ensure();
    if (this.context.state === "suspended") await this.context.resume();
    this.master.gain.setTargetAtTime(0.16, this.context.currentTime, 0.08);
  }

  update({ running, frequency, strength, bursting, whiteout, unstable, paused }) {
    if (!this.ready) return;
    const now = this.context.currentTime;
    if (now - this.lastUpdate < 0.025) return;
    this.lastUpdate = now;
    const audible = running && !paused;
    const toneLevel = bursting && audible
      ? 0.13 * Math.min(1, Math.max(0, strength / 100)) * (1 - whiteout * 0.88)
      : 0.0001;
    const staticLevel = audible ? whiteout * 0.03 + (unstable ? 0.008 : 0) : 0.0001;
    const windLevel = audible ? 0.018 + whiteout * 0.048 : 0.0001;

    this.master.gain.setTargetAtTime(audible ? 0.17 : 0.0001, now, 0.05);
    this.carrier.frequency.setTargetAtTime(frequency, now, 0.022);
    this.harmonic.frequency.setTargetAtTime(frequency * 2.004, now, 0.022);
    this.harmonicGain.gain.setTargetAtTime(unstable ? 0.07 : 0.2, now, 0.04);
    this.toneGain.gain.setTargetAtTime(toneLevel, now, audible ? 0.035 : 0.01);
    this.staticGain.gain.setTargetAtTime(staticLevel, now, 0.04);
    this.windGain.gain.setTargetAtTime(windLevel, now, 0.16);
    this.toneFilter.frequency.setTargetAtTime(
      Math.min(2400, Math.max(900, frequency * 2.2 + strength * 3)),
      now,
      0.08
    );
  }

  async replayBurst(carrierHz, seed) {
    await this.ensure();
    const context = this.context;
    const now = context.currentTime + 0.025;
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const oscillator = context.createOscillator();
    const crackle = context.createBufferSource();
    const crackleGain = context.createGain();
    const crackleFilter = context.createBiquadFilter();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(carrierHz, now);
    filter.type = "bandpass";
    filter.frequency.value = carrierHz * 1.1;
    filter.Q.value = 3.2;
    gain.gain.setValueAtTime(0.0001, now);

    const pulses = [
      [0.05, 0.22],
      [0.34, 0.22],
      [0.63, 0.24],
      [0.95, 0.34]
    ];
    for (const [offset, length] of pulses) {
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(0.075, now + offset + 0.015);
      gain.gain.setValueAtTime(0.075, now + offset + length - 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, now + offset + length);
    }

    crackle.buffer = noiseBuffer(context, 1.45, seed ^ 0x5a17, 0.1);
    crackleFilter.type = "highpass";
    crackleFilter.frequency.value = 2100;
    crackleGain.gain.value = 0.018;
    oscillator.connect(filter).connect(gain).connect(context.destination);
    crackle.connect(crackleFilter).connect(crackleGain).connect(context.destination);
    oscillator.start(now);
    crackle.start(now);
    oscillator.stop(now + 1.42);
    crackle.stop(now + 1.42);
  }
}
