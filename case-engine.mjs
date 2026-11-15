export const BATTERY_SECONDS = 180;

export const SECTORS = [
  { id: "NW", label: "西北", short: "NW", x: [0.1, 0.4], y: [0.1, 0.4] },
  { id: "NE", label: "东北", short: "NE", x: [0.6, 0.9], y: [0.1, 0.4] },
  { id: "SW", label: "西南", short: "SW", x: [0.1, 0.4], y: [0.6, 0.9] },
  { id: "SE", label: "东南", short: "SE", x: [0.6, 0.9], y: [0.6, 0.9] }
];

export const BANDS = [
  { id: "LF", label: "低频", range: "180–280 Hz", min: 180, max: 280, base: 226, color: "#7fe7d4" },
  { id: "MF", label: "中频", range: "430–540 Hz", min: 430, max: 540, base: 482, color: "#ffc86b" },
  { id: "HF", label: "高频", range: "720–860 Hz", min: 720, max: 860, base: 790, color: "#ff8e9f" }
];

export const CADENCES = [
  { id: "6s", label: "6.0 秒", seconds: 6 },
  { id: "8s", label: "8.0 秒", seconds: 8 },
  { id: "10s", label: "10.0 秒", seconds: 10 }
];

export const PENALTY_RULES = {
  sector: 18,
  frequency: 14,
  cadence: 10
};

export const SOURCE_META = [
  { name: "ALPHA", channel: "A-17", color: "#78e5d2" },
  { name: "BRAVO", channel: "B-42", color: "#ffbd68" },
  { name: "CERES", channel: "C-09", color: "#ff8498" }
];

const DIMENSION_META = {
  sector: { label: "方位", penalty: "sector" },
  frequency: { label: "频段", penalty: "frequency" },
  cadence: { label: "周期", penalty: "cadence" }
};

export function normalizeSeed(value) {
  const text = String(value ?? "").trim().toUpperCase() || "AURORA-774";
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { text, hash: hash >>> 0 };
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random, min, max) {
  return min + random() * (max - min);
}

