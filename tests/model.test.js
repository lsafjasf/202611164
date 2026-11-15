import assert from "node:assert/strict";
import test from "node:test";
import {
  TOTAL_BEATS,
  beatFingerprint,
  beatPositions,
  buildDemoProject,
  countNotes,
  getExportDuration,
  getPlaybackRange,
  noteEvents,
  parseProject,
  pitchRatio,
  sanitizeProject,
  secondsPerBeat,
  serializeProject,
  transportBeatAt,
  wrapBeat,
} from "../src/model.js";

test("demo project contains a complete four-track sequence", () => {
  const project = buildDemoProject();
  assert.equal(project.tracks.length, 4);
  assert.equal(project.loopEnd, TOTAL_BEATS);
  assert.equal(countNotes(project), 33);
  assert.equal(getExportDuration(project), 4);
  assert.equal(new Set(project.tracks.map((track) => track.id)).size, 4);
  assert.ok(project.tracks.every((track) => track.steps.length === 32));
});

test("serialize and reload preserve notes, beats, pitch, gain and duration", () => {
  const before = buildDemoProject();
  before.tracks[0].pitch = 7;
  before.tracks[1].gain = 0.43;
  before.tracks[2].fadeOut = 0.123;
  before.tracks[3].key = "Q";
  const after = parseProject(serializeProject(before));

  assert.equal(countNotes(after), countNotes(before));
  assert.deepEqual(beatPositions(after), beatPositions(before));
  assert.equal(beatFingerprint(after), beatFingerprint(before));
  assert.equal(getExportDuration(after), getExportDuration(before));
  assert.equal(after.tracks[0].pitch, 7);
  assert.equal(after.tracks[1].gain, 0.43);
  assert.equal(after.tracks[2].fadeOut, 0.123);
  assert.equal(after.tracks[3].key, "Q");
});

test("out-of-range loop point truncates to the sequence boundary", () => {
  const project = buildDemoProject();
  project.loopEnd = 12;
  const repaired = sanitizeProject(project);
  assert.equal(repaired.loopEnd, TOTAL_BEATS);
  assert.deepEqual(getPlaybackRange(repaired), { start: 0, end: 8 });
  assert.equal(getExportDuration(repaired), 4);
  assert.ok(noteEvents(repaired, 0, repaired.loopEnd).every((event) => event.beat < 8));
});

test("loop start cannot collapse the playback range", () => {
  const project = buildDemoProject();
  project.loopStart = 12;
  project.loopEnd = 16;
  const repaired = sanitizeProject(project);
  assert.equal(repaired.loopStart, TOTAL_BEATS - 0.25);
  assert.equal(repaired.loopEnd, TOTAL_BEATS);
  assert.equal(getExportDuration(repaired), 0.125);
});

test("speed scales note spacing and export duration without changing beat data", () => {
  const project = buildDemoProject();
  project.speed = 1.5;
  const repaired = sanitizeProject(project);
  assert.equal(secondsPerBeat(repaired), 60 / 180);
  assert.ok(Math.abs(getExportDuration(repaired) - 8 / 3) < 1e-9);
  assert.equal(beatFingerprint(repaired), beatFingerprint(project));
  assert.equal(countNotes(repaired), 33);
});

test("pause and resume rebase to the captured beat without waiting drift", () => {
  const bps = 2;
  const range = { start: 0, end: 8 };
  const beforePause = transportBeatAt(0, 10, 10.5, bps, range);
  assert.equal(beforePause, 1);

  const resumeAnchorBeat = beforePause;
  const afterLongWaitAndResume = transportBeatAt(
    resumeAnchorBeat,
    110,
    110.75,
    bps,
    range,
  );
  assert.equal(afterLongWaitAndResume, 2.5);
  assert.equal(afterLongWaitAndResume - resumeAnchorBeat - 0.75 * bps, 0);
});

test("loop wrapping remains phase-locked across many cycles", () => {
  const range = { start: 2, end: 7 };
  const bps = 3.25;
  const startBeat = wrapBeat(5.5, range.start, range.end);
  for (let cycle = 0; cycle < 10_000; cycle += 1) {
    const elapsed = cycle * 1.37;
    const beat = transportBeatAt(startBeat, 0, elapsed, bps, range);
    const expected = wrapBeat(startBeat + elapsed * bps, range.start, range.end);
    assert.equal(beat, expected);
    assert.ok(beat >= range.start && beat < range.end);
  }
});

test("speed changes preserve the captured transport beat", () => {
  const capturedBeat = transportBeatAt(1.25, 4, 5.4, 2, {
    start: 0,
    end: 8,
  });
  assert.ok(Math.abs(capturedBeat - 4.05) < 1e-12);
  const afterRebase = transportBeatAt(capturedBeat, 20, 20, 3.5, {
    start: 0,
    end: 8,
  });
  assert.equal(afterRebase, capturedBeat);
});

test("pitch ratio is exact at the octave", () => {
  assert.equal(pitchRatio(0), 1);
  assert.equal(pitchRatio(12), 2);
  assert.equal(pitchRatio(-12), 0.5);
});
