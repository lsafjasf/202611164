import { keyOf, cellHash } from './model.js';
import { ROOF_STYLES } from './rules.js';
import { findBlockingBuildings } from './path.js';

// Returns {city, changed:[oldKey,newKey]} without mutating the input city.
// Only the edited cell is touched, so every other per-cell hash stays equal.
export function editCell(city, x, y, patch) {
  const next = {
    ...city,
    cells: new Map(city.cells),
    roadSet: new Set(city.roadSet),
    targets: city.targets,
  };
  const k = keyOf(x, y);
  const oldCell = next.cells.get(k);
  if (!oldCell) throw new Error(`cell ${k} does not exist`);
  const oldKey = cellHash(oldCell);

  let cell;
  if (patch.kind === 'building') {
    cell = {
      x,
      y,
      type: 'building',
      floors: patch.floors ?? oldCell.floors ?? 1,
      roof: patch.roof ?? (ROOF_STYLES.includes(oldCell.roof) ? oldCell.roof : 'flat'),
    };
  } else if (patch.kind === 'plaza' || patch.kind === 'green') {
    cell = { x, y, type: patch.kind, floors: 0 };
  } else if (patch.kind === 'road') {
    cell = { x, y, type: 'road', floors: 0 };
  } else {
    throw new Error(`unknown edit kind ${patch.kind}`);
  }
  if (cell.type === 'target' || oldCell.type === 'target') {
    throw new Error('target cells are fixed and cannot be edited');
  }
  next.cells.set(k, cell);
  if (cell.type === 'road') next.roadSet.add(k);
  else next.roadSet.delete(k);
  return { city: next, changed: [oldKey, cellHash(cell)] };
}

export function diagnose(city) {
  return findBlockingBuildings(city);
}
