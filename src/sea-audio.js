// Web Audio 海况提示：平静海况持续底噪、警告脉冲与断航低音警报。

export class SeaAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.state = "calm";
    this.timer = null;
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const wind = this.ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.08;
    wind.connect(filter).connect(this.windGain).connect(this.master);
    wind.start();
  }

  resume() {
    this.ensure();
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setState(state) {
    this.ensure();
    this.state = state;
    if (this.timer) clearInterval(this.timer);
    if (state === "calm") {
      this.windGain.gain.setTargetAtTime(0.08, this.ctx.currentTime, 0.4);
      return;
    }
    this.windGain.gain.setTargetAtTime(state === "blocked" ? 0.2 : 0.14, this.ctx.currentTime, 0.3);
    const interval = state === "blocked" ? 1400 : 2600;
    this.timer = setInterval(() => this.pulse(state), interval);
  }

  pulse(state) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = state === "blocked" ? "sawtooth" : "sine";
    osc.frequency.value = state === "blocked" ? 160 : 420;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(state === "blocked" ? 0.22 : 0.12, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (state === "blocked" ? 0.5 : 0.25));
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  click(ok = true) {
    this.ensure();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = ok ? 660 : 200;
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  statusText() {
    if (this.state === "blocked") return "海况：断航 — 低音警报";
    if (this.state === "warning") return "海况：注意 — 周期提示音";
    return "海况：平静 — 低幅海风底噪";
  }
}
