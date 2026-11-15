(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.GameLogic = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const BAND_KEYS = ['low', 'mid', 'high'];
  const BANDS = {
    low:  { label: '低频台', freq: 196, color: '#e05555' },
    mid:  { label: '中频台', freq: 392, color: '#3fa34d' },
    high: { label: '高频台', freq: 784, color: '#4a7ddb' },
  };
  const RANGE_KEYS = ['near', 'mid', 'far'];
  const RANGES = {
    near: { label: '近', min: 2.0, max: 4.5 },
    mid:  { label: '中', min: 5.5, max: 8.0 },
    far:  { label: '远', min: 9.0, max: 12.0 },
  };
  const DIR_KEYS = ['left', 'center', 'right'];
  const DIR_LABELS = { left: '左', center: '中', right: '右' };

  // 山谷声学规则（游戏内恒定，会在规则面板中告知玩家）
  const DIRECT_PER_UNIT = 0.12; // 直达声延迟 = 距离 * 0.12s
  const GAP_PER_UNIT = 0.25;    // 真回波与直达声时差 = 距离 * 0.25s
  const ORDER_STAGGER = 1.5;    // 相邻播报顺序的起播间隔
  const LOOP_SECONDS = 6.0;     // 片段循环周期
  const CORRECT_SCORE = 10;
  const PENALTY_CHOICES = [5, 8, 10]; // 错误惩罚分，由 seed 决定且同 seed 恒定

  function rangeOf(dist) {
    for (const k of RANGE_KEYS) if (dist < RANGES[k].max + 1e-9 && dist >= RANGES[k].min - 1e-9) return k;
    return dist < RANGES.near.min ? 'near' : 'far';
  }
  function dirOf(x) {
    if (x < -2.5) return 'left';
    if (x > 2.5) return 'right';
    return 'center';
  }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function generateCase(seed) {
    const rng = mulberry32(seed);
    const rangeAssign = shuffled(RANGE_KEYS, rng); // rangeAssign[i] -> BAND_KEYS[i] 的距离档
    const stations = {};
    BAND_KEYS.forEach((band, i) => {
      const range = rangeAssign[i];
      const dist = RANGES[range].min + rng() * (RANGES[range].max - RANGES[range].min);
      let x, y;
      do {
        const ang = (20 + rng() * 140) * Math.PI / 180;
        x = dist * Math.cos(ang);
        y = dist * Math.sin(ang);
      } while (Math.abs(Math.abs(x) - 2.5) < 0.6); // 避免方位边界模糊
      const motif = [];
      const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
      for (let n = 0; n < 5; n++) motif.push(scale[Math.floor(rng() * scale.length)]);
      stations[band] = {
        band, x, y, dist,
        range, dir: dirOf(x),
        directDelay: dist * DIRECT_PER_UNIT,
        echoGap: dist * GAP_PER_UNIT,
        motif,
      };
    });
    const order = shuffled(BAND_KEYS, rng); // order[0] 为第 1 棒
    BAND_KEYS.forEach((band) => { stations[band].orderIndex = order.indexOf(band); });
    const falseEchoBand = BAND_KEYS[Math.floor(rng() * 3)];
    const st = stations[falseEchoBand];
    st.falseEchoGap = st.echoGap * (1.35 + rng() * 0.5);
    const penalty = PENALTY_CHOICES[Math.floor(rng() * PENALTY_CHOICES.length)];
    return { seed, stations, order, falseEchoBand, penalty, correctScore: CORRECT_SCORE };
  }

  // guesses: { dir: {low,mid,high}, dist: {low,mid,high}, order: [band,band,band] }
  function evaluate(caseData, guesses) {
    const rows = [];
    const st = caseData.stations;
    BAND_KEYS.forEach((band) => {
      const s = st[band];
      const gDir = guesses.dir[band];
      const okDir = gDir === s.dir;
      rows.push({
        dimension: '方位', band, guess: DIR_LABELS[gDir] || '未选', truth: DIR_LABELS[s.dir],
        correct: okDir,
        hint: okDir ? '' : `方位判断错误：${BANDS[band].label}实际位于${DIR_LABELS[s.dir]}侧（x=${s.x.toFixed(1)}），应依据声像左右偏转判断。`,
        data: `x=${s.x.toFixed(1)}`,
      });
      const gDist = guesses.dist[band];
      const okDist = gDist === s.range;
      let hint = '';
      if (!okDist) {
        hint = `距离判断错误：${BANDS[band].label}真实距离 ${s.dist.toFixed(1)}（${RANGES[s.range].label}档），真回波时差 ${s.echoGap.toFixed(2)}s。`;
        if (band === caseData.falseEchoBand) {
          hint += ` 该台混有 ${s.falseEchoGap.toFixed(2)}s 的假回波（消音窗口下会消失），你可能采信了它。`;
        }
      }
      rows.push({
        dimension: '距离', band, guess: (RANGES[gDist] || {}).label || '未选', truth: RANGES[s.range].label,
        correct: okDist, hint,
        data: `dist=${s.dist.toFixed(1)} 回波差=${s.echoGap.toFixed(2)}s 直达延迟=${s.directDelay.toFixed(2)}s`,
      });
    });
    caseData.order.forEach((truthBand, idx) => {
      const gBand = guesses.order[idx];
      const ok = gBand === truthBand;
      const s = st[truthBand];
      rows.push({
        dimension: `播报顺序·第${idx + 1}棒`, band: truthBand,
        guess: (BANDS[gBand] || {}).label || '未选', truth: BANDS[truthBand].label,
        correct: ok,
        hint: ok ? '' : `顺序判断错误：第${idx + 1}棒实为${BANDS[truthBand].label}（起播偏移 ${(s.orderIndex * ORDER_STAGGER).toFixed(1)}s）。用该频段到达时刻减去直达延迟 ${s.directDelay.toFixed(2)}s 校正后再排序。`,
        data: `起播偏移=${(s.orderIndex * ORDER_STAGGER).toFixed(1)}s`,
      });
    });
    const correctCount = rows.filter((r) => r.correct).length;
    const wrongCount = rows.length - correctCount;
    const score = correctCount * caseData.correctScore - wrongCount * caseData.penalty;
    return { rows, correctCount, wrongCount, score, maxScore: rows.length * caseData.correctScore, penalty: caseData.penalty };
  }

  return {
    BAND_KEYS, BANDS, RANGES, RANGE_KEYS, DIR_KEYS, DIR_LABELS,
    DIRECT_PER_UNIT, GAP_PER_UNIT, ORDER_STAGGER, LOOP_SECONDS,
    generateCase, evaluate, rangeOf, dirOf,
  };
});
