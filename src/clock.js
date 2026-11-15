import { BEATS_PER_STEP, buildNotePlan } from "./project.js";

export class BeatClock {
  constructor(bpm = 112) {
    this.bpm = clampBpm(bpm);
    this.running = false;
    this.paused = true;
    this.anchorTime = 0;
    this.anchorBeat = 0;
    this.pausedBeat = 0;
  }

  start(time, beat = 0, delay = 0) {
    this.anchorTime = time + Math.max(0, delay);
    this.anchorBeat = Math.max(0, beat);
    this.running = true;
    this.paused = false;
  }

  pause(time) {
    if (!this.running) {
      return this.pausedBeat;
    }
    this.pausedBeat = this.beatAt(time);
    this.anchorBeat = this.pausedBeat;
    this.anchorTime = time;
    this.running = false;
    this.paused = true;
    return this.pausedBeat;
  }

  resume(time, delay = 0) {
    if (!this.paused) {
      return;
    }
    this.start(time, this.pausedBeat, delay);
  }

  stop() {
    this.running = false;
    this.paused = true;
    this.anchorTime = 0;
    this.anchorBeat = 0;
    this.pausedBeat = 0;
  }

  beatAt(time) {
    if (!this.running) {
      return this.pausedBeat;
    }
    return this.anchorBeat + Math.max(0, time - this.anchorTime) * (this.bpm / 60);
  }

  timeAtBeat(beat) {
    if (!this.running) {
      return this.anchorTime;
    }
    return this.anchorTime + Math.max(0, beat - this.anchorBeat) * (60 / this.bpm);
  }

  setBpm(bpm, time) {
    const nextBpm = clampBpm(bpm);
    if (this.running) {
      this.anchorBeat = this.beatAt(time);
      this.anchorTime = time;
    }
    this.bpm = nextBpm;
  }

  getState(time) {
    return {
      running: this.running,
      paused: this.paused,
      beat: this.beatAt(time),
      bpm: this.bpm,
      nextStep: Math.ceil((this.beatAt(time) + 1e-7) / BEATS_PER_STEP),
    };
  }
}

function clampBpm(bpm) {
  return Math.min(180, Math.max(60, Number(bpm) || 112));
}

export function rapidPauseResumeAudit(initialBpm = 112) {
  const clock = new BeatClock(initialBpm);
  clock.start(100, 0, 0);
  clock.setBpm(initialBpm + 26, 100.2);
  clock.pause(100.5);
  clock.resume(100.7, 0.03);
  clock.setBpm(initialBpm - 17, 101.1);
  clock.pause(101.25);
  clock.resume(101.31, 0.02);
  clock.setBpm(initialBpm + 9, 101.5);
  const actualBeat = clock.beatAt(101.8);

  const expectedBeat =
    (0.2 * initialBpm) / 60 +
    (0.3 * (initialBpm + 26)) / 60 +
    (0.37 * (initialBpm + 26)) / 60 +
    (0.15 * (initialBpm - 17)) / 60 +
    (0.17 * (initialBpm - 17)) / 60 +
    (0.3 * (initialBpm + 9)) / 60;

  return {
    actualBeat,
    expectedBeat,
    offset: Math.abs(actualBeat - expectedBeat),
    segments: 6,
  };
}

export function loopAlignmentAudit(project, bars = 4) {
  const notes = buildNotePlan(project, bars);
  let maxOffset = 0;
  let loopBoundaryNotes = 0;
  for (const note of notes) {
    const gridIndex = note.beat / BEATS_PER_STEP;
    maxOffset = Math.max(
      maxOffset,
      Math.abs(gridIndex - Math.round(gridIndex)) * BEATS_PER_STEP,
    );
    if (note.step === 0) {
      loopBoundaryNotes += 1;
    }
  }
  return {
    bars,
    noteCount: notes.length,
    loopBoundaryNotes,
    maxOffset,
  };
}
