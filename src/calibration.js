const SAMPLE_COUNT = 8;
const BEAT_INTERVAL = 0.6;
const MAX_OFFSET = 0.3;

export class CalibrationController {
  constructor({ audio, dialog, elements, onApply }) {
    this.audio = audio;
    this.dialog = dialog;
    this.elements = elements;
    this.onApply = onApply;
    this.beatTimes = [];
    this.offsets = [];
    this.usedBeats = new Set();
    this.startAt = 0;
    this.frame = 0;
    this.active = false;
    this.bind();
  }

  bind() {
    this.elements.close.addEventListener("click", () => this.close());
    this.elements.pad.addEventListener("click", () => this.tap());
    this.elements.apply.addEventListener("click", () => this.apply());
    this.elements.reset.addEventListener("click", () => {
      this.onApply(0);
      this.close();
    });
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
    window.addEventListener("keydown", (event) => {
      if (this.active && event.code === "Space") {
        event.preventDefault();
        this.tap();
      }
    });
  }

  async open() {
    if (!this.dialog.open) this.dialog.showModal();
    await this.audio.ensureContext();
    this.start();
  }

  start() {
    this.stopPlayback();
    this.beatTimes = [];
    this.offsets = [];
    this.usedBeats.clear();
    this.active = true;
    this.startAt = this.audio.ctx.currentTime + 0.8;
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const when = this.startAt + index * BEAT_INTERVAL;
      this.beatTimes.push(when);
      this.audio.scheduleClick(when, { calibration: true });
    }
    this.renderStats();
    this.elements.visual.querySelector("span").textContent = "LISTEN";
    this.animate();
  }

  tap() {
    if (!this.active || this.held) return;
    const now = this.audio.ctx.currentTime;
    if (now < this.startAt - 0.2) return;
    let nearestIndex = -1;
    let nearestDelta = Infinity;
    this.beatTimes.forEach((time, index) => {
      const delta = now - time;
      if (Math.abs(delta) < Math.abs(nearestDelta)) {
        nearestDelta = delta;
        nearestIndex = index;
      }
    });
    if (nearestIndex < 0 || Math.abs(nearestDelta) > MAX_OFFSET) return;
    if (this.usedBeats.has(nearestIndex)) return;

    this.usedBeats.add(nearestIndex);
    this.offsets.push(nearestDelta * 1000);
    this.elements.pad.classList.add("lit");
    window.setTimeout(() => this.elements.pad.classList.remove("lit"), 90);
    this.renderStats();
    if (this.offsets.length >= SAMPLE_COUNT) {
      this.elements.apply.disabled = false;
      this.elements.visual.querySelector("span").textContent = "CALIBRATED";
    }
  }

  animate() {
    if (!this.active) return;
    const elapsed = this.audio.ctx.currentTime - this.startAt;
    const phase = Math.max(0, elapsed) / BEAT_INTERVAL;
    const beatIndex = Math.floor(phase);
    const withinBeat = phase - beatIndex;
    const bars = [...this.elements.bars.children];
    bars.forEach((bar, index) => {
      const isCurrent = index === beatIndex && withinBeat < 0.34;
      bar.classList.toggle("on", isCurrent || index < this.usedBeats.size);
    });
    this.elements.pad.classList.toggle("lit", beatIndex >= 0 && withinBeat < 0.16);
    if (elapsed > SAMPLE_COUNT * BEAT_INTERVAL + 0.2 && this.offsets.length < SAMPLE_COUNT) {
      this.elements.visual.querySelector("span").textContent = "TAP AGAIN";
    }
    this.frame = requestAnimationFrame(() => this.animate());
  }

  renderStats() {
    this.elements.count.textContent = `${this.offsets.length} / ${SAMPLE_COUNT}`;
    if (!this.offsets.length) {
      this.elements.offset.textContent = "0 ms";
      this.elements.spread.textContent = "—";
      return;
    }
    const average = this.offsets.reduce((sum, value) => sum + value, 0) / this.offsets.length;
    const variance = this.offsets.reduce((sum, value) => sum + (value - average) ** 2, 0)
      / this.offsets.length;
    this.elements.offset.textContent = `${average >= 0 ? "+" : ""}${Math.round(average)} ms`;
    this.elements.spread.textContent = `±${Math.round(Math.sqrt(variance))} ms`;
  }

  apply() {
    if (this.offsets.length < SAMPLE_COUNT) return;
    const average = this.offsets.reduce((sum, value) => sum + value, 0) / this.offsets.length;
    this.onApply(Math.round(average));
    this.close();
  }

  close() {
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.audio.stopCalibration();
    if (this.dialog.open) this.dialog.close();
    this.elements.apply.disabled = true;
    this.elements.visual.querySelector("span").textContent = "READY";
    [...this.elements.bars.children].forEach((bar) => bar.classList.remove("on"));
  }

  stopPlayback() {
    cancelAnimationFrame(this.frame);
    this.audio.stopCalibration();
  }
}
