import { keyOf, layoutFingerprint, inBounds } from './model.js';
import { generateCity } from './generator.js';
import { targetReachability } from './path.js';
import { shortHash } from './hash.js';

function checkOverlapAndBounds(city) {
  const issues = [];
  const r = city.rules;
  const seen = new Set();
  for (const cell of city.cells.values()) {
    const k = keyOf(cell.x, cell.y);
    if (seen.has(k)) issues.push(`duplicate cell at ${k}`);
    seen.add(k);
    if (!inBounds(r, cell.x, cell.y)) issues.push(`cell ${k} outside grid ${r.width}x${r.height}`);
  }
  if (city.cells.size !== r.width * r.height) {
    issues.push(`cell count ${city.cells.size} != grid size ${r.width * r.height}`);
  }
  const targetKeys = new Set();
  for (const t of city.targets) {
    const k = keyOf(t.x, t.y);
    if (targetKeys.has(k)) issues.push(`overlapping targets at ${k}`);
    targetKeys.add(k);
    const cell = city.cells.get(k);
    if (!cell || cell.type !== 'target' || cell.targetId !== t.id) {
      issues.push(`target ${t.id} not backed by matching target cell at ${k}`);
    }
  }
  if (city.targets.length !== r.targetCount) {
    issues.push(`target count ${city.targets.length} != rule ${r.targetCount}`);
  }
  return issues;
}

// Structured, reproducible verification report for one generated city.
export function verifyCity(city) {
  const { pairs } = targetReachability(city);
  const unreachable = pairs.filter((p) => !p.reachable);
  const overlapIssues = checkOverlapAndBounds(city);
  const layoutHash = shortHash(layoutFingerprint(city));
  return {
    seed: city.rules.seed,
    layoutHash,
    targetCount: city.targets.length,
    allTargetsReachable: unreachable.length === 0,
    unreachable,
    overlapIssues,
    passed: unreachable.length === 0 && overlapIssues.length === 0,
  };
}

export function verifyReproducibility(rules) {
  const a = generateCity(rules);
  const b = generateCity(rules);
  const ha = shortHash(layoutFingerprint(a));
  const hb = shortHash(layoutFingerprint(b));
  const report = verifyCity(a);
  return {
    ...report,
    reproducible: ha === hb,
    rerunHash: hb,
    passed: report.passed && ha === hb,
  };
}

// Run the full check suite across several fixed seeds.
export function verifySeeds(seedList, rules = {}) {
  return seedList.map((seed) => verifyReproducibility({ ...rules, seed }));
}
