import { ResourceRegistry } from "./error-boundary.js";

const NOTE_RATIOS = [1, 1.122, 1.26, 1.335, 1.498, 1.682, 1.888, 2];
const BASE_FREQUENCY = 164.81;

function defaultContextFactory() {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器没有可用的 Web Audio 支持。");
  return new AudioContextClass();
}

export class AudioEngine {
  constructor(options = {}) {
    this.contextFactory = options.contextFactory || defaultContextFactory;
    this.onStateChange = options.onStateChange || (() => {});
    this.onStep = options.onStep || (() => {});
    this.resources = new ResourceRegistry("audio");
    this.context = null;
    this.status = "idle";
    this.stepIndex = 0;
    this.loopTimer = null;
    this.config = null;
    this.nodeSequence = 0;
    this.lastError = null;
  }

  get nodeCount() {
    return this.resources.size;
  }

  snapshot() {
    return {
      status: this.status,
      stepIndex: this.stepIndex,
      nodeCount: this.nodeCount,
      lastError: this.lastError ? String(this.lastError) : null
    };
  }

  emit(extra = {}) {
    this.onStateChange({ ...this.snapshot(), ...extra });
  }

  ensureContext() {
    if (this.context) return this.context;
    try {
      this.context = this.contextFactory();
    } catch (error) {
      this.status = "error";
      this.lastError = error;
      this.emit();
      throw new Error(`音频上下文创建失败：${error.message}`);
    }
    return this.context;
  }

  createTone({ frequency, waveform, volume, duration = 0.24, silent = false }) {
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    if (!oscillator || !gain) throw new Error("无法创建振荡器或增益节点。");
    const id = `node-${this.nodeSequence += 1}`;
    const now = Number(context.currentTime) || 0;
    oscillator.type = waveform;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(silent ? 0 : volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    this.resources.add(
      id,
      () => {
        try {
          oscillator.stop();
        } catch {
          // The node may already have ended.
        }
        try {
          oscillator.disconnect();
        } catch {
          // Disconnection is idempotent for this flow.
        }
        try {
          gain.disconnect();
        } catch {
          // Disconnection is idempotent for this flow.
        }
      },
      { id, frequency }
    );
    oscillator.onended = () => this.resources.cleanup(id);
    oscillator.start(now);
    oscillator.stop(now + duration);
    globalThis.setTimeout?.(() => this.resources.cleanup(id), (duration + 0.1) * 1000);
    return id;
  }

  async start(config, options = {}) {
    this.stopAll("restarting");
    const context = this.ensureContext();
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch (error) {
        throw new Error(`音频上下文无法恢复：${error.message}`);
      }
    }
    this.config = {
      waveform: config.waveform,
      volume: Math.max(0, Math.min(1, config.volume / 100)) * 0.32,
      bpm: config.bpm,
      pattern: config.pattern.slice(0, 8),
      notes: config.notes.slice(0, 8)
    };
    if (options.failAfterCreate) {
      this.createTone({
        frequency: BASE_FREQUENCY,
        waveform: this.config.waveform,
        volume: 0,
        silent: true
      });
      throw new Error("合成节点启动失败：模拟的一次性音频故障。");
    }
    this.status = "playing";
    this.stepIndex = 0;
    this.lastError = null;
    this.emit();
    this.tick();
    if (this.status === "error") {
      throw this.lastError || new Error("音频序列启动过程中节点创建失败。");
    }
    return this.snapshot();
  }

  tick() {
    if (this.status !== "playing" || !this.config) return;
    const step = this.stepIndex;
    if (this.config.pattern[step]) {
      const semitone = this.config.notes[step] || 0;
      const ratio = NOTE_RATIOS[Math.abs(semitone) % NOTE_RATIOS.length];
      const frequency = BASE_FREQUENCY * ratio * (semitone >= 12 ? 2 : 1);
      try {
        this.createTone({
          frequency,
          waveform: this.config.waveform,
          volume: this.config.volume
        });
      } catch (error) {
        this.status = "error";
        this.lastError = error;
        this.stopAll("error");
        return;
      }
    }
    this.onStep(step, this.snapshot());
    const stepMs = Math.round(60000 / this.config.bpm / 2);
    this.loopTimer = globalThis.setTimeout(() => {
      this.stepIndex = (this.stepIndex + 1) % 8;
      this.tick();
    }, stepMs);
  }

  stopAll(reason = "stopped") {
    if (this.loopTimer) {
      globalThis.clearTimeout?.(this.loopTimer);
      this.loopTimer = null;
    }
    const stopped = this.resources.cleanupAll();
    if (this.status === "playing") this.status = "idle";
    this.emit({ reason, stopped: stopped.length });
    return stopped.length;
  }

  async dispose() {
    this.stopAll("disposed");
    if (this.context && typeof this.context.close === "function") {
      try {
        await this.context.close();
      } catch {
        // Closing is best effort during teardown.
      }
    }
    this.context = null;
  }
}
