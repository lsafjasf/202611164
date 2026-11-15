/* Web Audio 实时合成：所有声音均由程序生成，无外部音频资源；同 seed 缓冲与调度一致。 */
(function (root) {
  "use strict";
  const E = root.CaseEngine;

  function AudioEngine(caseData) {
    this.caseData = caseData;
    this.ctx = null;
    this.analyser = null;
    this.master = null;
    this.chains = [];
    this.rng = E.mulberry32(caseData.seed + ":audio");
    this.noiseBuffer = null;
    this.positionIndex = 0;
    this.virtualTime = 0;
    this.absoluteTime = 0;
    this.firedUntil = 0;
    this.running = false;
    this.lastWallMs = 0;
    this.passageEvents = caseData.passages.map(function (p) {
      return caseData.events.filter(function (ev) { return ev.source === p.index; });
    });
    this.tickHandle = null;
    this.recorder = null;
    this.playbackNodes = [];
  }

  AudioEngine.prototype._find = function (list, id) {
    return list.filter(function (x) { return x.id === id; })[0];
  };

  AudioEngine.prototype.init = function () {
    if (this.ctx) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.noiseBuffer = this._makeNoiseBuffer(2);
    this._buildChains();
    this.applyPosition(0);
  };

  AudioEngine.prototype._makeNoiseBuffer = function (seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = this.rng() * 2 - 1;
    return buf;
  };

  AudioEngine.prototype._reverbIR = function (wall) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * (wall.rt60 + 0.15));
    const ir = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const decay = Math.pow(1 - t, 2.2) * (0.35 + wall.damp * 0.65);
        d[i] = (this.rng() * 2 - 1) * decay;
      }
    }
    return ir;
  };

  AudioEngine.prototype._buildChains = function () {
    const self = this;
    this.caseData.passages.forEach(function (p) {
      const ctx = self.ctx;
      const wall = self._find(E.WALLS, p.wall);
      const door = self._find(E.DOORS, p.door);
      const pre = ctx.createGain();
      pre.gain.value = 0.9;
      const dry = ctx.createGain();
      dry.gain.value = 1;
      const wet = ctx.createGain();
      wet.gain.value = wall.rt60;
      const conv = ctx.createConvolver();
      conv.buffer = self._reverbIR(wall);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = door.lowpass;
      lp.Q.value = 0.6;
      const doorGain = ctx.createGain();
      doorGain.gain.value = door.gain;
      const posDelay = ctx.createDelay(0.5);
      posDelay.delayTime.value = 0.05;
      const posGain = ctx.createGain();
      posGain.gain.value = 0.5;
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      pre.connect(dry);
      pre.connect(conv);
      conv.connect(wet);
      dry.connect(lp);
      wet.connect(lp);
      lp.connect(doorGain);
      doorGain.connect(posDelay);
      posDelay.connect(posGain);
      posGain.connect(panner);
      panner.connect(self.master);
      self.chains.push({
        passage: p.index, input: pre, wall: wall, door: door,
        posDelay: posDelay, posGain: posGain, panner: panner
      });
    });
  };

  AudioEngine.prototype.applyPosition = function (positionIndex) {
    this.positionIndex = positionIndex;
    const geo = E.POSITIONS[positionIndex].geometry;
    this.chains.forEach(function (chain, i) {
      chain.posGain.gain.value = geo[i].gain;
      chain.posDelay.delayTime.value = geo[i].delay;
      if (chain.panner.pan) chain.panner.pan.value = geo[i].pan;
    });
  };

  root.AudioEngine = AudioEngine;

  AudioEngine.prototype.nowVirtual = function () { return this.virtualTime; };

  AudioEngine.prototype.start = function () {
    this.init();
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (this.running) return;
    this.running = true;
    this.lastWallMs = performance.now();
    this._resumeRecording();
    this._loop();
  };

  AudioEngine.prototype.pause = function () {
    this.running = false;
    if (this.tickHandle) clearTimeout(this.tickHandle);
    if (this.ctx) this.ctx.suspend();
    if (this.recorder && this.recorder.active) this._pauseRecording();
  };

  AudioEngine.prototype.replay = function () {
    this.virtualTime = 0;
    this.absoluteTime = 0;
    this.firedUntil = 0;
    this.stopPlayback();
    if (this.recorder && this.recorder.active) this._discardRecording();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    this.running = true;
    this.lastWallMs = performance.now();
    this._loop();
  };

  AudioEngine.prototype.destroy = function () {
    this.running = false;
    if (this.tickHandle) clearTimeout(this.tickHandle);
    this.stopPlayback();
    if (this.recorder) this._discardRecording();
    if (this.ctx && this.ctx.close) this.ctx.close();
  };

  AudioEngine.prototype._loop = function () {
    if (!this.running) return;
    const wall = performance.now();
    const dt = Math.min(0.1, (wall - this.lastWallMs) / 1000);
    this.lastWallMs = wall;
    this.absoluteTime += dt;
    this.virtualTime = this.absoluteTime % this.caseData.loopSeconds;
    this._schedule();
    this.tickHandle = setTimeout(this._loop.bind(this), 40);
  };

  AudioEngine.prototype._chainFor = function (passageIndex) {
    return this.chains.filter(function (c) { return c.passage === passageIndex; })[0];
  };

  AudioEngine.prototype._schedule = function () {
    const self = this;
    const horizon = this.absoluteTime + 0.25;
    const loop = this.caseData.loopSeconds;
    this.caseData.passages.forEach(function (passage) {
      const events = self.passageEvents[passage.index];
      events.forEach(function (ev) {
        let slot = Math.floor(self.firedUntil / loop) * loop + ev.time;
        if (slot <= self.firedUntil) slot += loop;
        if (slot > self.firedUntil && slot <= horizon) {
          self._trigger(passage.index, ev.kind);
        }
      });
    });
    this.firedUntil = horizon;
  };

  AudioEngine.prototype._trigger = function (passageIndex, kind) {
    if (kind === "steps") this._voiceSteps(passageIndex);
    if (kind === "drip") this._voiceDrip(passageIndex);
    if (kind === "hum") this._voiceHum(passageIndex);
  };

  AudioEngine.prototype._voiceSteps = function (pi) {
    const ctx = this.ctx, chain = this._chainFor(pi), t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + this.rng() * 0.25;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + this.rng() * 900;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(bp); bp.connect(g); g.connect(chain.input);
    src.start(t); src.stop(t + 0.2);
  };

  AudioEngine.prototype._voiceDrip = function (pi) {
    const ctx = this.ctx, chain = this._chainFor(pi), t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const f0 = 2400 + this.rng() * 2200;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g); g.connect(chain.input);
    osc.start(t); osc.stop(t + 0.25);
  };

  AudioEngine.prototype._voiceHum = function (pi) {
    const ctx = this.ctx, chain = this._chainFor(pi), t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 90 + this.rng() * 50;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.5);
    g.gain.setValueAtTime(0.3, t + 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    osc.connect(lp); lp.connect(g); g.connect(chain.input);
    osc.start(t); osc.stop(t + 2.5);
  };

  AudioEngine.prototype.getSpectrum = function (fftSize) {
    if (!this.analyser) return new Float32Array((fftSize || 2048) / 2);
    const arr = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(arr);
    return Float32Array.from(arr, function (v) { return v / 255; });
  };

  AudioEngine.prototype.startRecording = function (slotLabel) {
    this.init();
    if (this.recorder && this.recorder.active) return null;
    const self = this;
    const rate = this.ctx.sampleRate;
    const max = this.caseData.maxRecordSeconds;
    const processor = this.ctx.createScriptProcessor(4096, 2, 2);
    const left = [], right = [];
    const startVirtual = this.virtualTime;
    let collected = 0;
    const rec = {
      active: true, paused: false, label: slotLabel,
      start: startVirtual, positionIndex: this.positionIndex,
      positionLabel: E.POSITIONS[this.positionIndex].label,
      stop: null, processor: processor
    };
    processor.onaudioprocess = function (e) {
      if (!rec.active || rec.paused) return;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.getChannelData(1);
      left.push(inL.slice()); right.push(inR.slice());
      collected += inL.length;
      e.outputBuffer.getChannelData(0).fill(0);
      e.outputBuffer.getChannelData(1).fill(0);
      if (collected >= rate * max) self.stopRecording();
    };
    this.master.connect(processor);
    processor.connect(this.ctx.destination);
    this.recorder = rec;
    this._recChunks = { left: left, right: right, rate: rate, max: max };
    return rec;
  };

  AudioEngine.prototype._pauseRecording = function () {
    if (this.recorder) this.recorder.paused = true;
  };

  AudioEngine.prototype._resumeRecording = function () {
    if (this.recorder && this.recorder.active) this.recorder.paused = false;
  };

  AudioEngine.prototype._discardRecording = function () {
    if (!this.recorder) return;
    this.recorder.active = false;
    try { this.master.disconnect(this.recorder.processor); } catch (err) {}
    this.recorder.processor.disconnect();
    this.recorder = null;
    this._recChunks = null;
  };

  AudioEngine.prototype.stopRecording = function () {
    if (!this.recorder || !this.recorder.active) return null;
    const rec = this.recorder;
    const chunks = this._recChunks;
    rec.active = false;
    try { this.master.disconnect(rec.processor); } catch (err) {}
    rec.processor.disconnect();
    const total = chunks.left.reduce(function (n, c) { return n + c.length; }, 0);
    const buffer = this.ctx.createBuffer(2, total, chunks.rate);
    const dl = buffer.getChannelData(0), dr = buffer.getChannelData(1);
    let off = 0;
    chunks.left.forEach(function (c) { dl.set(c, off); off += c.length; });
    off = 0;
    chunks.right.forEach(function (c) { dr.set(c, off); off += c.length; });
    rec.stop = this.virtualTime;
    this.recorder = null;
    this._recChunks = null;
    return {
      label: rec.label, start: rec.start, stop: rec.stop,
      positionIndex: rec.positionIndex, positionLabel: rec.positionLabel,
      buffer: buffer
    };
  };

  AudioEngine.prototype.playBuffer = function (audioBuffer, onEnded) {
    this.init();
    this.stopPlayback();
    const src = this.ctx.createBufferSource();
    src.buffer = audioBuffer;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    src.connect(g);
    g.connect(this.master);
    src.onended = function () {
      if (onEnded) onEnded();
    };
    src.start();
    this.playbackNodes = [src, g];
  };

  AudioEngine.prototype.stopPlayback = function () {
    this.playbackNodes.forEach(function (node) {
      try { node.stop && node.stop(); } catch (err) {}
      try { node.disconnect(); } catch (err2) {}
    });
    this.playbackNodes = [];
  };
})(typeof self !== "undefined" ? self : globalThis);
