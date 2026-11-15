export const VERSION = 1;

export const DIRECTIONS = Object.freeze({
  up: { key: "up", dx: 0, dy: -1, label: "北", arrow: "↑" },
  right: { key: "right", dx: 1, dy: 0, label: "东", arrow: "→" },
  down: { key: "down", dx: 0, dy: 1, label: "南", arrow: "↓" },
  left: { key: "left", dx: -1, dy: 0, label: "西", arrow: "←" }
});

export const DEFAULT_CONFIG = Object.freeze({
  cols: 8,
  rows: 6,
  start: { x: 0, y: 5 },
  beacon: { x: 7, y: 0 },
  obstacles: [
    { x: 1, y: 4 },
    { x: 2, y: 3 },
    { x: 4, y: 2 },
    { x: 5, y: 0 },
    { x: 6, y: 4 }
  ],
  fragments: [
    { id: "f1", x: 2, y: 0 },
    { id: "f2", x: 5, y: 2 },
    { id: "f3", x: 3, y: 4 }
  ],
  requiredFragments: 3,
  startEnergy: 22,
  maxEnergy: 36,
  moveCost: 1,
  fragmentEnergy: 4
});

const STATUS_LABELS = {
  playing: "航行中",
  won: "已完成",
  failed: "能量耗尽"
};

const DIRECTION_LABELS = {
  "0,-1": "北",
  "1,-1": "东北",
  "1,0": "东",
  "1,1": "东南",
  "0,1": "南",
  "-1,1": "西南",
  "-1,0": "西",
  "-1,-1": "西北",
  "0,0": "当前位置"
};

function clone(value) {
  return structuredClone(value);
}

function normalizePoint(point, fallback) {
  const x = Number.isFinite(point?.x) ? Math.trunc(point.x) : fallback.x;
  const y = Number.isFinite(point?.y) ? Math.trunc(point.y) : fallback.y;
  return { x, y };
}

export function normalizeConfig(input = {}) {
  const source = { ...DEFAULT_CONFIG, ...input };
  const cols = Math.max(2, Math.trunc(Number(source.cols) || DEFAULT_CONFIG.cols));
  const rows = Math.max(2, Math.trunc(Number(source.rows) || DEFAULT_CONFIG.rows));
  const maxEnergy = Math.max(1, Math.trunc(Number(source.maxEnergy) || DEFAULT_CONFIG.maxEnergy));
  const startEnergy = Math.min(
    maxEnergy,
    Math.max(1, Math.trunc(Number(source.startEnergy) || DEFAULT_CONFIG.startEnergy))
  );
  return {
    cols,
    rows,
    start: normalizePoint(source.start, DEFAULT_CONFIG.start),
    beacon: normalizePoint(source.beacon, DEFAULT_CONFIG.beacon),
    obstacles: clone(source.obstacles || []).map((point) => normalizePoint(point, { x: 0, y: 0 })),
    fragments: clone(source.fragments || []).map((fragment, index) => ({
      id: String(fragment.id || `f${index + 1}`),
      ...normalizePoint(fragment, { x: 0, y: 0 })
    })),
    requiredFragments: Math.max(0, Math.trunc(Number(source.requiredFragments) || 0)),
    startEnergy,
    maxEnergy,
    moveCost: Math.max(0, Math.trunc(Number(source.moveCost) || 0)),
    fragmentEnergy: Math.max(0, Math.trunc(Number(source.fragmentEnergy) || 0))
  };
}

export function createGame(config = {}, meta = {}) {
  const normalized = normalizeConfig(config);
  const state = {
    version: VERSION,
    config: normalized,
    player: clone(normalized.start),
    facing: "up",
    energy: normalized.startEnergy,
    fragments: normalized.fragments.map((fragment, index) => ({
      ...fragment,
      ordinal: index + 1,
      collected: false
    })),
    status: "playing",
    moves: 0,
    invalidMoves: 0,
    history: [],
    failureReason: "",
    message: {
      tone: "info",
      text: "航程已就绪。收集三枚折光碎片，然后抵达信标。"
    },
    lastEvent: "start",
    title: meta.title || "默认星图"
  };
  return state;
}

export function pointKey(point) {
  return `${point.x},${point.y}`;
}

