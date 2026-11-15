export const BAND = Object.freeze({
  start: 6120,
  end: 6148,
  unit: "kHz",
});

export const CYCLE_SECONDS = 25.4;

export const RULES = Object.freeze({
  missingSourcePenalty: 20,
  wrongPositionPenalty: 10,
  duplicatePenalty: 10,
  labels: [
    "声源未命中 −20",
    "位置错位 −10",
    "重复记录 −10",
    "空缺 −20",
  ],
});

export const STATIONS = Object.freeze([
  {
    id: "beichen",
    name: "北辰",
    code: "NX-03",
    profile: "长划 · 双脉冲",
    color: "#78f2cf",
    pattern: [1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1],
  },
  {
    id: "wudi",
    name: "雾笛",
    code: "WD-17",
    profile: "三短 · 一长",
    color: "#ffbe6a",
    pattern: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 0],
  },
  {
    id: "hongshan",
    name: "红杉",
    code: "HS-09",
    profile: "低音单脉冲",
    color: "#ff8b73",
    pattern: [1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
  },
  {
    id: "yinxian",
    name: "银线",
    code: "YX-22",
    profile: "高频颤音",
    color: "#72b9f5",
    pattern: [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1],
  },
  {
    id: "yeying",
    name: "夜鹰",
    code: "YY-41",
    profile: "短促三连",
    color: "#c39bff",
    pattern: [1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0],
  },
  {
    id: "maodian",
    name: "锚点",
    code: "MD-06",
    profile: "宽间隔脉冲",
    color: "#88d8ef",
    pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
  },
]);

const STATION_MAP = new Map(STATIONS.map((station) => [station.id, station]));

export function normalizeSeed(value) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^\w-]/g, "")
    .slice(0, 20)
    .toUpperCase();
  return cleaned || "SW-0714";
}

