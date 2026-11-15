// 世界常量与生成参数。所有尺寸以逻辑像素为单位，网格用于寻路。

export const WORLD = {
  width: 960,
  height: 640,
  cell: 16,
  chunkCols: 6,
  chunkRows: 4,
};

export const GRID = {
  get cols() {
    return Math.ceil(WORLD.width / WORLD.cell);
  },
  get rows() {
    return Math.ceil(WORLD.height / WORLD.cell);
  },
};

export const CHUNK = {
  get width() {
    return WORLD.width / WORLD.chunkCols;
  },
  get height() {
    return WORLD.height / WORLD.chunkRows;
  },
};

export const DEFAULT_PARAMS = {
  islandSlots: 14,
  shallowSlots: 10,
  buoyCount: 6,
  minIslandRadius: 26,
  maxIslandRadius: 58,
  minShallowRadius: 20,
  maxShallowRadius: 40,
  islandPoints: 9,
  margin: 24,
};

export const RULE_VERSION = "v1";
export const MAX_DREDGE_PASSES = 3;
export const MAX_PLACE_TRIES = 8;

export function rulesSummary(params) {
  const p = { ...DEFAULT_PARAMS, ...params };
  return [
    `规则 ${RULE_VERSION} · seed 驱动`,
    `网格 ${GRID.cols}×${GRID.rows}（每格 ${WORLD.cell}px）`,
    `区块 ${WORLD.chunkCols}×${WORLD.chunkRows}=${WORLD.chunkCols * WORLD.chunkRows} 块，参数变化仅重算受影响区块`,
    `岛屿槽位 ${p.islandSlots} · 浅滩槽位 ${p.shallowSlots} · 浮标 ${p.buoyCount}`,
    `岛屿半径 ${p.minIslandRadius}-${p.maxIslandRadius}px · 浅滩 ${p.minShallowRadius}-${p.maxShallowRadius}px`,
    `码头→灯塔：4 连通寻路，浅滩/岛屿/障碍不可通行`,
    `玩家可移动浮标 ≤ ${p.buoyCount} 个；新增障碍断航时报告阻断点`,
  ].join("\n");
}