export function directionLabel(dx, dy) {
  const cappedX = Math.sign(dx);
  const cappedY = Math.sign(dy);
  return DIRECTION_LABELS[`${cappedX},${cappedY}`] || "未知";
}

export function getTarget(state) {
  if (state.status === "won") {
    return {
      kind: "beacon",
      label: "信标",
      x: state.config.beacon.x,
      y: state.config.beacon.y,
      ordinal: null,
      direction: "当前位置",
      distance: 0
    };
  }
  const remaining = state.fragments
    .filter((fragment) => !fragment.collected)
    .map((fragment) => ({
      fragment,
      distance:
        Math.abs(fragment.x - state.player.x) + Math.abs(fragment.y - state.player.y)
    }))
    .sort((a, b) => a.distance - b.distance || a.fragment.y - b.fragment.y || a.fragment.x - b.fragment.x);
  const point = remaining[0]?.fragment || state.config.beacon;
  const kind = remaining.length ? "fragment" : "beacon";
  const dx = point.x - state.player.x;
  const dy = point.y - state.player.y;
  return {
    kind,
    label: kind === "fragment" ? `第 ${point.ordinal || state.fragments.indexOf(point) + 1} 枚碎片` : "信标",
    x: point.x,
    y: point.y,
    ordinal: point.ordinal || null,
    direction: directionLabel(dx, dy),
    distance: Math.abs(dx) + Math.abs(dy)
  };
}

export function collectedCount(state) {
  return state.fragments.filter((fragment) => fragment.collected).length;
}

export function getStateView(state) {
  const target = getTarget(state);
  return {
    positionColumn: state.player.x + 1,
    positionRow: state.player.y + 1,
    positionText: `第 ${state.player.x + 1} 列，第 ${state.player.y + 1} 行`,
    status: state.status,
    statusLabel: STATUS_LABELS[state.status] || "未知",
    targetKind: target.kind,
    targetLabel: target.label,
    targetDirection: state.status === "won" ? "已抵达信标" : target.direction,
    targetDistance: target.distance,
    collected: collectedCount(state),
    required: state.config.requiredFragments,
    energy: state.energy,
    maxEnergy: state.config.maxEnergy,
    moves: state.moves,
    failureReason: state.failureReason,
    message: state.message.text
  };
}

export function describeState(state) {
  const view = getStateView(state);
  const targetText =
    state.status === "won"
      ? `目标方向：${view.targetDirection}`
      : `目标方向：${view.targetDirection}，${view.targetLabel}，距离 ${view.targetDistance} 步`;
  const failure = view.failureReason ? `失败原因：${view.failureReason}` : "";
  return (
    `位置：${view.positionText}。${targetText}。` +
    `资源：碎片 ${view.collected}/${view.required}，能量 ${view.energy}/${view.maxEnergy}。` +
    `状态：${view.statusLabel}。${failure}`
  );
}

function withHistory(state) {
  return [
    {
      player: clone(state.player),
      facing: state.facing,
      energy: state.energy,
      fragments: clone(state.fragments),
      status: state.status,
      moves: state.moves,
      failureReason: state.failureReason,
      message: clone(state.message),
      lastEvent: state.lastEvent
    }
  ];
}

function announcementFor(state, prefix) {
  const view = getStateView(state);
  const target =
    state.status === "won"
      ? "信标已抵达。"
      : `目标${view.targetDirection}，距离 ${view.targetDistance} 步。`;
  return `${prefix}位置${view.positionText}。碎片 ${view.collected}/${view.required}，能量 ${view.energy}/${view.maxEnergy}。${target}`;
}

function finishMoveEvent(next, event) {
  const prefix = event.reason || event.prefix || "";
  return {
    ...event,
    ok: event.ok ?? true,
    reason: event.reason || "",
    state: next,
    announcement: announcementFor(next, prefix)
  };
}

