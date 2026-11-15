import test from "node:test";
import assert from "node:assert/strict";

import {
  RULES,
  bearingResponse,
  evaluateSubmission,
  generateCase,
  receiverTelemetry,
} from "../engine.js";

test("same seed reproduces clue order, frequencies and penalty rules", () => {
  const first = generateCase("SW-0714");
  const replay = generateCase("  sw-0714 ");

  assert.equal(first.caseId, replay.caseId);
  assert.deepEqual(first.truthOrder, replay.truthOrder);
  assert.deepEqual(
    first.sources.map(({ id, frequency, bearing, start, duration, role }) => ({
      id,
      frequency,
      bearing,
      start,
      duration,
      role,
    })),
    replay.sources.map(({ id, frequency, bearing, start, duration, role }) => ({
      id,
      frequency,
      bearing,
      start,
      duration,
      role,
    })),
  );
  assert.deepEqual(first.rules, replay.rules);
  assert.deepEqual(first.rules, RULES);
});

test("a correct chronological conclusion scores 100 with no error dimension", () => {
  const caseData = generateCase("SW-0714");
  const result = evaluateSubmission(caseData, caseData.truthOrder);

  assert.equal(result.correct, true);
  assert.equal(result.score, 100);
  assert.deepEqual(result.dimensions, ["全部维度"]);
  assert.equal(result.comparisons.length, 3);
  assert.ok(result.comparisons.every((row) => row.verdict === "hit"));
  assert.ok(result.comparisons.every((row) => row.truth.frequencyLabel && row.truth.windowLabel));
});

test("a wrong order is rejected and names the timing dimension", () => {
  const caseData = generateCase("SW-0714");
  const reversed = [...caseData.truthOrder].reverse();
  const result = evaluateSubmission(caseData, reversed);

  assert.equal(result.correct, false);
  assert.ok(result.score < 100);
  assert.ok(result.dimensions.includes("时序"));
  assert.ok(result.feedback.every((item) => item.dimension === "时序"));
  assert.match(result.feedback[0].message, /真实出现位次/);
});

test("a decoy callsign is rejected on the source dimension", () => {
  const caseData = generateCase("SW-0714");
  const wrong = [caseData.decoys[0].id, ...caseData.truthOrder.slice(1)];
  const result = evaluateSubmission(caseData, wrong);

  assert.equal(result.correct, false);
  assert.ok(result.dimensions.includes("声源"));
  assert.equal(result.feedback[0].dimension, "声源");
  assert.match(result.feedback[0].message, /邻频干扰/);
});

test("duplicate records are rejected on the completeness dimension", () => {
  const caseData = generateCase("SW-0714");
  const duplicate = [caseData.truthOrder[0], caseData.truthOrder[0], caseData.truthOrder[2]];
  const result = evaluateSubmission(caseData, duplicate);

  assert.equal(result.correct, false);
  assert.ok(result.dimensions.includes("完整性"));
  assert.ok(result.feedback.some((item) => /重复记录/.test(item.message)));
});

test("real beacons are direction sensitive while jammers are broad", () => {
  const caseData = generateCase("SW-0714");
  const beacon = caseData.truthSources[0];
  const decoy = caseData.decoys[0];

  assert.ok(bearingResponse(beacon, beacon.bearing) > 0.9);
  assert.ok(bearingResponse(beacon, (beacon.bearing + 90) % 360) < 0.1);
  assert.ok(bearingResponse(decoy, decoy.bearing) - bearingResponse(decoy, (decoy.bearing + 90) % 360) < 0.4);
});

test("a correctly tuned, directional receiver can lock a beacon", () => {
  const caseData = generateCase("SW-0714");
  const beacon = caseData.truthSources[0];
  const telemetry = receiverTelemetry(
    caseData,
    {
      frequency: beacon.frequency,
      bearing: beacon.bearing,
      gain: 48,
    },
    beacon.start + 1,
  );

  assert.equal(telemetry.nearest?.id, beacon.id);
  assert.equal(telemetry.lockable, true);
  assert.ok(telemetry.quality > 0.8);
});

test("excessive gain reports clipping and prevents a clean lock", () => {
  const caseData = generateCase("SW-0714");
  const beacon = caseData.truthSources[0];
  const telemetry = receiverTelemetry(
    caseData,
    {
      frequency: beacon.frequency,
      bearing: beacon.bearing,
      gain: 94,
    },
    beacon.start + 1,
  );

  assert.ok(telemetry.clipping > 0.5);
  assert.equal(telemetry.lockable, false);
});
