// Web Audio 引擎：金属齿合成 + 虚拟时钟前瞻调度 + 节点全生命周期登记。
import { buildEvents, durationSec, exportDurationSec } from './core.js';

const LOOKAHEAD_SEC = 0.25;
const TICK_MS = 100;
const PARTIALS = [
  { ratio: 1.0, gain: 0.55, decay: 2.6 },
  { ratio: 2.76, gain: 0.26, decay: 1.1 },   // 非谐和泛音 → 金属质感
  { ratio: 5.4, gain: 0.13, decay: 0.55 },
  { ratio: 8.93, gain: 0.06, decay: 0.28 },
];

export class AudioEngine {
  constructor(project) {
    this.project = project;
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.voices = new Set();       // 所有存活节点包，停止即全部 disconnect/stop
    this.nodeCount = 0;            // 累计创建节点数（自检用）
    this.closedCount = 0;          // 累计释放节点数（自检用）
    this.timer = null;
    this.cursor = 0;               // 已调度到的虚拟时间
    this.lastScheduled = [];       // 最近实际发声事件（自检/可视化用）
    this.rebuildEvents();
  }

  rebuildEvents() {
    this.events = buildEvents(this.project);
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // 把虚拟时间映射到音频硬件时间。同一虚拟位置永远映射到同一硬件时刻 → 无漂移。
  virtualToAudioTime(virtualTime, transport) {
    const offset = transport.anchorVirtual - transport.anchorNow;
    return virtualTime - offset;
  }

  startScheduler(transport) {
    this.ensureContext().then(() => {
      if (this.timer) {
        this.stopScheduler();
      }
      this.cursor = transport.virtualTime;
      this.timer = setInterval(() => this.pump(transport), TICK_MS);
      this.pump(transport);
    });
  }

  stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pump(transport) {
    if (!this.ctx || this.ctx.state === 'closed') return;
    if (!transport.running) return;
    // 循环回绕后游标必须落在当前时间窗口内，否则整轮事件会被错误跳过。
    if (this.cursor > transport.virtualTime + 0.001) this.cursor = transport.virtualTime;
    const horizon = Math.min(transport.duration, transport.virtualTime + LOOKAHEAD_SEC);
    const from = this.cursor;
    const due = this.events.sounded.filter((e) => e.time > from && e.time <= horizon);
    for (const ev of due) {
      const at = this.virtualToAudioTime(ev.time, transport);
      if (at > this.ctx.currentTime - 0.005) {
        this.scheduleVoice(this.ctx, ev, at, this.master);
        this.lastScheduled.push({ virtualTime: ev.time, audioTime: at, beat: ev.beat, id: ev.noteId });
        if (this.lastScheduled.length > 64) this.lastScheduled.shift();
      }
    }
    this.cursor = horizon;
  }

  // 单个金属齿音：多个非谐和振荡器经独立包络汇入一个 voice gain，再经声像。
  scheduleVoice(ctx, ev, when, output) {
    const nodes = [];
    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0.0001, when);
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.001, ev.gain * ev.velocity), when + 0.004);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, when + 3.2);
    nodes.push(voiceGain);

    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, ev.pan));
      voiceGain.connect(panner);
      panner.connect(output);
      nodes.push(panner);
    } else {
      voiceGain.connect(output);
    }

    for (const p of PARTIALS) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = ev.freq * p.ratio;
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(p.gain, when);
      pg.gain.exponentialRampToValueAtTime(0.0001, when + p.decay);
      osc.connect(pg);
      pg.connect(voiceGain);
      osc.start(when);
      osc.stop(when + p.decay + 0.05);
      nodes.push(osc, pg);
    }

    const pack = { nodes, deadline: when + 3.4 };
    this.voices.add(pack);
    this.nodeCount += nodes.length;
    const release = () => this.releaseVoice(pack);
    if (ctx !== this._offlineMarker) {
      pack.timer = setTimeout(release, (pack.deadline - ctx.currentTime) * 1000 + 120);
    }
  }

  releaseVoice(pack) {
    if (!this.voices.has(pack)) return;
    if (pack.timer) clearTimeout(pack.timer);
    for (const node of pack.nodes) {
      try { node.disconnect(); } catch { /* 已释放 */ }
      if (typeof node.stop === 'function') {
        try { node.stop(); } catch { /* 已停止 */ }
      }
    }
    this.voices.delete(pack);
    this.closedCount += pack.nodes.length;
  }

  // 硬停：快速释放后停止全部振荡器，保证任何节点停止后不残留声音。
  hardStopAll(ctx = this.ctx) {
    this.stopScheduler();
    const t = ctx ? ctx.currentTime : 0;
    const packs = [...this.voices];
    for (const pack of packs) {
      if (pack.timer) clearTimeout(pack.timer);
      const g = pack.nodes.find((nd) => nd.gain && typeof nd.gain.cancelScheduledValues === 'function');
      if (g && ctx) {
        try {
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        } catch { /* ignore */ }
      }
      for (const node of pack.nodes) {
        if (typeof node.stop === 'function') {
          try { node.stop(t + 0.04); } catch { /* ignore */ }
        }
      }
    }
    const hardStopTimer = setTimeout(() => packs.forEach((p) => this.releaseVoice(p)), 90);
    if (this._hardTimers) this._hardTimers.push(hardStopTimer); else this._hardTimers = [hardStopTimer];
    this.cursor = 0;
  }

  get liveVoiceCount() {
    return this.voices.size;
  }

  get nodeBalanceOK() {
    return this.voices.size === 0 || this.nodeCount >= this.closedCount;
  }

  // 完全释放：硬停全部声音并关闭音频上下文。
  async dispose() {
    this.hardStopAll();
    if (this._hardTimers) {
      for (const tm of this._hardTimers) clearTimeout(tm);
      this._hardTimers = [];
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      try { await this.ctx.close(); } catch { /* ignore */ }
    }
    this.voices.clear();
  }

  // 离线渲染：与实时播放共用 scheduleVoice，时间轴完全确定性。
  async renderOffline(sampleRate = 44100) {
    const total = exportDurationSec(this.project);
    const offline = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
    const master = offline.createGain();
    master.gain.value = 0.9;
    const comp = offline.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(offline.destination);
    let created = 0;
    const localVoices = new Set();
    this._offlineMarker = offline;
    for (const ev of this.events.sounded) {
      this.scheduleVoice(offline, ev, ev.time + 0.05, master);
      const pack = [...this.voices].pop();
      localVoices.add(pack);
      created += pack.nodes.length;
    }
    const rendered = await offline.startRendering();
    // OfflineAudioContext 渲染结束即销毁；显式断开所有节点释放引用。
    for (const pack of localVoices) {
      if (pack.timer) clearTimeout(pack.timer);
      for (const node of pack.nodes) {
        try { node.disconnect(); } catch { /* ignore */ }
      }
      this.voices.delete(pack);
      this.closedCount += pack.nodes.length;
    }
    this._offlineMarker = null;
    return { buffer: rendered, wav: encodeWav(rendered), created, duration: total };
  }

  // 离线推演（不依赖 AudioContext）：返回事件时间轴，供 Node 测试与自检对照。
  simulateTimeline() {
    return {
      duration: durationSec(this.project),
      exportDuration: exportDurationSec(this.project),
      events: this.events.all.map((e) => ({
        id: e.noteId, time: e.time, beat: e.beat, status: e.status,
        trackId: e.trackId, pitch: e.pitch, freq: e.freq,
      })),
    };
  }
}

function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length * numCh * 2;
  const ab = new ArrayBuffer(44 + len);
  const dv = new DataView(ab);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i += 1) dv.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + len, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * numCh * 2, true);
  dv.setUint16(32, numCh * 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, 'data');
  dv.setUint32(40, len, true);
  const chans = [];
  for (let c = 0; c < numCh; c += 1) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < buffer.length; i += 1) {
    for (let c = 0; c < numCh; c += 1) {
      const sample = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(off, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
