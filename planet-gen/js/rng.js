// Deterministic RNG + hashing utilities. Pure module (browser & node).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit over a string.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashHex(str) {
  // 64-bit-ish hex digest from two FNV passes with different offset basis.
  const h1 = fnv1a(str);
  const h2 = fnv1a('~' + str) ^ 0x9e3779b9;
  return h1.toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

// Stable stringify: sorts object keys so hash is order-independent.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function hashObject(obj) {
  return hashHex(stableStringify(obj));
}

// Quantize a float so hash is robust to tiny FP noise across runs.
export function q(x, digits = 5) {
  const p = Math.pow(10, digits);
  return Math.round(x * p) / p;
}
