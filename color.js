(function (root) {
  "use strict";

  const CVD_MATRICES = {
    normal: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ],
    deuteranopia: [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.01182, 0.04294, 0.968881]
    ],
    protanopia: [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998]
    ],
    tritanopia: [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039]
    ]
  };

  const MODES = [
    {
      id: "normal",
      label: "普通视觉",
      short: "普通",
      description: "标准 sRGB 色觉"
    },
    {
      id: "deuteranopia",
      label: "红绿弱视模拟",
      short: "红绿",
      description: "Deuteranopia · 绿色感受缺失"
    },
    {
      id: "tritanopia",
      label: "蓝黄弱视模拟",
      short: "蓝黄",
      description: "Tritanopia · 蓝色感受缺失"
    }
  ];

  const DEFAULT_PALETTE = [
    { id: "surface", name: "画布背景", role: "Surface", value: "#F4F1E8", locked: true },
    { id: "text", name: "正文墨色", role: "Ink", value: "#17201D", locked: true },
    { id: "series1", name: "密钥绿", role: "Primary", value: "#237A65", locked: true },
    { id: "series2", name: "烟褐", role: "Series 02", value: "#6B3624", locked: false },
    { id: "series3", name: "深钴蓝", role: "Series 03", value: "#1442CC", locked: false },
    { id: "series4", name: "洋莓", role: "Series 04", value: "#D92A63", locked: false },
    { id: "series5", name: "橄榄", role: "Series 05", value: "#8A6E2E", locked: false },
    { id: "series6", name: "深鸢尾", role: "Series 06", value: "#4D2E8A", locked: false }
  ];

  const SERIES_IDS = ["series1", "series2", "series3", "series4", "series5", "series6"];
  const DATA_IDS = ["series1", "series2", "series3", "series4", "series5"];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseHex(input) {
    if (typeof input !== "string") {
      throw new Error("INVALID_HEX: 色值必须是字符串");
    }
    const value = input.trim().toUpperCase();
    let match = /^#([0-9A-F]{6})$/.exec(value);
    if (match) {
      return {
        r: parseInt(match[1].slice(0, 2), 16),
        g: parseInt(match[1].slice(2, 4), 16),
        b: parseInt(match[1].slice(4, 6), 16)
      };
    }
    match = /^#([0-9A-F]{3})$/.exec(value);
    if (match) {
      return {
        r: parseInt(match[1][0] + match[1][0], 16),
        g: parseInt(match[1][1] + match[1][1], 16),
        b: parseInt(match[1][2] + match[1][2], 16)
      };
    }
    throw new Error(`INVALID_HEX: ${input} 不是有效的 #RRGGBB 色值`);
  }

  function isValidHex(input) {
    try {
      parseHex(input);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function componentToHex(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0").toUpperCase();
  }

  function rgbToHex(rgb) {
    return `#${componentToHex(rgb.r)}${componentToHex(rgb.g)}${componentToHex(rgb.b)}`;
  }

  function normalizeHex(input) {
    return rgbToHex(parseHex(input));
  }

  function srgbToLinear(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(channel) {
    const value = clamp(channel, 0, 1);
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  }

  function relativeLuminance(rgb) {
    const r = srgbToLinear(rgb.r);
    const g = srgbToLinear(rgb.g);
    const b = srgbToLinear(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(hexA, hexB) {
    const a = relativeLuminance(parseHex(hexA));
    const b = relativeLuminance(parseHex(hexB));
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function simulateHex(hex, mode) {
    const matrix = CVD_MATRICES[mode] || CVD_MATRICES.normal;
    if (mode === "normal") {
      return normalizeHex(hex);
    }
    const rgb = parseHex(hex);
    const linear = [srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b)];
    const transformed = matrix.map((row) =>
      row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]
    );
    return rgbToHex({
      r: linearToSrgb(transformed[0]),
      g: linearToSrgb(transformed[1]),
      b: linearToSrgb(transformed[2])
    });
  }

  function rgbToXyz(rgb) {
    const r = srgbToLinear(rgb.r);
    const g = srgbToLinear(rgb.g);
    const b = srgbToLinear(rgb.b);
    return {
      x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
      y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
      z: r * 0.0193339 + g * 0.119192 + b * 0.9503041
    };
  }

  function pivotLab(value) {
    return value > 0.008856451679 ? Math.cbrt(value) : 7.787037037 * value + 16 / 116;
  }

  function rgbToLab(rgb) {
    const xyz = rgbToXyz(rgb);
    const xr = pivotLab(xyz.x / 0.95047);
    const yr = pivotLab(xyz.y / 1);
    const zr = pivotLab(xyz.z / 1.08883);
    return {
      l: 116 * yr - 16,
      a: 500 * (xr - yr),
      b: 200 * (yr - zr)
    };
  }

  function deltaE76(hexA, hexB) {
    const a = rgbToLab(parseHex(hexA));
    const b = rgbToLab(parseHex(hexB));
    return Math.sqrt(
      Math.pow(a.l - b.l, 2) +
      Math.pow(a.a - b.a, 2) +
      Math.pow(a.b - b.b, 2)
    );
  }

  function hslToRgb(h, s, l) {
    const hue = ((h % 360) + 360) % 360 / 360;
    if (s === 0) {
      const gray = Math.round(l * 255);
      return { r: gray, g: gray, b: gray };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hueToRgb = (t) => {
      let value = t;
      if (value < 0) value += 1;
      if (value > 1) value -= 1;
      if (value < 1 / 6) return p + (q - p) * 6 * value;
      if (value < 1 / 2) return q;
      if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
      return p;
    };
    return {
      r: Math.round(hueToRgb(hue + 1 / 3) * 255),
      g: Math.round(hueToRgb(hue) * 255),
      b: Math.round(hueToRgb(hue - 1 / 3) * 255)
    };
  }

  function hslToHex(h, s, l) {
    return rgbToHex(hslToRgb(h, s, l));
  }

  function hashSeed(seed) {
    const value = String(seed || "QG-2048");
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function getPaletteMap(palette) {
    return palette.reduce((map, token) => {
      map[token.id] = token;
      return map;
    }, {});
  }

  function pairName(a, b) {
    return `${a.role} / ${b.role}`;
  }

  function analyzeMode(palette, mode) {
    const map = getPaletteMap(palette);
    const surface = map.surface ? simulateHex(map.surface.value, mode) : "#FFFFFF";
    const text = map.text ? simulateHex(map.text.value, mode) : "#000000";
    const series = SERIES_IDS
      .filter((id) => map[id])
      .map((id) => {
        const token = map[id];
        return {
          token,
          simulated: simulateHex(token.value, mode),
          contrast: contrastRatio(simulateHex(token.value, mode), surface)
        };
      });
    const textContrast = contrastRatio(text, surface);
    const seriesContrast = series.length
      ? Math.min(...series.map((item) => item.contrast))
      : 0;
    const pairs = [];
    const issues = [];

    for (let i = 0; i < series.length; i += 1) {
      for (let j = i + 1; j < series.length; j += 1) {
        const left = series[i];
        const right = series[j];
        const delta = deltaE76(left.simulated, right.simulated);
        pairs.push({
          leftId: left.token.id,
          rightId: right.token.id,
          label: pairName(left.token, right.token),
          delta
        });
      }
    }

    pairs.sort((a, b) => a.delta - b.delta);
    const minDelta = pairs.length ? pairs[0].delta : 0;
    const avgDelta = pairs.length
      ? pairs.reduce((sum, pair) => sum + pair.delta, 0) / pairs.length
      : 0;

    if (textContrast < 4.5) {
      issues.push({
        type: "text-contrast",
        severity: "critical",
        title: "文字对比度不足",
        detail: `正文与画布仅 ${textContrast.toFixed(2)}:1，要求 ≥ 4.5:1。`,
        value: `${textContrast.toFixed(2)}:1`
      });
    }

    if (seriesContrast < 3) {
      const weakest = series.reduce((lowest, item) =>
        item.contrast < lowest.contrast ? item : lowest
      , series[0]);
      issues.push({
        type: "series-contrast",
        severity: "critical",
        title: "图形对比度不足",
        detail: `${weakest.token.name} 与画布仅 ${weakest.contrast.toFixed(2)}:1，要求 ≥ 3:1。`,
        value: `${weakest.contrast.toFixed(2)}:1`
      });
    }

    pairs.filter((pair) => pair.delta < 12).forEach((pair) => {
      issues.push({
        type: "pair-delta",
        severity: pair.delta < 8 ? "critical" : "warning",
        title: "序列色差接近",
        detail: `${pair.label} 在${MODES.find((item) => item.id === mode).label}下仅 ΔE ${pair.delta.toFixed(1)}。`,
        value: `ΔE ${pair.delta.toFixed(1)}`
      });
    });

    const deltaScore = clamp((minDelta / 22) * 100, 0, 100);
    const seriesScore = clamp(((seriesContrast - 1.5) / 3.5) * 100, 0, 100);
    const textScore = clamp(((textContrast - 3) / 8) * 100, 0, 100);
    const penalty = issues.filter((issue) => issue.severity === "critical").length * 8;
    const score = Math.round(clamp(
      deltaScore * 0.56 + seriesScore * 0.28 + textScore * 0.16 - penalty,
      0,
      100
    ));
    const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
    const status = criticalCount ? "fail" : issues.length ? "warn" : "pass";

    return {
      mode,
      label: MODES.find((item) => item.id === mode).label,
      surface,
      text,
      series,
      pairs,
      minDelta,
      avgDelta,
      textContrast,
      seriesContrast,
      issues,
      score,
      status
    };
  }

  function evaluate(palette) {
    const modes = MODES.map((mode) => analyzeMode(palette, mode.id));
    const critical = modes.flatMap((mode) =>
      mode.issues
        .filter((issue) => issue.severity === "critical")
        .map((issue) => ({ ...issue, mode: mode.mode, modeLabel: mode.label }))
    );
    const warnings = modes.flatMap((mode) =>
      mode.issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => ({ ...issue, mode: mode.mode, modeLabel: mode.label }))
    );
    const score = Math.round(modes.reduce((sum, mode) => sum + mode.score, 0) / modes.length);
    return {
      modes,
      critical,
      warnings,
      issues: [...critical, ...warnings],
      score,
      status: critical.length ? "fail" : warnings.length ? "warn" : "pass"
    };
  }

  function makeSeriesCandidates(seed) {
    const candidates = [
      "#237A65", "#6B3624", "#1442CC", "#D92A63", "#8A6E2E",
      "#4D2E8A", "#6552A0", "#C99418", "#A7477C", "#3E6BC7"
    ];
    const offset = hashSeed(seed) % 360;
    const lightnesses = [0.22, 0.27, 0.32, 0.37, 0.42, 0.47, 0.52, 0.57];
    const saturations = [0.42, 0.56, 0.7, 0.84];
    for (let h = 0; h < 24; h += 1) {
      for (let l = 0; l < lightnesses.length; l += 1) {
        for (let s = 0; s < saturations.length; s += 1) {
          const hue = (offset + h * 15 + l * 7 + s * 3) % 360;
          const hex = hslToHex(hue, saturations[s], lightnesses[l]);
          if (!candidates.includes(hex)) candidates.push(hex);
        }
      }
    }
    return candidates;
  }

  function makeNeutralCandidates(role, seed) {
    if (role === "Surface") {
      return ["#F4F1E8", "#F7F5EF", "#F0EEE5", "#F8F7F2", "#ECEBE2", "#FAF9F5", "#E8E8DF"];
    }
    if (role === "Ink") {
      return ["#17201D", "#111816", "#202B27", "#0F1714", "#29332F", "#1B2420", "#101512"];
    }
    return [hslToHex(hashSeed(seed) % 360, 0.65, 0.42)];
  }

  function candidatePool(role, seed) {
    return role.startsWith("Series")
      ? makeSeriesCandidates(seed)
      : makeNeutralCandidates(role, seed);
  }

  function evaluateCandidate(palette) {
    const result = evaluate(palette);
    const minDelta = Math.min(...result.modes.map((mode) => mode.minDelta));
    const minSeriesContrast = Math.min(...result.modes.map((mode) => mode.seriesContrast));
    const minTextContrast = Math.min(...result.modes.map((mode) => mode.textContrast));
    const criticalCount = result.critical.length;
    const warningCount = result.warnings.length;
    const contrastPenalty = Math.max(0, 3.05 - minSeriesContrast) * 85 +
      Math.max(0, 4.55 - minTextContrast) * 40;
    const deltaPenalty = Math.max(0, 12 - minDelta) * 9;
    const score =
      minDelta * 4.2 +
      Math.min(minSeriesContrast, 7) * 4.5 +
      Math.min(minTextContrast, 12) * 0.45 -
      contrastPenalty -
      deltaPenalty -
      criticalCount * 60 -
      warningCount * 3;
    return { score, minDelta, minSeriesContrast, minTextContrast, criticalCount, warningCount };
  }

  function generatePalette(palette, lockedIds, seed) {
    const locked = new Set(lockedIds || []);
    const result = palette.map((token) => ({ ...token }));
    const before = new Map(result.map((token) => [token.id, token.value]));
    const unlocked = result.filter((token) => !locked.has(token.id));
    const protectedBefore = result
      .filter((token) => locked.has(token.id))
      .map((token) => ({ id: token.id, value: token.value }));

    unlocked.forEach((token, index) => {
      const pool = candidatePool(token.role, `${seed}:${token.id}:${index}`);
      let bestValue = token.value;
      let bestScore = -Infinity;
      pool.forEach((candidate) => {
        token.value = candidate;
        const candidateScore = evaluateCandidate(result);
        if (candidateScore.score > bestScore + 0.0001) {
          bestScore = candidateScore.score;
          bestValue = candidate;
        }
      });
      token.value = bestValue;
    });

    for (let pass = 0; pass < 2; pass += 1) {
      unlocked.forEach((token, index) => {
        const pool = candidatePool(token.role, `${seed}:${token.id}:refine:${pass}:${index}`);
        let bestValue = token.value;
        let bestScore = evaluateCandidate(result).score;
        pool.forEach((candidate) => {
          const previous = token.value;
          token.value = candidate;
          const candidateScore = evaluateCandidate(result).score;
          if (candidateScore > bestScore + 0.0001) {
            bestScore = candidateScore;
            bestValue = candidate;
          }
          token.value = previous;
        });
        token.value = bestValue;
      });
    }

    const protectedAfter = result
      .filter((token) => locked.has(token.id))
      .map((token) => ({ id: token.id, value: token.value }));
    const drift = protectedBefore.filter((token, index) =>
      token.value !== protectedAfter[index].value
    );
    return {
      palette: result,
      protectedCount: protectedBefore.length,
      changedCount: result.filter((token) => before.get(token.id) !== token.value).length,
      driftedCount: drift.length,
      seed: String(seed)
    };
  }

  function clonePalette(palette) {
    return palette.map((token) => ({ ...token }));
  }

  const API = {
    CVD_MATRICES,
    MODES,
    DEFAULT_PALETTE,
    SERIES_IDS,
    DATA_IDS,
    parseHex,
    normalizeHex,
    isValidHex,
    simulateHex,
    contrastRatio,
    deltaE76,
    analyzeMode,
    evaluate,
    generatePalette,
    clonePalette,
    hashSeed
  };

  root.ColorEngine = API;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
})(typeof window !== "undefined" ? window : globalThis);
