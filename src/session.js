import { AudioEngine } from "./audio.js";
import { buildChart } from "./chart.js";
import { CHART_BEATS, DIFFICULTIES, SECONDS_PER_BEAT } from "./config.js";

const GRADE_ORDER = ["perfect", "great", "good", "miss"];
const GRADE_LABELS = {
  perfect: "PERFECT",
  great: "GREAT",
  good: "GOOD",
  miss: "MISS"
};

export class RhythmSession {
  constructor({ project, onEvent = () => {} }) {
    this.project = project;
    this.chart = buildChart(project.difficulty);
    this.onEvent = onEvent;
    this.audio = new AudioEngine({
      onVoiceChange: (count) => this.onEvent({ type: "voices", count })
    });
    this.state = "idle";
    this.anchor = null;
    this.pausedBeat = 0;
    this.timer = null;
    this.judged = new Map();
    this.scheduled = new Set();
    this.counts = emptyCounts();
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lastJudgment = null;
    this.startedAt = null;
  }

  get difficulty() {
    return DIFFICULTIES[this.project.difficulty] || DIFFICULTIES.normal;
  }

  updateProject(project, { rebuild = false } = {}) {
    this.project = project;
    if (rebuild) {
      this.chart = buildChart(project.difficulty);
      if (this.state !== "playing" && this.state !== "paused") this.resetScore();
    }
    this.audio.setMix(project.lanes);
    this.audio.setTranspose(project.transpose);
  }

  async start() {
    await this.audio.ensureContext();
    await this.audio.resume();
    this.resetScore();
    this.judged.clear();
    this.scheduled.clear();
    this.pausedBeat = 0;
    this.startedAt = performance.now();
    this.state = "playing";
    this.anchor = {
      ctxTime: this.audio.ctx.currentTime + 0.09,
      beatStart: 0
    };
    this.startScheduler();
    this.emitState();
  }

  async pause() {
    if (this.state !== "playing") return;
    this.pausedBeat = Math.max(0, this.currentBeat());
    this.state = "paused";
    this.stopScheduler();
    await this.audio.suspend();
    this.emitState();
  }

  async resume() {
    if (this.state !== "paused") return;
    await this.audio.resume();
    this.anchor = {
      ctxTime: this.audio.ctx.currentTime + 0.07,
      beatStart: this.pausedBeat
    };
    this.state = "playing";
    this.scheduled.clear();
    this.startScheduler();
    this.emitState();
  }

  async stop({ keepState = false } = {}) {
    this.stopScheduler();
    await this.audio.suspend();
    if (!keepState) {
      this.anchor = null;
      this.pausedBeat = 0;
      this.state = "idle";
    }
    this.emitState();
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  resetScore() {
    this.counts = emptyCounts();
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lastJudgment = null;
  }

  currentBeat() {
    if (this.state === "paused") return this.pausedBeat;
    if (this.state === "idle" || this.state === "result" || !this.anchor) return 0;
    return this.anchor.beatStart
      + (this.audio.ctx.currentTime - this.anchor.ctxTime) / SECONDS_PER_BEAT;
  }

  currentPosition() {
    const rawBeat = this.currentBeat();
    const safeBeat = Math.max(0, rawBeat);
    const cycle = Math.floor(safeBeat / CHART_BEATS);
    const localBeat = safeBeat % CHART_BEATS;
    return {
      rawBeat,
      displayBeat: safeBeat,
      cycle,
      localBeat,
      seconds: localBeat * SECONDS_PER_BEAT,
      progress: localBeat / CHART_BEATS
    };
  }

  startScheduler() {
    this.stopScheduler();
    this.scheduleWindow();
    this.timer = window.setInterval(() => this.scheduleWindow(), 24);
  }

  stopScheduler() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  scheduleWindow() {
    if (this.state !== "playing" || !this.audio.initialized) return;
    const currentBeat = this.currentBeat();
    const horizonBeat = currentBeat + 1.35 / SECONDS_PER_BEAT;
    const firstCycle = Math.floor(currentBeat / CHART_BEATS);
    const lastCycle = Math.floor(horizonBeat / CHART_BEATS);

    for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
      for (const note of this.chart.notes) {
        const absoluteBeat = cycle * CHART_BEATS + note.beat;
        if (absoluteBeat < currentBeat - 0.001 || absoluteBeat > horizonBeat) continue;
        const key = `${cycle}:${note.id}`;
        if (this.scheduled.has(key)) continue;

        const when = this.anchor.ctxTime
          + (absoluteBeat - this.anchor.beatStart) * SECONDS_PER_BEAT;
        if (when < this.audio.ctx.currentTime - 0.035) continue;
        this.scheduled.add(key);
        this.audio.scheduleLane(note.laneId, when, {
          velocity: note.velocity,
          accent: true
        });
      }

      if (this.project.metronome) {
        const startBeat = Math.ceil(Math.max(currentBeat, cycle * CHART_BEATS));
        const endBeat = Math.min((cycle + 1) * CHART_BEATS, horizonBeat);
        for (let beat = startBeat; beat <= endBeat; beat += 1) {
          const key = `metro:${cycle}:${beat}`;
          if (this.scheduled.has(key)) continue;
          const when = this.anchor.ctxTime
            + (beat - this.anchor.beatStart) * SECONDS_PER_BEAT;
          if (when < this.audio.ctx.currentTime - 0.02) continue;
          this.scheduled.add(key);
          this.audio.scheduleClick(when);
        }
      }
    }

    this.pruneTransientState(firstCycle);
  }

