import { CONFIG, bandOf, dirById } from './config.js';
import { createRng, cellRng, randInt, pick, shuffle } from './rng.js';

const N = CONFIG.gridSize;
const key = (x, y) => `${x},${y}`;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function generateMap(seed) {
  const rng = createRng(`${seed}::map`);
  const home = { x: 0, y: 0 };
  const used = new Set([key(home.x, home.y)]);
  const take = () => {
    for (let tries = 0; tries < 500; tries++) {
      const cell = { x: randInt(rng, 0, N - 1), y: randInt(rng, 0, N - 1) };
      if (!used.has(key(cell.x, cell.y))) {
        used.add(key(cell.x, cell.y));
        return cell;
      }
    }
    throw new Error('地图生成失败');
  };

  const beacons = [];
  const bands = shuffle(rng, CONFIG.bands.map((b) => b.id));
  for (let i = 0; i < CONFIG.beaconCount; i++) {
    const cell = take();
    const band = CONFIG.bands.find((b) => b.id === bands[i]);
    const freq = Math.round(band.range[0] + rng() * (band.range[1] - band.range[0]));
    beacons.push({ id: `B${i + 1}`, x: cell.x, y: cell.y, bandId: band.id, freq });
  }

  const reefs = [];
  for (let i = 0; i < CONFIG.reefCount; i++) {
    const cell = take();
    reefs.push({ id: `R${i + 1}`, x: cell.x, y: cell.y });
  }

  // 全局海流：固定方向与强度，仅通过监听线索暴露。
  const currentDir = pick(rng, CONFIG.dirs);
  const strengthKeys = Object.keys(CONFIG.currentStrengths);
  const current = {
    dirId: currentDir.id,
    strength: pick(rng, strengthKeys),
  };

  return { home, beacons, reefs, current };
}

export function createGame(seedInput) {
  const seed = String(seedInput ?? '');
  const map = generateMap(seed);
  return {
    seed,
    status: 'idle', // idle | running | paused | ended
    time: 0, // 逻辑时间（秒），暂停冻结，重开精确复现
    energy: CONFIG.startEnergy,
    sub: { x: map.home.x, y: map.home.y },
    scans: 0,
    collected: [],
    markers: [], // 玩家标记的“暗礁”
    log: [], // 线索日志（扫描/监听），重播只读取
    events: [],
    returned: false,
    verdict: null,
    map,
  };
}

export function startGame(game) {
  if (game.status === 'idle') game.status = 'running';
  return game;
}

export function pauseGame(game) {
  if (game.status === 'running') game.status = 'paused';
  return game;
}

export function resumeGame(game) {
  if (game.status === 'paused') game.status = 'running';
  return game;
}

function addEvent(game, text) {
  game.events.unshift({ t: game.time, text });
  if (game.events.length > 40) game.events.pop();
}

export function move(game, dirId) {
  if (game.status !== 'running') return { ok: false, reason: 'not-running' };
  const dir = dirById(dirId);
  const nx = game.sub.x + dir.dx;
  const ny = game.sub.y + dir.dy;
  if (!inBounds(nx, ny)) {
    addEvent(game, '边界：无法继续向该方向航行');
    return { ok: false, reason: 'edge' };
  }
  game.sub = { x: nx, y: ny };
  game.energy = Math.max(0, game.energy - CONFIG.moveCost);
  game.time += 1;

  const reef = game.map.reefs.find((r) => r.x === nx && r.y === ny);
  if (reef) {
    game.energy = Math.max(0, game.energy - CONFIG.collisionCost);
    addEvent(game, `撞击暗礁！额外消耗 ${CONFIG.collisionCost} 能源`);
  }
  const beacon = game.map.beacons.find(
    (b) => b.x === nx && b.y === ny && !game.collected.includes(b.id),
  );
  if (beacon) {
    game.collected.push(beacon.id);
    addEvent(game, `回收信标 ${beacon.id}`);
  }
  if (nx === game.map.home.x && ny === game.map.home.y && game.collected.length === CONFIG.beaconCount) {
    game.returned = true;
    addEvent(game, '三个信标已回收，潜航器已返回母舰');
  }
  if (game.energy <= 0) endByEnergy(game);
  return { ok: true, hitReef: Boolean(reef), beacon: beacon?.id ?? null };
}

