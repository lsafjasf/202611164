// Text layout engine with a measurement cache for the subtitle scene.
//
// Cache key: text + font + fontSize + width + align (+ style version).
// Any style change bumps the version, invalidating all cached entries.
// Line breaking keeps CJK rules (break between any CJK chars) and
// Latin rules (break at word boundaries, hard-break overlong words).

const CJK_RE =
  /[　-〿㐀-䶿一-鿿豈-﫿︰-﹏＀-｠￠-￦]/;

export function isCjk(ch) {
  return CJK_RE.test(ch);
}

// Split text into breakable units. CJK chars are individual units;
// Latin runs (word + trailing spaces) are atomic units.
export function tokenize(text) {
  const units = [];
  let word = "";
  for (const ch of text) {
    if (isCjk(ch)) {
      if (word) {
        units.push(word);
        word = "";
      }
      units.push(ch);
    } else if (ch === "\n") {
      if (word) {
        units.push(word);
        word = "";
      }
      units.push("\n");
    } else {
      word += ch;
      if (ch === " " || ch === "\t") {
        units.push(word);
        word = "";
      }
    }
  }
  if (word) units.push(word);
  return units;
}

export class TextLayoutEngine {
  // measure(text, font, fontSize) -> width in px (canvas measureText in
  // the browser, a deterministic estimator in tests).
  constructor({ measure, lineHeightRatio = 1.4, now } = {}) {
    if (typeof measure !== "function") {
      throw new Error("TextLayoutEngine requires a measure() function");
    }
    this.measure = measure;
    this.lineHeightRatio = lineHeightRatio;
    this.now = now || (() => Date.now());
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.totalLayoutMs = 0;
    this.maxLayoutMs = 0;
    this.styleVersion = 0;
  }

  // Called whenever font/fontSize/lineHeight/align defaults change.
  invalidateStyles() {
    this.styleVersion += 1;
    this.cache.clear();
  }

  _key({ text, font, fontSize, width, align }) {
    return [this.styleVersion, text, font, fontSize, width, align].join("");
  }

  // Layout one subtitle block. Returns lines, height and cache flag.
  layout({ text, font, fontSize, width, align }) {
    if (typeof text !== "string") throw new Error("layout: text must be a string");
    if (!(width > 0)) throw new Error("layout: width must be > 0");
    if (!(fontSize > 0)) throw new Error("layout: fontSize must be > 0");
    const key = this._key({ text, font, fontSize, width, align });
    const cached = this.cache.get(key);
    if (cached) {
      this.hits += 1;
      return { ...cached, fromCache: true };
    }
    const start = this.now();
    const result = this._compute({ text, font, fontSize, width, align });
    const elapsed = this.now() - start;
    this.misses += 1;
    this.totalLayoutMs += elapsed;
    if (elapsed > this.maxLayoutMs) this.maxLayoutMs = elapsed;
    this.cache.set(key, result);
    return { ...result, fromCache: false };
  }

  _compute({ text, font, fontSize, width, align }) {
    const lineHeight = Math.round(fontSize * this.lineHeightRatio * 100) / 100;
    const lines = [];
    let current = "";
    const pushLine = () => {
      lines.push({ text: current, width: this.measure(current, font, fontSize) });
      current = "";
    };
    for (const unit of tokenize(text)) {
      if (unit === "\n") {
        pushLine();
        continue;
      }
      if (current !== "" && this.measure(current + unit, font, fontSize) > width) {
        pushLine();
      }
      const piece = current === "" ? unit.trimStart() : unit;
      if (
        piece.length > 1 &&
        this.measure(piece, font, fontSize) > width
      ) {
        // Overlong Latin word: hard-break it character by character.
        for (const ch of piece) {
          if (current !== "" && this.measure(current + ch, font, fontSize) > width) {
            pushLine();
          }
          current += ch;
        }
      } else {
        current += piece;
      }
    }
    if (current !== "" || lines.length === 0) pushLine();
    return {
      lines,
      lineHeight,
      height: lines.length * lineHeight,
      align,
      width,
    };
  }

  // Stack subtitle blocks vertically; scrollTop only shifts the viewport,
  // never the block offsets, so blocks can never overlap after scrolling.
  stack(blocks, gap = 8) {
    let y = 0;
    return blocks.map((b) => {
      const placed = { ...b, y };
      y += b.height + gap;
      return placed;
    });
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      totalLayoutMs: this.totalLayoutMs,
      avgLayoutMs: this.misses === 0 ? 0 : this.totalLayoutMs / this.misses,
      maxLayoutMs: this.maxLayoutMs,
      cacheSize: this.cache.size,
      styleVersion: this.styleVersion,
    };
  }
}
