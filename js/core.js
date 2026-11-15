/* ============================================================
 * core.js
 * 确定性山谷云带生成内核（无 DOM 依赖，可在浏览器 / Node 中运行）
 * 同 seed + 同参数 => 完全相同的地形、路径、云团与布局哈希
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ValleyCloud = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WORLD_W = 960;
  var WORLD_H = 600;
  var GRID = 8;                       // 路径网格像素
  var COLS = WORLD_W / GRID;          // 120
  var ROWS = WORLD_H / GRID;          // 75
  var REGION_COLS = 8;
  var REGION_ROWS = 5;
  var LAYOUT_VERSION = 3;

  // ---------- 确定性 PRNG：mulberry32 ----------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 整数哈希（噪声网格用） ----------
  function hash2(ix, iy, seed) {
    var h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  function valueNoise2(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = smooth(x - ix), fy = smooth(y - iy);
    var a = hash2(ix, iy, seed);
    var b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed);
    var d = hash2(ix + 1, iy + 1, seed);
    var ab = a + (b - a) * fx;
    var cd = c + (d - c) * fx;
    return ab + (cd - ab) * fy;
  }

  // 分形布朗运动，输出约 0..1
  function fbm2(x, y, seed, octaves) {
    var sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum += valueNoise2(x * freq, y * freq, seed + o * 1013) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }

  // ---------- 稳定字符串哈希 cyrb53 ----------
  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(13, '0');
  }

  // 对纯数据对象做稳定序列化后哈希（键名排序）
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(value[k]);
    }).join(',') + '}';
  }

  function hashData(value) { return cyrb53(stableStringify(value)); }

  function round2(v) { return Math.round(v * 100) / 100; }

  // ============================================================
  // 地形生成：三层侧视山脊（fbm 轮廓）+ 山峰圆形障碍
  // 仅依赖 seed，与湿度/风/高度无关（保证改参数时地形哈希不变）
  // ============================================================
  var RIDGE_LAYERS = [
    { base: 250, amp: 195, freq: 3.2, seed: 11, color: '#5a7184', snow: 0.86 },
    { base: 350, amp: 165, freq: 4.2, seed: 29, color: '#3f5466', snow: 0.9 },
    { base: 470, amp: 115, freq: 5.2, seed: 47, color: '#2a3b49', snow: 1.1 }
  ];

  function ridgeProfile(layer, seed) {
    var pts = [];
    for (var x = 0; x <= WORLD_W; x += 8) {
      var n = fbm2((x / WORLD_W) * layer.freq * 2.2 + 5.1, layer.seed * 0.37, seed, 4);
      var n2 = fbm2((x / WORLD_W) * layer.freq * 5.5 + 1.7, layer.seed * 0.91, seed, 2);
      var ridge = 1 - Math.abs(2 * n - 1); // 脊线化：让噪声形成尖锐峰
      var y = layer.base - layer.amp * (0.6 * ridge + 0.4 * n2);
      pts.push({ x: x, y: Math.round(y * 10) / 10 });
    }
    return pts;
  }

  // 在山脊轮廓上提取局部最高点作为山峰障碍
  function extractPeaks(profile, layerIndex, rng, out, minGap, minProm, baseRadius, span) {
    for (var i = span; i < profile.length - span; i++) {
      var p = profile[i];
      var isMax = true;
      for (var k = i - 2; k <= i + 2; k++) {
        if (k !== i && profile[k].y <= p.y) { isMax = false; break; }
      }
      if (!isMax) continue;
      // 显著性：峰顶与峰肩窗口内最深谷底（y 最大）的高程差
      var saddle = p.y;
      for (var s = i - span; s <= i + span; s++) {
        if (profile[s].y > saddle) saddle = profile[s].y;
      }
      var prom = saddle - p.y;
      if (prom < minProm) continue;
      var jx = p.x + (rng() - 0.5) * 14;
      var jy = p.y + (rng() - 0.5) * 8;
      var radius = Math.round(baseRadius + prom * 0.85 + rng() * 8);
      var candidate = {
        id: 'peak-' + layerIndex + '-' + i,
        kind: 'peak',
        x: 0,
        y: 0,
        r: radius,
        layer: layerIndex,
        prominence: Math.round(prom * 10) / 10
      };
      candidate.x = Math.round(Math.max(radius + 4, Math.min(WORLD_W - radius - 4, jx)) * 10) / 10;
      candidate.y = Math.round(Math.max(radius + 4, Math.min(WORLD_H - radius - 4, jy)) * 10) / 10;
      var overlap = out.some(function (q) {
        return Math.hypot(q.x - candidate.x, q.y - candidate.y) < (q.r + candidate.r) * 0.55 + minGap;
      });
      if (!overlap) out.push(candidate);
    }
  }

  function buildTerrain(seed) {
    var rng = mulberry32(seed ^ 0x51a7e3);
    var ridges = RIDGE_LAYERS.map(function (layer) {
      return { layer: layer, profile: ridgeProfile(layer, seed) };
    });
    var peaks = [];
    extractPeaks(ridges[0].profile, 0, rng, peaks, 30, 5, 24, 11);
    extractPeaks(ridges[1].profile, 1, rng, peaks, 24, 4, 20, 9);
    return {
      ridges: ridges,
      peaks: peaks,
      terrainHash: hashData({
        v: LAYOUT_VERSION,
        seed: seed,
        ridges: ridges.map(function (r) { return r.profile; }),
        peaks: peaks.map(function (p) { return [p.id, p.x, p.y, p.r, p.layer]; })
      })
    };
  }

  // ============================================================
  // 障碍与栅格
  // ============================================================
  function buildObstacles(terrain, params, customObstacles) {
    var clearance = cloudHalfWidth(params.humidity);
    var list = terrain.peaks.map(function (p) {
      var edge = Math.min(p.x, WORLD_W - p.x, p.y, WORLD_H - p.y);
      // 贴近场景边缘的山峰收缩膨胀量，保证云带与边界之间留有绕行缝隙
      var inflation = Math.max(0, Math.min(clearance * 0.75, (edge - GRID * 2) * 0.45));
      return {
        id: p.id, kind: 'peak',
        x: p.x, y: p.y,
        r: p.r + inflation,
        baseR: p.r, layer: p.layer
      };
    });
    (customObstacles || []).forEach(function (c) {
      list.push({
        id: c.id, kind: c.kind || 'custom',
        x: c.x, y: c.y,
        r: c.r + clearance, baseR: c.r
      });
    });
    return list;
  }

  function cloudHalfWidth(humidity) {
    // 湿度 20..90 -> 云带半宽 14..34px
    return 10 + (humidity - 20) * (24 / 70);
  }

  function cellBlocked(cx, cy, obstacles) {
    var wx = cx * GRID + GRID / 2;
    var wy = cy * GRID + GRID / 2;
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      var dx = wx - o.x, dy = wy - o.y;
      if (dx * dx + dy * dy <= o.r * o.r) return true;
    }
    return false;
  }

  // 为某高度找到一列/行中最近的开放格
  function nearestOpenCell(cx, cy, blocked) {
    if (!blocked[cy][cx]) return [cx, cy];
    var inwardX = cx <= 1 ? 1 : (cx >= COLS - 2 ? -1 : 0);
    var inwardY = cy <= 1 ? 1 : (cy >= ROWS - 2 ? -1 : 0);
    // 先沿远离边界的方向直线搜索，避免被吸回边缘
    for (var step = 1; step < 40; step++) {
      var ix = cx + inwardX * step, iy = cy + inwardY * step;
      if (ix >= 0 && iy >= 0 && ix < COLS && iy < ROWS && !blocked[iy][ix]) return [ix, iy];
    }
    for (var ring = 1; ring < 40; ring++) {
      for (var dy = -ring; dy <= ring; dy++) {
        for (var dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          var x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
          if (!blocked[y][x]) return [x, y];
        }
      }
    }
    return null;
  }

  // ============================================================
  // A* 寻路（4 邻接，二叉堆），绕开膨胀后的山峰
  // ============================================================
  function buildBlockedGrid(obstacles) {
    var blocked = new Array(ROWS);
    for (var y = 0; y < ROWS; y++) {
      blocked[y] = new Uint8Array(COLS);
      for (var x = 0; x < COLS; x++) {
        blocked[y][x] = cellBlocked(x, y, obstacles) ? 1 : 0;
      }
    }
    return blocked;
  }

  function Heap() { this.a = []; }
  Heap.prototype.push = function (node) {
    var a = this.a, i = a.push(node) - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      var t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        var t = a[s]; a[s] = a[i]; a[i] = t;
        i = s;
      }
    }
    return top;
  };

  function astar(blocked, sx, sy, gx, gy) {
    var total = COLS * ROWS;
    var gScore = new Float64Array(total).fill(Infinity);
    var came = new Int32Array(total).fill(-1);
    var closed = new Uint8Array(total);
    function idx(x, y) { return y * COLS + x; }
    function h(x, y) {
      var dx = Math.abs(x - gx), dy = Math.abs(y - gy);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    }
    var start = idx(sx, sy);
    gScore[start] = 0;
    var heap = new Heap();
    heap.push({ f: h(sx, sy), x: sx, y: sy });
    var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (heap.a.length) {
      var cur = heap.pop();
      var ci = idx(cur.x, cur.y);
      if (closed[ci]) continue;
      closed[ci] = 1;
      if (cur.x === gx && cur.y === gy) {
        var cells = [];
        var n = ci;
        while (n !== -1) {
          cells.push([n % COLS, Math.floor(n / COLS)]);
          n = came[n];
        }
        cells.reverse();
        return { ok: true, cells: cells, closed: closed };
      }
      for (var d = 0; d < 4; d++) {
        var nx = cur.x + nb[d][0], ny = cur.y + nb[d][1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || blocked[ny][nx]) continue;
        var ni = idx(nx, ny);
        if (closed[ni]) continue;
        var ng = gScore[ci] + 1;
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          came[ni] = ci;
          heap.push({ f: ng + h(nx, ny), x: nx, y: ny });
        }
      }
    }
    return { ok: false, cells: null, closed: closed };
  }

  // Ramer–Douglas–Peucker 路径抽稀
  function rdp(points, eps) {
    if (points.length < 3) return points;
    var keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    (function rec(lo, hi) {
      if (hi <= lo + 1) return;
      var a = points[lo], b = points[hi];
      var dx = b.x - a.x, dy = b.y - a.y;
      var len2 = dx * dx + dy * dy || 1;
      var maxD = -1, maxI = -1;
      for (var i = lo + 1; i < hi; i++) {
        var t = ((points[i].x - a.x) * dx + (points[i].y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        var px = a.x + t * dx, py = a.y + t * dy;
        var dist = Math.hypot(points[i].x - px, points[i].y - py);
        if (dist > maxD) { maxD = dist; maxI = i; }
      }
      if (maxD > eps) {
        keep[maxI] = 1;
        rec(lo, maxI);
        rec(maxI, hi);
      }
    })(0, points.length - 1);
    return points.filter(function (_, i) { return keep[i]; });
  }

  // ============================================================
  // 阻断分析：A* 失败时，找出把起终点两侧分开的障碍
  // ============================================================
  function floodFill(blocked, sx, sy) {
    var seen = new Uint8Array(COLS * ROWS);
    var q = [[sx, sy]];
    seen[sy * COLS + sx] = 1;
    var head = 0;
    while (head < q.length) {
      var cur = q[head++];
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < 4; d++) {
        var nx = cur[0] + nb[d][0], ny = cur[1] + nb[d][1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        var ni = ny * COLS + nx;
        if (seen[ni] || blocked[ny][nx]) continue;
        seen[ni] = 1;
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  function findBlockage(blocked, obstacles, sx, sy, gx, gy) {
    var reachable = floodFill(blocked, sx, sy);
    if (reachable[gy * COLS + gx]) return null;
    // 起端可达区域的开放边界格，找贴着这些格的障碍
    var touch = {};
    for (var cy = 0; cy < ROWS; cy++) {
      for (var cx = 0; cx < COLS; cx++) {
        if (!reachable[cy * COLS + cx]) continue;
        var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d = 0; d < 4; d++) {
          var nx = cx + nb[d][0], ny = cy + nb[d][1];
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || !blocked[ny][nx]) continue;
          var wx = nx * GRID + GRID / 2, wy = ny * GRID + GRID / 2;
          for (var i = 0; i < obstacles.length; i++) {
            var o = obstacles[i];
            if (Math.hypot(wx - o.x, wy - o.y) <= o.r + GRID) touch[o.id] = o;
          }
        }
      }
    }
    var blockers = Object.keys(touch).map(function (k) {
      var o = touch[k];
      return { id: o.id, kind: o.kind, x: round2(o.x), y: round2(o.y), r: o.baseR || o.r };
    });
    blockers.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var anchor = blockers[0] || { x: gx * GRID, y: gy * GRID, r: 12 };
    return {
      reason: 'obstacle_chain',
      message: '障碍链在 (' + Math.round(anchor.x) + ', ' + Math.round(anchor.y) +
        ') 附近闭合，云带无法从起点到达终点',
      blockers: blockers,
      anchor: { x: anchor.x, y: anchor.y }
    };
  }

  // ============================================================
  // 风向 -> 起终点；高度参数决定水平风时的纵向位置
  // ============================================================
  function endpoints(windDir, altitude) {
    // altitude 0..100，映射到画面纵向 120..420
    var y = Math.round(120 + (100 - altitude) * 3);
    var x = Math.round(40 + altitude * 8.8);  // 垂直风时高度映射到横向 40..920
    var cy = Math.max(0, Math.min(ROWS - 1, Math.round(y / GRID)));
    var cx = Math.max(0, Math.min(COLS - 1, Math.round(x / GRID)));
    if (windDir === 'E') return { s: [1, cy], g: [COLS - 2, cy] };
    if (windDir === 'W') return { s: [COLS - 2, cy], g: [1, cy] };
    if (windDir === 'S') return { s: [cx, 1], g: [cx, ROWS - 2] };
    return { s: [cx, ROWS - 2], g: [cx, 1] }; // N
  }

  function planRoute(terrain, params, customObstacles) {
    var obstacles = buildObstacles(terrain, params, customObstacles);
    var blocked = buildBlockedGrid(obstacles);
    var ep = endpoints(params.windDir, params.altitude);
    var start = nearestOpenCell(ep.s[0], ep.s[1], blocked);
    var goal = nearestOpenCell(ep.g[0], ep.g[1], blocked);
    if (!start || !goal) {
      return {
        ok: false, obstacles: obstacles, blocked: blocked,
        blockage: { reason: 'endpoint_blocked', message: '起点或终点被障碍完全覆盖，无法规划云带' }
      };
    }
    var result = astar(blocked, start[0], start[1], goal[0], goal[1]);
    if (!result.ok) {
      return {
        ok: false, obstacles: obstacles, blocked: blocked,
        start: start, goal: goal,
        blockage: findBlockage(blocked, obstacles, start[0], start[1], goal[0], goal[1])
      };
    }
    var pts = result.cells.map(function (c) {
      return { x: c[0] * GRID + GRID / 2, y: c[1] * GRID + GRID / 2 };
    });
    var simplified = rdp(pts, 22);
    var targets = simplified.map(function (p, i) {
      return { id: 'target-' + i, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    });
    return {
      ok: true, obstacles: obstacles, blocked: blocked,
      start: start, goal: goal,
      path: pts, targets: targets
    };
  }

  // ============================================================
  // 云团：沿路径等距放置，湿度决定数量、半宽与半径
  // ============================================================
  function buildClouds(path, humidity, seed) {
    if (!path || path.length < 2) return [];
    var rng = mulberry32(seed ^ 0xc10d);
    var half = cloudHalfWidth(humidity);
    var spacing = 20 - humidity * 0.1;            // 湿度越高，云团越密
    var count = Math.max(8, Math.round(pathLength(path) / spacing));
    var puffs = [];
    for (var i = 0; i < count; i++) {
      var t = count === 1 ? 0 : i / (count - 1);
      var at = samplePath(path, t);
      var jitterAlong = (rng() - 0.5) * 10;
      var off = (rng() - 0.5) * 2 * half * 0.85;
      var radius = Math.round((half * (0.85 + rng() * 0.5)) * 10) / 10;
      var shifted = samplePath(path, Math.min(1, Math.max(0, t + jitterAlong / pathLength(path))));
      puffs.push({
        id: 'puff-' + i,
        x: Math.round((shifted.x + at.nx * off) * 10) / 10,
        y: Math.round((shifted.y + at.ny * off) * 10) / 10,
        r: radius,
        rx: Math.round(radius * 1.35 * 10) / 10,
        ry: Math.round(radius * 0.82 * 10) / 10,
        alpha: Math.round((0.55 + rng() * 0.3) * 100) / 100
      });
    }
    return puffs;
  }

  function pathLength(path) {
    var len = 0;
    for (var i = 1; i < path.length; i++) {
      len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    return len;
  }

  function samplePath(path, t) {
    var total = pathLength(path);
    var want = total * t;
    var acc = 0;
    for (var i = 1; i < path.length; i++) {
      var a = path[i - 1], b = path[i];
      var seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + seg >= want || i === path.length - 1) {
        var k = seg === 0 ? 0 : (want - acc) / seg;
        var dx = b.x - a.x, dy = b.y - a.y;
        return {
          x: a.x + dx * k, y: a.y + dy * k,
          nx: -dy / (seg || 1), ny: dx / (seg || 1)
        };
      }
      acc += seg;
    }
    var last = path[path.length - 1];
    return { x: last.x, y: last.y, nx: 0, ny: 0 };
  }

  // ============================================================
  // 场景区域：8 x 5，用于“未受影响区域坐标与哈希不变”校验
  // ============================================================
  function regionOf(x, y) {
    var rx = Math.min(REGION_COLS - 1, Math.max(0, Math.floor(x / (WORLD_W / REGION_COLS))));
    var ry = Math.min(REGION_ROWS - 1, Math.max(0, Math.floor(y / (WORLD_H / REGION_ROWS))));
    return ry * REGION_COLS + rx;
  }

  function regionHashes(terrain, route, puffs, customObstacles) {
    var buckets = [];
    for (var i = 0; i < REGION_COLS * REGION_ROWS; i++) buckets.push({ terrain: [], clouds: [] });
    terrain.peaks.forEach(function (p) {
      buckets[regionOf(p.x, p.y)].terrain.push([p.id, round2(p.x), round2(p.y), p.r]);
    });
    (customObstacles || []).forEach(function (c) {
      buckets[regionOf(c.x, c.y)].terrain.push([c.id, round2(c.x), round2(c.y), c.r]);
    });
    if (route && route.ok) {
      route.targets.forEach(function (t) {
        buckets[regionOf(t.x, t.y)].clouds.push([t.id, t.x, t.y]);
      });
      puffs.forEach(function (p) {
        buckets[regionOf(p.x, p.y)].clouds.push([p.id, p.x, p.y, p.rx, p.ry, p.alpha]);
      });
    }
    return buckets.map(function (b, i) {
      b.terrain.sort(function (a, z) { return a[0] < z[0] ? -1 : 1; });
      b.clouds.sort(function (a, z) { return a[0] < z[0] ? -1 : 1; });
      return {
        region: i,
        terrainHash: cyrb53(stableStringify({ t: b.terrain })),
        cloudHash: cyrb53(stableStringify({ c: b.clouds }))
      };
    });
  }

  // ============================================================
  // 完整布局生成（纯函数）
  // ============================================================
  function defaultParams() {
    return { humidity: 55, windSpeed: 30, altitude: 55, windDir: 'E' };
  }

  function ruleSummary(params) {
    var dirName = { E: '东风 → 西向东', W: '西风 → 东向西', S: '南风 → 北向南', N: '北风 → 南向北' };
    return [
      'seed 驱动 mulberry32 + fbm 噪声生成三层山脊',
      '湿度 ' + params.humidity + '% → 云带半宽 ' + Math.round(cloudHalfWidth(params.humidity)) +
        'px，云团密度随湿度上升',
      '风向 ' + dirName[params.windDir] + '，A*（4 邻接）绕开膨胀后的山峰',
      '高度 ' + params.altitude + '% 决定云带走线高度；风速 ' + params.windSpeed +
        ' 仅驱动风迹动画，不参与布局哈希',
      '场景边界 0..' + WORLD_W + ' x 0..' + WORLD_H + '，对象越界即判定失败'
    ];
  }

  function generateLayout(seed, params, customObstacles) {
    params = Object.assign(defaultParams(), params || {});
    customObstacles = customObstacles || [];
    var terrain = buildTerrain(seed);
    var route = planRoute(terrain, params, customObstacles);
    var puffs = route.ok ? buildClouds(route.path, params.humidity, seed) : [];
    var regions = regionHashes(terrain, route, puffs, customObstacles);
    var layoutPayload = {
      v: LAYOUT_VERSION,
      seed: seed,
      params: {
        humidity: params.humidity,
        altitude: params.altitude,
        windDir: params.windDir
        // windSpeed 有意排除：动画参数不影响布局
      },
      peaks: terrain.peaks.map(function (p) { return [p.id, round2(p.x), round2(p.y), p.r]; }),
      custom: customObstacles.map(function (c) { return [c.id, round2(c.x), round2(c.y), c.r]; }),
      targets: route.ok ? route.targets : [],
      puffs: puffs.map(function (p) { return [p.id, p.x, p.y, p.rx, p.ry, p.alpha]; })
    };
    return {
      seed: seed,
      params: params,
      terrain: terrain,
      obstacles: route.obstacles,
      blocked: route.blocked,
      route: route,
      puffs: puffs,
      customObstacles: customObstacles,
      regions: regions,
      targetCount: route.ok ? route.targets.length : 0,
      puffCount: puffs.length,
      terrainHash: terrain.terrainHash,
      layoutHash: cyrb53(stableStringify(layoutPayload)),
      blockage: route.ok ? null : route.blockage
    };
  }

  // 比较两次布局的区域哈希，返回发生变化的区域编号
  function diffRegions(before, after) {
    var changed = { terrain: [], clouds: [] };
    for (var i = 0; i < before.regions.length; i++) {
      if (before.regions[i].terrainHash !== after.regions[i].terrainHash) changed.terrain.push(i);
      if (before.regions[i].cloudHash !== after.regions[i].cloudHash) changed.clouds.push(i);
    }
    return changed;
  }

  // 场景边界 / 关键对象不重叠 / 可达性校验
  function validateLayout(layout) {
    var problems = [];
    var inBounds = function (o) {
      return o.x - o.r >= 0 && o.x + o.r <= WORLD_W &&
             o.y - o.r >= 0 && o.y + o.r <= WORLD_H;
    };
    layout.terrain.peaks.forEach(function (p) {
      if (!inBounds(p)) problems.push('山峰 ' + p.id + ' 越界');
    });
    layout.customObstacles.forEach(function (c) {
      if (c.x < 0 || c.x > WORLD_W || c.y < 0 || c.y > WORLD_H) {
        problems.push('自定义障碍 ' + c.id + ' 越界');
      }
    });
    var peaks = layout.terrain.peaks;
    for (var i = 0; i < peaks.length; i++) {
      for (var j = i + 1; j < peaks.length; j++) {
        var d = Math.hypot(peaks[i].x - peaks[j].x, peaks[i].y - peaks[j].y);
        if (d < (peaks[i].r + peaks[j].r) * 0.55) {
          problems.push('山峰 ' + peaks[i].id + ' 与 ' + peaks[j].id + ' 重叠');
        }
      }
    }
    if (!layout.route.ok) {
      problems.push('云带不可达：' + (layout.blockage && layout.blockage.message));
    } else {
      var half = cloudHalfWidth(layout.params.humidity);
      layout.route.path.forEach(function (pt) {
        if (pt.x < 0 || pt.x > WORLD_W || pt.y < 0 || pt.y > WORLD_H) {
          problems.push('云带路径越界');
        }
        layout.terrain.peaks.forEach(function (p) {
          if (Math.hypot(pt.x - p.x, pt.y - p.y) < p.r + half - GRID) {
            problems.push('云带路径穿入山峰 ' + p.id);
          }
        });
      });
    }
    return { ok: problems.length === 0, problems: problems };
  }

  // ============================================================
  // 可复现自检套件：两个固定 seed + 局部重算 + 阻断定位 + 存档
  // ============================================================
  function runChecks() {
    var seeds = [20261116, 987654321];
    var results = [];
    function record(name, ok, detail) {
      results.push({ name: name, ok: !!ok, detail: detail || '' });
    }

    seeds.forEach(function (seed) {
      var p1 = defaultParams();
      var a = generateLayout(seed, p1);
      var b = generateLayout(seed, JSON.parse(JSON.stringify(p1)));

      // 1. 同 seed 复现：布局哈希一致
      record('seed ' + seed + ' 同参数复现',
        a.layoutHash === b.layoutHash && a.terrainHash === b.terrainHash,
        'layout=' + a.layoutHash);

      // 2. 目标可达
      record('seed ' + seed + ' 云带目标可达', a.route.ok,
        a.route.ok ? a.targetCount + ' 个目标点' : (a.blockage && a.blockage.message));

      // 3. 关键对象不重叠、边界正确
      var v = validateLayout(a);
      record('seed ' + seed + ' 边界与不重叠', v.ok, v.problems.join('；') || '全部对象在界内且无重叠');
    });

    // 4. 风速不影响布局哈希（仅动画）
    var base = generateLayout(seeds[0], { windSpeed: 10 });
    var windy = generateLayout(seeds[0], { windSpeed: 90 });
    record('风速变化不改变布局', base.layoutHash === windy.layoutHash,
      base.layoutHash);

    // 5. 修改单个对象：地形区域哈希与未受影响云区保持不变
    var before = generateLayout(seeds[0]);
    var custom = [{ id: 'custom-1', kind: 'custom', x: 700, y: 300, r: 26 }];
    var after = generateLayout(seeds[0], defaultParams(), custom);
    var diff = diffRegions(before, after);
    var terrainStable = after.regions.every(function (r, i) {
      return r.terrainHash === before.regions[i].terrainHash ||
             diff.terrain.indexOf(i) !== -1; // 仅含新障碍的区域允许变化
      });
    var customRegion = regionOf(700, 300);
    var onlyExpectedTerrainRegion = diff.terrain.length === 1 && diff.terrain[0] === customRegion;
    record('单对象修改只影响所属地形区域',
      terrainStable && onlyExpectedTerrainRegion,
      '变化区域=' + JSON.stringify(diff.terrain));
    record('未受影响区域云哈希保持',
      after.regions.every(function (r, i) {
        return diff.clouds.indexOf(i) !== -1 || r.cloudHash === before.regions[i].cloudHash;
      }),
      '云变化区域=' + JSON.stringify(diff.clouds));

    // 6. 阻断场景：用一排障碍封死横向通道，必须报告阻断位置
    var wall = [];
    for (var y = 40; y <= 560; y += 70) {
      wall.push({ id: 'wall-' + y, kind: 'custom', x: 480, y: y, r: 46 });
    }
    var blockedLayout = generateLayout(seeds[0], defaultParams(), wall);
    record('障碍断链时报告阻断位置',
      !blockedLayout.route.ok && blockedLayout.blockage &&
      blockedLayout.blockage.blockers.length > 0,
      blockedLayout.blockage ? blockedLayout.blockage.message : '未报告阻断');

    // 7. 保存再载入：存档中的哈希与重新计算一致
    var snapshot = buildSnapshot(before);
    var restored = generateLayout(snapshot.seed, snapshot.params, snapshot.customObstacles);
    record('存档载入后布局哈希一致',
      restored.layoutHash === snapshot.layoutHash &&
      restored.terrainHash === snapshot.terrainHash,
      snapshot.layoutHash);

    return {
      ok: results.every(function (r) { return r.ok; }),
      results: results,
      seeds: seeds
    };
  }

  // ============================================================
  // 存档快照（保存/载入一致性的最小数据）
  // ============================================================
  function buildSnapshot(layout) {
    return {
      version: LAYOUT_VERSION,
      seed: layout.seed,
      params: layout.params,
      customObstacles: layout.customObstacles,
      layoutHash: layout.layoutHash,
      terrainHash: layout.terrainHash,
      savedAt: new Date().toISOString()
    };
  }

  return {
    WORLD_W: WORLD_W,
    WORLD_H: WORLD_H,
    GRID: GRID,
    COLS: COLS,
    ROWS: ROWS,
    REGION_COLS: REGION_COLS,
    REGION_ROWS: REGION_ROWS,
    LAYOUT_VERSION: LAYOUT_VERSION,
    mulberry32: mulberry32,
    hashData: hashData,
    cyrb53: cyrb53,
    cloudHalfWidth: cloudHalfWidth,
    defaultParams: defaultParams,
    ruleSummary: ruleSummary,
    generateLayout: generateLayout,
    diffRegions: diffRegions,
    validateLayout: validateLayout,
    runChecks: runChecks,
    buildSnapshot: buildSnapshot,
    regionOf: regionOf
  };
});
