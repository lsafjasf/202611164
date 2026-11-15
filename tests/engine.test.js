import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECKS_PER_CASE,
  CHECK_DIMENSIONS,
  applyMarkCheck,
  buildTruthAnswers,
  createCase,
  evaluateMark,
  evaluateSubmission,
} from "../src/engine.js";

test("同一 seed 重开生成相同的线索顺序与惩罚规则", () => {
  const first = createCase("  echo-0417  ");
  const second = createCase("ECHO-0417");
  const firstShape = {
    caseNumber: first.caseNumber,
    clueOrder: first.clues.map((clue) => [clue.id, clue.label, clue.eventId]),
    checksPerCase: first.checksPerCase,
    events: first.events.map((event) => ({
      key: event.key,
      trueOrder: event.trueOrder,
      direction: event.direction,
      distance: event.distance,
      time: event.time,
    })),
  };
  const secondShape = {
    caseNumber: second.caseNumber,
    clueOrder: second.clues.map((clue) => [clue.id, clue.label, clue.eventId]),
    checksPerCase: second.checksPerCase,
    events: second.events.map((event) => ({
      key: event.key,
      trueOrder: event.trueOrder,
      direction: event.direction,
      distance: event.distance,
      time: event.time,
    })),
  };
  assert.deepEqual(firstShape, secondShape);
  assert.equal(first.checksPerCase, CHECKS_PER_CASE);
  assert.equal(first.checksPerCase, 3);
});

test("不同 seed 会生成不同的案件参数", () => {
  const first = createCase("ALPHA-7");
  const second = createCase("BETA-7");
  assert.notEqual(first.caseNumber, second.caseNumber);
  assert.notDeepEqual(
    first.clues.map((clue) => clue.eventId),
    second.clues.map((clue) => clue.eventId),
  );
});

test("正确结论：所有时间、方位与距离判断均通过", () => {
  const caseData = createCase("VERIFY-CORRECT");
  const answers = buildTruthAnswers(caseData);
  const evaluation = evaluateSubmission(caseData, answers);

  assert.equal(evaluation.overallCorrect, true);
  assert.equal(evaluation.correctRows, 6);
  assert.deepEqual(evaluation.wrongDimensions, []);
  assert.deepEqual(evaluation.totals, {
    timeline: 6,
    direction: 6,
    distance: 6,
  });
  for (const row of evaluation.rows) {
    assert.equal(row.correct, true);
    assert.ok(row.event.source);
    assert.ok(row.event.time);
    assert.ok(row.event.band);
  }
});

test("错误结论：交换原序位后指出时间顺序维度", () => {
  const caseData = createCase("VERIFY-WRONG-TIME");
  const answers = buildTruthAnswers(caseData);
  const [first, second] = caseData.clues;
  const firstOrder = answers[first.id].order;
  answers[first.id].order = answers[second.id].order;
  answers[second.id].order = firstOrder;
  const evaluation = evaluateSubmission(caseData, answers);

  assert.equal(evaluation.overallCorrect, false);
  assert.ok(evaluation.wrongDimensions.includes("timeline"));
  assert.ok(evaluation.totals.timeline < 6);
  assert.match(CHECK_DIMENSIONS.timeline.hint, /时间顺序/);
});

test("错误检查：方位或距离错误时给出对应维度并只扣一次机会", () => {
  const caseData = createCase("VERIFY-CHECK");
  const clue = caseData.clues[0];
  const answers = buildTruthAnswers(caseData);
  const truth = answers[clue.id];

  const wrongDirection =
    truth.direction === "左前"
      ? "右后"
      : truth.direction === "右后"
        ? "左前"
        : truth.direction === "右前"
          ? "左后"
          : "右前";
  const directionCheck = applyMarkCheck(
    caseData,
    CHECKS_PER_CASE,
    clue.id,
    { ...truth, direction: wrongDirection },
  );
  assert.equal(directionCheck.correct, false);
  assert.equal(directionCheck.wrongDimension, "direction");
  assert.equal(directionCheck.checksRemaining, CHECKS_PER_CASE - 1);
  assert.equal(directionCheck.consumed, true);
  assert.match(directionCheck.hint, /声源方位/);

  const wrongDistance = truth.distance === "近" ? "远" : "近";
  const distanceCheck = applyMarkCheck(
    caseData,
    directionCheck.checksRemaining,
    clue.id,
    { ...truth, distance: wrongDistance },
  );
  assert.equal(distanceCheck.correct, false);
  assert.equal(distanceCheck.wrongDimension, "distance");
  assert.equal(distanceCheck.checksRemaining, CHECKS_PER_CASE - 2);
  assert.match(distanceCheck.hint, /距离层级/);
});

test("正确标记通过检查但不消耗机会", () => {
  const caseData = createCase("VERIFY-PASS");
  const clue = caseData.clues[2];
  const guess = buildTruthAnswers(caseData)[clue.id];
  const result = applyMarkCheck(caseData, CHECKS_PER_CASE, clue.id, guess);
  assert.equal(result.correct, true);
  assert.equal(result.checksRemaining, CHECKS_PER_CASE);
  assert.equal(result.consumed, false);
});

test("错误结论可以同时指出多个判断维度", () => {
  const caseData = createCase("VERIFY-MULTI");
  const answers = buildTruthAnswers(caseData);
  const [clue] = caseData.clues;
  const event = caseData.eventsById.get(clue.eventId);
  answers[clue.id] = {
    order: event.trueOrder === 1 ? 2 : 1,
    direction: event.direction === "左前" ? "右后" : "左前",
    distance: event.distance === "近" ? "远" : "近",
  };
  const mark = evaluateMark(caseData, clue.id, answers[clue.id]);
  const evaluation = evaluateSubmission(caseData, answers);
  assert.equal(mark.wrongDimension, "timeline");
  assert.deepEqual(evaluation.wrongDimensions, [
    "timeline",
    "direction",
    "distance",
  ]);
});