  pruneTransientState(currentCycle) {
    if (this.scheduled.size < 180) return;
    for (const key of this.scheduled) {
      const cycle = Number(key.split(":")[1]);
      if (Number.isFinite(cycle) && cycle < currentCycle - 1) this.scheduled.delete(key);
    }
    for (const [key, entry] of this.judged) {
      if (entry.cycle < currentCycle - 1) this.judged.delete(key);
    }
  }

  tick() {
    if (this.state !== "playing") return;
    const beat = this.currentBeat();
    if (beat < 0) return;
    this.detectMisses(beat);

    if (!this.project.loop) {
      const cycle = Math.floor(beat / CHART_BEATS);
      const localBeat = beat - cycle * CHART_BEATS;
      const endingCycle = localBeat < 0.25 && cycle > 0 ? cycle - 1 : cycle;
      const targetBeat = (endingCycle + 1) * CHART_BEATS;
      if (beat >= targetBeat) this.finishSession(endingCycle);
    }
  }

  detectMisses(transportBeat) {
    const currentCycle = Math.floor(transportBeat / CHART_BEATS);
    const localBeat = transportBeat - currentCycle * CHART_BEATS;
    const lateBeats = this.difficulty.windows.good / SECONDS_PER_BEAT;
    for (const note of this.chart.notes) {
      if (note.beat >= localBeat - lateBeats) break;
      const key = `${currentCycle}:${note.id}`;
      if (!this.judged.has(key)) {
        this.registerGrade("miss", note, key, currentCycle, 0);
      }
    }
  }

  async finishSession(cycle) {
    if (this.state !== "playing") return;
    this.flushRemainingMisses(cycle);
    this.state = "result";
    this.stopScheduler();
    this.pausedBeat = CHART_BEATS;
    await this.audio.stopAll();
    if (this.audio.ctx?.state === "running") await this.audio.ctx.suspend();
    this.emitState();
    this.onEvent({
      type: "finish",
      summary: this.summary(),
      voices: this.audio.activeVoiceCount
    });
  }

  flushRemainingMisses(cycle) {
    for (const note of this.chart.notes) {
      const key = `${cycle}:${note.id}`;
      if (!this.judged.has(key)) {
        this.registerGrade("miss", note, key, cycle, 0);
      }
    }
  }

