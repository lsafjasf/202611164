// All tunable generation rules. Changing a rule changes the layout hash;
// view-only parameters (floorHeight, tileSize, hideBelow) live separately.
export const ROOF_STYLES = ['flat', 'gable', 'pyramid', 'hip'];

export const DEFAULT_RULES = Object.freeze({
  width: 20,
  height: 16,
  targetCount: 4,
  minFloors: 1,
  maxFloors: 6,
  buildingWeight: 0.72,
  plazaWeight: 0.16,
  greenWeight: 0.12,
  margin: 1,
  corridorWidth: 1,
  seed: 20261116,
});

export function clampRules(input = {}) {
  const rules = { ...DEFAULT_RULES, ...input };
  rules.width = Math.max(8, Math.min(40, Math.round(rules.width)));
  rules.height = Math.max(8, Math.min(32, Math.round(rules.height)));
  rules.targetCount = Math.max(2, Math.min(8, Math.round(rules.targetCount)));
  rules.minFloors = Math.max(1, Math.round(rules.minFloors));
  rules.maxFloors = Math.max(rules.minFloors, Math.min(12, Math.round(rules.maxFloors)));
  rules.corridorWidth = Math.max(1, Math.min(3, Math.round(rules.corridorWidth)));
  rules.margin = Math.max(0, Math.min(3, Math.round(rules.margin)));
  const sum = rules.buildingWeight + rules.plazaWeight + rules.greenWeight;
  if (!(sum > 0)) throw new Error('terrain weights must have a positive sum');
  rules.seed = Math.trunc(rules.seed) >>> 0;
  return rules;
}

// One-line human-readable summary shown in the generator panel.
export function ruleSummary(rules) {
  const r = clampRules(rules);
  return `seed ${r.seed} · grid ${r.width}x${r.height} · targets ${r.targetCount} · floors ${r.minFloors}-${r.maxFloors} · corridor ${r.corridorWidth} · weights B/P/G ${r.buildingWeight}/${r.plazaWeight}/${r.greenWeight}`;
}

export const DEFAULT_VIEW = Object.freeze({
  floorHeight: 26,
  tileSize: 34,
  hideBelow: 0,
  sectionRow: -1,
});

export function clampView(input = {}) {
  const view = { ...DEFAULT_VIEW, ...input };
  view.floorHeight = Math.max(8, Math.min(60, Math.round(view.floorHeight)));
  view.tileSize = Math.max(16, Math.min(64, Math.round(view.tileSize)));
  view.hideBelow = Math.max(0, Math.min(12, Math.round(view.hideBelow)));
  view.sectionRow = Math.round(view.sectionRow);
  return view;
}
