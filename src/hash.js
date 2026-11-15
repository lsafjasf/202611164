// 确定性哈希工具：FNV-1a (32 位) + 结构化稳定序列化。

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashBytes(bytes, seed = 0) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function toHex(h) {
  return (h >>> 0).toString(16).padStart(8, "0");
}

// 对任意可结构化数据生成稳定哈希；对象按 key 排序，数组按顺序。
export function hashValue(value) {
  return hashString(stableStringify(value));
}

export function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

// 组合多个哈希，顺序敏感。
export function combineHashes(parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Number(p) >>> 0;
    h = Math.imul(h, 0x01000193);
    h = (h + 0x9e3779b9) >>> 0;
  }
  return h >>> 0;
}
