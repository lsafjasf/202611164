const TONES = {
  move: [{ frequency: 330, endFrequency: 285, duration: 0.065, gain: 0.025, wave: "sine" }],
  fragment: [
    { frequency: 620, endFrequency: 880, duration: 0.11, gain: 0.035, wave: "triangle" },
    { frequency: 960, endFrequency: 1180, duration: 0.13, gain: 0.022, wave: "sine", delay: 0.055 }
  ],
  error: [
    { frequency: 155, endFrequency: 105, duration: 0.2, gain: 0.035, wave: "sawtooth" }
  ],
  win: [
    { frequency: 440, endFrequency: 440, duration: 0.12, gain: 0.03, wave: "triangle" },
    { frequency: 660, endFrequency: 660, duration: 0.14, gain: 0.028, wave: "triangle", delay: 0.1 },
    { frequency: 880, endFrequency: 1320, duration: 0.32, gain: 0.03, wave: "sine", delay: 0.21 }
  ],
  export: [
    { frequency: 520, endFrequency: 780, duration: 0.14, gain: 0.025, wave: "sine" },
    { frequency: 1040, endFrequency: 1040, duration: 0.1, gain: 0.015, wave: "sine", delay: 0.09 }
  ],
  undo: [{ frequency: 440, endFrequency: 320, duration: 0.11, gain: 0.022, wave: "triangle" }]
};

export class AudioEngine {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.context = null;
    this.supported = Boolean(globalThis.AudioContext || globalThis.webkitAudioContext);
    this.lastPlayed = "";
    this.error = "";
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  ensureContext() {
    if (!this.supported) {
      this.error = "当前浏览器不支持 Web Audio";
      return null;
    }
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      try {
        this.context = new AudioContextClass();
        this.error = "";
      } catch (error) {
        this.error = `Web Audio 初始化失败：${error.message}`;
        return null;
      }
    }
    if (this.context.state === "suspended") {
      this.context.resume().catch((error) => {
        this.error = `Web Audio 恢复失败：${error.message}`;
      });
    }
    return this.context;
  }

  play(type) {
    this.lastPlayed = type;
    if (!this.enabled) {
      return;
    }
    const context = this.ensureContext();
    if (!context) {
      return;
    }
    const tones = TONES[type] || TONES.move;
    try {
      for (const tone of tones) {
        const start = context.currentTime + (tone.delay || 0);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = tone.wave;
        oscillator.frequency.setValueAtTime(tone.frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(30, tone.endFrequency),
          start + tone.duration
        );
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + tone.duration + 0.03);
      }
    } catch (error) {
      this.error = `操作音播放失败：${error.message}`;
    }
  }

  dispose() {
    if (this.context && this.context.state !== "closed") {
      this.context.close().catch(() => {});
    }
    this.context = null;
  }
}
