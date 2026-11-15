import test from "node:test";
import assert from "node:assert/strict";
import { collectNotes, compareProjects, noteStats } from "../src/notes.js";
import {
  automationAt,
  createDemoProject,
  deserializeProject,
  serializeProject,
  trackEnvelopeAt,
  updateTrack
} from "../src/project.js";

test("demo project round-trips with identical notes and track positions", () => {
  const before = createDemoProject();
  const after = deserializeProject(serializeProject(before));
  const comparison = compareProjects(before, after);
  assert.equal(comparison.noteCountMatches, true);
  assert.equal(comparison.beatSignatureMatches, true);
  assert.equal(comparison.trackPositionsMatch, true);
  assert.ok(comparison.before.count > 80);
  assert.deepEqual(comparison.before.beatPositions, comparison.after.beatPositions);
});

test("moving a clip shifts notes without changing its internal rhythm", () => {
  const before = createDemoProject();
  const track = before.tracks.find((candidate) => candidate.id === "machine");
  const moved = updateTrack(before, track.id, { start: 5.5 });
  const oldNotes = collectNotes(before).filter((note) => note.trackId === track.id);
  const newNotes = collectNotes(moved).filter((note) => note.trackId === track.id);
  assert.equal(oldNotes.length, newNotes.length);
  for (let index = 0; index < oldNotes.length; index += 1) {
    assert.ok(Math.abs((newNotes[index].time - oldNotes[index].time) - 1.3) < 1e-9);
    assert.equal(newNotes[index].localBeat, oldNotes[index].localBeat);
  }
});

test("automation and crossfade envelopes stay in range", () => {
  const project = createDemoProject();
  const track = project.tracks[0];
  assert.equal(automationAt(track, 0), track.automation[0].value);
  assert.equal(automationAt(track, track.duration), track.automation.at(-1).value);
  assert.equal(trackEnvelopeAt(track, track.start - 0.01), 0);
  assert.equal(trackEnvelopeAt(track, track.start + track.duration + 0.01), 0);
  for (let time = 0; time <= track.duration; time += 0.1) {
    const envelope = trackEnvelopeAt(track, track.start + time);
    assert.ok(envelope >= 0 && envelope <= 1.5);
  }
});

test("note stats expose stable beat positions for reload comparison", () => {
  const project = createDemoProject();
  const stats = noteStats(project);
  assert.equal(stats.positions.length, stats.count);
  assert.match(stats.signature, /^[0-9a-f]{8}$/);
  assert.equal(stats.positions[0], `${collectNotes(project)[0].trackId}@${collectNotes(project)[0].beat.toFixed(6)}`);
});
