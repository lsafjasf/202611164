/*
 * 三组确定性测试场景(正常 / 边界 / 损坏)。
 * 使用固定种子的 PRNG,保证失败场景可重复。
 */
(function (global) {
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

  const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'];

  /** 正常场景:默认 5 万个合法关键帧 */
  function normalScenario(count) {
    const n = count || 50000;
    const rand = mulberry32(20261116);
    const keyframes = new Array(n);
    for (let i = 0; i < n; i += 1) {
      keyframes[i] = {
        id: 'kf-' + i,
        time: Math.round(i * 33.333 * 1000) / 1000,
        value: Math.round(rand() * 2000 - 1000) / 1000,
        track: 'track-' + (i % 8),
        easing: EASINGS[i % EASINGS.length]
      };
    }
    return JSON.stringify({ name: 'normal-project', version: 1, keyframes });
  }

  /** 边界场景:空数组、单帧、极值时间、Unicode、缺省可选字段 */
  function boundaryScenario() {
    const keyframes = [
      { id: 'k-zero', time: 0, value: 0 },
      { id: 'k-huge', time: 1e15, value: -1e308 },
      { id: 'k-tiny', time: 0.000001, value: 5e-324 },
      { id: 'k-unicode', time: 1.5, value: 3.14,
        track: '轨道-α-🎬', easing: 'step' },
      { id: 'k-neg-value', time: 999999.999, value: -0.0 }
    ];
    const empty = JSON.stringify({ name: 'boundary-empty', version: 1,
      keyframes: [] });
    const single = JSON.stringify({ name: 'boundary-single', version: 1,
      keyframes: [keyframes[0]] });
    const extreme = JSON.stringify({ name: 'boundary-extreme', version: 1,
      keyframes });
    return { empty, single, extreme,
      combined: [empty, single, extreme] };
  }

  /** 损坏场景:确定性构造,可重复 */
  function corruptedScenario() {
    const rand = mulberry32(42);
    const keyframes = [];
    for (let i = 0; i < 2000; i += 1) {
      keyframes.push({
        id: 'kf-' + i,
        time: i * 16.666,
        value: Math.round(rand() * 100) / 100,
        track: 'track-' + (i % 4),
        easing: 'linear'
      });
    }
    // 注入确定性字段错误
    keyframes[100] = { id: 123, time: -5, value: 'abc' };      // 多字段类型错误
    keyframes[500] = 'not-an-object';                          // 非对象
    keyframes[999] = { id: 'kf-999', time: 999, value: 1,
      easing: 'bounce' };                                      // 非法枚举
    keyframes[1500] = { time: 10, value: 2 };                  // 缺 id
    const fieldErrors = JSON.stringify(
      { name: 'corrupted-fields', version: 1, keyframes });
    const truncated = fieldErrors.slice(0, fieldErrors.length - 137);
    const syntaxBroken = fieldErrors.replace('"id":"kf-10"', '"id":kf-10');
    return { fieldErrors, truncated, syntaxBroken };
  }

  const api = { normalScenario, boundaryScenario, corruptedScenario, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Scenarios = api;
})(typeof window !== 'undefined' ? window : globalThis);
