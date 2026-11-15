const CJK_RE = /[⺀-⻿㐀-䶿一-鿿豈-﫿＀-￯]/;

export function isCJK(ch) {
  return CJK_RE.test(ch);
}

export function tokenize(text) {
  const tokens = [];
  let buf = '';
  let kind = null;
  const flush = () => {
    if (buf) tokens.push({ text: buf, kind });
    buf = '';
    kind = null;
  };
  for (const ch of String(text)) {
    if (/\s/.test(ch)) {
      flush();
      tokens.push({ text: ch, kind: 'space' });
    } else if (isCJK(ch)) {
      flush();
      tokens.push({ text: ch, kind: 'cjk' });
    } else {
      if (kind !== 'latin') flush();
      kind = 'latin';
      buf += ch;
    }
  }
  flush();
  return tokens;
}

export function measureWidth(ctx, text, fontSize) {
  ctx.save();
  ctx.font = `${fontSize}px "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}

function fits(ctx, line, fontSize, maxWidth) {
  return measureWidth(ctx, line, fontSize) <= maxWidth;
}

export function wrapText(ctx, text, maxWidth, fontSize) {
  const tokens = tokenize(text);
  const lines = [];
  let line = '';
  const pushLine = () => {
    const trimmed = line.trimEnd();
    if (trimmed) lines.push(trimmed);
    line = '';
  };
  for (const token of tokens) {
    if (token.kind === 'space') {
      if (line && fits(ctx, line + token.text, fontSize, maxWidth)) line += token.text;
      continue;
    }
    if (fits(ctx, line + token.text, fontSize, maxWidth)) {
      line += token.text;
      continue;
    }
    if (line) pushLine();
    if (fits(ctx, token.text, fontSize, maxWidth)) {
      line = token.text;
    } else if (token.kind === 'latin') {
      let piece = '';
      for (const ch of token.text) {
        if (fits(ctx, piece + ch, fontSize, maxWidth)) {
          piece += ch;
        } else {
          if (piece) lines.push(piece);
          piece = ch;
        }
      }
      line = piece;
    } else {
      lines.push(token.text);
      line = '';
    }
  }
  if (line.trimEnd()) lines.push(line.trimEnd());
  return avoidOrphans(ctx, lines.filter(Boolean), maxWidth, fontSize);
}

function avoidOrphans(ctx, lines, maxWidth, fontSize) {
  if (lines.length < 2) return lines;
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  const lastTokens = tokenize(last).filter((tk) => tk.kind !== 'space');
  const isOrphan = lastTokens.length <= 1;
  if (isOrphan && fits(ctx, `${prev}${last}`, maxWidth)) {
    lines[lines.length - 2] = `${prev}${last}`;
    lines.pop();
    return lines;
  }
  if (isOrphan) {
    const prevTokens = tokenize(prev);
    const joinTokens = (tks) => {
      let out = '';
      for (const tk of tks) {
        if (tk.kind === 'space') {
          if (out && !out.endsWith(' ')) out += ' ';
        } else if (
          out &&
          !out.endsWith(' ') &&
          !(tk.kind === 'cjk' && isCJK(out[out.length - 1]))
        ) {
          out += ` ${tk.text}`;
        } else {
          out += tk.text;
        }
      }
      return out.trim();
    };
    for (let take = 1; take <= prevTokens.length; take += 1) {
      const movedTokens = prevTokens.slice(-take);
      const restTokens = prevTokens.slice(0, -take);
      const movedPart = joinTokens(movedTokens);
      const rest = joinTokens(restTokens);
      const merged = `${movedPart} ${last}`.trim();
      if ((!rest || fits(ctx, rest, fontSize, maxWidth)) && fits(ctx, merged, fontSize, maxWidth)) {
        lines[lines.length - 2] = rest;
        lines[lines.length - 1] = merged;
        break;
      }
    }
  }
  return lines;
}

export function layoutText(ctx, text, maxWidth, fontSize, lineHeight = 1.35) {
  const lines = wrapText(ctx, text, maxWidth, fontSize);
  return {
    lines,
    width: Math.max(...lines.map((ln) => measureWidth(ctx, ln, fontSize)), 0),
    height: lines.length * fontSize * lineHeight,
    lineHeight: fontSize * lineHeight
  };
}
