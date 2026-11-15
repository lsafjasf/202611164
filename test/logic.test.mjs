import assert from 'node:assert/strict';
import { generateCase, evaluate, scoreFor } from '../js/case.js';

const a = generateCase(20261116);
const b = generateCase(20261116);
assert.deepEqual(a, b, 'same seed must regenerate identical case');
const c = generateCase(42);
assert.notDeepEqual(a.segments, c.segments, 'different seeds should differ');

const truth = {
  order: [1, 2, 3, 4].map((pos) => a.segments.find((s) => s.order === pos).id),
  directions: Object.fromEntries(a.directionTargets.map((id) => [id, a.segments[id].pan])),
};
const okRes = evaluate(a, truth);
assert.equal(okRes.solved, true, 'correct conclusion must solve the case');
assert.equal(okRes.wrongPositions.length, 0);
assert.equal(okRes.wrongDirections.length, 0);

const wrong = {
  order: truth.order.slice().reverse(),
  directions: Object.fromEntries(
    a.directionTargets.map((id) => [id, a.segments[id].pan === 'left' ? 'right' : 'left'])
  ),
};
const badRes = evaluate(a, wrong);
assert.equal(badRes.solved, false, 'wrong conclusion must not solve the case');
assert.ok(badRes.wrongPositions.length > 0, 'order dimension flagged');
assert.equal(badRes.wrongDirections.length, 2, 'both direction targets flagged');
assert.ok(badRes.hints.some((h) => h.includes('顺序维度')), 'hint names order dimension');
assert.ok(badRes.hints.some((h) => h.includes('方位维度')), 'hint names direction dimension');
assert.ok(badRes.hints.some((h) => h.includes('时间锚点')), 'hint points at time anchor');

const orderOnly = evaluate(a, { order: truth.order.slice().reverse(), directions: truth.directions });
assert.equal(orderOnly.solved, false);
assert.equal(orderOnly.wrongDirections.length, 0);
assert.ok(!orderOnly.hints.some((h) => h.includes('方位维度有误')));

assert.equal(a.rules.maxAttempts, b.rules.maxAttempts);
assert.equal(a.rules.penaltyPerFail, b.rules.penaltyPerFail);
assert.equal(scoreFor(a, 2), a.rules.baseScore - 2 * a.rules.penaltyPerFail);

console.log('All logic tests passed.');
