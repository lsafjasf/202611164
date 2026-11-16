export const MATERIALS = [
  {
    id: "leaf",
    name: "落叶层",
    code: "LF",
    color: "#d7b568",
    band: "3.2–4.8 kHz",
    bandLow: 3200,
    bandHigh: 4800,
    echo: "短促高频反射",
    echoRange: [72, 112],
    hint: "高频细碎 · 近距反射"
  },
  {
    id: "gravel",
    name: "碎石地",
    code: "GR",
    color: "#92a6ad",
    band: "1.3–2.4 kHz",
    bandLow: 1300,
    bandHigh: 2400,
    echo: "清晰规律回响",
    echoRange: [120, 168],
    hint: "中高频硬点 · 规律回响"
  },
  {
    id: "moss",
    name: "湿苔藓",
    code: "MS",
    color: "#6fa985",
    band: "220–620 Hz",
    bandLow: 220,
    bandHigh: 620,
    echo: "低沉长尾反射",
    echoRange: [260, 340],
    hint: "低频闷响 · 长尾拖声"
  },
  {
    id: "pine",
    name: "松针层",
    code: "PN",
    color: "#b98767",
    band: "700–1.4 kHz",
    bandLow: 700,
    bandHigh: 1400,
    echo: "柔和弥散回响",
    echoRange: [190, 250],
    hint: "中频柔碎 · 弥散尾音"
  }
];

const MATERIAL_BY_ID = new Map(MATERIALS.map((material) => [material.id, material]));

export function getMaterial(id) {
  return MATERIAL_BY_ID.get(id) ?? null;
}

