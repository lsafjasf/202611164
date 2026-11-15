function tokenize(text) {
  const parts = text.match(/[\u2e80-\u9fff]|[^\s\u2e80-\u9fff]+|\s+/g) || [];
  return parts;
}

export function wrapParagraph(text, maxWidth, measure) {
  if (!text) return [""];
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [text];
  const tokens = tokenize(text);
  const lines = [];
  let current = "";

  for (const token of tokens) {
    const candidate = current + token;
    if (current && measure(candidate) > maxWidth) {
      lines.push(current.trimEnd());
      current = token.trimStart();
    } else {
      current = candidate;
    }
  }
  if (current || lines.length === 0) lines.push(current.trimEnd());
  return lines;
}

export function layoutText(layer, measure) {
  const paragraphs = String(layer.text || "").split("\n");
  const lines = paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, layer.w, measure));
  return {
    lines,
    widths: lines.map((line) => measure(line)),
    fontSize: layer.fontSize,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing || 0,
  };
}

export class TextLayoutCache {
  constructor(limit = 96) {
    this.limit = limit;
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  key(layer) {
    return [
      layer.id,
      layer.text,
      layer.w,
      layer.font,
      layer.fontSize,
      layer.fontWeight,
      layer.lineHeight,
      layer.letterSpacing || 0,
    ].join("|");
  }

  get(layer, measure) {
    const key = this.key(layer);
    const cached = this.entries.get(key);
    if (cached) {
      this.hits += 1;
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    this.misses += 1;
    const value = layoutText(layer, measure);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return value;
  }

  clear() {
    this.entries.clear();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      hitRate: total ? this.hits / total : 0,
    };
  }
}
