// 确定性伪随机：所有线索（含音频抖动）都经过此 RNG，保证同 seed 完全复现。
export function hashSeed(seed) {
  let h = 2166136261 >>> 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32：小而确定的 32bit PRNG。
export function createRng(seed) {
  let a = hashSeed(seed) >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 由“案件 seed + 格子坐标 + 线索类型”派生局部 RNG：
// 同一格子的扫描/监听结果与玩家操作历史无关，线索顺序天然可复现。
export function cellRng(seed, x, y, kind) {
  return createRng(`${seed}#${kind}@${x},${y}`);
}