function shuffled(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function createCase(seedValue = "AURORA-774") {
  const seed = normalizeSeed(seedValue);
  const random = mulberry32(seed.hash);
  const sectors = shuffled(SECTORS, random).slice(0, 3);
  const bands = shuffled(BANDS, random);
  const cadences = shuffled(CADENCES, random);

  const sources = SOURCE_META.map((meta, index) => {
    const sector = sectors[index];
    const band = bands[index];
    const cadence = cadences[index];
    const carrierHz = Math.round(
      Math.min(band.max - 8, Math.max(band.min + 8, band.base + between(random, -22, 22)))
    );
    return {
      ...meta,
      index,
      sector: sector.id,
      sectorLabel: sector.label,
      position: {
        x: between(random, sector.x[0], sector.x[1]),
        y: between(random, sector.y[0], sector.y[1])
      },
      band: band.id,
      bandLabel: band.label,
      bandRange: band.range,
      carrierHz,
      cadence: cadence.id,
      cadenceSeconds: cadence.seconds,
      phase: Number((1.2 + index * 0.8 + random() * 2.2).toFixed(2)),
      burstSeconds: 1.8
    };
  });

  const whiteouts = [];
  let cursor = between(random, 13, 18);
  for (let index = 0; index < 5; index += 1) {
    const duration = between(random, 3.8, 7.2);
    whiteouts.push({
      start: Number(cursor.toFixed(2)),
      end: Number((cursor + duration).toFixed(2)),
      strength: between(random, 0.62, 0.94)
    });
    cursor += duration + between(random, 12, 21);
  }

  return {
    seed: seed.text,
    seedHash: seed.hash,
    sources,
    whiteouts,
    batterySeconds: BATTERY_SECONDS,
    penaltyRules: { ...PENALTY_RULES },
    signature: `${seed.text}::${seed.hash}`
  };
}

export function whiteoutIntensity(caseData, time) {
  let intensity = 0;
  for (const gate of caseData.whiteouts) {
    if (time < gate.start || time > gate.end) continue;
    const edge = Math.min(time - gate.start, gate.end - time);
    const envelope = Math.min(1, Math.max(0, edge / 0.7));
    intensity = Math.max(intensity, gate.strength * envelope);
  }
  return intensity;
}

export function sourceSignal(caseData, source, receiver) {
  const dx = source.position.x - receiver.x;
  const dy = source.position.y - receiver.y;
  const distance = Math.hypot(dx, dy);
  const strength = Math.max(2, 96 * Math.exp(-(distance * distance) / (2 * 0.19 * 0.19)));
  return { distance, strength, dx, dy };
}

export function isBursting(source, time, offset = 0) {
  const shifted = time + offset - source.phase;
  if (shifted < 0) return false;
  return shifted % source.cadenceSeconds < source.burstSeconds;
}

export function buildClueSchedule(caseData, until = BATTERY_SECONDS) {
  const events = [];
  for (const source of caseData.sources) {
    for (let time = source.phase; time < until; time += source.cadenceSeconds) {
      events.push({
        time: Number(time.toFixed(2)),
        sourceIndex: source.index,
        sourceName: source.name,
        channel: source.channel,
        carrierHz: source.carrierHz,
        band: source.band,
        cadenceSeconds: source.cadenceSeconds
      });
    }
  }
  return events.sort((a, b) => a.time - b.time || a.sourceIndex - b.sourceIndex);
}

function penaltyFor(dimension) {
  return PENALTY_RULES[DIMENSION_META[dimension].penalty];
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = (safe % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${remainder}`;
}

function burstTimes(source) {
  return [0, 1, 2].map((index) => source.phase + index * source.cadenceSeconds);
}

export function evaluateAnswers(caseData, answers) {
  const fields = [];
  const feedback = [];
  let score = 100;

  caseData.sources.forEach((source, sourceIndex) => {
    const answer = answers[sourceIndex] || {};
    const checks = [
      {
        dimension: "sector",
        actual: source.sector,
        given: answer.sector,
        evidence: `声源 ${source.name}（${source.channel}）位于${source.sectorLabel}扇区；首次清晰起报 ${formatClock(source.phase)}`
      },
      {
        dimension: "frequency",
        actual: source.band,
        given: answer.band,
        evidence: `声源 ${source.name} 载频 ${source.carrierHz} Hz，属于 ${source.band} 频段（${source.bandRange}）`
      },
      {
        dimension: "cadence",
        actual: source.cadence,
        given: answer.cadence,
        evidence: `声源 ${source.name} 起报时刻 ${burstTimes(source).map(formatClock).join(" / ")}，间隔 ${source.cadenceSeconds.toFixed(1)} 秒`
      }
    ];

    for (const check of checks) {
      const correct = check.given === check.actual;
      const penalty = correct ? 0 : penaltyFor(check.dimension);
      score -= penalty;
      fields.push({
        sourceIndex,
        sourceName: source.name,
        channel: source.channel,
        dimension: check.dimension,
        dimensionLabel: DIMENSION_META[check.dimension].label,
        given: check.given ?? null,
        actual: check.actual,
        correct,
        penalty,
        evidence: check.evidence
      });
      if (!correct) {
        feedback.push({
          sourceIndex,
          sourceName: source.name,
          dimension: check.dimension,
          dimensionLabel: DIMENSION_META[check.dimension].label,
          message: `${DIMENSION_META[check.dimension].label}判断偏差：${source.name} 你提交“${check.given ?? "未选择"}”，真实为“${check.actual}”。${check.evidence}。`
        });
      }
    }
  });

  const correctCount = fields.filter((field) => field.correct).length;
  return {
    passed: correctCount === fields.length,
    correctCount,
    total: fields.length,
    score: Math.max(0, score),
    penalty: Math.max(0, 100 - score),
    fields,
    feedback
  };
}

export function correctAnswers(caseData) {
  return caseData.sources.map((source) => ({
    sector: source.sector,
    band: source.band,
    cadence: source.cadence
  }));
}

export function getBand(id) {
  return BANDS.find((band) => band.id === id) || null;
}

export function getSector(id) {
  return SECTORS.find((sector) => sector.id === id) || null;
}

export function getCadence(id) {
  return CADENCES.find((cadence) => cadence.id === id) || null;
}
