// FNV-1a (32 bit) content hashing with deterministic canonical JSON.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1aBytes(bytes) {
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

export function fnv1a(str) {
  return fnv1aBytes(new TextEncoder().encode(str));
}

export function toHex(h) {
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function canonicalHash(value) {
  return toHex(fnv1a(stableStringify(value)));
}

export function combineHash(hexParts) {
  return toHex(fnv1a(hexParts.slice().sort().join('|')));
}
