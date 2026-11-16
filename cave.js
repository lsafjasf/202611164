// cave.js — 确定性洞穴生成器核心（浏览器与 Node 通用）
// 区域化生成：入口 / 3 个洞厅 / 4 条隧道 / 出口各自独立，
// 参数变化只重算受影响区域，未受影响区域的坐标与哈希保持不变。
(function (global) {
  'use strict';

  // ---------- 常量 ----------
  var W = 96, H = 64;
  var ROCK = 0, FLOOR = 1, WATER = 2, PILLAR = 3;
  var REGION_ORDER = ['entrance', 'chamber0', 'chamber1', 'chamber2', 'exit',
                      'tunnel0', 'tunnel1', 'tunnel2', 'tunnel3'];

  // ---------- 确定性哈希 / RNG ----------
  function hashString(str) { // FNV-1a 32bit
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function hex8(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }

  function makeRng(seedStr) { // mulberry32，纯整数运算，跨平台可复现
    var a = hashString(seedStr) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function defaultParams() {
    return { seed: 'cave-seed-1', curvature: 0.5, chamberSize: 1.0, edits: {} };
  }

  function normalizeParams(p) {
    p = p || {};
    return {
      seed: String(p.seed == null ? 'cave-seed-1' : p.seed),
      curvature: clamp(Number(p.curvature == null ? 0.5 : p.curvature), 0, 1),
      chamberSize: clamp(Number(p.chamberSize == null ? 1 : p.chamberSize), 0.5, 2),
      edits: p.edits || {}
    };
  }

  // ---------- 区域生成 ----------
  // 每个区域返回 { writes, bbox, meta }，区域子种子 = hash(seed|区域名|相关参数)

  function chamberAnchors(seed) {
    var rng = makeRng(seed + '|anchors');
    var pts = [];
    for (var i = 0; i < 3; i++) {
      pts.push({
        x: Math.round(W * (0.25 + 0.25 * i)),
        y: Math.round(H * 0.3 + rng() * H * 0.4)
      });
    }
    return pts;
  }

  function entrancePoint() { return { x: 3, y: H >> 1 }; }
  function exitPoint() { return { x: W - 4, y: H >> 1 }; }

  function genEntrance(seed) {
    var p = entrancePoint(), writes = [];
    for (var y = p.y - 2; y <= p.y + 2; y++)
      for (var x = 1; x <= 6; x++) writes.push({ x: x, y: y, cell: FLOOR });
    return { writes: writes, bbox: { x0: 1, y0: p.y - 2, x1: 6, y1: p.y + 2 },
             meta: { spawn: p } };
  }

  function genExit(seed) {
    var p = exitPoint(), writes = [];
    for (var y = p.y - 2; y <= p.y + 2; y++)
      for (var x = W - 7; x <= W - 2; x++) writes.push({ x: x, y: y, cell: FLOOR });
    return { writes: writes, bbox: { x0: W - 7, y0: p.y - 2, x1: W - 2, y1: p.y + 2 },
             meta: { exit: p } };
  }

  // 洞厅：椭圆大厅 + 内部水域 + 岩柱（岩柱避让中心与出生点）
  function genChamber(seed, idx, anchor, chamberSize) {
    var rng = makeRng(seed + '|chamber' + idx + '|' + chamberSize.toFixed(4));
    var rx = Math.max(3, Math.round((6 + rng() * 3) * chamberSize));
    var ry = Math.max(3, Math.round((4 + rng() * 2) * chamberSize));
    var cx = anchor.x, cy = anchor.y;
    var writes = [], cells = {};
    var x, y;
    for (y = cy - ry; y <= cy + ry; y++) {
      for (x = cx - rx; x <= cx + rx; x++) {
        if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
        var dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          cells[x + ',' + y] = FLOOR;
        }
      }
    }
    // 水域：内椭圆低洼处按子种子散布
    var waterRng = makeRng(seed + '|water' + idx + '|' + chamberSize.toFixed(4));
    for (var key in cells) {
      var parts = key.split(',');
      var px = +parts[0], py = +parts[1];
      var ddx = (px - cx) / rx, ddy = (py - cy) / ry;
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 > 0.25 && d2 < 0.85 && waterRng() < 0.22) cells[key] = WATER;
    }
    // 中心（目标点）周围保持干燥、无柱
    for (var ay = cy - 1; ay <= cy + 1; ay++)
      for (var ax = cx - 1; ax <= cx + 1; ax++)
        if (cells[ax + ',' + ay] != null) cells[ax + ',' + ay] = FLOOR;
    // 岩柱：数量与位置由子种子决定，绝不落在中心 2 格内
    var pillarRng = makeRng(seed + '|pillar' + idx + '|' + chamberSize.toFixed(4));
    var count = 1 + Math.floor(pillarRng() * 3);
    var pillars = [];
    for (var n = 0; n < count; n++) {
      var ang = pillarRng() * Math.PI * 2;
      var rad = 0.45 + pillarRng() * 0.45;
      var px2 = Math.round(cx + Math.cos(ang) * rx * rad);
      var py2 = Math.round(cy + Math.sin(ang) * ry * rad);
      if (cells[px2 + ',' + py2] == null) continue;
      if (Math.abs(px2 - cx) <= 2 && Math.abs(py2 - cy) <= 2) continue;
      cells[px2 + ',' + py2] = PILLAR;
      pillars.push({ x: px2, y: py2 });
    }
    var minX = cx - rx, maxX = cx + rx, minY = cy - ry, maxY = cy + ry;
    for (var k in cells) writes.push({ x: +k.split(',')[0], y: +k.split(',')[1], cell: cells[k] });
    return {
      writes: writes,
      bbox: { x0: Math.max(1, minX), y0: Math.max(1, minY),
              x1: Math.min(W - 2, maxX), y1: Math.min(H - 2, maxY) },
      meta: { center: { x: cx, y: cy }, rx: rx, ry: ry, pillars: pillars }
    };
  }

  // 隧道：中点位移折线，位移幅度随 curvature 增大；3 格宽笔刷保证连通
  function genTunnel(seed, idx, a, b, curvature) {
    var rng = makeRng(seed + '|tunnel' + idx + '|' + curvature.toFixed(4));
    var pts = [a, b];
    for (var level = 0; level < 4; level++) {
      var next = [pts[0]];
      for (var i = 0; i < pts.length - 1; i++) {
        var p = pts[i], q = pts[i + 1];
        var mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        var dx = q.x - p.x, dy = q.y - p.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var off = (rng() * 2 - 1) * len * 0.35 * curvature;
        next.push({ x: mx - (dy / len) * off, y: my + (dx / len) * off }, q);
      }
      pts = next;
    }
    var writes = [], seen = {};
    var bbox = { x0: W, y0: H, x1: 0, y1: 0 };
    function carve(cx, cy) {
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        var x = cx + ox, y = cy + oy;
        if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
        var key = x + ',' + y;
        if (seen[key]) continue;
        seen[key] = 1;
        writes.push({ x: x, y: y, cell: FLOOR });
        if (x < bbox.x0) bbox.x0 = x; if (x > bbox.x1) bbox.x1 = x;
        if (y < bbox.y0) bbox.y0 = y; if (y > bbox.y1) bbox.y1 = y;
      }
    }
    for (var s = 0; s < pts.length - 1; s++) {
      var p0 = pts[s], p1 = pts[s + 1];
      var steps = Math.ceil(Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y))) || 1;
      for (var t = 0; t <= steps; t++) {
        carve(Math.round(p0.x + (p1.x - p0.x) * t / steps),
              Math.round(p0.y + (p1.y - p0.y) * t / steps));
      }
    }
    return { writes: writes, bbox: bbox, meta: {} };
  }

  // ---------- 区域键：决定哪些区域需要重算 ----------
  // curvature 只影响隧道；chamberSize 只影响洞厅；seed 影响全部。
  function regionKey(params, id) {
    if (id.indexOf('tunnel') === 0)
      return hashString(params.seed + '|' + id + '|c' + params.curvature.toFixed(4));
    if (id.indexOf('chamber') === 0)
      return hashString(params.seed + '|' + id + '|s' + params.chamberSize.toFixed(4));
    return hashString(params.seed + '|' + id);
  }

  function genRegion(params, id, anchors) {
    if (id === 'entrance') return genEntrance(params.seed);
    if (id === 'exit') return genExit(params.seed);
    if (id.indexOf('chamber') === 0) {
      var i = +id.slice(7);
      return genChamber(params.seed, i, anchors[i], params.chamberSize);
    }
    var ti = +id.slice(6);
    var chain = [entrancePoint()].concat(anchors).concat([exitPoint()]);
    return genTunnel(params.seed, ti, chain[ti], chain[ti + 1], params.curvature);
  }

  // ---------- BFS 寻路 ----------
  function passable(cell) { return cell === FLOOR || cell === WATER; }

  function bfs(grid, from) {
    var prev = new Int32Array(W * H).fill(-1);
    var q = [from.y * W + from.x];
    prev[q[0]] = q[0];
    for (var head = 0; head < q.length; head++) {
      var cur = q[head], cx = cur % W, cy = (cur / W) | 0;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var ni = ny * W + nx;
        if (prev[ni] !== -1 || !passable(grid[ni])) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    return prev;
  }

  function tracePath(prev, to) {
    var idx = to.y * W + to.x;
    if (prev[idx] === -1) return null;
    var path = [];
    while (true) {
      path.push({ x: idx % W, y: (idx / W) | 0 });
      if (prev[idx] === idx) break;
      idx = prev[idx];
    }
    return path.reverse();
  }

  // ---------- 主入口：generateCave(params, cache) ----------
  // cache: 上一次返回的对象；区域键一致时直接复用，实现局部重算。
  function generateCave(rawParams, cache) {
    var params = normalizeParams(rawParams);
    var anchors = (cache && cache._anchorSeed === params.seed)
      ? cache.anchors : chamberAnchors(params.seed);
    var prevRegions = (cache && cache.regions) || {};
    var regions = {}, recomputed = [];

    for (var r = 0; r < REGION_ORDER.length; r++) {
      var id = REGION_ORDER[r];
      var key = regionKey(params, id);
      if (prevRegions[id] && prevRegions[id].key === key) {
        regions[id] = prevRegions[id]; // 未受影响：坐标与哈希原样保留
      } else {
        var reg = genRegion(params, id, anchors);
        reg.key = key;
        reg.hash = hashWrites(reg.writes);
        regions[id] = reg;
        recomputed.push(id);
      }
    }

    // 合成网格：固定顺序，隧道最后覆盖，保证链路贯通
    var grid = new Uint8Array(W * H); // 默认 ROCK
    for (var r2 = 0; r2 < REGION_ORDER.length; r2++) {
      var ws = regions[REGION_ORDER[r2]].writes;
      for (var i = 0; i < ws.length; i++)
        grid[ws[i].y * W + ws[i].x] = ws[i].cell;
    }
    enforceBoundary(grid);

    // 目标点：出生点(入口) + 3 洞厅中心 + 出口
    var targets = [{ x: 3, y: H >> 1, name: '入口/出生点' }];
    for (var c = 0; c < 3; c++)
      targets.push({ x: anchors[c].x, y: anchors[c].y, name: '洞厅' + (c + 1) });
    targets.push({ x: W - 4, y: H >> 1, name: '出口' });

    // 连通性保障：岩柱若封死目标，按确定顺序撤除（绝不碰出生点）
    guaranteeConnectivity(grid, regions);

    // 手动编辑层（单对象修改）
    var editKeys = Object.keys(params.edits);
    for (var e = 0; e < editKeys.length; e++) {
      var parts = editKeys[e].split(',');
      var ex = +parts[0], ey = +parts[1];
      if (ex >= 1 && ey >= 1 && ex <= W - 2 && ey <= H - 2)
        grid[ey * W + ex] = params.edits[editKeys[e]];
    }

    // 可达性 + 路径
    var prev = bfs(grid, targets[0]);
    var unreachable = [];
    for (var t = 0; t < targets.length; t++)
      if (prev[targets[t].y * W + targets[t].x] === -1) unreachable.push(targets[t].name);

    var path = [];
    if (unreachable.length === 0) {
      for (var leg = 0; leg < targets.length - 1; leg++) {
        var segPrev = bfs(grid, targets[leg]);
        var seg = tracePath(segPrev, targets[leg + 1]);
        for (var s = 0; s < seg.length; s++) path.push(seg[s]);
      }
    }

    // 阻断定位：逐个回退编辑，找出导致断路的障碍
    var blockedBy = [];
    if (unreachable.length > 0) {
      for (var e2 = 0; e2 < editKeys.length; e2++) {
        var cellVal = params.edits[editKeys[e2]];
        if (passable(cellVal)) continue;
        var p2 = editKeys[e2].split(',');
        var bx = +p2[0], by = +p2[1];
        var saved = grid[by * W + bx];
        grid[by * W + bx] = FLOOR;
        var prev2 = bfs(grid, targets[0]);
        var fixed = [];
        for (var t2 = 0; t2 < targets.length; t2++) {
          var ti = targets[t2].y * W + targets[t2].x;
          if (prev[ti] === -1 && prev2[ti] !== -1) fixed.push(targets[t2].name);
        }
        grid[by * W + bx] = saved;
        if (fixed.length > 0) blockedBy.push({ x: bx, y: by, targets: fixed });
      }
    }

    var layoutHash = hex8(hashGrid(grid, params));
    return {
      params: params, grid: grid, regions: regions, anchors: anchors,
      _anchorSeed: params.seed,
      targets: targets, path: path,
      reachable: unreachable.length === 0, unreachable: unreachable,
      blockedBy: blockedBy, recomputed: recomputed,
      layoutHash: layoutHash,
      regionHashes: regionHashMap(regions)
    };
  }

  function enforceBoundary(grid) {
    for (var x = 0; x < W; x++) { grid[x] = ROCK; grid[(H - 1) * W + x] = ROCK; }
    for (var y = 0; y < H; y++) { grid[y * W] = ROCK; grid[y * W + W - 1] = ROCK; }
  }

  function guaranteeConnectivity(grid, regions) {
    var spawn = entrancePoint();
    var goals = [exitPoint()];
    for (var id in regions)
      if (regions[id].meta && regions[id].meta.center) goals.push(regions[id].meta.center);
    for (var guard = 0; guard < 64; guard++) {
      var prev = bfs(grid, spawn);
      var ok = true;
      for (var g = 0; g < goals.length; g++)
        if (prev[goals[g].y * W + goals[g].x] === -1) { ok = false; break; }
      if (ok) return;
      // 撤除一个岩柱（倒序，确定性）；出生点 3 格内本就不会生成岩柱
      var removed = false;
      for (var c = 2; c >= 0 && !removed; c--) {
        var pillars = regions['chamber' + c].meta.pillars;
        for (var p = pillars.length - 1; p >= 0; p--) {
          var pi = pillars[p];
          if (grid[pi.y * W + pi.x] === PILLAR) {
            grid[pi.y * W + pi.x] = FLOOR;
            pillars.splice(p, 1);
            removed = true;
            break;
          }
        }
      }
      if (!removed) return;
    }
  }

  // ---------- 哈希 ----------
  function hashWrites(writes) {
    var h = 0x811c9dc5;
    for (var i = 0; i < writes.length; i++) {
      h = Math.imul(h ^ (writes[i].x & 0xff), 0x01000193);
      h = Math.imul(h ^ (writes[i].y & 0xff), 0x01000193);
      h = Math.imul(h ^ (writes[i].cell & 0xff), 0x01000193);
    }
    return hex8(h >>> 0);
  }

  function hashGrid(grid, params) {
    var h = 0x811c9dc5;
    for (var i = 0; i < grid.length; i++) h = Math.imul(h ^ grid[i], 0x01000193);
    var s = params.seed + '|' + params.curvature + '|' + params.chamberSize;
    for (var c = 0; c < s.length; c++) h = Math.imul(h ^ s.charCodeAt(c), 0x01000193);
    return h >>> 0;
  }

  function regionHashMap(regions) {
    var out = {};
    for (var i = 0; i < REGION_ORDER.length; i++)
      out[REGION_ORDER[i]] = regions[REGION_ORDER[i]].hash;
    return out;
  }

  // ---------- 参数持久化 ----------
  function serializeParams(params) {
    var p = normalizeParams(params);
    return JSON.stringify({
      seed: p.seed, curvature: p.curvature,
      chamberSize: p.chamberSize, edits: p.edits
    });
  }

  function deserializeParams(json) { return normalizeParams(JSON.parse(json)); }

  var API = {
    W: W, H: H, ROCK: ROCK, FLOOR: FLOOR, WATER: WATER, PILLAR: PILLAR,
    REGION_ORDER: REGION_ORDER,
    defaultParams: defaultParams, normalizeParams: normalizeParams,
    generateCave: generateCave,
    serializeParams: serializeParams, deserializeParams: deserializeParams,
    hashString: hashString, hex8: hex8
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.Cave = API;
})(typeof window !== 'undefined' ? window : globalThis);
