import {
  spbFromBpm, beatTime, retuneAnchor, loopPosition, semitoneRatio,
} from './timing.js';

export const TOTAL_BEATS = 48;        // 一段完整示例 = 48 拍
export const LOOP_BEATS = 8;

export function defaultProject() {
  return {
    version: 1,
    bpm: 96,
    speed: 1,
    pitch: 0,               // 全局变调（半音）
    loop: true,
    loopBeats: LOOP_BEATS,
    tracks: {
      beat:  { gain: 0.8, params: { freq: 180, decay: 0.09 } },
      cue:   { gain: 0.9, params: { baseFreq: 440, echoTime: 0.28, echoFb: 0.35 } },
      noise: { gain: 0.6, params: { level: 0 } },
    },
  };
}

// 简单可复现的 PRNG，保证离线渲染两次结果一致
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Engine {
  constructor(project, opts = {}) {
    this.project = project;
    this.offline = !!opts.offline;
    this.ctx = opts.context || null;
    this.master = null;
    this.trackGains = {};
    this.activeNodes = new Set();
    this.visualEvents = [];      // {time, type, data} 供 UI 按音频时钟同步消费
    this.noteCount = 0;
    this.beatPositions = [];
    this.playing = false;
    this.paused = false;
    this.anchor = 0;
    this.nextBeatIndex = 0;
    this.timer = null;
    this.noiseBed = null;
    this._noiseBuf = null;
  }

  get spb() {
    return spbFromBpm(this.project.bpm, this.project.speed);
  }

  ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
  }

  // 建立 master 与每轨增益节点（增益值来自工程参数）
  buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);
    for (const [name, tr] of Object.entries(this.project.tracks)) {
      const g = ctx.createGain();
      g.gain.value = tr.gain;
      g.connect(this.master);
      this.trackGains[name] = g;
    }
  }

  applyTrackGains() {
    if (!this.ctx) return;
    for (const [name, tr] of Object.entries(this.project.tracks)) {
      const g = this.trackGains[name];
      if (g) g.gain.setTargetAtTime(tr.gain, this.ctx.currentTime, 0.02);
    }
  }

  // ---- 走带控制 ----

  start() {
    if (this.playing) return;
    this.ensureContext();
    if (!this.master) this.buildGraph();
    this.ctx.resume();
    this.anchor = this.ctx.currentTime + 0.1;
    this.nextBeatIndex = 0;
    this.beatPositions = [];
    this.playing = true;
    this.paused = false;
    this._startNoiseBed();
    this.timer = setInterval(() => this._tick(), 25);
    this._tick();
  }

  _tick() {
    const horizon = this.ctx.currentTime + 0.15;
    while (true) {
      const pos = this.project.loop
        ? loopPosition(this.nextBeatIndex, this.project.loopBeats)
        : this.nextBeatIndex;
      if (!this.project.loop && this.nextBeatIndex >= TOTAL_BEATS) {
        this.stop();
        return;
      }
      const t = beatTime(this.anchor, this.nextBeatIndex, this.spb);
      if (t >= horizon) break;
      this._scheduleBeat(this.nextBeatIndex, pos, t);
      this.nextBeatIndex += 1;
    }
  }

  // 暂停：冻结 AudioContext 时钟。锚点与拍序号不变，
  // 恢复后节拍位置 = anchor + index*spb，数学上零漂移。
  pause() {
    if (!this.playing || this.paused) return;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.ctx.suspend();
    this.paused = true;
  }

  resume() {
    if (!this.playing || !this.paused) return;
    this.ctx.resume();
    this.paused = false;
    this.timer = setInterval(() => this._tick(), 25);
    this._tick();
  }

  // 停止：停掉并断开所有活动节点，释放资源，位置归零
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const n of this.activeNodes) {
      try { if (n.stop) n.stop(0); } catch (e) { /* 已停止 */ }
      try { n.disconnect(); } catch (e) { /* 已断开 */ }
    }
    this.activeNodes.clear();
    this._stopNoiseBed();
    this.playing = false;
    this.paused = false;
    this.nextBeatIndex = 0;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 变速：重算锚点保持当前拍位置连续，后续拍仍按整数网格推导
  setSpeed(speed) {
    const oldSpb = this.spb;
    this.project.speed = speed;
    if (this.playing && !this.paused) {
      this.anchor = retuneAnchor(this.ctx.currentTime, this.anchor, oldSpb, this.spb);
    }
  }

  setPitch(semis) {
    this.project.pitch = semis;
  }

  setLoop(on) {
    this.project.loop = on;
  }

  setTrackGain(name, gain) {
    this.project.tracks[name].gain = gain;
    this.applyTrackGains();
  }

  // 当前拍位置（含小数），供 UI 同步视觉
  beatPositionNow() {
    if (!this.playing || !this.ctx) return -1;
    return (this.ctx.currentTime - this.anchor) / this.spb;
  }

  nextBeatTime() {
    return beatTime(this.anchor, this.nextBeatIndex, this.spb);
  }

  drainVisualEvents(now) {
    const out = [];
    while (this.visualEvents.length && this.visualEvents[0].time <= now) {
      out.push(this.visualEvents.shift());
    }
    return out;
  }

  _register(node) {
    this.activeNodes.add(node);
    if (node.onended !== undefined) {
      node.onended = () => {
        try { node.disconnect(); } catch (e) { /* 忽略 */ }
        this.activeNodes.delete(node);
      };
    }
    return node;
  }

  // ---- 合成声部（全部 Web Audio 实时合成，无采样） ----

  _scheduleBeat(globalIndex, pos, t) {
    const accent = pos === 0;
    this._click(t, accent);
    this.beatPositions.push(t);
    this.visualEvents.push({ time: t, type: 'beat', data: { pos, globalIndex } });
  }

  _click(t, accent) {
    const ctx = this.ctx;
    const p = this.project.tracks.beat.params;
    const osc = this._register(ctx.createOscillator());
    const env = this._register(ctx.createGain());
    osc.type = 'square';
    osc.frequency.value = accent ? p.freq * 2 : p.freq;
    env.gain.setValueAtTime(accent ? 0.9 : 0.5, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + p.decay);
    osc.connect(env).connect(this.trackGains.beat);
    osc.start(t);
    osc.stop(t + p.decay + 0.02);
    this.noteCount += 1;
  }

  // 导航提示音：声像指示左/右出口，回响时间指示距离，音高指示深度
  cueTone(t, { pan = 0, semis = 0, echoTime = null, dur = 0.35 } = {}) {
    const ctx = this.ctx;
    const tr = this.project.tracks.cue;
    const freq = tr.params.baseFreq
      * semitoneRatio(semis + this.project.pitch);
    const osc = this._register(ctx.createOscillator());
    const env = this._register(ctx.createGain());
    const panner = this._register(ctx.createStereoPanner());
    osc.type = 'sine';
    osc.frequency.value = freq;
    panner.pan.value = pan;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.8, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(panner);
    panner.connect(this.trackGains.cue);
    // 回响：延时 + 反馈，回响时间随出口距离变化
    const echo = echoTime == null ? tr.params.echoTime : echoTime;
    const delay = this._register(ctx.createDelay(2));
    const fb = this._register(ctx.createGain());
    delay.delayTime.value = echo;
    fb.gain.value = tr.params.echoFb;
    panner.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(this.trackGains.cue);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    this.noteCount += 1;
    return { freq, echoTime: echo };
  }

  // 探针：短促 ping，左右各一次，回响时间不同以便比较
  probePing(t, pan, echoTime) {
    const ctx = this.ctx;
    const osc = this._register(ctx.createOscillator());
    const env = this._register(ctx.createGain());
    const panner = this._register(ctx.createStereoPanner());
    const delay = this._register(ctx.createDelay(2));
    const fb = this._register(ctx.createGain());
    osc.type = 'triangle';
    osc.frequency.value = 1200 * semitoneRatio(this.project.pitch);
    panner.pan.value = pan;
    env.gain.setValueAtTime(0.7, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    delay.delayTime.value = echoTime;
    fb.gain.value = 0.45;
    osc.connect(env).connect(panner);
    panner.connect(this.trackGains.cue);
    panner.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(this.trackGains.cue);
    osc.start(t);
    osc.stop(t + 0.1);
    this.noteCount += 1;
    const echoes = [];
    for (let k = 1; k <= 3; k += 1) echoes.push(t + echoTime * k);
    return echoes;
  }

  noiseBurst(t, level) {
    const ctx = this.ctx;
    const src = this._register(ctx.createBufferSource());
    src.buffer = this._noiseBuffer();
    const env = this._register(ctx.createGain());
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, level), t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(env).connect(this.trackGains.noise);
    src.start(t);
    src.stop(t + 0.45);
    this.noteCount += 1;
  }

  _noiseBuffer() {
    if (this._noiseBuf) return this._noiseBuf;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 1);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rand = mulberry32(20261116);
    for (let i = 0; i < len; i += 1) data[i] = rand() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  }

  // 噪声床：随错误次数渐强；停止时整体释放
  _startNoiseBed() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = this.project.tracks.noise.params.level;
    src.connect(g).connect(this.trackGains.noise);
    src.start();
    this.noiseBed = { src, g };
  }

  setNoiseLevel(level) {
    this.project.tracks.noise.params.level = level;
    if (this.noiseBed && this.ctx) {
      this.noiseBed.g.gain.setTargetAtTime(level, this.ctx.currentTime, 0.1);
    }
  }

  _stopNoiseBed() {
    if (!this.noiseBed) return;
    try { this.noiseBed.src.stop(0); } catch (e) { /* 已停止 */ }
    try { this.noiseBed.src.disconnect(); } catch (e) { /* 忽略 */ }
    try { this.noiseBed.g.disconnect(); } catch (e) { /* 忽略 */ }
    this.noiseBed = null;
  }
}
