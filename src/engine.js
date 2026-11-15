// Deterministic terrain / vegetation / road generation engine.
// Pure logic, no DOM access. Shared by the browser UI and the Node verifier.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VegEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W = 96; // grid columns
  var H = 64; // grid rows
  var CELL = 8; // pixel size of one cell on the canvas
  var TRUNK_RADIUS = 0.55; // cells; road center must stay at least this far from a trunk
  var ROAD_HALF_WIDTH = 1.1; // cells on each side of the road center line

  // ---- deterministic PRNG (mulberry32) ------------------------------------
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- FNV-1a ---------------------------------------------------------------
  function fnv1aNum(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function fnv1a(str) {
    return ('0000000' + fnv1aNum(str).toString(16)).slice(-8);
  }

  // Per-cell stable 32-bit seed, independent of object creation order.
  function cellSeed(worldSeed, x, y, stream) {
    return fnv1aNum(worldSeed + '|c' + stream + '|' + x + ',' + y);
  }

  // ---- hashed value lattice + smooth value noise --------------------------
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function lattice(seed, ix, iy) {
    var h = (seed | 0) >>> 0;
    h = Math.imul(h ^ ix, 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h ^ iy, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h, 0x27d4eb2f) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return rng(h)();
  }

  function valueNoise(seed, x, y) {
    var ix = Math.floor(x);
    var iy = Math.floor(y);
    var fx = smooth(x - ix);
    var fy = smooth(y - iy);
    var v00 = lattice(seed, ix, iy);
    var v10 = lattice(seed, ix + 1, iy);
    var v01 = lattice(seed, ix, iy + 1);
    var v11 = lattice(seed, ix + 1, iy + 1);
    var top = v00 + (v10 - v00) * fx;
    var bot = v01 + (v11 - v01) * fx;
    return top + (bot - top) * fy; // 0..1
  }

  function fbm(seed, x, y, octaves, baseFreq) {
    var sum = 0;
    var amp = 0.5;
    var norm = 0;
    var freq = baseFreq;
    for (var o = 0; o < octaves; o++) {
      sum += valueNoise((seed + o * 1013) >>> 0, x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm; // 0..1
  }

  var DEFAULT_PARAMS = {
    seed: 1337,
    waterLevel: 0.32,
    treeDensity: 0.8,
    shrubDensity: 0.7,
    grassDensity: 0.8,
    windDirDeg: 270, // direction the wind blows TOWARDS, degrees
    windStrength: 0.6,
    season: 'summer' // spring | summer | autumn | winter (appearance only)
  };

  // ---- terrain --------------------------------------------------------------
  function buildTerrain(params) {
    var cells = new Array(W * H);
    var rad = (params.windDirDeg * Math.PI) / 180;
    var wvx = Math.cos(rad);
    var wvy = Math.sin(rad);
    var seedNum = fnv1aNum('seed:' + params.seed);
    var elevSeed = seedNum;
    var moistSeed = (seedNum ^ 0x9e3779b9) >>> 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var nx = x / W;
        var ny = y / H;
        var elev = fbm(elevSeed, nx, ny, 4, 4);
        var moist = fbm(moistSeed, nx + 31.7, ny + 17.3, 3, 3);
        var water = elev < params.waterLevel;
        // gradient points uphill; windward slope faces the incoming wind.
        var gx =
          valueNoise(elevSeed, (nx) * 4 + 0.05, ny * 4) -
          valueNoise(elevSeed, (nx) * 4 - 0.05, ny * 4);
        var gy =
          valueNoise(elevSeed, nx * 4, ny * 4 + 0.05) -
          valueNoise(elevSeed, nx * 4, ny * 4 - 0.05);
        var windward = Math.max(0, -(gx * wvx + gy * wvy)) * params.windStrength;
        cells[y * W + x] = {
          x: x,
          y: y,
          elev: elev,
          moist: moist,
          water: water,
          slopeX: gx,
          slopeY: gy,
          windward: windward,
          road: false,
          obj: null
        };
      }
    }
    return cells;
  }

  function idx(x, y) {
    return y * W + x;
  }
  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < W && y < H;
  }

  // Deterministic landmark placement: scan in fixed order, take the land cell
  // whose stable per-cell random value is closest to 0.5 within its region.
  function pickLandmark(cells, region, worldSeed, tag) {
    var best = null;
    for (var y = region.y0; y < region.y1; y++) {
      for (var x = region.x0; x < region.x1; x++) {
        var c = cells[idx(x, y)];
        if (c.water) continue;
        var score = Math.abs(rng(cellSeed(worldSeed, x, y, tag))() - 0.5);
        if (!best || score < best.score) best = { x: x, y: y, score: score };
      }
    }
    return best;
  }

  // ---- A* over 4-connected land cells --------------------------------------
  function astar(cells, start, goal) {
    var open = [];
    var came = {};
    var g = {};
    var key = function (x, y) { return x + ',' + y; };
    var sk = key(start.x, start.y);
    g[sk] = 0;
    open.push({ x: start.x, y: start.y, f: heur(start, goal) });
    var dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    function heur(a, b) {
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) {
        if (open[i].f < open[bi].f) bi = i;
      }
      var cur = open.splice(bi, 1)[0];
      var ck = key(cur.x, cur.y);
      if (cur.x === goal.x && cur.y === goal.y) {
        var path = [{ x: goal.x, y: goal.y }];
        var k = ck;
        while (came[k]) {
          path.unshift({ x: came[k].x, y: came[k].y });
          k = key(came[k].x, came[k].y);
        }
        return path;
      }
      for (var d = 0; d < 4; d++) {
        var nx = cur.x + dirs[d][0];
        var ny = cur.y + dirs[d][1];
        if (!inBounds(nx, ny) || cells[idx(nx, ny)].water) continue;
        var nk = key(nx, ny);
        var ng = g[ck] + 1;
        if (g[nk] === undefined || ng < g[nk]) {
          g[nk] = ng;
          came[nk] = { x: cur.x, y: cur.y };
          open.push({ x: nx, y: ny, f: ng + heur({ x: nx, y: ny }, goal) });
        }
      }
    }
    return null;
  }

  // Rasterize every cell whose center lies within ROAD_HALF_WIDTH of a
  // polyline segment. Returns the cell indices in stable (y,x) order.
  function corridorCells(points) {
    var set = {};
    for (var s = 0; s < points.length - 1; s++) {
      var a = points[s];
      var b = points[s + 1];
      var minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - ROAD_HALF_WIDTH));
      var maxX = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) + ROAD_HALF_WIDTH));
      var minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - ROAD_HALF_WIDTH));
      var maxY = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) + ROAD_HALF_WIDTH));
      for (var y = minY; y <= maxY; y++) {
        for (var x = minX; x <= maxX; x++) {
          if (distPointToSegment(x, y, a, b) <= ROAD_HALF_WIDTH) {
            set[idx(x, y)] = true;
          }
        }
      }
    }
    set[idx(points[0].x, points[0].y)] = true;
    set[idx(points[points.length - 1].x, points[points.length - 1].y)] = true;
    return Object.keys(set).map(Number).sort(function (p, q) { return p - q; });
  }

  function distPointToSegment(px, py, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len2 = dx * dx + dy * dy || 1;
    var t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    var cx = a.x + t * dx;
    var cy = a.y + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // ---- vegetation rules -----------------------------------------------------
  // Trees: higher elevation / higher moisture / suppressed on windward slopes.
  // Shrubs: drier open ground; grass fills remaining land cells sparsely.
  function treeSuitability(cell, params) {
    if (cell.water || cell.road) return 0;
    var moistBoost = cell.moist > 0.5 ? 0.18 : 0.05;
    var elevBoost = cell.elev > params.waterLevel + 0.1 ? 0.16 : 0.05;
    var s = moistBoost + elevBoost - cell.windward * 0.8;
    return Math.max(0, s);
  }

  function shrubSuitability(cell) {
    if (cell.water || cell.road) return 0;
    return cell.moist < 0.45 ? 0.24 : 0.06;
  }

  function grassSuitability(cell) {
    if (cell.water || cell.road) return 0;
    return 0.16 + 0.12 * cell.moist;
  }

  function makeObject(world, cell, type, streamTag) {
    var r = rng(cellSeed(world.params.seed, cell.x, cell.y, streamTag));
    var jx = (r() - 0.5) * 0.6;
    var jy = (r() - 0.5) * 0.6;
    var obj = {
      id: type[0].toUpperCase() + ':' + cell.x + ',' + cell.y,
      type: type,
      cellX: cell.x,
      cellY: cell.y,
      px: cell.x + 0.5 + jx,
      py: cell.y + 0.5 + jy,
      lean: 0
    };
    if (type === 'tree') {
      obj.lean = world.cells[idx(cell.x, cell.y)].windward * 0.9;
      obj.height = 0.8 + r() * 0.7;
    }
    return obj;
  }

  function plantLayer(world, type) {
    var params = world.params;
    var density =
      type === 'tree' ? params.treeDensity
        : type === 'shrub' ? params.shrubDensity
          : params.grassDensity;
    var stream = type === 'tree' ? 11 : type === 'shrub' ? 22 : 33;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var cell = world.cells[idx(x, y)];
        if (cell.water || cell.road) continue;
        var suit =
          type === 'tree' ? treeSuitability(cell, params)
            : type === 'shrub' ? shrubSuitability(cell)
              : grassSuitability(cell);
        if (suit <= 0) continue;
        var roll = rng(cellSeed(params.seed, x, y, stream))();
        if (roll < suit * density) {
          if (!cell.obj) {
            var obj = makeObject(world, cell, type, stream);
            cell.obj = obj;
            world.objects.push(obj);
          }
        }
      }
    }
  }

  function clearObjects(world, cellIds) {
    for (var i = 0; i < cellIds.length; i++) {
      var c = world.cells[cellIds[i]];
      if (c.obj) {
        var p = world.objects.indexOf(c.obj);
        if (p >= 0) world.objects.splice(p, 1);
        c.obj = null;
      }
    }
  }

  function markRoad(world, corridor) {
    for (var i = 0; i < world.cells.length; i++) world.cells[i].road = false;
    for (var j = 0; j < corridor.length; j++) world.cells[corridor[j]].road = true;
  }

  // Validate a candidate road polyline. Reports the first blocking segment:
  // either water crossing or a trunk center closer than TRUNK_RADIUS.
  function validateRoad(world, points) {
    var blockers = [];
    for (var s = 0; s < points.length - 1; s++) {
      var a = points[s];
      var b = points[s + 1];
      var minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - ROAD_HALF_WIDTH));
      var maxX = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) + ROAD_HALF_WIDTH));
      var minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - ROAD_HALF_WIDTH));
      var maxY = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) + ROAD_HALF_WIDTH));
      for (var y = minY; y <= maxY; y++) {
        for (var x = minX; x <= maxX; x++) {
          var cell = world.cells[idx(x, y)];
          var onEndpoint =
            (a.x === x && a.y === y) || (b.x === x && b.y === y);
          if (cell.water && (onEndpoint ||
              distPointToSegment(x + 0.5, y + 0.5, a, b) <= 0.5)) {
            blockers.push({ kind: 'water', x: x, y: y, segment: s });
          } else if (cell.obj && cell.obj.type === 'tree') {
            var d = distPointToSegment(cell.obj.px, cell.obj.py, a, b);
            if (d < TRUNK_RADIUS) {
              blockers.push({ kind: 'trunk', x: x, y: y, distance: d, segment: s });
            }
          }
        }
      }
    }
    return { ok: blockers.length === 0, blockers: blockers };
  }

  // Flood fill over land, non-road-blocked cells; used to verify that start
  // can still reach target after a single-object edit.
  function reachable(world, start, goal) {
    var seen = {};
    var queue = [start];
    seen[idx(start.x, start.y)] = true;
    var dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    while (queue.length) {
      var cur = queue.shift();
      if (cur.x === goal.x && cur.y === goal.y) return { ok: true };
      for (var d = 0; d < 4; d++) {
        var nx = cur.x + dirs[d][0];
        var ny = cur.y + dirs[d][1];
        if (!inBounds(nx, ny)) continue;
        var id = idx(nx, ny);
        if (seen[id]) continue;
        var c = world.cells[id];
        if (c.water || c.roadBlocked) continue;
        seen[id] = true;
        queue.push({ x: nx, y: ny });
      }
    }
    // Report the reachable cell closest (Manhattan) to the goal as the
    // front of the blockage, plus the goal cell that cannot be entered.
    var front = start;
    var best = Infinity;
    Object.keys(seen).forEach(function (k) {
      var cx = k % W;
      var cy = (k - cx) / W;
      var dist = Math.abs(cx - goal.x) + Math.abs(cy - goal.y);
      if (dist < best) { best = dist; front = { x: cx, y: cy }; }
    });
    return { ok: false, front: front, goal: goal };
  }

  function layoutHash(world) {
    var lines = world.objects
      .slice()
      .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; })
      .map(function (o) {
        return [
          o.id,
          o.px.toFixed(3),
          o.py.toFixed(3),
          o.type,
          o.lean ? o.lean.toFixed(3) : '0'
        ].join(',');
      });
    lines.push(
      'R:' + world.road.map(function (p) { return p.x + ',' + p.y; }).join(';')
    );
    return fnv1a(lines.join('\n'));
  }

  function refreshHash(world) {
    world.hash = layoutHash(world);
    return world.hash;
  }

  function createWorld(inputParams) {
    var params = Object.assign({}, DEFAULT_PARAMS, inputParams || {});
    var world = {
      params: params,
      cells: buildTerrain(params),
      objects: [],
      road: [],
      roadStatus: { ok: true, blockers: [] },
      start: null,
      target: null,
      hash: '',
      generatedAt: 0
    };
    world.start = pickLandmark(world.cells,
      { x0: 1, y0: 1, x1: Math.floor(W * 0.45), y1: H - 1 },
      params.seed, 91);
    world.target = pickLandmark(world.cells,
      { x0: Math.floor(W * 0.55), y0: 1, x1: W - 1, y1: H - 1 },
      params.seed, 92);
    if (!world.start || !world.target) {
      throw new Error('seed ' + params.seed + ': no land available for landmarks');
    }
    var path = astar(world.cells, world.start, world.target);
    if (!path) throw new Error('seed ' + params.seed + ': target unreachable on land');
    world.road = withControlPoints(simplifyPath(path));
    var corridor = corridorCells(world.road);
    markRoad(world, corridor);
    plantLayer(world, 'tree');
    plantLayer(world, 'shrub');
    plantLayer(world, 'grass');
    refreshHash(world);
    world.generatedAt = Date.now();
    return world;
  }

  // Collapse collinear steps so the draggable polyline stays compact while
  // covering exactly the same cells.
  function simplifyPath(path) {
    var out = [path[0]];
    for (var i = 1; i < path.length - 1; i++) {
      var a = out[out.length - 1];
      var b = path[i];
      var c = path[i + 1];
      if ((b.x - a.x) * (c.y - b.y) !== (b.y - a.y) * (c.x - b.x)) out.push(b);
    }
    out.push(path[path.length - 1]);
    return out;
  }

  // Long straight runs get interior draggable nodes every 12 cells, while
  // staying on exactly the same raster corridor.
  function withControlPoints(points) {
    var out = [points[0]];
    for (var s = 0; s < points.length - 1; s++) {
      var p0 = points[s];
      var p1 = points[s + 1];
      var len = Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y);
      var steps = Math.floor(len / 12);
      for (var k = 1; k <= steps; k++) {
        var t = (k * 12) / len;
        out.push({
          x: Math.round(p0.x + (p1.x - p0.x) * t),
          y: Math.round(p0.y + (p1.y - p0.y) * t)
        });
      }
      out.push(p1);
    }
    return out;
  }

  function plantCell(world, cell) {
    if (cell.water || cell.road || cell.obj) return;
    var params = world.params;
    var rollT = rng(cellSeed(params.seed, cell.x, cell.y, 11))();
    if (rollT < treeSuitability(cell, params) * params.treeDensity) {
      cell.obj = makeObject(world, cell, 'tree', 11);
    } else {
      var rollS = rng(cellSeed(params.seed, cell.x, cell.y, 22))();
      if (rollS < shrubSuitability(cell) * params.shrubDensity) {
        cell.obj = makeObject(world, cell, 'shrub', 22);
      } else {
        var rollG = rng(cellSeed(params.seed, cell.x, cell.y, 33))();
        if (rollG < grassSuitability(cell) * params.grassDensity) {
          cell.obj = makeObject(world, cell, 'grass', 33);
        }
      }
    }
    if (cell.obj) world.objects.push(cell.obj);
  }

  function removeObjectAt(world, x, y) {
    var cell = world.cells[idx(x, y)];
    if (cell && cell.obj) {
      var p = world.objects.indexOf(cell.obj);
      if (p >= 0) world.objects.splice(p, 1);
      cell.obj = null;
    }
  }

  // User dragged the road. Invalid roads are rejected and the old layout is
  // kept; valid roads only touch cells entering/leaving the corridor.
  function setRoad(world, points) {
    var check = validateRoad(world, points);
    if (!check.ok) {
      world.roadStatus = check;
      return { ok: false, blockers: check.blockers };
    }
    var oldCorridor = {};
    for (var i = 0; i < world.cells.length; i++) {
      if (world.cells[i].road) oldCorridor[i] = true;
    }
    var newCorridor = corridorCells(points);
    var newSet = {};
    newCorridor.forEach(function (id) { newSet[id] = true; });
    var freed = Object.keys(oldCorridor)
      .map(Number)
      .filter(function (id) { return !newSet[id]; });
    clearObjects(world, newCorridor);
    world.road = points.map(function (p) { return { x: p.x, y: p.y }; });
    markRoad(world, newCorridor);
    freed.forEach(function (id) {
      plantCell(world, world.cells[id]);
    });
    world.roadStatus = { ok: true, blockers: [] };
    refreshHash(world);
    return {
      ok: true,
      affected: newCorridor.concat(freed).sort(function (a, b) { return a - b; })
    };
  }

  // Add a tree on one land cell. If its trunk crosses the road corridor the
  // edit is rejected with the exact blocked road segment / cell location.
  function addTree(world, x, y) {
    if (!inBounds(x, y)) return { ok: false, reason: 'out-of-bounds', x: x, y: y };
    var cell = world.cells[idx(x, y)];
    if (cell.water) return { ok: false, reason: 'water', x: x, y: y };
    if (cell.obj) return { ok: false, reason: 'occupied', x: x, y: y };
    var obj = makeObject(world, cell, 'tree', 11);
    var check = validateRoad(world, world.road);
    var blocking = check.blockers.filter(function (b) {
      return b.x === x && b.y === y && b.kind === 'trunk';
    });
    if (blocking.length) {
      return {
        ok: false,
        reason: 'road-blocked',
        x: x,
        y: y,
        blocker: blocking[0]
      };
    }
    cell.obj = obj;
    world.objects.push(obj);
    // Temporarily close the road cells that the new trunk center blocks,
    // then run the land flood fill to see whether the route still exists.
    var blockedIds = [];
    check.blockers.forEach(function (b) {
      var id = idx(b.x, b.y);
      if (!world.cells[id].roadBlocked) {
        world.cells[id].roadBlocked = true;
        blockedIds.push(id);
      }
    });
    var link = reachable(world, world.start, world.target);
    blockedIds.forEach(function (id) { world.cells[id].roadBlocked = false; });
    if (!link.ok) {
      removeObjectAt(world, x, y);
      return {
        ok: false,
        reason: 'route-disconnected',
        x: x,
        y: y,
        blockage: {
          obstacle: { x: x, y: y },
          front: link.front,
          goal: link.goal
        }
      };
    }
    refreshHash(world);
    return { ok: true, object: obj, affected: [idx(x, y)] };
  }

  function removeObject(world, x, y) {
    if (!inBounds(x, y)) return { ok: false, reason: 'out-of-bounds', x: x, y: y };
    var cell = world.cells[idx(x, y)];
    if (!cell.obj) return { ok: false, reason: 'empty', x: x, y: y };
    var removed = cell.obj;
    removeObjectAt(world, x, y);
    var link = reachable(world, world.start, world.target);
    refreshHash(world);
    return {
      ok: true,
      removed: removed,
      reachable: link.ok,
      blockage: link.ok ? null : link,
      affected: [idx(x, y)]
    };
  }

  // Parameter edits rebuild only the layers they can affect. Terrain-affecting
  // params require a full rebuild (different land/water partition).
  function updateParams(world, edits) {
    var terrainKeys = ['seed', 'waterLevel'];
    var terrainChanged = terrainKeys.some(function (k) {
      return Object.prototype.hasOwnProperty.call(edits, k) &&
        edits[k] !== world.params[k];
    });
    if (terrainChanged) {
      var rebuilt = createWorld(Object.assign({}, world.params, edits));
      Object.keys(world).forEach(function (k) { delete world[k]; });
      Object.assign(world, rebuilt);
      return { rebuilt: 'full', affected: null };
    }
    var before = snapshotObjects(world);
    Object.assign(world.params, edits);
    var layerChanged =
      'treeDensity' in edits || 'shrubDensity' in edits || 'grassDensity' in edits;
    if (layerChanged) replant(world);
    if ('windDirDeg' in edits || 'windStrength' in edits) {
      var rad = (world.params.windDirDeg * Math.PI) / 180;
      var wvx2 = Math.cos(rad);
      var wvy2 = Math.sin(rad);
      world.cells.forEach(function (c) {
        c.windward =
          Math.max(0, -(c.slopeX * wvx2 + c.slopeY * wvy2)) *
          world.params.windStrength;
      });
      world.objects.forEach(function (o) {
        if (o.type === 'tree') {
          o.lean = world.cells[idx(o.cellX, o.cellY)].windward * 0.9;
        }
      });
    }
    refreshHash(world);
    return {
      rebuilt: layerChanged ? 'vegetation' : 'appearance',
      changedCells: diffSnapshots(before, snapshotObjects(world))
    };
  }

  // Deterministic full replant of land cells (road cells stay clear).
  function replant(world) {
    world.objects = [];
    for (var i = 0; i < world.cells.length; i++) {
      var c = world.cells[i];
      if (!c.water && !c.road) c.obj = null;
    }
    plantLayer(world, 'tree');
    plantLayer(world, 'shrub');
    plantLayer(world, 'grass');
  }

  function snapshotObjects(world) {
    var snap = {};
    world.objects.forEach(function (o) {
      snap[o.id] = o.px.toFixed(3) + '/' + o.py.toFixed(3) + '/' + o.type;
    });
    return snap;
  }

  function diffSnapshots(before, after) {
    var changed = [];
    Object.keys(after).forEach(function (id) {
      if (before[id] !== after[id]) changed.push(id);
    });
    Object.keys(before).forEach(function (id) {
      if (!(id in after)) changed.push(id);
    });
    return changed;
  }

  // Hash of every object inside a rectangle of cells, for proving that edits
  // outside the region leave its coordinates and hash untouched.
  function regionHash(world, x0, y0, x1, y1) {
    var lines = world.objects
      .filter(function (o) {
        return o.cellX >= x0 && o.cellX < x1 && o.cellY >= y0 && o.cellY < y1;
      })
      .map(function (o) {
        return o.id + ',' + o.px.toFixed(3) + ',' + o.py.toFixed(3);
      })
      .sort();
    return fnv1a(lines.join('\n'));
  }

  function serialize(world) {
    return JSON.stringify({
      version: 1,
      params: world.params,
      road: world.road,
      hash: world.hash
    });
  }

  // Load is a deterministic rebuild: same params must reproduce the hash.
  function deserialize(text) {
    var data = JSON.parse(text);
    var world = createWorld(data.params);
    if (data.road && data.road.length) {
      var res = setRoad(world, data.road);
      if (!res.ok) throw new Error('saved road is invalid after reload');
    }
    if (data.hash && world.hash !== data.hash) {
      throw new Error('hash mismatch: saved=' + data.hash + ' rebuilt=' + world.hash);
    }
    return world;
  }

  function ruleSummary(world) {
    var p = world.params;
    var counts = { tree: 0, shrub: 0, grass: 0 };
    world.objects.forEach(function (o) { counts[o.type]++; });
    return {
      seed: p.seed,
      counts: counts,
      total: world.objects.length,
      rules: [
        '水面：海拔<' + p.waterLevel.toFixed(2) + ' 的单元格不生成任何陆生植物',
        '密度：树林 ' + p.treeDensity + ' / 灌木 ' + p.shrubDensity + ' / 草地 ' + p.grassDensity,
        '风向 ' + p.windDirDeg + '° × 风力 ' + p.windStrength +
          '：迎风坡树木减少且树干倾斜',
        '道路中心线与树干中心间距必须 ≥ ' + TRUNK_RADIUS + ' 格'
      ]
    };
  }

  return {
    W: W,
    H: H,
    CELL: CELL,
    TRUNK_RADIUS: TRUNK_RADIUS,
    ROAD_HALF_WIDTH: ROAD_HALF_WIDTH,
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    rng: rng,
    fnv1a: fnv1a,
    createWorld: createWorld,
    setRoad: setRoad,
    validateRoad: validateRoad,
    corridorCells: corridorCells,
    addTree: addTree,
    removeObject: removeObject,
    updateParams: updateParams,
    regionHash: regionHash,
    layoutHash: refreshHash,
    serialize: serialize,
    deserialize: deserialize,
    ruleSummary: ruleSummary,
    astar: astar,
    reachable: reachable
  };
});