  pressLane(laneId) {
    if (this.state !== "playing" || !this.audio.initialized) {
      return { accepted: false };
    }
    const now = this.audio.ctx.currentTime;
    this.audio.scheduleLane(laneId, now, { velocity: 0.56, accent: true });

    const transportBeat = this.currentBeat();
    if (transportBeat < 0) return { accepted: false };
    const latencyBeats = (this.project.latencyMs / 1000) / SECONDS_PER_BEAT;
    const adjustedBeat = transportBeat - latencyBeats;
    const currentCycle = Math.floor(adjustedBeat / CHART_BEATS);
    const goodSeconds = this.difficulty.windows.good;
    const candidates = [];

    for (let cycle = currentCycle - 1; cycle <= currentCycle + 1; cycle += 1) {
      for (const note of this.chart.notes) {
        if (note.laneId !== laneId) continue;
        const absoluteBeat = cycle * CHART_BEATS + note.beat;
        const deltaSeconds = (adjustedBeat - absoluteBeat) * SECONDS_PER_BEAT;
        if (Math.abs(deltaSeconds) > goodSeconds) continue;
        const key = `${cycle}:${note.id}`;
        if (this.judged.has(key)) continue;
        candidates.push({ note, cycle, key, deltaSeconds, absoluteBeat });
      }
    }

    candidates.sort((a, b) => Math.abs(a.deltaSeconds) - Math.abs(b.deltaSeconds));
    const hit = candidates[0];
    if (!hit) {
      this.onEvent({ type: "empty", laneId });
      return { accepted: true, grade: null, delta: 0 };
    }

    const grade = gradeForDelta(Math.abs(hit.deltaSeconds), this.difficulty.windows);
    this.registerGrade(grade, hit.note, hit.key, hit.cycle, hit.deltaSeconds);
    return {
      accepted: true,
      grade,
      delta: hit.deltaSeconds,
      score: this.score,
      combo: this.combo
    };
  }

  registerGrade(grade, note, key, cycle, deltaSeconds) {
    if (this.judged.has(key)) return;
    this.judged.set(key, { grade, noteId: note.id, cycle, deltaSeconds });
    this.counts[grade] += 1;

    if (grade === "miss") {
      this.combo = 0;
    } else {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += Math.round(
        this.difficulty.score[grade] * (1 + Math.min(this.combo, 100) / 200)
      );
    }

    this.lastJudgment = grade;
    this.onEvent({
      type: "judgment",
      grade,
      label: GRADE_LABELS[grade],
      laneId: note.laneId,
      delta: deltaSeconds,
      score: this.score,
      combo: this.combo,
      counts: { ...this.counts }
    });
  }

  get liveAccuracy() {
    const judged = GRADE_ORDER.reduce((sum, key) => sum + this.counts[key], 0);
    if (!judged) return 100;
    const weight = this.counts.perfect
      + this.counts.great * 0.7
      + this.counts.good * 0.35;
    return (weight / judged) * 100;
  }

  summary() {
    const judged = GRADE_ORDER.reduce((sum, key) => sum + this.counts[key], 0);
    const accuracy = this.liveAccuracy;
    return {
      score: this.score,
      combo: this.maxCombo,
      accuracy,
      counts: { ...this.counts },
      total: judged,
      grade: letterGrade(accuracy),
      noteCount: this.chart.notes.length
    };
  }

  emitState() {
    this.onEvent({
      type: "state",
      state: this.state,
      position: this.currentPosition(),
      voices: this.audio.activeVoiceCount,
      summary: this.summary()
    });
  }

  diagnostics() {
    const position = this.currentPosition();
    return {
      state: this.state,
      rawBeat: this.currentBeat(),
      localBeat: position.localBeat,
      progress: position.progress,
      activeVoices: this.audio.activeVoiceCount,
      noteCount: this.chart.notes.length,
      chartSignature: this.chart.notes.map((note) => `${note.beat}:${note.lane}`).join("|"),
      loop: this.project.loop,
      latencyMs: this.project.latencyMs,
      speed: this.project.speed,
      transpose: this.project.transpose,
      exportDuration: this.chart.duration
    };
  }
}

export function gradeForDelta(absSeconds, windows) {
  if (absSeconds <= windows.perfect) return "perfect";
  if (absSeconds <= windows.great) return "great";
  if (absSeconds <= windows.good) return "good";
  return null;
}

function emptyCounts() {
  return { perfect: 0, great: 0, good: 0, miss: 0 };
}

function letterGrade(accuracy) {
  if (accuracy >= 96) return "S";
  if (accuracy >= 89) return "A";
  if (accuracy >= 78) return "B";
  if (accuracy >= 64) return "C";
  return "D";
}