export function normalizeSeed(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  const cleaned = raw.replace(/\s+/g, "-").replace(/[^A-Z0-9_-]/g, "");
  return cleaned || "NIGHT-001";
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
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

function shuffle(items, random) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function between(random, min, max) {
  return min + random() * (max - min);
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function choosePenalty(random) {
  const material = [24, 26, 28, 30][Math.floor(random() * 4)];
  const sequence = [12, 15, 18, 20][Math.floor(random() * 4)];
  return { material, sequence };
}

const POSITION_POOL = [
  [16, 18], [24, 76], [42, 28], [50, 84], [73, 17],
  [82, 64], [66, 49], [31, 52], [57, 71], [12, 57]
];

function makeSources(random) {
  const materials = shuffle(MATERIALS, random).slice(0, 3);
  const positions = shuffle(POSITION_POOL, random).slice(0, 3);
  const timeBands = [
    [4.4, 5.6],
    [10.1, 11.5],
    [15.8, 17.2]
  ];
  const sources = materials.map((material, index) => {
    const [minTime, maxTime] = timeBands[index];
    const frequency = Math.round(between(random, material.bandLow, material.bandHigh));
    const echoMs = Math.round(between(random, material.echoRange[0], material.echoRange[1]));
    const [x, y] = positions[index];
    const jitterX = round(between(random, -3.2, 3.2), 1);
    const jitterY = round(between(random, -3.2, 3.2), 1);
    return {
      id: `S-${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      materialId: material.id,
      x: round(x + jitterX, 1),
      y: round(y + jitterY, 1),
      time: round(between(random, minTime, maxTime), 2),
      frequency,
      echoMs,
      audioSeed: Math.floor(random() * 0xffffffff),
      pan: x < 43 ? "左" : x > 57 ? "右" : "中"
    };
  });
  return sources.sort((left, right) => left.time - right.time).map((source, index) => ({
    ...source,
    id: `S-${String(index + 1).padStart(2, "0")}`,
    order: index + 1
  }));
}

function makeWind(random) {
  const windows = [
    [1.4, 3.9],
    [7.1, 9.5],
    [12.0, 14.4],
    [18.0, 20.2]
  ];
  return windows.map(([start, end], index) => ({
    id: `W-${index + 1}`,
    start: round(start + between(random, -0.35, 0.35), 2),
    end: round(end + between(random, -0.35, 0.35), 2),
    intensity: round(between(random, 0.24, 0.52), 2),
    pan: round(between(random, -0.8, 0.8), 2),
    seed: Math.floor(random() * 0xffffffff)
  }));
}

export function generateCase(seedValue) {
  const seed = normalizeSeed(seedValue);
  const random = mulberry32(hashSeed(seed));
  const sources = makeSources(random);
  const windEvents = makeWind(random);
  const penalty = choosePenalty(random);
  const audioSeed = Math.floor(random() * 0xffffffff);

  return {
    seed,
    caseCode: `${seed.slice(0, 5)}-${(hashSeed(seed) % 0xffff).toString(16).toUpperCase().padStart(4, "0")}`,
    duration: 22,
    sources,
    windEvents,
    penalty,
    audioSeed,
    successRule: "三个材质判断与发声顺序全部一致",
    listenerStart: { x: 50, y: 50 }
  };
}

export function cloneCase(caseData) {
  return JSON.parse(JSON.stringify(caseData));
}

export function isCompleteSubmission(guesses) {
  return Array.isArray(guesses)
    && guesses.length === 3
    && guesses.every((guess) => Boolean(getMaterial(guess)));
}

export function hasDuplicateMaterials(guesses) {
  return new Set(guesses).size !== guesses.length;
}

function countInversions(values) {
  let inversions = 0;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      if (values[left] > values[right]) inversions += 1;
    }
  }
  return inversions;
}

export function gradeSubmission(caseData, guesses) {
  if (!isCompleteSubmission(guesses)) {
    return {
      valid: false,
      success: false,
      dimension: "form",
      message: "请为三个时间槽分别选择一种地面材质。",
      score: 0,
      rows: [],
      breakdown: []
    };
  }

  if (hasDuplicateMaterials(guesses)) {
    return {
      valid: false,
      success: false,
      dimension: "material",
      message: "三个声源来自不同地面材质，请避免重复选择。",
      score: 0,
      rows: [],
      breakdown: []
    };
  }

  const truth = caseData.sources.map((source) => source.materialId);
  const rows = caseData.sources.map((source, index) => {
    const guess = guesses[index];
    return {
      slot: index + 1,
      guess,
      guessMaterial: getMaterial(guess),
      actual: source.materialId,
      actualMaterial: getMaterial(source.materialId),
      sourceId: source.id,
      time: source.time,
      frequency: source.frequency,
      band: getMaterial(source.materialId).band,
      echoMs: source.echoMs,
      echo: getMaterial(source.materialId).echo,
      position: { x: source.x, y: source.y },
      pan: source.pan,
      materialCorrect: guess === source.materialId
    };
  });

  const wrongRows = rows.filter((row) => !row.materialCorrect);
  if (wrongRows.length === 0) {
    return {
      valid: true,
      success: true,
      dimension: "all",
      message: "三处材质与发声顺序全部吻合，声景重建成功。",
      score: 100,
      rows,
      breakdown: [
        { dimension: "材质", status: "pass", detail: "3 / 3 正确" },
        { dimension: "顺序", status: "pass", detail: "时间线一致" }
      ]
    };
  }

  const guessRanks = guesses.map((guess) => truth.indexOf(guess));
  const sameMaterialSet = [...guesses].sort().join("|") === [...truth].sort().join("|");
  if (sameMaterialSet) {
    const inversions = countInversions(guessRanks);
    const score = Math.max(0, 100 - caseData.penalty.sequence * inversions);
    return {
      valid: true,
      success: false,
      dimension: "order",
      message: `顺序判断错误：三种材质均已识别，但有 ${wrongRows.length} 个时间槽错位。`,
      score,
      rows,
      breakdown: [
        { dimension: "材质", status: "pass", detail: "三种材质集合正确" },
        { dimension: "顺序", status: "fail", detail: `${inversions} 次逆序 · 扣 ${caseData.penalty.sequence} 分/次` }
      ]
    };
  }

  const score = Math.max(0, 100 - caseData.penalty.material * wrongRows.length);
  return {
    valid: true,
    success: false,
    dimension: "material",
    message: `材质判断错误：${wrongRows.map((row) => `第 ${row.slot} 声`).join("、")}与真实地面材质不符。`,
    score,
    rows,
    breakdown: [
      { dimension: "材质", status: "fail", detail: `${wrongRows.length} 项错误 · 扣 ${caseData.penalty.material} 分/项` },
      { dimension: "顺序", status: "review", detail: "先修正材质后再核对时间顺序" }
    ]
  };
}