export function applyMove(state, directionKey) {
  const direction = DIRECTIONS[directionKey];
  const next = clone(state);
  if (!direction) {
    return {
      ok: false,
      type: "invalid-direction",
      reason: "无效方向",
      message: "无法识别该方向。请使用方向键。",
      announcement: "无法识别该方向。",
      state: next
    };
  }
  if (state.status !== "playing") {
    next.message = {
      tone: "error",
      text:
        state.status === "won"
          ? "本轮航程已经完成。重新开始后可继续操作。"
          : "能量已经耗尽。请撤回一步或重新开始。"
    };
    return {
      ok: false,
      type: "round-ended",
      reason: next.message.text,
      message: next.message.text,
      announcement: next.message.text,
      state: next
    };
  }

  const x = state.player.x + direction.dx;
  const y = state.player.y + direction.dy;
  const boundsError = x < 0 || x >= state.config.cols || y < 0 || y >= state.config.rows;
  if (boundsError) {
    next.invalidMoves += 1;
    next.message = {
      tone: "error",
      text: `地图边界：向${direction.label}移动会越界，当前位置未变。`
    };
    next.failureReason = next.message.text;
    next.lastEvent = "boundary";
    return finishMoveEvent(next, {
      ok: false,
      type: "boundary",
      reason: next.message.text,
      message: next.message.text,
      prefix: ""
    });
  }

  const obstacle = state.config.obstacles.some((point) => point.x === x && point.y === y);
  if (obstacle) {
    next.invalidMoves += 1;
    next.message = {
      tone: "error",
      text: `雾墙阻挡：${direction.label}侧无法通行，当前位置未变。`
    };
    next.failureReason = next.message.text;
    next.lastEvent = "obstacle";
    return finishMoveEvent(next, {
      ok: false,
      type: "obstacle",
      reason: next.message.text,
      message: next.message.text
    });
  }

  next.history = withHistory(state);
  next.player = { x, y };
  next.facing = direction.key;
  next.moves += 1;
  next.energy = Math.max(0, next.energy - next.config.moveCost);
  next.failureReason = "";

  const fragment = next.fragments.find(
    (item) => !item.collected && item.x === x && item.y === y
  );
  if (fragment) {
    fragment.collected = true;
    next.energy = Math.min(next.config.maxEnergy, next.energy + next.config.fragmentEnergy);
  }

  const atBeacon = x === next.config.beacon.x && y === next.config.beacon.y;
  const enoughFragments = collectedCount(next) >= next.config.requiredFragments;
  if (atBeacon && enoughFragments) {
    next.status = "won";
    next.lastEvent = "win";
    next.message = {
      tone: "success",
      text: `航程完成：已抵达信标，使用 ${next.moves} 步，剩余能量 ${next.energy}。`
    };
    return finishMoveEvent(next, {
      ok: true,
      type: "win",
      reason: "",
      message: next.message.text,
      prefix: "航程完成。"
    });
  }

  if (atBeacon) {
    const missing = Math.max(0, next.config.requiredFragments - collectedCount(next));
    next.failureReason = `信标拒绝：还缺 ${missing} 枚折光碎片。`;
    next.message = { tone: "error", text: next.failureReason };
    next.lastEvent = "beacon-locked";
    return finishMoveEvent(next, {
      ok: true,
      type: "beacon-locked",
      reason: next.failureReason,
      message: next.failureReason
    });
  }

  if (next.energy <= 0) {
    next.status = "failed";
    next.failureReason = "能量耗尽：最后一步后没有剩余能量，无法继续移动。";
    next.message = { tone: "error", text: next.failureReason };
    next.lastEvent = "exhausted";
    return finishMoveEvent(next, {
      ok: true,
      type: "exhausted",
      reason: next.failureReason,
      message: next.failureReason,
      prefix: next.failureReason
    });
  }

  next.lastEvent = fragment ? "fragment" : "move";
  next.message = fragment
    ? {
        tone: "success",
        text: `收集第 ${fragment.ordinal} 枚碎片。还缺 ${Math.max(
          0,
          next.config.requiredFragments - collectedCount(next)
        )} 枚。`
      }
    : { tone: "info", text: `向${direction.label}移动。` };
  return finishMoveEvent(next, {
    ok: true,
    type: fragment ? "fragment" : "move",
    reason: "",
    message: next.message.text,
    prefix: fragment ? `收集第 ${fragment.ordinal} 枚碎片。` : `向${direction.label}移动。`
  });
}

