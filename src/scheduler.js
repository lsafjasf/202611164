// 精确音序调度器：以音频时钟 (AudioContext.currentTime) 为唯一时间基准。
// 暂停通过挂起音频时钟实现，恢复时不重算任何时间基准，因此不累积节拍误差。

export const STEPS_PER_BEAT = 2; // 八分音符网格，1 拍 = 2 个步进

export class Scheduler {
  constructor({ lookaheadMs = 25, scheduleAheadTime = 0.12, clock } = {}) {
    this.lookaheadMs = lookaheadMs;
    this.scheduleAheadTime = scheduleAheadTime;
    this.clock = clock;
    this.onStep = null; // ({ stepIndex, patternStep, when, beat, transpose }) => void
    this.onComplete = null; // (finishAt) => void
    this._timer = null;
    this.resetState();
  }

  resetState() {
    this.step = 0; // 已调度的全局步进数（循环也不归零，避免任何偏移重置）
    this.nextStepTime = 0; // step 对应的音频时钟时间
    this.playing = false;
    this.paused = false;
    this.tempo = 120;
    this.transpose = 0; // 半音
    this.loop = false;
    this.patternLength = 0; // 步进数
    this._lastEvent = null;
    this._completed = false;
  }

  load({ tempo, transpose, loop, patternLength }) {
    this.tempo = tempo;
    this.transpose = transpose;
    this.loop = loop;
    this.patternLength = patternLength;
  }

  get stepDuration() {
    return 60 / this.tempo / STEPS_PER_BEAT;
  }

  get isRunning() {
    return this.playing && !this.paused;
  }

  play(startAt = this.clock.now()) {
    this.stopTimer();
    this.step = 0;
    this.nextStepTime = startAt;
    this.playing = true;
    this.paused = false;
    this._completed = false;
    this._lastEvent = null;
    this.startTimer();
    return startAt;
  }

  // 暂停：外部挂起音频时钟。调度器仅停掉轮询，时间基准原样保留。
  pause() {
    if (!this.playing || this.paused) return;
    this.paused = true;
    this.stopTimer();
  }

  // 恢复：音频时钟解冻后继续调度，nextStepTime/step 均未改动 → 零误差。
  resume() {
    if (!this.playing || !this.paused) return;
    this.paused = false;
    this.startTimer();
  }

  stop() {
    this.stopTimer();
    this.playing = false;
    this.paused = false;
    this.step = 0;
    this._lastEvent = null;
    this._completed = false;
  }

  setTempo(tempo) {
    this.tempo = clampTempo(tempo);
  }

  setTranspose(semitones) {
    this.transpose = clampTranspose(semitones);
  }

  setLoop(loop) {
    this.loop = !!loop;
  }

  startTimer() {
    this.stopTimer();
    this._timer = this.clock.setInterval(() => this.tick(), this.lookaheadMs);
  }

  stopTimer() {
    if (this._timer !== null) {
      this.clock.clearInterval(this._timer);
      this._timer = null;
    }
  }

  // 可手动驱动（测试），也可由内部定时器驱动。
  tick() {
    if (!this.isRunning || this._completed) return;
    const horizon = this.clock.now() + this.scheduleAheadTime;
    while (this.nextStepTime < horizon) {
      if (this.step >= this.patternLength) {
        if (this.loop) {
          // 用全局步进取模定位，nextStepTime 连续推进，循环接缝无间隙无漂移。
          break;
        } else {
          this._finish(this.nextStepTime);
          return;
        }
      }
      this._scheduleOne();
    }
  }

  // 手动驱动一个步进（测试/离线场景），不依赖音频时钟是否推进。
  runStep() {
    if (!this.isRunning || this._completed) return false;
    if (this.step >= this.patternLength && !this.loop) {
      this._finish(this.nextStepTime);
      return false;
    }
    this._scheduleOne();
    return true;
  }

  _scheduleOne() {
    const event = {
      stepIndex: this.step,
      patternStep: this.step % this.patternLength,
      when: this.nextStepTime,
      beat: this.step / STEPS_PER_BEAT,
      transpose: this.transpose,
    };
    this._lastEvent = event;
    this.onStep(event);
    this.step += 1;
    this.nextStepTime += this.stepDuration;
  }

  _finish(finishAt) {
    this._completed = true;
    this.stopTimer();
    if (this.onComplete) this.onComplete(finishAt);
  }

  // UI 用的浮点节拍位置（随音频时钟走；挂起期间自然冻结）。
  getBeatPosition(now = this.clock.now()) {
    if (!this.playing) return 0;
    if (!this._lastEvent) return 0;
    const elapsed = Math.max(0, now - this._lastEvent.when);
    const beat = this._lastEvent.beat + elapsed * (this.tempo / 60);
    return Math.min(beat, this.patternLength / STEPS_PER_BEAT);
  }
}

export function clampTempo(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 120;
  return Math.min(300, Math.max(30, n));
}

export function clampTranspose(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(24, Math.max(-24, n));
}
