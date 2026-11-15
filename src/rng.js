// 可复现随机数：mulberry32。任意 seed（数字或字符串）产生同一序列。

import { hashString } from "./hash.js";

export function seedToInt(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  return hashString(String(seed));
}

export function makeRng(seed) {
  let state = seedToInt(seed);
  const rng = {
    next() {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) {
      return min + rng.next() * (max - min);
    },
    int(min, maxExclusive) {
      return min + Math.floor(rng.next() * (maxExclusive - min));
    },
    pick(list) {
      return list[rng.int(0, list.length)];
    },
  };
  return rng;
}

// 为子系统派生独立但确定性的随机流。
export function subRng(seed, namespace) {
  return makeRng(hashString(`${namespace}::${seedToInt(seed)}`));
}
