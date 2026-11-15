// 零依赖 Web Audio mock：currentTime 可手动推进，记录全部节点的创建与停止。

export class MockNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.connected = [];
    this.stopped = false;
    this.disconnected = false;
    this.onended = null;
    this._params = {};
  }

 connect(target) {
    this.connected.push(target);
    return target;
  }

  disconnect() {
    this.disconnected = true;
    this.connected = [];
  }

  start(when) { this.startedAt = when; }

  stop(when) {
    if (this.stopped) return;
    this.stopped = true;
    this.stoppedAt = when;
    if (this.onended) this.onended();
  }

  param(name, initial = 0) {
    if (!this._params[name]) {
      this._params[name] = {
        value: initial,
        setValueAtTime(v) { this.value = v; },
        exponentialRampToValueAtTime(v) { this.value = v; },
        linearRampToValueAtTime(v) { this.value = v; },
      };
    }
    return this._params[name];
  }
}

export class MockAudioParam {
  constructor(value) { this.value = value; }
  setValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
}

export class MockScheduledNode extends MockNode {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.gain = new MockAudioParam(1);
    this.frequency = new MockAudioParam(440);
    this.pan = new MockAudioParam(0);
    this.Q = new MockAudioParam(1);
    this.type = '';
  }
}

export class MockBuffer {
  constructor(channels, length) {
    this.numberOfChannels = channels;
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(ch) { return this._data[ch]; }
}

export class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new MockNode(this, 'destination');
    this.created = [];
  }

  _track(node) { this.created.push(node); return node; }
  createGain() { return this._track(new MockScheduledNode(this, 'gain')); }
  createOscillator() {
    const node = new MockScheduledNode(this, 'oscillator');
    node.frequency = new MockAudioParam(440);
    return this._track(node);
  }
  createBiquadFilter() { return this._track(new MockScheduledNode(this, 'filter')); }
  createStereoPanner() { return this._track(new MockScheduledNode(this, 'panner')); }
  createBufferSource() {
    const node = new MockScheduledNode(this, 'buffer-source');
    node.buffer = null;
    return this._track(node);
  }
  createBuffer(channels, length) { return new MockBuffer(channels, length); }

  advance(seconds) { this.currentTime += seconds; }

  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
}

export class MockOfflineContext extends MockAudioContext {
  constructor(channels, length, sampleRate) {
    super();
    this.channels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  async startRendering() {
    this.currentTime = this.length / this.sampleRate;
    return new MockBuffer(this.channels, this.length);
  }
}

export class ManualClock {
  constructor(ctx) {
    this.ctx = ctx;
    this.intervals = new Map();
    this.nextId = 1;
  }

  now() { return this.ctx.currentTime; }
  setInterval(fn, ms) {
    const id = this.nextId++;
    this.intervals.set(id, { fn, ms });
    return id;
  }
  clearInterval(id) { this.intervals.delete(id); }

  // 测试环境立即完成，不依赖真实墙钟时间。
  setTimeout(fn) {
    fn();
    return this.nextId++;
  }

  clearTimeout() { /* 立即执行后无需清理 */ }

  // 推进时间并触发落在区间内的轮询（音频时钟挂起时不推进）。
  runFor(seconds, tickMs = 25) {
    const steps = Math.round((seconds * 1000) / tickMs);
    for (let i = 0; i < steps; i += 1) {
      if (this.ctx.state !== 'suspended') this.ctx.advance(tickMs / 1000);
      for (const entry of this.intervals.values()) entry.fn();
    }
  }
}
