// Deterministic, seedable pseudo-random utilities.
// mulberry32: same seed always produces the same byte-for-byte sequence.

export function hashStringToInt(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.seed = (typeof seed === 'string' ? hashStringToInt(seed) : seed) >>> 0;
    this.state = this.seed;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  int(min, maxInclusive) {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  fork(salt) {
    return new Rng((this.state ^ hashStringToInt(String(salt))) >>> 0);
  }
}
