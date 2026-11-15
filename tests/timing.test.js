import assert from "node:assert/strict";
import test from "node:test";
import { BeatClock, loopAlignmentAudit, rapidPauseResumeAudit } from "../src/clock.js";
import {
  applyRhythmJson,
  buildNotePlan,
  cloneProject,
  createDemoProject,
  deserializeProject,
  exportDurationSeconds,
  serializeProject,
  serializeRhythm,
} from "../src/project.js";

test("demo project round-trips notes and beats through JSON", () => {
  const project = createDemoProject();
  const reloaded = deserializeProject(serializeProject(project));
  const first = buildNotePlan(project, project.exportBars);
  const second = buildNotePlan(reloaded, reloaded.exportBars);
  assert.equal(first.length, second.length);
  assert.deepEqual(
    first.map((note) => note.beat),
    second.map((note) => note.beat),
  );
  assert.equal(exportDurationSeconds(project), exportDurationSeconds(reloaded));
  assert.ok(first.length > 20);
});

test("project JSON records every track parameter and gain", () => {
  const project = createDemoProject();
  project.tracks.forEach((track, index) => {
    track.gain = 0.4 + index * 0.1;
    track.tune = index - 2;
    track.decay = 0.1 + index * 0.1;
    track.tone = 0.2 + index * 0.1;
  });
  const reloaded = deserializeProject(serializeProject(project));
  assert.deepEqual(
    reloaded.tracks.map(({ gain, tune, decay, tone }) => ({ gain, tune, decay, tone })),
    project.tracks.map(({ gain, tune, decay, tone }) => ({ gain, tune, decay, tone })),
  );
});

test("tempo changes preserve exact elapsed beat position", () => {
  const clock = new BeatClock(120);
  clock.start(10, 0, 0);
  clock.setBpm(180, 10.5);
  clock.setBpm(75, 10.75);
  const expected = (0.5 * 120) / 60 + (0.25 * 180) / 60 + (0.5 * 75) / 60;
  assert.ok(Math.abs(clock.beatAt(11.25) - expected) < 1e-12);
});

test("rapid pause and resume does not accumulate beat error", () => {
  const result = rapidPauseResumeAudit(112);
  assert.ok(result.offset < 1e-9);
  assert.equal(result.segments, 6);
});

test("all loop notes land on the exact sixteenth-note grid", () => {
  const result = loopAlignmentAudit(createDemoProject(), 8);
  assert.equal(result.maxOffset, 0);
  assert.ok(result.noteCount > 100);
});

test("transposition changes pitch without changing beat positions", () => {
  const project = createDemoProject();
  const transposed = cloneProject(project);
  transposed.transpose += 5;
  const first = buildNotePlan(project, 1);
  const second = buildNotePlan(transposed, 1);
  assert.deepEqual(
    first.map((note) => note.beat),
    second.map((note) => note.beat),
  );
  assert.ok(second.every((note, index) => note.midi - first[index].midi === 5));
});

test("copied rhythm can restore a changed pattern", () => {
  const project = createDemoProject();
  const text = serializeRhythm(project);
  const changed = cloneProject(project);
  for (const track of changed.tracks) {
    for (const step of track.steps) {
      step.on = false;
      step.velocity = 1;
    }
  }
  const restored = applyRhythmJson(changed, text);
  assert.deepEqual(
    restored.tracks.map((track) => track.steps),
    project.tracks.map((track) => track.steps),
  );
});
