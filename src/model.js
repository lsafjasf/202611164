// Grid cell model. type: road | target | building | plaza | green
export function keyOf(x, y) {
  return `${x},${y}`;
}

export function makeCity(rules) {
  return {
    rules,
    cells: new Map(),
    targets: [],
    roadSet: new Set(),
  };
}

export function inBounds(rules, x, y) {
  return x >= 0 && y >= 0 && x < rules.width && y < rules.height;
}

export function cellHash(cell) {
  // Semantic per-cell hash: position + content, no view parameters.
  return [
    'v1',
    cell.x,
    cell.y,
    cell.type,
    cell.floors ?? 0,
    cell.roof ?? '',
    cell.targetId ?? '',
  ].join('|');
}

export function layoutFingerprint(city) {
  const lines = [];
  for (let y = 0; y < city.rules.height; y++) {
    for (let x = 0; x < city.rules.width; x++) {
      const cell = city.cells.get(keyOf(x, y));
      if (cell) lines.push(cellHash(cell));
    }
  }
  return lines.join(';;');
}

export function cloneCity(city) {
  const copy = makeCity(city.rules);
  copy.targets = city.targets.map((t) => ({ ...t }));
  copy.roadSet = new Set(city.roadSet);
  for (const [k, cell] of city.cells) copy.cells.set(k, { ...cell });
  return copy;
}

export function serializeCity(city) {
  return JSON.stringify({
    version: 1,
    rules: city.rules,
    targets: city.targets,
    roadSet: [...city.roadSet],
    cells: [...city.cells.values()],
  });
}

export function deserializeCity(text) {
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  if (data.version !== 1) throw new Error(`unsupported city version ${data.version}`);
  const city = makeCity(data.rules);
  city.targets = data.targets.map((t) => ({ ...t }));
  city.roadSet = new Set(data.roadSet);
  for (const cell of data.cells) city.cells.set(keyOf(cell.x, cell.y), { ...cell });
  return city;
}
