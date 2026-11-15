// 工程模型：8 只杯子 = 8 条独立轨道；保存每轨参数与增益。

export const PROJECT_VERSION = 1;
export const GLASS_COUNT = 8;
export const STEPS_PER_BEAT = 2;

// C 大调五声音阶基底（C5 D5 E5 G5 A5 C6 D6 E6）
export const BASE_FREQS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];

// 默认十二音示例：八分音符序列，覆盖全部 8 只杯子。
// glass = 轨道索引；vel = 敲击力度 (0..1)；kind = strike | rub。
export function defaultMelody() {
  const seq = [
    [0, 0.55], [2, 0.5], [4, 0.6], [2, 0.5],
    [5, 0.65], [4, 0.55], [2, 0.5], [1, 0.5],
    [3, 0.6], [6, 0.7], [4, 0.55], [7, 0.75],
  ];
  return seq.map(([glass, vel], i) => ({
    id: `n${i}`,
    glass,
    velocity: vel,
    kind: 'strike',
    step: i, // 每个步进一个音（八分音符）
  }));
}

export function defaultProject() {
  return {
    version: PROJECT_VERSION,
    tempo: 100,
    transpose: 0,
    loop: false,
    stepsPerBeat: STEPS_PER_BEAT,
    melody: defaultMelody(),
    tracks: Array.from({ length: GLASS_COUNT }, (_, i) => ({
      id: i,
      water: 0.5, // 0..1 水位
      gain: 0.8, // 每轨增益
      pan: 0, // -1..1 声像
      broken: false,
    })),
    physics: {
      breakVelocity: 0.85, // 超过该力度敲击即破裂
      maxTemperature: 100,
      detuneCentsPerDegree: 0.8, // 每升温 1 度失谐 0.8 cent
      rubHeat: 9, // 每次摩擦升温
      coolingPerSecond: 3,
    },
  };
}

export function patternLength(project) {
  return Math.max(1, ...project.melody.map((n) => n.step + 1));
}

// 深拷贝 + 版本校验，确保重新载入得到的是一份干净快照。
export function serializeProject(project) {
  const json = JSON.stringify({ ...project, savedAt: new Date().toISOString() });
  return json;
}

export function deserializeProject(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
  if (!data || data.version !== PROJECT_VERSION) {
    throw new Error(`不支持的工程版本: ${data && data.version}`);
  }
  if (!Array.isArray(data.tracks) || data.tracks.length !== GLASS_COUNT) {
    throw new Error('工程轨道数据损坏（应为 8 轨）');
  }
  if (!Array.isArray(data.melody) || data.melody.length === 0) {
    throw new Error('工程旋律为空');
  }
  return normalizeProject(data);
}

function normalizeProject(data) {
 const base = defaultProject();
  return {
    ...base,
    ...data,
    physics: { ...base.physics, ...(data.physics || {}) },
    tracks: data.tracks.map((t, i) => ({ ...base.tracks[i], ...t, id: i })),
    melody: data.melody.map((n, i) => ({
      id: n.id || `n${i}`,
      glass: Number(n.glass),
      velocity: Number(n.velocity),
      kind: n.kind === 'rub' ? 'rub' : 'strike',
      step: Number(n.step),
    })),
  };
}

export const STORAGE_KEY = 'glass-harmonica-project-v1';

export function saveToStorage(project, storage = localStorage) {
  storage.setItem(STORAGE_KEY, serializeProject(project));
}

export function loadFromStorage(storage = localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? deserializeProject(raw) : null;
}

export function clearStorage(storage = localStorage) {
  storage.removeItem(STORAGE_KEY);
}
