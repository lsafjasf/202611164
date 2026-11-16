// app.js — Canvas 渲染与交互
(function () {
  'use strict';
  var C = window.Cave;
  var CELL = 8;
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  cv.width = C.W * CELL;
  cv.height = C.H * CELL;

  var COLORS = {};
  COLORS[C.ROCK] = '#3a3f4a';
  COLORS[C.FLOOR] = '#8a7f66';
  COLORS[C.WATER] = '#2f6fb8';
  COLORS[C.PILLAR] = '#6e7686';

  var params = C.defaultParams();
  params.seed = document.getElementById('seed').value;
  params.curvature = 0.6;
  params.chamberSize = 1.1;
  var cave = null;

  function regenerate() {
    cave = C.generateCave(params, cave); // 传入缓存，仅重算受影响区域
    draw();
    renderInfo();
  }

  function draw() {
    var g = cave.grid;
    for (var y = 0; y < C.H; y++) {
      for (var x = 0; x < C.W; x++) {
        ctx.fillStyle = COLORS[g[y * C.W + x]];
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    // 可达路径
    ctx.fillStyle = '#e3b341';
    for (var i = 0; i < cave.path.length; i++) {
      var p = cave.path[i];
      ctx.fillRect(p.x * CELL + 2, p.y * CELL + 2, CELL - 4, CELL - 4);
    }
    // 目标标记
    cave.targets.forEach(function (t, idx) {
      ctx.fillStyle = idx === 0 ? '#3fb950' : (idx === cave.targets.length - 1 ? '#f85149' : '#d2a8ff');
      ctx.beginPath();
      ctx.arc(t.x * CELL + CELL / 2, t.y * CELL + CELL / 2, CELL * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx === 0 ? '入' : (idx === cave.targets.length - 1 ? '出' : idx)),
                   t.x * CELL + CELL / 2, t.y * CELL + CELL / 2 + 0.5);
    });
    // 阻断位置闪烁框
    if (cave.blockedBy.length) {
      ctx.strokeStyle = '#ff2d20';
      ctx.lineWidth = 2;
      cave.blockedBy.forEach(function (b) {
        ctx.strokeRect(b.x * CELL - 1, b.y * CELL - 1, CELL + 2, CELL + 2);
      });
    }
  }

  function ruleSummary() {
    return C.W + '×' + C.H + ' 网格 · 3 洞厅 · 曲率 ' + params.curvature.toFixed(2) +
      ' · 洞厅尺寸 ' + params.chamberSize.toFixed(2) +
      '\n规则: 边界封闭 / 岩柱避让出生点 / 目标互不可封死 / 同 seed 必复现';
  }

  function renderInfo() {
    var lines = [
      'Seed: ' + params.seed,
      '目标数量: ' + cave.targets.length + '（入口 + 3 洞厅 + 出口）',
      '布局哈希: ' + cave.layoutHash,
      '本次重算区域: ' + (cave.recomputed.length ? cave.recomputed.join(', ') : '无（全部复用缓存）'),
      '路径: ' + (cave.reachable ? '全部目标可达，长度 ' + cave.path.length + ' 格'
                                 : '断开！不可达: ' + cave.unreachable.join('、')),
      '',
      ruleSummary()
    ];
    document.getElementById('info').textContent = lines.join('\n');
    var warn = '';
    if (cave.blockedBy.length) {
      warn = cave.blockedBy.map(function (b) {
        return '阻断位置 (' + b.x + ',' + b.y + ') → 影响: ' + b.targets.join('、');
      }).join('\n');
    }
    document.getElementById('warn').textContent = warn;
    var rh = cave.regionHashes;
    document.getElementById('regions').textContent =
      '区域哈希: ' + C.REGION_ORDER.map(function (r) { return r + '=' + rh[r]; }).join('  ');
  }

  // ---------- 事件 ----------
  document.getElementById('seed').addEventListener('input', function (e) {
    params.seed = e.target.value; // 显式点击“重新生成”后才生效
  });
  document.getElementById('curvature').addEventListener('input', function (e) {
    params.curvature = +e.target.value;
    document.getElementById('curvVal').textContent = params.curvature.toFixed(2);
    regenerate(); // 仅隧道区域重算
  });
  document.getElementById('chamberSize').addEventListener('input', function (e) {
    params.chamberSize = +e.target.value;
    document.getElementById('sizeVal').textContent = params.chamberSize.toFixed(2);
    regenerate(); // 仅洞厅区域重算
  });
  document.getElementById('regen').addEventListener('click', function () {
    params.seed = document.getElementById('seed').value;
    cave = null; // 显式重新生成：清空缓存，全量重算
    regenerate();
  });
  document.getElementById('save').addEventListener('click', function () {
    var json = C.serializeParams(params);
    document.getElementById('paramIO').value = json;
    try { localStorage.setItem('caveParams', json); } catch (e) {}
  });
  document.getElementById('load').addEventListener('click', function () {
    var json = document.getElementById('paramIO').value ||
               (localStorage.getItem('caveParams') || '');
    if (!json) return;
    try {
      params = C.deserializeParams(json);
      document.getElementById('seed').value = params.seed;
      document.getElementById('curvature').value = params.curvature;
      document.getElementById('chamberSize').value = params.chamberSize;
      document.getElementById('curvVal').textContent = params.curvature.toFixed(2);
      document.getElementById('sizeVal').textContent = params.chamberSize.toFixed(2);
      cave = null;
      regenerate(); // 载入后布局哈希应与保存时一致
    } catch (e) {
      document.getElementById('warn').textContent = '参数 JSON 解析失败: ' + e.message;
    }
  });

  // 单对象修改：点击切换岩柱；出生点与目标格受保护
  cv.addEventListener('click', function (e) {
    var rect = cv.getBoundingClientRect();
    var x = Math.floor((e.clientX - rect.left) / CELL);
    var y = Math.floor((e.clientY - rect.top) / CELL);
    if (x < 1 || y < 1 || x > C.W - 2 || y > C.H - 2) return;
    for (var i = 0; i < cave.targets.length; i++) {
      var t = cave.targets[i];
      if (Math.abs(t.x - x) <= 1 && Math.abs(t.y - y) <= 1) return; // 目标不可封死
    }
    var key = x + ',' + y;
    var cur = cave.grid[y * C.W + x];
    if (params.edits[key] != null) {
      delete params.edits[key]; // 撤销编辑，恢复原区域格
    } else if (cur === C.FLOOR || cur === C.WATER) {
      params.edits[key] = C.PILLAR;
    } else if (cur === C.ROCK) {
      params.edits[key] = C.FLOOR;
    }
    regenerate(); // 区域全部复用，仅重算路径与阻断
  });

  regenerate();
})();
