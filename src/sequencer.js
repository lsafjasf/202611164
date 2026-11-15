import { BeatClock } from "./clock.js";
import {
  BEATS_PER_STEP,
  STEPS_PER_BAR,
  shouldTrigger,
  trackMidi,
} from "./project.js";

const SCHEDULER_INTERVAL_MS = 24;
const SCHEDULE_AHEAD_SECONDS = 0.1;
const START_DELAY_SECONDS = 0.055;

export class DrumSequencer {
  constructor(engine, getProject, callbacks = {}) {
    this.engine = engine;
    this.getProject = getProject;
    this.onSchedule = callbacks.onSchedule || (() => {});
    this.onStateChange = callbacks.onStateChange || (() => {});
    this.clock = new BeatClock(getProject().bpm);
    this.state = "stopped";
    this.nextStep = 0;
    this.timer = null;
    this.endTimer = null;
    this.loopEndStep = STEPS_PER_BAR;
    this.events = [];
  }

  get now() {
    return this.engine.context?.currentTime ?? 0;
  }

  async play() {
    if (this.state === "playing") {
      return;
    }
    if (this.state === "paused") {
      await this.resume();
      return;
    }
    const project = this.getProject();
    await this.engine.ensureStarted(project);
    this.clock.bpm = project.bpm;
    this.clock.start(this.now, 0, START_DELAY_SECONDS);
    this.nextStep = 0;
    this.loopEndStep = STEPS_PER_BAR;
    this.events = [];
    this.state = "playing";
    this.startScheduler();
    this.emitState();
  }

  async resume() {
    if (this.state !== "paused") {
      return;
    }
    const project = this.getProject();
    await this.engine.ensureStarted(project);
    this.clock.bpm = project.bpm;
    this.clock.resume(this.now, START_DELAY_SECONDS);
    this.nextStep = Math.ceil((this.clock.pausedBeat + 1e-7) / BEATS_PER_STEP);
    this.state = "playing";
    this.startScheduler();
    this.emitState();
  }

  pause() {
    if (this.state !== "playing") {
      return;
    }
    this.clock.pause(this.now);
    this.stopScheduler();
    this.engine.releaseAll(0.01);
    this.events = this.events.filter((event) => event.time <= this.now);
    this.state = "paused";
    this.emitState();
  }

  stop() {
    this.clock.stop();
    this.stopScheduler();
    this.engine.releaseAll(0.008);
    this.events = [];
    this.nextStep = 0;
    this.state = "stopped";
    this.emitState();
  }

  async togglePlayPause() {
    if (this.state === "playing") {
      this.pause();
    } else {
      await this.play();
    }
  }

  setBpm(bpm, project) {
    if (this.state === "playing") {
      const now = this.now;
      this.clock.setBpm(bpm, now);
      this.engine.cancelScheduledAfter(now + 0.012);
      this.events = this.events.filter((event) => event.time < now + 0.012);
      this.nextStep = Math.ceil((this.clock.beatAt(now) + 1e-7) / BEATS_PER_STEP);
      this.clearEndTimer();
      this.scheduleWindow();
    } else {
      this.clock.setBpm(bpm, this.now);
    }
    this.ensureEndTimer(project);
    this.emitState();
  }

  setLoop(project) {
    if (project.loop) {
      this.clearEndTimer();
    } else {
      const currentStep = Math.floor(this.clock.beatAt(this.now) / BEATS_PER_STEP);
      this.loopEndStep =
        (Math.floor(currentStep / STEPS_PER_BAR) + 1) * STEPS_PER_BAR;
      this.ensureEndTimer(project);
    }
    this.emitState();
  }

  startScheduler() {
    this.stopScheduler();
    this.scheduleWindow();
    this.timer = window.setInterval(() => this.scheduleWindow(), SCHEDULER_INTERVAL_MS);
  }

  stopScheduler() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.clearEndTimer();
  }

  scheduleWindow() {
    if (this.state !== "playing") {
      return;
    }
    const project = this.getProject();
    const now = this.now;
    const horizon = now + SCHEDULE_AHEAD_SECONDS;
    let guard = 0;

    while (guard < 64) {
      guard += 1;
      const beat = this.nextStep * BEATS_PER_STEP;
      const when = this.clock.timeAtBeat(beat);
      if (when > horizon) {
        break;
      }
      if (!project.loop && this.nextStep >= this.loopEndStep) {
        this.ensureEndTimer(project);
        break;
      }
      if (when < now - 0.035) {
        this.nextStep += 1;
        continue;
      }
      this.scheduleStep(project, this.nextStep, when);
      this.nextStep += 1;
    }

    this.ensureEndTimer(project);
    this.events = this.events.filter((event) => event.time > now - 2);
  }

  scheduleStep(project, absoluteStep, when) {
    const patternStep = absoluteStep % STEPS_PER_BAR;
    for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
      const step = project.tracks[trackIndex].steps[patternStep];
      if (!step?.on || !shouldTrigger(project, step, trackIndex, absoluteStep)) {
        continue;
      }
      this.engine.scheduleVoice(project, trackIndex, step, absoluteStep, when);
      const event = {
        trackIndex,
        step: patternStep,
        absoluteStep,
        beat: absoluteStep * BEATS_PER_STEP,
        time: when,
        midi: trackMidi(project, trackIndex),
        velocity: step.velocity,
        pan: step.pan,
      };
      this.events.push(event);
      this.onSchedule(event);
    }
  }

  ensureEndTimer(project) {
    if (project.loop || this.state !== "playing" || this.endTimer !== null) {
      return;
    }
    const endTime = this.clock.timeAtBeat(this.loopEndStep * BEATS_PER_STEP);
    const delay = Math.max(0, (endTime - this.now) * 1000);
    this.endTimer = window.setTimeout(() => {
      this.endTimer = null;
      if (
        this.state === "playing" &&
        !this.getProject().loop &&
        this.now >= endTime - 0.012
      ) {
        this.stop();
      }
    }, delay);
  }

  clearEndTimer() {
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  getPosition() {
    const beat = this.state === "playing" ? this.clock.beatAt(this.now) : this.clock.beatAt(this.now);
    const stepFloat = beat / BEATS_PER_STEP;
    const absoluteStep = Math.max(0, Math.floor(stepFloat));
    return {
      state: this.state,
      beat,
      stepFloat,
      absoluteStep,
      patternStep: absoluteStep % STEPS_PER_BAR,
      elapsed: beat * (60 / this.clock.bpm),
    };
  }

  getRecentEvents(maxAge = 0.15) {
    const now = this.now;
    return this.events.filter(
      (event) => event.time <= now + 0.001 && now - event.time <= maxAge,
    );
  }

  getLastTrigger() {
    const now = this.now;
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (this.events[index].time <= now + 0.001) {
        return this.events[index];
      }
    }
    return null;
  }

  emitState() {
    this.onStateChange({
      state: this.state,
      bpm: this.clock.bpm,
      position: this.getPosition(),
    });
  }
}
