export const CHECKS_PER_CASE = 3;

export const DIRECTIONS = ["左前", "右前", "左后", "右后"];
export const DISTANCES = ["近", "中", "远"];
export const ORDER_OPTIONS = [1, 2, 3, 4, 5, 6];

const EVIDENCE_LABELS = ["α", "β", "γ", "δ", "ε", "ζ"];

const EVENT_POOL = [
  {
    key: "brake",
    title: "制动锁死",
    source: "轿车 A · 左前轮",
    band: "1.8–4.8 kHz",
    bandName: "高频段",
  },
  {
    key: "horn",
    title: "气喇叭长鸣",
    source: "货车 B · 双音气喇叭",
    band: "320–760 Hz",
    bandName: "中频段",
  },
  {
    key: "impact",
    title: "初次碰撞",
    source: "轿车 A · 左侧护栏",
    band: "90–680 Hz",
    bandName: "低频段",
  },
  {
    key: "glass",
    title: "车窗碎裂",
    source: "轿车 A · 右后窗",
    band: "2.6–8.0 kHz",
    bandName: "高频段",
  },
  {
    key: "airbag",
    title: "气囊展开",
    source: "轿车 A · 驾驶席",
    band: "160–1800 Hz",
    bandName: "宽频段",
  },
  {
    key: "siren",
    title: "救援抵达",
    source: "救护车 C · 警报器",
    band: "780–2400 Hz",
    bandName: "中高频段",
  },
  {
    key: "secondary",
    title: "二次刮碰",
    source: "轿车 A · 右前翼子板",
    band: "110–920 Hz",
    bandName: "中低频段",
  },
  {
    key: "valve",
    title: "制动气路泄压",
    source: "货车 B · 后轴气路",
    band: "420 Hz–3.2 kHz",
    bandName: "中高频段",
  },
];

const DISTANCE_RANGES = {
  近: [4, 9],
  中: [16, 34],
  远: [52, 88],
};

export function normalizeSeed(value) {
  const cleaned = String(value ?? "").trim().replace(/\s+/g, "-");
  return (cleaned || "ECHO-0417").toUpperCase();
}

export function hashSeed(value) {
  const text = normalizeSeed(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function pickRange([min, max], random) {
  return Math.round(min + random() * (max - min));
}

export function formatTimestamp(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const hundredths = Math.floor((milliseconds % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function createCase(rawSeed) {
  const seed = normalizeSeed(rawSeed);
  const seedHash = hashSeed(seed);
  const random = mulberry32(seedHash);
  const selectedDefinitions = shuffle(EVENT_POOL, random).slice(0, 6);
  const directions = shuffle(
    ["左前", "右前", "左后", "右后", "左前", "右后"],
    random,
  );
  const distances = shuffle(["近", "中", "远", "近", "中", "远"], random);

  let cursor = 520;
  const events = selectedDefinitions.map((definition, index) => {
    const direction = directions[index];
    const distance = distances[index];
    const timeMs = Math.round(cursor);
    cursor += 680 + random() * 920;
    return {
      ...definition,
      direction,
      distance,
      distanceMeters: pickRange(DISTANCE_RANGES[distance], random),
      trueOrder: index + 1,
      timeMs,
      time: formatTimestamp(timeMs),
    };
  });

  const shuffledEventIds = shuffle(
    events.map((event) => event.key),
    random,
  );
  const eventsById = new Map(events.map((event) => [event.key, event]));
  const clues = shuffledEventIds.map((eventKey, index) => {
    const event = eventsById.get(eventKey);
    return {
      id: `clue-${index + 1}`,
      label: EVIDENCE_LABELS[index],
      eventId: event.key,
    };
  });

  return {
    seed,
    seedHash,
    caseNumber: `ES-${String(seedHash % 100000).padStart(5, "0")}`,
    checksPerCase: CHECKS_PER_CASE,
    events,
    clues,
    eventsById,
  };
}

export function getEventForClue(caseData, clueId) {
  const clue = caseData.clues.find((item) => item.id === clueId);
  return clue ? caseData.eventsById.get(clue.eventId) ?? null : null;
}

export const CHECK_DIMENSIONS = {
  timeline: {
    label: "时间顺序",
    hint: "时间顺序未通过：片尾序位脉冲的数量与该标记不符。重听序位脉冲后重新定位。",
  },
  direction: {
    label: "声源方位",
    hint: "声源方位未通过：声像左右位置与前后明暗感，不符合你勾选的方位。",
  },
  distance: {
    label: "距离层级",
    hint: "距离层级未通过：直达声与混响尾音的比例，不符合你勾选的距离档。",
  },
};

export function evaluateMark(caseData, clueId, guess) {
  const event = getEventForClue(caseData, clueId);
  if (!event) {
    throw new Error(`Unknown clue: ${clueId}`);
  }
  const dimensions = {
    timeline: Number(guess.order) === event.trueOrder,
    direction: guess.direction === event.direction,
    distance: guess.distance === event.distance,
  };
  const wrongDimensions = Object.keys(dimensions).filter(
    (key) => !dimensions[key],
  );
  return {
    clueId,
    correct: wrongDimensions.length === 0,
    dimensions,
    wrongDimension: wrongDimensions[0] ?? null,
  };
}

export function applyMarkCheck(caseData, checksRemaining, clueId, guess) {
  const result = evaluateMark(caseData, clueId, guess);
  const nextChecks = result.correct
    ? checksRemaining
    : Math.max(0, checksRemaining - 1);
  return {
    ...result,
    checksRemaining: nextChecks,
    consumed: !result.correct && nextChecks < checksRemaining,
    hint: result.wrongDimension
      ? CHECK_DIMENSIONS[result.wrongDimension].hint
      : "该标记与声学线索一致，已通过检查。",
  };
}

export function evaluateSubmission(caseData, answers) {
  const rows = caseData.clues.map((clue) => {
    const event = caseData.eventsById.get(clue.eventId);
    const guess = answers[clue.id] ?? {};
    const dimensions = {
      timeline: Number(guess.order) === event.trueOrder,
      direction: guess.direction === event.direction,
      distance: guess.distance === event.distance,
    };
    return {
      clueId: clue.id,
      label: clue.label,
      event: {
        key: event.key,
        title: event.title,
        source: event.source,
        band: event.band,
        bandName: event.bandName,
        trueOrder: event.trueOrder,
        time: event.time,
        direction: event.direction,
        distance: event.distance,
        distanceMeters: event.distanceMeters,
      },
      guess: {
        order: Number(guess.order),
        direction: guess.direction,
        distance: guess.distance,
      },
      dimensions,
      correct: Object.values(dimensions).every(Boolean),
    };
  });

  const totals = {
    timeline: rows.filter((row) => row.dimensions.timeline).length,
    direction: rows.filter((row) => row.dimensions.direction).length,
    distance: rows.filter((row) => row.dimensions.distance).length,
  };
  const correctRows = rows.filter((row) => row.correct).length;
  const wrongDimensions = Object.keys(totals).filter(
    (key) => totals[key] < rows.length,
  );

  return {
    rows,
    totals,
    correctRows,
    overallCorrect: correctRows === rows.length,
    wrongDimensions,
  };
}

export function buildTruthAnswers(caseData) {
  return Object.fromEntries(
    caseData.clues.map((clue) => {
      const event = caseData.eventsById.get(clue.eventId);
      return [
        clue.id,
        {
          order: event.trueOrder,
          direction: event.direction,
          distance: event.distance,
        },
      ];
    }),
  );
}