export function undoMove(state) {
  if (!state.history.length) {
    const next = clone(state);
    next.message = { tone: "error", text: "没有可撤回的移动。" };
    next.failureReason = "";
    return {
      ok: false,
      type: "undo-empty",
      reason: next.message.text,
      message: next.message.text,
      announcement: next.message.text,
      state: next
    };
  }
  const previous = state.history[0];
  const next = clone(state);
  next.player = clone(previous.player);
  next.facing = previous.facing || "up";
  next.energy = previous.energy;
  next.fragments = clone(previous.fragments);
  next.status = "playing";
  next.moves = previous.moves;
  next.failureReason = "";
  next.history = [];
  next.message = { tone: "info", text: "已撤回一步，状态恢复为上一次安全移动。" };
  next.lastEvent = "undo";
  return {
    ok: true,
    type: "undo",
    reason: "",
    message: next.message.text,
    announcement: `${next.message.text}${announcementFor(next, "")}`,
    state: next
  };
}

export function restartGame(state) {
  const next = createGame(state.config, { title: state.title });
  next.message = { tone: "info", text: "航程已重置。位置、资源与目标已恢复到起点。" };
  return {
    ok: true,
    type: "restart",
    reason: "",
    message: next.message.text,
    announcement: `${next.message.text}${announcementFor(next, "")}`,
    state: next
  };
}

export function restoreState(raw) {
  try {
    const candidate = typeof raw === "string" ? JSON.parse(raw) : clone(raw);
    if (!candidate || candidate.version !== VERSION) {
      return { ok: false, error: "存档版本不兼容" };
    }
    if (
      !candidate.config ||
      !candidate.player ||
      !Array.isArray(candidate.fragments) ||
      !["playing", "won", "failed"].includes(candidate.status)
    ) {
      return { ok: false, error: "存档缺少必要字段" };
    }
    const config = normalizeConfig(candidate.config);
    const within = (point) =>
      Number.isInteger(point?.x) &&
      Number.isInteger(point?.y) &&
      point.x >= 0 &&
      point.x < config.cols &&
      point.y >= 0 &&
      point.y < config.rows;
    if (!within(candidate.player) || !within(config.beacon) || !config.fragments.every(within)) {
      return { ok: false, error: "存档坐标超出地图范围" };
    }
    if (!Number.isFinite(candidate.energy) || candidate.energy < 0) {
      return { ok: false, error: "存档能量值无效" };
    }
    candidate.config = config;
    candidate.version = VERSION;
    candidate.facing = Object.hasOwn(
      { up: true, right: true, down: true, left: true },
      candidate.facing
    )
      ? candidate.facing
      : "up";
    candidate.history = Array.isArray(candidate.history) ? candidate.history.slice(0, 1) : [];
    candidate.failureReason = String(candidate.failureReason || "");
    candidate.message = candidate.message || { tone: "info", text: "存档已恢复。" };
    candidate.lastEvent = candidate.lastEvent || "restore";
    candidate.moves = Number(candidate.moves) || 0;
    candidate.invalidMoves = Number(candidate.invalidMoves) || 0;
    candidate.title = String(candidate.title || "恢复的星图");
    return { ok: true, state: candidate };
  } catch (error) {
    return { ok: false, error: `存档无法解析：${error.message}` };
  }
}

export function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createExportSnapshot(state, settings, exportedAt = new Date().toISOString()) {
  const view = getStateView(state);
  const payload = {
    format: "lumen-relay-project",
    version: VERSION,
    exportedAt,
    stateFingerprint: fingerprint(state),
    state: clone(state),
    settings: clone(settings),
    summary: {
      position: view.positionText,
      target: `${view.targetLabel} · ${view.targetDirection} · ${view.targetDistance} 步`,
      resources: `碎片 ${view.collected}/${view.required} · 能量 ${view.energy}/${view.maxEnergy}`,
      status: view.statusLabel,
      failureReason: view.failureReason
    }
  };
  payload.snapshotFingerprint = fingerprint(payload);
  return payload;
}

export const DEFAULT_TEST_PATH = [
  "up",
  "up",
  "up",
  "up",
  "up",
  "right",
  "right",
  "right",
  "right",
  "down",
  "right",
  "down",
  "down",
  "down",
  "down",
  "left",
  "left",
  "up",
  "down",
  "right",
  "right",
  "right",
  "right",
  "up",
  "up",
  "up",
  "up",
  "up"
];
