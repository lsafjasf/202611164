"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../js/engine.js");

function solveCase(seed) {
  const session = new Engine.Investigation(seed);
  session.probe();
  session.setLengthGuess(session._case.main.lengthKey);
  session.descendToJunctions();
  const directions = [];
  session._case.junctions.forEach(function (junction) {
    session.probe();
    directions.push(junction.open.direction);
    session.chooseDirection(junction.open.direction);
  });
  return { session, directions };
}

function runFixedTurns(seed, turns) {
  const session = new Engine.Investigation(seed);
  session.probe();
  session.setLengthGuess(session._case.main.lengthKey);
  session.descendToJunctions();
  const observations = [];
  turns.forEach(function (direction) {
    const probe = session.probe();
    observations.push(probe.clues.map(function (clue) {
      return [clue.bearing, clue.delayMs, clue.bandHz, clue.strengthLabel];
    }));
    session.chooseDirection(direction);
  });
  return { session, observations };
}

test("same seed produces identical clue order and turn penalties", function () {
  const seed = "K-731904";
  const turns = ["left", "right", "straight"];
  const first = runFixedTurns(seed, turns);
  const second = runFixedTurns(seed, turns);

  assert.deepEqual(first.observations, second.observations);
  assert.deepEqual(first.session.logs, second.session.logs);
  assert.equal(first.session.oxygen, second.session.oxygen);
  assert.equal(first.session.wrongTurns, second.session.wrongTurns);
});

test("wrong turns follow the stable 100, 66, 32, 0 oxygen rule", function () {
  const session = new Engine.Investigation("oxygen-rule");
  const probe = session.probe();
  assert.ok(probe);
  session.setLengthGuess(session._case.main.lengthKey);
  session.descendToJunctions();
  for (let index = 0; index < 3; index += 1) {
    session.probe();
    const junction = session._case.junctions[index];
    const wrong = Engine.BEARINGS.find(function (bearing) {
      return bearing.key !== junction.open.direction;
    });
    session.chooseDirection(wrong.key);
    const expected = [66, 32, 0][index];
    assert.equal(session.oxygen, expected);
  }
  assert.equal(session.wrongTurns, 3);
  assert.equal(session.snapshot().oxygenExhausted, true);
});

test("public state does not expose true case parameters before submission", function () {
  const session = new Engine.Investigation("sealed-before-submit");
  session.probe();
  session.setLengthGuess(session._case.main.lengthKey);
  session.descendToJunctions();
  session.probe();
  session.chooseDirection("straight");
  session.probe();
  session.chooseDirection("left");
  session.probe();
  session.chooseDirection("right");
  const snapshot = session.snapshot();
  const serialized = JSON.stringify(snapshot);

  assert.equal(Object.hasOwn(snapshot, "junctions"), false);
  assert.equal(Object.hasOwn(snapshot, "main"), false);
  assert.equal(serialized.includes("openDirection"), false);
  assert.equal(serialized.includes("\"open\""), false);
  assert.equal(snapshot.stage, "conclude");
});

test("correct conclusion is verified with evidence for all four dimensions", function () {
  const seed = "correct-case";
  const solved = solveCase(seed);
  const result = Engine.evaluateConclusion(solved.session, {
    length: solved.session._case.main.lengthKey,
    directions: solved.directions
  });

  assert.equal(result.allCorrect, true);
  assert.equal(result.verdict, "推断成立");
  assert.equal(result.correctCount, 4);
  assert.deepEqual(result.mismatchedDimensions, []);
  result.rows.forEach(function (row) {
    assert.equal(row.matched, true);
    assert.ok(row.evidence.source);
    assert.match(row.evidence.time, /ms$/);
    assert.match(row.evidence.band, /Hz$/);
  });
});

test("wrong junction conclusion names the exact mismatched dimension", function () {
  const seed = "wrong-case";
  const solved = solveCase(seed);
  const original = solved.session._case.junctions[1].open.direction;
  const wrong = Engine.BEARINGS.find(function (bearing) {
    return bearing.key !== original;
  }).key;
  const directions = solved.directions.slice();
  directions[1] = wrong;
  const result = Engine.evaluateConclusion(solved.session, {
    length: solved.session._case.main.lengthKey,
    directions
  });

  assert.equal(result.allCorrect, false);
  assert.equal(result.verdict, "部分推断成立");
  assert.deepEqual(result.mismatchedDimensions, ["第2岔口方向"]);
  assert.match(result.mismatchSummary, /第2岔口方向/);
  assert.equal(result.rows[2].matched, false);
  assert.ok(result.rows[2].evidence.source);
  assert.match(result.rows[2].evidence.time, /ms$/);
  assert.match(result.rows[2].evidence.band, /Hz$/);
  assert.match(result.rows[2].truth, /开放/);
});

test("a repeated probe does not reroll clues or append duplicate records", function () {
  const session = new Engine.Investigation("repeat-stable");
  const first = session.probe();
  const logsAfterFirst = session.logs.slice();
  const second = session.probe();

  assert.equal(first, second);
  assert.deepEqual(session.logs, logsAfterFirst);
});
