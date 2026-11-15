// 演奏控制层：连接 Scheduler / GlassAudioEngine / 工程旋律。
// 负责暂停挂起、恢复解冻、成功判定，以及停止后释放全部音频资源。

import { Scheduler } from './scheduler.js';
import { patternLength } from './project.js';

const RELEASE_TAIL = 3.5; // 最长泛音衰减后再统一释放节点

export class GlassSequencer {
  constructor(engine, project, clock) {
    this.engine = engine;
    this.project = project;
    this.clock = clock;
    this.scheduler = new Scheduler({ clock });
    this.onStateChange = null;
    this.onSuccess = null;
    this.onFail = null;
    this.onVisual = null; // (event, note) => void，仅用于视觉反馈，不影响调度
    this.notesByStep = buildNoteIndex(project.melody);
    this._wire();
  }

  _wire() {
    this.scheduler.onStep = (event) => this._playEvent(event);
    this.scheduler.onComplete = (finishAt) => {
      // 调度在结束前约一个前瞻窗口完成；用音频时钟延时到真正结束点再判定，
      // 尾音自然衰减后统一停止并断开所有节点，状态切回 stopped。
      const delaySec = Math.max(0, finishAt - this.engine.ctx.currentTime);
      if (this.clock.setTimeout) {
        this._completionTimer = this.clock.setTimeout(
          () => this._finalize(finishAt), delaySec * 1000);
      } else if (typeof setTimeout === 'function' && delaySec > 0.001) {
        this._completionTimer = setTimeout(() => this._finalize(finishAt), delaySec * 1000);
      } else {
        this._finalize(finishAt);
      }
    };
  }

  _finalize(finishAt) {
    this.engine.stopAll(finishAt + RELEASE_TAIL);
    this.scheduler.playing = false;
    this.scheduler.paused = false;
    this.scheduler.stopTimer();
    const broken = this.project.tracks.some((t) => t.broken);
    if (!broken && this.onSuccess) this.onSuccess(finishAt);
    if (this.onStateChange) this.onStateChange('stopped');
  }

  _playEvent(event) {
    const note = this.notesByStep.get(event.patternStep);
    if (note) {
      if (this.engine.isBroken(note.glass)) {
        if (this.onFail) this.onFail({ reason: 'broken-cup', note, when: event.when });
      } else {
        const options = { when: event.when, transpose: event.transpose };
        if (note.kind === 'rub') {
          this.engine.rub(note.glass, { ...options, duration: this.scheduler.stepDuration * 0.9 });
        } else {
          const result = this.engine.strike(note.glass, { ...options, velocity: note.velocity });
          if (result && result.broken && this.onFail) {
            this.onFail({ reason: 'broken-cup', note, when: event.when });
          }
        }
      }
    }
    if (this.onVisual) this.onVisual(event, note || null);
  }

  async play(startAt) {
    this.scheduler.load({
      tempo: this.project.tempo,
      transpose: this.project.transpose,
      loop: this.project.loop,
      patternLength: patternLength(this.project),
    });
    if (this.engine.ctx.state === 'suspended') await this.engine.resume();
    this.scheduler.play(startAt);
    this._emit();
  }

  async pause() {
    await this.engine.suspend(); // 音频时钟冻结，已排程事件时间保持不变
    this.scheduler.pause();
    this._emit();
  }

  async resume() {
    await this.engine.resume(); // 时钟解冻；不重置 nextStepTime → 零累积误差
    this.scheduler.resume();
    this._emit();
  }

  stop() {
    if (this._completionTimer) {
      if (this.clock.clearTimeout) this.clock.clearTimeout(this._completionTimer);
      else clearTimeout(this._completionTimer);
      this._completionTimer = null;
    }
    this.scheduler.stop();
    this.engine.stopAll(this.engine.ctx.currentTime);
    this._emit();
  }

  setTempo(tempo) {
    this.project.tempo = tempo;
    this.scheduler.setTempo(tempo);
  }

  setTranspose(semitones) {
    this.project.transpose = semitones;
    this.scheduler.setTranspose(semitones);
  }

  setLoop(loop) {
    this.project.loop = loop;
    this.scheduler.setLoop(loop);
  }

  get state() {
    if (this.scheduler.paused) return 'paused';
    return this.scheduler.playing ? 'playing' : 'stopped';
  }

  get beatPosition() {
    return this.scheduler.getBeatPosition();
  }

  _emit() {
    if (this.onStateChange) this.onStateChange(this.state);
  }
}

export function buildNoteIndex(melody) {
  const map = new Map();
  for (const note of melody) map.set(note.step, note);
  return map;
}

export { RELEASE_TAIL };
