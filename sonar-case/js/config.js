export const CONFIG = {
  gridSize: 10,
  reefCount: 5,
  beaconCount: 3,

  // 三个信标各自固定的频段（Hz），调查阶段只暴露测得的频率数值。
  bands: [
    { id: 'low', label: '低频段', range: [140, 260] },
    { id: 'mid', label: '中频段', range: [420, 620] },
    { id: 'high', label: '高频段', range: [900, 1300] },
  ],

  // 资源与惩罚：全部为固定常量，重开同一 seed 时规则完全一致。
  startEnergy: 100,
  moveCost: 2,
  scanCost: 4,
  listenCost: 3,
  wrongMarkCost: 10,
  collisionCost: 8,
  returnReward: 0,

  // 主动声呐：扫描次数越多，本底噪声与非目标回波越强。
  scanNoiseBase: 0.12,
  scanNoisePerScan: 0.045,
  scanNoiseMax: 0.6,
  clutterBase: 1,
  clutterExtraEvery: 3, // 每多扫描 3 次，多 1 个杂波回波
  clutterJitter: 0.35, // 杂波距离抖动（格）
  echoSpeed: 0.18, // 声呐回波每格传播时间（秒，逻辑时间）
  echoJitterMax: 0.12,
  listenDuration: 2.5,
  freqJitter: 0.02, // 测频误差 ±2%

  currentStrengths: {
    weak: { label: '弱', drift: 0.2 },
    moderate: { label: '中', drift: 0.5 },
    strong: { label: '强', drift: 0.9 },
  },
  // 八方向
  dirs: [
    { id: 'N', dx: 0, dy: -1, label: '北' },
    { id: 'NE', dx: 1, dy: -1, label: '东北' },
    { id: 'E', dx: 1, dy: 0, label: '东' },
    { id: 'SE', dx: 1, dy: 1, label: '东南' },
    { id: 'S', dx: 0, dy: 1, label: '南' },
    { id: 'SW', dx: -1, dy: 1, label: '西南' },
    { id: 'W', dx: -1, dy: 0, label: '西' },
    { id: 'NW', dx: -1, dy: -1, label: '西北' },
  ],
};

export function bandOf(freq) {
  for (const band of CONFIG.bands) {
    if (freq >= band.range[0] && freq <= band.range[1]) return band;
  }
  return CONFIG.bands[CONFIG.bands.length - 1];
}

export function dirById(id) {
  return CONFIG.dirs.find((d) => d.id === id) || CONFIG.dirs[0];
}
