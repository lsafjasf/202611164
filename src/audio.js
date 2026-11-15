export class SoundFeedback {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        this.enabled = false;
        return null;
      }
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  beep(freq = 660, duration = 0.06, type = 'sine', gainValue = 0.04) {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  select() {
    this.beep(620, 0.05, 'sine');
  }

  add() {
    this.beep(740, 0.07, 'triangle');
  }

  remove() {
    this.beep(240, 0.09, 'sawtooth', 0.03);
  }

  success() {
    this.beep(880, 0.08, 'sine');
    window.setTimeout(() => this.beep(1180, 0.09, 'sine'), 70);
  }

  error() {
    this.beep(180, 0.16, 'square', 0.025);
  }
}
