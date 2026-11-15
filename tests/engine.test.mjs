import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClueSchedule,
  correctAnswers,
  createCase,
  evaluateAnswers,
  PENALTY_RULES
} from "../case-engine.mjs";

test("the same seed preserves sources, clue order and penalties", () => {
  const first = createCase("AURORA-774");
  const replay = createCase("AURORA-774");

  assert.deepEqual(replay.sources, first.sources);
  assert.deepEqual(replay.whiteouts, first.whiteouts);
  assert.deepEqual(replay.penaltyRules, first.penaltyRules);
  assert.deepEqual(buildClueSchedule(replay), buildClueSchedule(first));
});

test("a completely correct conclusion passes without penalty", () => {
  const caseData = createCase("AURORA-774");
  const result = evaluateAnswers(caseData, correctAnswers(caseData));

  assert.equal(result.passed, true);
  assert.equal(result.correctCount, 9);
  assert.equal(result.penalty, 0);
  assert.equal(result.feedback.length, 0);
  assert.equal(result.fields.length, 9);
  assert.ok(result.fields.every((field) => field.evidence.includes(field.sourceName)));
});

test("a wrong frequency judgement names the exact dimension and source", () => {
  const caseData = createCase("AURORA-774");
  const answers = correctAnswers(caseData);
  const target = caseData.sources[1];
  answers[1].band = target.band === "HF" ? "LF" : "HF";

  const result = evaluateAnswers(caseData, answers);
  const mistake = result.feedback.find((item) => item.sourceName === target.name);

  assert.equal(result.passed, false);
  assert.equal(result.correctCount, 8);
  assert.equal(result.penalty, PENALTY_RULES.frequency);
  assert.equal(mistake.dimension, "frequency");
  assert.match(mistake.message, /频段判断偏差/);
  assert.match(mistake.message, new RegExp(target.name));
  assert.match(mistake.message, /Hz/);
  assert.ok(result.fields.some((field) => field.dimension === "frequency" && !field.correct));
});
