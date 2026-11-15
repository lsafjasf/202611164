/*
 * 灯塔信号推理案 —— 纯逻辑层（无 DOM / 无 Audio），可在 Node 中直接测试。
 * 同一 seed 生成的案件参数与信号时序完全一致，刷新或重开都不会改变线索。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LHCase = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MORSE = {
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
    5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.'
  };

  // 机械延迟三档：雾笛响起后，首闪会滞后该时长（每轮再叠加小幅机械抖动）。
  var DELAY_BINS = [
    { id: 'low',  label: '低延迟（机械迟滞短）', ms: 240 },
    { id: 'mid',  label: '中延迟',               ms: 620 },
    { id: 'high', label: '高延迟（机械迟滞长）', ms: 1050 }
  ];

  // 风级三档：雾笛基频落在不同频段，强风同时让船漂移更快。
  var WIND_LEVELS = [
    { id: 0, label: '微风', driftPxS: 12, hornHz: 90,  bandLabel: '60–120 Hz 低频段' },
    { id: 1, label: '和风', driftPxS: 26, hornHz: 220, bandLabel: '180–260 Hz 中频段' },
    { id: 2, label: '强风', driftPxS: 44, hornHz: 370, bandLabel: '320–420 Hz 高频段' }
  ];

  var ROUNDS = 3;          // 每案广播轮数
  var MAX_ATTEMPTS = 3;    // 错误确认上限，超过则案件失败（强制返航）

  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createCase(seed) {
    var key = String(seed);
    var rnd = mulberry32(hashSeed('case:' + key));
    var route = [
      Math.floor(rnd() * 10),
      Math.floor(rnd() * 10),
      Math.floor(rnd() * 10)
    ];
    var delayIndex = Math.floor(rnd() * 3);
    var windIndex = Math.floor(rnd() * 3);
    return {
      seed: key,
      route: route,
      routeMorse: route.map(function (d) { return MORSE[d]; }),
      delayId: DELAY_BINS[delayIndex].id,
      delayIndex: delayIndex,
      windId: WIND_LEVELS[windIndex].id,
      windIndex: windIndex
    };
  }

  // 纯函数：由案件生成冻结的信号时刻表（毫秒），重播多少次都完全相同。
  function buildSchedule(c) {
    var rnd = mulberry32(hashSeed('sched:' + c.seed));
    var delayMs = DELAY_BINS[c.delayIndex].ms;
    var hornHz = WIND_LEVELS[c.windIndex].hornHz;
    var DOT = 200, DASH = 600, ELEM_GAP = 220, ROUND_GAP = 1500;

    var flashes = [];
    var horns = [];
    var rounds = [];
    var t = 800;

    for (var r = 0; r < ROUNDS; r++) {
      var hornAt = Math.round(t);
      // 机械延迟：每轮首闪相对雾笛的滞后，档内带 ±45ms 抖动。
      var roundJitter = Math.round((rnd() - 0.5) * 90);
      var firstFlashAt = hornAt + delayMs + roundJitter;
      horns.push({ at: hornAt, freq: hornHz, round: r });
      rounds.push({ index: r, hornAt: hornAt, firstFlashAt: firstFlashAt, measuredDelay: firstFlashAt - hornAt });

      var cur = firstFlashAt;
      var morse = c.routeMorse[r];
      for (var i = 0; i < morse.length; i++) {
        var ch = morse[i];
        var dur = ch === '.' ? DOT : DASH;
        flashes.push({ at: Math.round(cur), dur: dur, type: ch, round: r });
        cur += dur + ELEM_GAP + Math.round((rnd() - 0.5) * 100);
      }
      t = cur + ROUND_GAP + Math.round((rnd() - 0.5) * 200);
    }

    return {
      flashes: flashes,
      horns: horns,
      rounds: rounds,
      durationMs: Math.round(t + 400)
    };
  }

  function delayById(id) {
    for (var i = 0; i < DELAY_BINS.length; i++) {
      if (DELAY_BINS[i].id === id) return DELAY_BINS[i];
    }
    return null;
  }

  function evaluate(answer, c) {
    var routeGiven = Array.isArray(answer.route)
      ? answer.route.map(function (x) { return parseInt(x, 10); })
      : [];
    var routeOk = routeGiven.length === 3 && routeGiven.every(function (d, i) {
      return d === c.route[i];
    });
    var delayOk = answer.delayId === c.delayId;
    var windOk = answer.windId === c.windId;
    var wrongCount = (routeOk ? 0 : 1) + (delayOk ? 0 : 1) + (windOk ? 0 : 1);

    var hints = [];
    if (!routeOk) {
      var pos = -1;
      for (var i = 0; i < 3; i++) {
        if (routeGiven[i] !== c.route[i]) { pos = i + 1; break; }
      }
      hints.push('路线判断错误：第 ' + pos + ' 位闪光数字与灯塔摩斯电码不符，'
        + '请重新核对长短闪烁（点=短闪、划=长闪）。');
    }
    if (!delayOk) {
      hints.push('机械延迟判断错误：请测量每轮“雾笛响起 → 第一次闪光”的时间差，'
        + '取三轮的集中档位（低 ≈240ms / 中 ≈620ms / 高 ≈1050ms）。');
    }
    if (!windOk) {
      hints.push('风级判断错误：请读雾笛基频频段（低 60–120Hz / 中 180–260Hz / 高 320–420Hz），'
        + '同时观察船身横向漂移速度。');
    }
    return {
      routeOk: routeOk,
      delayOk: delayOk,
      windOk: windOk,
      allOk: wrongCount === 0,
      wrongCount: wrongCount,
      hints: hints
    };
  }

  function attemptScore(attemptNumber, wrongCount) {
    return Math.max(0, 100 - (attemptNumber - 1) * 15 - wrongCount * 20);
  }

  // 结算数据：每个判断维度与对应声源 / 时间 / 频段并列（仅结算阶段调用）。
  function buildVerdict(answer, c, sched, attemptNumber) {
    var result = evaluate(answer, c);
    var wind = WIND_LEVELS[c.windIndex];
    var delay = DELAY_BINS[c.delayIndex];
    return {
      result: result,
      score: attemptScore(attemptNumber, result.wrongCount),
      rows: [
        {
          dimension: '路线（三位数字）',
          source: '灯塔长短闪光 · 摩斯电码',
          clue: c.routeMorse.map(function (m, i) {
            return '第' + (i + 1) + '轮 ' + m + '（首闪 t='
              + sched.rounds[i].firstFlashAt + 'ms）';
          }).join('；'),
          truth: c.route.join(' '),
          given: (answer.route || []).join(' '),
          ok: result.routeOk
        },
        {
          dimension: '机械延迟档位',
          source: '雾笛 → 首闪的时间差',
          clue: sched.rounds.map(function (rd) {
            return '第' + (rd.index + 1) + '轮 ' + rd.measuredDelay + 'ms';
          }).join('；'),
          truth: delay.label + '（标称 ' + delay.ms + 'ms）',
          given: (delayById(answer.delayId) || { label: '未选择' }).label,
          ok: result.delayOk
        },
        {
          dimension: '风级 / 频段',
          source: '雾笛基频与船身漂移',
          clue: '基频 ' + wind.hornHz + 'Hz，属' + wind.bandLabel
            + '；漂移 ' + wind.driftPxS + 'px/s',
          truth: wind.label + '（' + wind.hornHz + 'Hz · ' + wind.bandLabel + '）',
          given: (WIND_LEVELS.filter(function (w) { return w.id === answer.windId; })[0]
            || { label: '未选择' }).label,
          ok: result.windOk
        }
      ]
    };
  }

  return {
    MORSE: MORSE,
    DELAY_BINS: DELAY_BINS,
    WIND_LEVELS: WIND_LEVELS,
    ROUNDS: ROUNDS,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    hashSeed: hashSeed,
    createCase: createCase,
    buildSchedule: buildSchedule,
    evaluate: evaluate,
    attemptScore: attemptScore,
    buildVerdict: buildVerdict
  };
});