function endByEnergy(game) {
  game.status = 'ended';
  game.verdict = {
    missionSuccess: false,
    reason: 'energy',
    judgments: [],
  };
  addEvent(game, '能源耗尽，任务失败');
}

function nearestOf(pos, items) {
  let best = null;
  let bestD = Infinity;
  for (const item of items) {
    const d = dist(pos, item);
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  return { item: best, distance: bestD };
}

// 主动声呐扫描：回波按距离（=传播时延）排列；扫描越多，本底噪声/杂波越强。
export function scan(game) {
  if (game.status !== 'running') return { ok: false, reason: 'not-running' };
  game.energy = Math.max(0, game.energy - CONFIG.scanCost);
  game.scans += 1;
  const t = game.time;
  game.time += 2;
  const rng = cellRng(game.seed, game.sub.x, game.sub.y, 'scan');

  const noiseFloor = Math.min(
    CONFIG.scanNoiseMax,
    CONFIG.scanNoiseBase + (game.scans - 1) * CONFIG.scanNoisePerScan,
  );

  const targets = [
    ...game.map.reefs.map((r) => ({ kind: 'reef', ...r })),
    ...game.map.beacons.map((b) => ({ kind: 'beacon', ...b })),
  ];
  const groups = new Map();
  for (const target of targets) {
    const d = dist(game.sub, target);
    const slot = Math.round(d); // 同距离回波在波形上重叠
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push({ target, distance: d });
  }

  const echoes = [];
  for (const [slot, members] of groups) {
    const distance = members[0].distance;
    const jitter = (rng() * 2 - 1) * CONFIG.echoJitterMax;
    const delay = Math.max(0.05, distance * CONFIG.echoSpeed + jitter);
    const amplitude = Math.max(0.18, 1 / (1 + distance * 0.28)) * (0.9 + rng() * 0.2);
    echoes.push({
      delay: Number(delay.toFixed(3)),
      amplitude: Number(amplitude.toFixed(3)),
      truth: {
        sources: members.map(({ target, distance: dd }) => ({
          kind: target.kind,
          id: target.id,
          x: target.x,
          y: target.y,
          distance: Number(dd.toFixed(2)),
          freq: target.kind === 'beacon' ? target.freq : null,
        })),
        merged: members.length > 1,
      },
    });
  }
  echoes.sort((a, b) => a.delay - b.delay);

  const clutterCount =
    CONFIG.clutterBase + Math.floor((game.scans - 1) / CONFIG.clutterExtraEvery);
  const clutter = [];
  for (let i = 0; i < clutterCount; i++) {
    clutter.push(
      Number((rng() * N * CONFIG.echoSpeed + rng() * CONFIG.clutterJitter).toFixed(3)),
    );
  }
  clutter.sort((a, b) => a - b);

  const entry = {
    id: `S${game.scans}`,
    type: 'scan',
    t,
    x: game.sub.x,
    y: game.sub.y,
    scanIndex: game.scans,
    noiseFloor: Number(noiseFloor.toFixed(3)),
    echoes,
    clutter,
  };
  game.log.push(entry);
  addEvent(game, `声呐扫描 #${game.scans}：${echoes.length} 组回波，杂波 ${clutter.length} 个`);
  if (game.energy <= 0) endByEnergy(game);
  return { ok: true, entry };
}

// 水听器监听：最近信标的音调（含测频误差）+ 海流声像（左右舷偏向）。
export function listen(game) {
  if (game.status !== 'running') return { ok: false, reason: 'not-running' };
  game.energy = Math.max(0, game.energy - CONFIG.listenCost);
  const t = game.time;
  game.time += CONFIG.listenDuration;
  const rng = cellRng(game.seed, game.sub.x, game.sub.y, 'listen');
  const { item: beacon, distance } = nearestOf(game.sub, game.map.beacons);

  const measuredFreq = Math.round(beacon.freq * (1 + (rng() * 2 - 1) * CONFIG.freqJitter));
  const dir = dirById(game.map.current.dirId);
  const strength = CONFIG.currentStrengths[game.map.current.strength];
  // 海流声像位置：由方向映射到左右舷（-1 左 / +1 右），上下方向取弱偏置。
  const pan = Math.max(-1, Math.min(1, dir.dx * 0.8 + dir.dy * 0.15 * (rng() - 0.5)));
  const turbulence = Number((strength.drift * (0.85 + rng() * 0.3)).toFixed(3));

  const entry = {
    id: `L${game.log.filter((e) => e.type === 'listen').length + 1}`,
    type: 'listen',
    t,
    x: game.sub.x,
    y: game.sub.y,
    duration: CONFIG.listenDuration,
    measuredFreq,
    pan: Number(pan.toFixed(3)),
    turbulence,
    nearestDistance: Number(distance.toFixed(2)),
    truth: {
      beacon: { id: beacon.id, freq: beacon.freq, bandId: beacon.bandId, x: beacon.x, y: beacon.y },
      current: { dirId: dir.id, strength: game.map.current.strength },
    },
  };
  game.log.push(entry);
  addEvent(game, `水听器监听：主频 ${measuredFreq}Hz，海流湍流 ${turbulence}`);
  if (game.energy <= 0) endByEnergy(game);
  return { ok: true, entry };
}

// 玩家标记暗礁（可点相邻格或当前格）。错误标记立即扣除固定能源。
export function markReef(game, x, y) {
  if (game.status !== 'running') return { ok: false, reason: 'not-running' };
  if (!inBounds(x, y)) return { ok: false, reason: 'edge' };
  if (Math.abs(x - game.sub.x) > 1 || Math.abs(y - game.sub.y) > 1) {
    return { ok: false, reason: 'too-far' };
  }
  if (game.markers.some((m) => m.x === x && m.y === y)) return { ok: false, reason: 'dup' };
  const isReef = game.map.reefs.some((r) => r.x === x && r.y === y);
  const marker = { x, y, t: game.time, correct: isReef };
  game.markers.push(marker);
  if (!isReef) {
    game.energy = Math.max(0, game.energy - CONFIG.wrongMarkCost);
    addEvent(game, `错误标记 (${x},${y})：消耗 ${CONFIG.wrongMarkCost} 能源`);
    if (game.energy <= 0) endByEnergy(game);
  } else {
    addEvent(game, `标记 (${x},${y}) 已记录`);
  }
  return { ok: true, marker };
}

export function removeMarker(game, x, y) {
  if (game.status !== 'running') return { ok: false, reason: 'not-running' };
  const before = game.markers.length;
  game.markers = game.markers.filter((m) => !(m.x === x && m.y === y));
  return { ok: game.markers.length < before };
}

function angleTo(pos, target) {
  const angle = Math.atan2(target.y - pos.y, target.x - pos.x);
  let deg = (angle * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const octant = Math.round(deg / 45) % 8;
  return CONFIG.dirs[octant].id;
}

function reefEvidence(game) {
  const scans = game.log.filter((e) => e.type === 'scan');
  let best = null;
  for (const entry of scans) {
    for (const echo of entry.echoes) {
      const reefSrc = echo.truth.sources.find((s) => s.kind === 'reef');
      if (reefSrc && (!best || reefSrc.distance < best.distance)) {
        best = { entry, echo, source: reefSrc, distance: reefSrc.distance };
      }
    }
  }
  if (!best) return { sourceName: '无扫描记录', detail: '调查阶段未进行主动声呐扫描' };
  return {
    sourceName: `${best.entry.id} 回波（${best.entry.t.toFixed(1)}s）`,
    detail: `时延 ${best.echo.delay}s ≈ 距离 ${best.source.distance} 格`,
  };
}

function judgeReef(game, guess) {
  const evidence = reefEvidence(game);
  if (!guess) {
    return {
      dimension: 'reef',
      dimensionLabel: '暗礁方位/距离',
      player: '未提交标记',
      truth: game.map.reefs.map((r) => `(${r.x},${r.y})`).join(' '),
      correct: false,
      errorDim: '方位与距离',
      evidence,
    };
  }
  const { item: reef, distance } = nearestOf(guess, game.map.reefs);
  const trueDir = angleTo(game.map.home, reef);
  const player = `(${guess.x},${guess.y})`;
  const truth = `(${reef.x},${reef.y})，距母舰 ${distance.toFixed(1)} 格，方向 ${trueDir}`;
  const correct = reef.x === guess.x && reef.y === guess.y;
  let errorDim = null;
  if (!correct) {
    const dirGuess = angleTo(game.map.home, guess);
    errorDim = dirGuess !== trueDir ? '方位' : '距离';
  }
  return {
    dimension: 'reef',
    dimensionLabel: '暗礁方位/距离',
    player,
    truth,
    correct,
    errorDim,
    evidence,
  };
}

function judgeBeaconBand(game, bandId) {
  // 以最近信标作为该判定的真实声源，与监听日志中的主频并列。
  const { item: beacon } = nearestOf(game.sub, game.map.beacons);
  const listens = game.log.filter((e) => e.type === 'listen');
  const match = listens.find((e) => e.truth.beacon.id === beacon.id) || listens[0];
  const evidence = match
    ? {
        sourceName: `${match.id} 监听（${match.t.toFixed(1)}s）`,
        detail: `测得主频 ${match.measuredFreq}Hz`,
      }
    : { sourceName: '无监听记录', detail: '调查阶段未使用水听器' };
  const trueBand = CONFIG.bands.find((b) => b.id === beacon.bandId);
  const guessBand = CONFIG.bands.find((b) => b.id === bandId);
  return {
    dimension: 'band',
    dimensionLabel: '信标频段',
    player: guessBand ? `${guessBand.label}（${bandId}）` : '未选择',
    truth: `${trueBand.label}，信标 ${beacon.id} 主频 ${beacon.freq}Hz`,
    correct: bandId === beacon.bandId,
    errorDim: bandId === beacon.bandId ? null : '频段',
    evidence,
  };
}

function judgeCurrent(game, dirId) {
  const listens = game.log.filter((e) => e.type === 'listen');
  const evidence = listens.length
    ? {
        sourceName: `${listens[0].id} 海流声像（${listens[0].t.toFixed(1)}s）`,
        detail: `左右舷偏向 ${listens[0].pan}，湍流 ${listens[0].turbulence}`,
      }
    : { sourceName: '无监听记录', detail: '调查阶段未使用水听器' };
  const trueDir = dirById(game.map.current.dirId);
  const guessDir = dirById(dirId);
  const strength = CONFIG.currentStrengths[game.map.current.strength];
  return {
    dimension: 'current',
    dimensionLabel: '海流方向',
    player: dirId ? `${guessDir.label}（${dirId}）` : '未选择',
    truth: `${trueDir.label}（${trueDir.id}），强度${strength.label}`,
    correct: dirId === game.map.current.dirId,
    errorDim: dirId === game.map.current.dirId ? null : '海流方向',
    evidence,
  };
}

// 提交结论：四项判定（含具体错误维度），结算后状态置 ended，真相仅此刻公开。
export function submitConclusions(game, guesses) {
  if (game.status !== 'running' && game.status !== 'paused') {
    return { ok: false, reason: 'not-running' };
  }
  const judgments = [
    judgeReef(game, guesses.reef || null),
    judgeBeaconBand(game, guesses.bandId || null),
    judgeCurrent(game, guesses.currentDirId || null),
  ];
  const missionSuccess =
    game.returned && game.collected.length === CONFIG.beaconCount && game.energy > 0;
  game.verdict = {
    missionSuccess,
    reason: missionSuccess ? 'done' : 'incomplete',
    judgments,
    allJudgmentsCorrect: judgments.every((j) => j.correct),
  };
  game.status = 'ended';
  addEvent(game, '结论已提交，进入结算');
  return { ok: true, verdict: game.verdict };
}

// 调查阶段的公开视图：深拷贝并剔除一切 truth 字段与地图实体坐标。
export function publicState(game) {
  const clone = JSON.parse(JSON.stringify(game));
  delete clone.map;
  clone.log = clone.log.map((entry) => {
    const copy = { ...entry };
    delete copy.truth;
    if (Array.isArray(copy.echoes)) {
      copy.echoes = copy.echoes.map((echo) => {
        const publicEcho = { ...echo };
        delete publicEcho.truth;
        return publicEcho;
      });
    }
    return copy;
  });
  clone.markers = clone.markers.map(({ x, y, t }) => ({ x, y, t }));
  return clone;
}
