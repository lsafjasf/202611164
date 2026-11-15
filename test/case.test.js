'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var LH = require('../js/case.js');

function deep(x) { return JSON.parse(JSON.stringify(x)); }

test('同 seed 的案件参数与信号时刻表完全一致（线索顺序、抖动、惩罚规则固定）', function () {
  var a = LH.createCase('A-1024');
  var b = LH.createCase('A-1024');
  assert.deepEqual(deep(b), deep(a));
  assert.deepEqual(deep(LH.buildSchedule(b)), deep(LH.buildSchedule(a)));

  var c = LH.createCase('A-1025');
  assert.notDeepEqual(c, a);
  assert.equal(a.route.length, 3);
  assert.ok(a.route.every(function (d) { return d >= 0 && d <= 9; }));
});

test('不同 seed 会覆盖不同延迟档与风级', function () {
  var seenDelay = {};
  var seenWind = {};
  for (var i = 0; i < 60; i++) {
    var cs = LH.createCase('seed-' + i);
    seenDelay[cs.delayId] = true;
    seenWind[cs.windId] = true;
  }
  assert.deepEqual(Object.keys(seenDelay).sort(), ['high', 'low', 'mid']);
  assert.deepEqual(Object.keys(seenWind).map(Number).sort(), [0, 1, 2]);
});

test('雾笛到首闪的时间差确实落在对应机械延迟档附近', function () {
  for (var i = 0; i < 20; i++) {
    var cs = LH.createCase('delay-' + i);
    var sched = LH.buildSchedule(cs);
    var nominal = LH.DELAY_BINS[cs.delayIndex].ms;
    sched.rounds.forEach(function (rd) {
      assert.ok(Math.abs(rd.measuredDelay - nominal) <= 45,
        'measured=' + rd.measuredDelay + ' nominal=' + nominal);
    });
  }
});

test('正确结论：全部维度通过，且结算行把判断与声源/时间/频段并列', function () {
  var cs = LH.createCase('VERIFY-OK');
  var sched = LH.buildSchedule(cs);
  var answer = { route: cs.route.slice(), delayId: cs.delayId, windId: cs.windId };
  var verdict = LH.buildVerdict(answer, cs, sched, 1);
  assert.equal(verdict.result.allOk, true);
  assert.equal(verdict.score, 100);
  assert.equal(verdict.rows.length, 3);
  verdict.rows.forEach(function (row) {
    assert.equal(row.ok, true);
    assert.ok(row.source.length > 0);
    assert.ok(row.clue.length > 0);
  });
  assert.equal(verdict.rows[0].given, cs.route.join(' '));
  assert.equal(verdict.rows[1].given, LH.DELAY_BINS[cs.delayIndex].label);
  assert.equal(verdict.rows[2].given, LH.WIND_LEVELS[cs.windIndex].label);
  assert.ok(verdict.rows[1].truth.indexOf(LH.DELAY_BINS[cs.delayIndex].label) === 0);
  assert.ok(verdict.rows[2].truth.indexOf(LH.WIND_LEVELS[cs.windIndex].label) === 0);
  assert.ok(/ms/.test(verdict.rows[1].clue));
  assert.ok(/Hz/.test(verdict.rows[2].clue));
});

test('错误结论：每个错误维度给出指向具体判断维度的提示', function () {
  var cs = LH.createCase('VERIFY-BAD');
  var sched = LH.buildSchedule(cs);
  var wrongRoute = cs.route.map(function (d) { return (d + 1) % 10; });
  var wrongDelay = LH.DELAY_BINS[(cs.delayIndex + 1) % 3].id;
  var wrongWind = (cs.windId + 1) % 3;
  var answer = { route: wrongRoute, delayId: wrongDelay, windId: wrongWind };

  var result = LH.evaluate(answer, cs);
  assert.equal(result.allOk, false);
  assert.equal(result.wrongCount, 3);
  assert.equal(result.hints.length, 3);
  assert.ok(result.hints[0].indexOf('路线') === 0);
  assert.ok(result.hints[1].indexOf('机械延迟') === 0);
  assert.ok(result.hints[2].indexOf('风级') === 0);

  var verdict = LH.buildVerdict(answer, cs, sched, 2);
  assert.equal(verdict.score, LH.attemptScore(2, 3));
  assert.equal(verdict.score, 25); // 100 - 15 - 60
  verdict.rows.forEach(function (row) { assert.equal(row.ok, false); });
});

test('只错风级时仅给出风级维度的提示，其余维度判对', function () {
  var cs = LH.createCase('VERIFY-WIND');
  var answer = {
    route: cs.route.slice(),
    delayId: cs.delayId,
    windId: (cs.windId + 1) % 3
  };
  var result = LH.evaluate(answer, cs);
  assert.equal(result.routeOk, true);
  assert.equal(result.delayOk, true);
  assert.equal(result.windOk, false);
  assert.equal(result.hints.length, 1);
  assert.ok(/风级判断错误/.test(result.hints[0]));
});

test('同 seed 重开：第二次提交的扣分规则与首次保持一致', function () {
  var cs = LH.createCase('PENALTY-7');
  var sched = LH.buildSchedule(cs);
  var good = { route: cs.route.slice(), delayId: cs.delayId, windId: cs.windId };
  var bad = {
    route: cs.route.map(function (d) { return (d + 1) % 10; }),
    delayId: cs.delayId,
    windId: cs.windId
  };
  var first = LH.buildVerdict(bad, cs, sched, 1);
  var reopen = LH.buildVerdict(bad, cs, LH.buildSchedule(LH.createCase('PENALTY-7')), 1);
  assert.equal(reopen.score, first.score);
  assert.deepEqual(reopen.rows.map(function (r) { return r.clue; }),
    first.rows.map(function (r) { return r.clue; }));
  assert.equal(LH.buildVerdict(good, cs, sched, 3).score, 70);
});