export function hashSeed(seed) {
  const text = normalizeSeed(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function fixed(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function windowLabel(start, duration) {
  const format = (seconds) => {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remainder = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
  };
  return `${format(start)}–${format(start + duration)}`;
}

export function getStation(id) {
  return STATION_MAP.get(id) ?? null;
}

export function generateCase(seedValue) {
  const seed = normalizeSeed(seedValue);
  const hash = hashSeed(seed);
  const random = mulberry32(hash);
  const stationOrder = shuffled(STATIONS, random);
  const targets = stationOrder.slice(0, 3);
  const decoys = stationOrder.slice(3, 6);
  const slotAssignment = shuffled([0, 1, 2], random);

  const trueSources = targets.map((station, index) => {
    const pairIndex = index;
    const baseFrequency = BAND.start + 2.2 + pairIndex * 7.15 + (random() - 0.5) * 1.1;
    const slot = slotAssignment[index];
    const frequency = fixed(baseFrequency, 1);
    const bearing = Math.floor(random() * 24) * 15;
    const start = fixed(1.25 + slot * 8.35 + (random() - 0.5) * 0.25, 1);
    const duration = 7.25;
    return {
      ...station,
      role: "beacon",
      pairIndex,
      slot,
      order: slot + 1,
      frequency,
      bearing,
      start,
      duration,
      window: windowLabel(start, duration),
      sidebands: 0,
    };
  });

  const decoySources = decoys.map((station, index) => {
    const paired = trueSources[index];
    const start = fixed(paired.start + 2.0 + random() * 1.15, 1);
    const duration = 5.15;
    return {
      ...station,
      role: "decoy",
      pairIndex: index,
      slot: -1,
      order: null,
      frequency: fixed(paired.frequency + 1.45 + random() * 0.35, 1),
      bearing: Math.floor(random() * 24) * 15,
      start,
      duration,
      window: windowLabel(start, duration),
      sidebands: 2,
    };
  });

  const sortedTargets = [...trueSources].sort((left, right) => left.order - right.order);
  const serial = String((hash % 9000) + 1000).padStart(4, "0");

  return {
    seed,
    hash,
    serial: `NO. ${serial}`,
    caseId: `SW-${serial}`,
    band: BAND,
    cycle: CYCLE_SECONDS,
    rules: RULES,
    candidates: STATIONS,
    targets: trueSources,
    decoys: decoySources,
    sources: [...trueSources, ...decoySources],
    truthOrder: sortedTargets.map((source) => source.id),
    truthSources: sortedTargets,
  };
}

export function cyclePosition(elapsed) {
  const safe = Math.max(0, Number(elapsed) || 0);
  return ((safe % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
}

export function isSourceActive(source, elapsed) {
  const position = cyclePosition(elapsed);
  return position >= source.start && position < source.start + source.duration;
}

export function activeSources(caseData, elapsed) {
  return caseData.sources
    .filter((source) => isSourceActive(source, elapsed))
    .sort((left, right) => left.frequency - right.frequency);
}

export function circularDifference(left, right) {
  const difference = Math.abs(left - right) % 360;
  return difference > 180 ? 360 - difference : difference;
}

export function bearingResponse(source, antennaBearing) {
  const difference = circularDifference(source.bearing, antennaBearing);
  if (source.role === "decoy") {
    return 0.58 + 0.19 * Math.cos((difference * Math.PI) / 180);
  }
  return 0.025 + 0.975 * Math.exp(-((difference / 17) ** 2));
}

export function tuningResponse(source, tunedFrequency) {
  const offset = Math.abs(source.frequency - tunedFrequency);
  if (offset <= 0.46) return 1;
  if (offset >= 2.4) return 0;
  return Math.max(0, 1 - (offset - 0.46) / 1.94);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function receiverTelemetry(caseData, receiver, elapsed) {
  const active = activeSources(caseData, elapsed);
  const gain = clamp(Number(receiver.gain) || 0, 0, 100);
  const tunedFrequency = Number(receiver.frequency) || BAND.start;
  const bearing = ((Number(receiver.bearing) || 0) % 360 + 360) % 360;
  const gainUsability = gain < 18
    ? clamp((gain - 5) / 13, 0, 1)
    : gain > 75
      ? clamp(1 - (gain - 75) / 25, 0.08, 1)
      : 1;

  let best = null;
  for (const source of active) {
    const tuning = tuningResponse(source, tunedFrequency);
    if (tuning <= 0) continue;
    const direction = bearingResponse(source, bearing);
    const clipping = gain > 73
      ? clamp(((gain - 73) / 24) * Math.max(0.15, tuning * direction), 0, 1)
      : 0;
    const quality = tuning * direction * gainUsability * (1 - clipping * 0.86);
    const candidate = {
      source,
      tuning,
      direction,
      clipping,
      quality,
      signalDbfs: -88 + quality * 77,
    };
    if (!best || candidate.quality > best.quality) best = candidate;
  }

  const noiseDbfs = -88 + gain * 0.09;
  if (!best) {
    return {
      active,
      nearest: null,
      tuning: 0,
      direction: 0,
      quality: 0,
      clipping: gain > 88 ? 0.22 : 0,
      signalDbfs: noiseDbfs,
      noiseDbfs,
      lockable: false,
      lockQuality: 0,
    };
  }

  const lockable = best.tuning > 0.76
    && best.direction > 0.5
    && gain >= 22
    && gain <= 76
    && best.clipping < 0.18;

  return {
    active,
    nearest: best.source,
    tuning: best.tuning,
    direction: best.direction,
    quality: best.quality,
    clipping: best.clipping,
    signalDbfs: best.signalDbfs,
    noiseDbfs,
    lockable,
    lockQuality: lockable ? best.quality : best.quality * 0.35,
  };
}

function formatSeconds(seconds) {
  return `${Math.max(0, seconds).toFixed(1)}s`;
}

export function evaluateSubmission(caseData, guesses) {
  const truth = caseData.truthSources;
  const truthIds = truth.map((source) => source.id);
  const normalized = Array.from({ length: 3 }, (_, index) => {
    const value = guesses?.[index];
    return STATION_MAP.has(value) ? value : null;
  });

  const counts = new Map();
  normalized.forEach((id) => {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  const duplicateIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));

  let score = 100;
  let duplicatePenaltyApplied = false;
  const feedback = [];
  const seen = new Map();

  const comparisons = truth.map((truthSource, index) => {
    const guessId = normalized[index];
    const guessSource = guessId ? STATION_MAP.get(guessId) : null;
    const isDuplicate = Boolean(guessId && duplicateIds.has(guessId));
    const earlierIndex = guessId ? seen.get(guessId) : undefined;
    if (guessId && earlierIndex === undefined) seen.set(guessId, index);

    let verdict = "hit";
    if (!guessId) {
      verdict = "missing";
      score -= RULES.missingSourcePenalty;
      feedback.push({
        position: index + 1,
        dimension: "完整性",
        tone: "bad",
        message: `第 ${index + 1} 位为空，无法构成完整的三枚信标时序结论。`,
      });
    } else if (isDuplicate) {
      verdict = "duplicate";
      score -= RULES.duplicatePenalty;
      if (!duplicatePenaltyApplied) duplicatePenaltyApplied = true;
      feedback.push({
        position: index + 1,
        dimension: "完整性",
        tone: "bad",
        message: `第 ${index + 1} 位与第 ${(earlierIndex ?? 0) + 1} 位重复记录 ${guessSource.name}，同一信标不能占据两个时序位。`,
      });
    } else if (guessId !== truthIds[index]) {
      const truePosition = truthIds.indexOf(guessId);
      if (truePosition >= 0) {
        verdict = "order";
        score -= RULES.wrongPositionPenalty;
        feedback.push({
          position: index + 1,
          dimension: "时序",
          tone: "bad",
          message: `第 ${index + 1} 位记录为 ${guessSource.name}。声源判断正确，但它的真实出现位次是第 ${truePosition + 1} 位。`,
        });
      } else {
        verdict = "source";
        score -= RULES.missingSourcePenalty;
        feedback.push({
          position: index + 1,
          dimension: "声源",
          tone: "bad",
          message: `第 ${index + 1} 位记录为 ${guessSource.name}。该台只产生邻频干扰，不属于本案三枚真实信标。`,
        });
      }
    }

    return {
      position: index + 1,
      guess: guessSource,
      verdict,
      truth: {
        ...truthSource,
        frequencyLabel: `${truthSource.frequency.toFixed(1)} kHz`,
        bearingLabel: `${String(truthSource.bearing).padStart(3, "0")}°`,
        windowLabel: truthSource.window,
        durationLabel: formatSeconds(truthSource.duration),
      },
    };
  });

  if (feedback.length === 0) {
    feedback.push({
      position: null,
      dimension: "全部维度",
      tone: "ok",
      message: "声源、时序与完整性均与本案真实发射参数一致。",
    });
  }

  const dimensions = [...new Set(feedback.map((item) => item.dimension))];
  return {
    correct: comparisons.every((item) => item.verdict === "hit"),
    score: clamp(Math.round(score), 0, 100),
    feedback,
    dimensions,
    comparisons,
    truth: truth.map((source) => ({
      ...source,
      frequencyLabel: `${source.frequency.toFixed(1)} kHz`,
      bearingLabel: `${String(source.bearing).padStart(3, "0")}°`,
      windowLabel: source.window,
    })),
    rules: RULES,
  };
}
