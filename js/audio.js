(function (root) {
  "use strict";

  function seededRandom(seed) {
    let state = (Number(seed) || 1) >>> 0;
    return function random() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 4294967296);
    };
  }

  function EchoAudio() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.ambientBus = null;
    this.ambientNodes = [];
    this.muted = false;
    this.activeCase = null;
  }

  EchoAudio.prototype.ensure = async function ensure() {
    if (!this.context) {
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Web Audio is not available in this browser.");
      }
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.82;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.24;
      this.ambientBus = this.context.createGain();
      this.ambientBus.gain.value = 0.78;
      this.ambientBus.connect(this.compressor);
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  };

  EchoAudio.prototype._noiseBuffer = function _noiseBuffer(seed, seconds) {
    const ctx = this.context;
    const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    const random = seededRandom(seed);
    for (let i = 0; i < length; i += 1) {
      channel[i] = random() * 2 - 1;
    }
    return buffer;
  };

  EchoAudio.prototype._noiseSource = function _noiseSource(seed, seconds) {
    const source = this.context.createBufferSource();
    source.buffer = this._noiseBuffer(seed, seconds);
    return source;
  };

  EchoAudio.prototype.begin = async function begin(caseData) {
    await this.ensure();
    this.stopAmbient();
    this.activeCase = caseData;
    const ctx = this.context;
    const now = ctx.currentTime;
    const ambient = [];
    const firstMachine = caseData.junctions[0].machine;

    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.05;
    const roomPan = ctx.createStereoPanner();
    roomPan.pan.value = firstMachine.pan * 0.45;
    const roomFilter = ctx.createBiquadFilter();
    roomFilter.type = "lowpass";
    roomFilter.frequency.value = 185;
    roomFilter.Q.value = 0.8;
    roomGain.connect(roomFilter);
    roomFilter.connect(roomPan);
    roomPan.connect(this.ambientBus);
    ambient.push(roomGain, roomFilter, roomPan);

    [43, 86.5].forEach(function (frequency, index) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index === 0 ? -5 : 8;
      gain.gain.value = index === 0 ? 0.024 : 0.007;
      oscillator.connect(gain);
      gain.connect(roomGain);
      oscillator.start(now);
      ambient.push(oscillator, gain);
    });

    const machineTone = ctx.createOscillator();
    const machineGain = ctx.createGain();
    const machineFilter = ctx.createBiquadFilter();
    const machinePan = ctx.createStereoPanner();
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    machineTone.type = "sawtooth";
    machineTone.frequency.value = firstMachine.bandHz * 0.47;
    machineGain.gain.value = 0.004;
    machineFilter.type = "lowpass";
    machineFilter.frequency.value = 260;
    machinePan.pan.value = firstMachine.pan;
    lfo.frequency.value = 0.19;
    lfoDepth.gain.value = 0.0025;
    machineTone.connect(machineFilter);
    machineFilter.connect(machineGain);
    machineGain.connect(machinePan);
    machinePan.connect(this.ambientBus);
    lfo.connect(lfoDepth);
    lfoDepth.connect(machineGain.gain);
    machineTone.start(now);
    lfo.start(now);
    ambient.push(machineTone, machineGain, machineFilter, machinePan, lfo, lfoDepth);

    const air = this._noiseSource(caseData.seed.length * 9173 + 31, 2.8);
    const airFilter = ctx.createBiquadFilter();
    const airGain = ctx.createGain();
    air.loop = true;
    airFilter.type = "bandpass";
    airFilter.frequency.value = 620;
    airFilter.Q.value = 0.35;
    airGain.gain.value = 0.006;
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(this.ambientBus);
    air.start(now);
    ambient.push(air, airFilter, airGain);

    this.ambientNodes = ambient;
    return ctx;
  };

  EchoAudio.prototype.stopAmbient = function stopAmbient() {
    this.ambientNodes.forEach(function (node) {
      try {
        if (typeof node.stop === "function") node.stop();
        node.disconnect();
      } catch (error) {
        // Nodes that have already ended can be safely ignored.
      }
    });
    this.ambientNodes = [];
  };

  EchoAudio.prototype.stop = function stop() {
    this.stopAmbient();
    this.activeCase = null;
  };

  EchoAudio.prototype.setMuted = function setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.82, this.context.currentTime, 0.03);
    }
    return this.muted;
  };

  EchoAudio.prototype.pause = async function pause() {
    if (this.context && this.context.state === "running") {
      await this.context.suspend();
    }
  };

  EchoAudio.prototype.resume = async function resume() {
    if (this.context && this.context.state === "suspended") {
      await this.context.resume();
    }
  };

  EchoAudio.prototype._knock = function _knock(when, pan) {
    const ctx = this.context;
    const output = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan || 0;
    output.gain.setValueAtTime(0.0001, when);
    output.gain.exponentialRampToValueAtTime(0.34, when + 0.008);
    output.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);
    output.connect(panner);
    panner.connect(this.master);

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(112, when);
    thump.frequency.exponentialRampToValueAtTime(48, when + 0.19);
    thumpGain.gain.setValueAtTime(0.8, when);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, when + 0.24);
    thump.connect(thumpGain);
    thumpGain.connect(output);
    thump.start(when);
    thump.stop(when + 0.26);

    const grit = this._noiseSource(44291, 0.22);
    const gritFilter = ctx.createBiquadFilter();
    const gritGain = ctx.createGain();
    gritFilter.type = "bandpass";
    gritFilter.frequency.setValueAtTime(1180, when);
    gritFilter.Q.value = 1.1;
    gritGain.gain.setValueAtTime(0.42, when);
    gritGain.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
    grit.connect(gritFilter);
    gritFilter.connect(gritGain);
    gritGain.connect(output);
    grit.start(when);
  };

  EchoAudio.prototype._playEcho = function _playEcho(clue, when) {
    const ctx = this.context;
    const duration = Math.max(0.14, clue.decayMs / 1000);
    const level = 0.025 + clue.strength * 0.19;
    const output = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const filter = ctx.createBiquadFilter();
    const resonance = ctx.createOscillator();
    const resonanceGain = ctx.createGain();

    panner.pan.setValueAtTime(clue.pan, when);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(clue.bandHz, when);
    filter.Q.value = 2.2 + (1 - clue.humidity) * 1.8;
    output.gain.setValueAtTime(0.0001, when);
    output.gain.exponentialRampToValueAtTime(level, when + 0.014);
    output.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * 0.2), when + duration * 0.46);
    output.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    filter.connect(output);
    output.connect(panner);
    panner.connect(this.master);

    const noise = this._noiseSource(clue.noiseSeed, duration);
    noise.connect(filter);
    noise.start(when);
    noise.stop(when + duration);

    resonance.type = "sine";
    resonance.frequency.setValueAtTime(clue.bandHz * 0.74, when);
    resonance.frequency.exponentialRampToValueAtTime(clue.bandHz * 0.69, when + duration);
    resonanceGain.gain.setValueAtTime(level * 0.32, when);
    resonanceGain.gain.exponentialRampToValueAtTime(0.0001, when + duration * 0.82);
    resonance.connect(resonanceGain);
    resonanceGain.connect(filter);
    resonance.start(when);
    resonance.stop(when + duration);

    if (duration > 0.5) {
      const tail = ctx.createGain();
      const tailPan = ctx.createStereoPanner();
      const tailFilter = ctx.createBiquadFilter();
      const tailNoise = this._noiseSource(clue.noiseSeed + 71, duration * 0.48);
      tailPan.pan.setValueAtTime(clue.pan * 0.72, when);
      tailFilter.type = "bandpass";
      tailFilter.frequency.value = Math.max(180, clue.bandHz * 0.76);
      tailFilter.Q.value = 1.4;
      tail.gain.setValueAtTime(0.0001, when + duration * 0.28);
      tail.gain.exponentialRampToValueAtTime(level * 0.23, when + duration * 0.42);
      tail.gain.exponentialRampToValueAtTime(0.0001, when + duration * 0.82);
      tailNoise.connect(tailFilter);
      tailFilter.connect(tail);
      tail.connect(tailPan);
      tailPan.connect(this.master);
      tailNoise.start(when + duration * 0.28);
    }
  };

  EchoAudio.prototype._machineMask = function _machineMask(mask, when) {
    if (!mask) return;
    const ctx = this.context;
    const duration = mask.durationMs / 1000;
    const output = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const lowpass = ctx.createBiquadFilter();
    const motor = ctx.createOscillator();
    const motorGain = ctx.createGain();
    const hiss = this._noiseSource(mask.bandHz * 97 + mask.durationMs, duration);
    const hissFilter = ctx.createBiquadFilter();
    const hissGain = ctx.createGain();
    const clang = ctx.createOscillator();
    const clangGain = ctx.createGain();

    output.gain.setValueAtTime(0.0001, when);
    output.gain.exponentialRampToValueAtTime(mask.gain, when + 0.08);
    output.gain.setValueAtTime(mask.gain, when + duration * 0.62);
    output.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    panner.pan.setValueAtTime(mask.pan, when);
    lowpass.type = "lowpass";
    lowpass.frequency.value = mask.bandHz * 4.2;
    lowpass.Q.value = 0.9;
    output.connect(lowpass);
    lowpass.connect(panner);
    panner.connect(this.master);

    motor.type = "sawtooth";
    motor.frequency.setValueAtTime(mask.bandHz * 0.43, when);
    motor.frequency.linearRampToValueAtTime(mask.bandHz * 0.51, when + duration);
    motorGain.gain.value = 0.5;
    motor.connect(motorGain);
    motorGain.connect(output);
    motor.start(when);
    motor.stop(when + duration);

    hissFilter.type = "bandpass";
    hissFilter.frequency.setValueAtTime(mask.bandHz * 5.4, when);
    hissFilter.frequency.linearRampToValueAtTime(mask.bandHz * 6.1, when + duration);
    hissFilter.Q.value = 0.72;
    hissGain.gain.setValueAtTime(0.14, when);
    hissGain.gain.linearRampToValueAtTime(0.08, when + duration);
    hiss.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(output);
    hiss.start(when);

    clang.type = "triangle";
    clang.frequency.setValueAtTime(mask.bandHz * 2.4, when);
    clang.frequency.exponentialRampToValueAtTime(mask.bandHz * 2.08, when + 0.42);
    clangGain.gain.setValueAtTime(0.19, when);
    clangGain.gain.exponentialRampToValueAtTime(0.001, when + duration * 0.55);
    clang.connect(clangGain);
    clangGain.connect(output);
    clang.start(when);
    clang.stop(when + duration * 0.56);
  };

  EchoAudio.prototype.playProbe = async function playProbe(probe) {
    await this.ensure();
    const ctx = this.context;
    const when = ctx.currentTime + 0.08;
    const mask = probe.clues[0] && probe.clues[0].mask;
    this._knock(when, 0);
    if (mask) {
      this._machineMask(mask, when + mask.startMs / 1000);
    }
    probe.clues.forEach((clue) => {
      this._playEcho(clue, when + clue.delayMs / 1000);
    });
    return Math.max.apply(null, probe.clues.map((clue) => clue.delayMs));
  };

  EchoAudio.prototype.replay = async function replay(probe) {
    if (!probe) throw new Error("No probe is available to replay.");
    return this.playProbe(probe);
  };

  root.EchoAudio = EchoAudio;
})(typeof window !== "undefined" ? window : globalThis);
