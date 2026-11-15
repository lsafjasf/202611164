(function () {
  'use strict';
  var E = window.VegEngine;
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var summaryEl = document.getElementById('summary');

  var world = null;
  var tool = 'road';
  var drag = null; // { index, points }
  var highlight = { affected: [], blockers: [], region: null };
  window.__veg = {
    get world() { return world; }
  };

  var PALETTES = {
    spring: { grass: '#7fbf6b', tree: '#4f9a52', trunk: '#6b4f35', shrub: '#6fae5c', leaf2: '#d38eb0' },
    summer: { grass: '#5d9b4d', tree: '#2f7a3a', trunk: '#5d452e', shrub: '#4e8f45', leaf2: '#3c8a44' },
    autumn: { grass: '#b09a4b', tree: '#c97e2c', trunk: '#5d452e', shrub: '#b06b32', leaf2: '#d3a23c' },
    winter: { grass: '#d8e0da', tree: '#3f5a48', trunk: '#4a3b2d', shrub: '#8fa397', leaf2: '#eef4f0' }
  };

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function cellFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    var px = ((ev.clientX - rect.left) / rect.width) * E.W;
    var py = ((ev.clientY - rect.top) / rect.height) * E.H;
    return { x: Math.floor(px), y: Math.floor(py), fx: px, fy: py };
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < E.W && y < E.H;
  }

  function draw() {
    if (!world) return;
    var pal = PALETTES[world.params.season] || PALETTES.summer;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTerrain(pal);
    drawRoad();
    var sorted = world.objects.slice().sort(function (a, b) {
      return a.py - b.py || a.px - b.px;
    });
    sorted.forEach(function (o) {
      if (o.type === 'grass') drawGrass(o, pal);
    });
    sorted.forEach(function (o) {
      if (o.type === 'shrub') drawShrub(o, pal);
    });
    sorted.forEach(function (o) {
      if (o.type === 'tree') drawTree(o, pal);
    });
    drawMarkers();
    drawOverlays();
  }

  function drawTerrain(pal) {
    for (var y = 0; y < E.H; y++) {
      for (var x = 0; x < E.W; x++) {
        var c = world.cells[y * E.W + x];
        var fill;
        if (c.water) {
          var depth = Math.max(0, world.params.waterLevel - c.elev);
          fill = shade('#2f6f9e', -depth * 2.2);
        } else {
          fill = shade(pal.grass, (c.elev - 0.4) * 0.9 - (1 - c.moist) * 0.12);
        }
        ctx.fillStyle = fill;
        ctx.fillRect(x * E.CELL, y * E.CELL, E.CELL, E.CELL);
      }
    }
  }

  function drawRoad() {
    var pts = (drag && drag.points) || world.road;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = (p.x + 0.5) * E.CELL;
      var y = (p.y + 0.5) * E.CELL;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#3a332b';
    ctx.lineWidth = E.ROAD_HALF_WIDTH * 2 * E.CELL;
    ctx.stroke();
    ctx.strokeStyle = '#8a7a5f';
    ctx.lineWidth = E.ROAD_HALF_WIDTH * 1.3 * E.CELL;
    ctx.stroke();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = '#e6d9b8';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    pts.forEach(function (p, i) {
      if (i === 0 || i === pts.length - 1) return;
      ctx.fillStyle = drag ? '#ffd479' : '#c9b487';
      ctx.beginPath();
      ctx.arc((p.x + 0.5) * E.CELL, (p.y + 0.5) * E.CELL, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawGrass(o, pal) {
    var x = o.px * E.CELL;
    var y = o.py * E.CELL;
    ctx.strokeStyle = shade(pal.grass, 0.15);
    ctx.lineWidth = 1;
    for (var i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 1.6, y + 1.5);
      ctx.lineTo(x + i * 1.6 + i, y - 2.5);
      ctx.stroke();
    }
  }

  function drawShrub(o, pal) {
    var x = o.px * E.CELL;
    var y = o.py * E.CELL;
    ctx.fillStyle = pal.shrub;
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.arc(x - 2.4, y + 1, 2.4, 0, Math.PI * 2);
    ctx.arc(x + 2.4, y + 1, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTree(o, pal) {
    var x = o.px * E.CELL;
    var y = o.py * E.CELL;
    var h = (o.height || 1) * E.CELL;
    var leanPx = o.lean * 6;
    ctx.strokeStyle = pal.trunk;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 1);
    ctx.lineTo(x + leanPx, y - h * 0.55);
    ctx.stroke();
    ctx.fillStyle = pal.tree;
    ctx.beginPath();
    ctx.arc(x + leanPx, y - h * 0.7, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.leaf2;
    ctx.beginPath();
    ctx.arc(x + leanPx - 1.5, y - h * 0.75, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMarkers() {
    marker(world.start, '#4aa3ff', 'S');
    marker(world.target, '#ff6b5e', 'T');
  }

  function marker(p, color, label) {
    var x = (p.x + 0.5) * E.CELL;
    var y = (p.y + 0.5) * E.CELL;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0e1610';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#0e1610';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5);
  }

  function drawOverlays() {
    highlight.affected.forEach(function (id) {
      var x = id % E.W;
      var y = (id - x) / E.W;
      ctx.strokeStyle = 'rgba(255,212,121,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x * E.CELL + 0.5, y * E.CELL + 0.5, E.CELL - 1, E.CELL - 1);
    });
    highlight.blockers.forEach(function (b) {
      ctx.fillStyle = b.kind === 'water'
        ? 'rgba(90,170,255,0.55)' : 'rgba(255,90,80,0.6)';
      ctx.fillRect(b.x * E.CELL, b.y * E.CELL, E.CELL, E.CELL);
    });
  }

  // Lighten (amt > 0) / darken (amt < 0) a hex color.
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255;
    var g = (n >> 8) & 255;
    var b = n & 255;
    var f = function (v) {
      return Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  canvas.addEventListener('mousedown', function (ev) {
    var p = cellFromEvent(ev);
    if (!inBounds(p.x, p.y)) return;
    if (tool === 'road') startRoadDrag(p);
    else if (tool === 'tree') tryAddTree(p);
    else if (tool === 'remove') tryRemove(p);
  });

  canvas.addEventListener('mousemove', function (ev) {
    if (!drag) return;
    var p = cellFromEvent(ev);
    if (!inBounds(p.x, p.y)) return;
    var cur = drag.points[drag.index];
    if (cur.x === p.x && cur.y === p.y) return;
    drag.points[drag.index] = { x: p.x, y: p.y };
    var check = E.validateRoad(world, drag.points);
    highlight.blockers = check.blockers;
    draw();
  });

  window.addEventListener('mouseup', function () {
    if (!drag) return;
    var res = E.setRoad(world, drag.points);
    var points = drag.points;
    drag = null;
    if (res.ok) {
      highlight.affected = res.affected;
      highlight.blockers = [];
      setStatus('道路已更新：仅重算 ' + res.affected.length +
        ' 个受影响单元格，新布局哈希 ' + world.hash, 'ok');
    } else {
      highlight.blockers = res.blockers;
      setStatus(formatBlockers(res.blockers, points), 'error');
    }
    draw();
    renderSummary();
  });

  function startRoadDrag(p) {
    var best = -1;
    var bestD = 2.2;
    world.road.forEach(function (rp, i) {
      if (i === 0 || i === world.road.length - 1) return;
      var d = Math.hypot(rp.x - p.x, rp.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) {
      setStatus('请拖动道路中间的黄色节点（起点 S 与终点 T 固定）。');
      return;
    }
    drag = {
      index: best,
      points: world.road.map(function (rp) { return { x: rp.x, y: rp.y }; })
    };
    highlight.affected = [];
  }

  function tryAddTree(p) {
    var res = E.addTree(world, p.x, p.y);
    if (res.ok) {
      highlight.affected = res.affected;
      highlight.blockers = [];
      setStatus('已在 (' + p.x + ',' + p.y + ') 加树；未受影响区域坐标与哈希不变。当前哈希 ' +
        world.hash, 'ok');
    } else if (res.reason === 'road-blocked') {
      highlight.blockers = [res.blocker];
      setStatus('拒绝加树：树干中心距道路不足 ' + E.TRUNK_RADIUS +
        ' 格，阻断于路段 #' + res.blocker.segment + ' 单元格 (' +
        res.blocker.x + ',' + res.blocker.y + ')。', 'error');
    } else if (res.reason === 'route-disconnected') {
      var b = res.blockage;
      setStatus('拒绝加树：会切断通往目标的路线。阻断前沿 (' +
        b.front.x + ',' + b.front.y + ')，无法到达目标 (' +
        b.goal.x + ',' + b.goal.y + ')。', 'error');
    } else {
      setStatus('该单元格无法加树：' + reasonText(res.reason) + ' (' + p.x + ',' + p.y + ')。', 'error');
    }
    draw();
    renderSummary();
  }

  function tryRemove(p) {
    var res = E.removeObject(world, p.x, p.y);
    if (!res.ok) {
      setStatus('该单元格没有对象：(' + p.x + ',' + p.y + ')。', 'error');
      return;
    }
    highlight.affected = res.affected;
    highlight.blockers = [];
    setStatus('已删除 ' + res.removed.id + '；其余对象坐标不变。当前哈希 ' + world.hash, 'ok');
    draw();
    renderSummary();
  }

  function formatBlockers(blockers, points) {
    var lines = ['道路未生效，已保留原布局。阻断位置：'];
    blockers.slice(0, 5).forEach(function (b) {
      var seg = points[b.segment];
      if (b.kind === 'water') {
        lines.push('- 水面：单元格 (' + b.x + ',' + b.y + ')，路段 #' + b.segment +
          ' 起点 (' + seg.x + ',' + seg.y + ')');
      } else {
        lines.push('- 树干中心：单元格 (' + b.x + ',' + b.y + ')，间距 ' +
          b.distance.toFixed(2) + ' < ' + E.TRUNK_RADIUS + ' 格，路段 #' + b.segment);
      }
    });
    if (blockers.length > 5) lines.push('…另有 ' + (blockers.length - 5) + ' 处');
    return lines.join('\n');
  }

  function reasonText(reason) {
    return {
      water: '水面（禁止陆生植物）',
      occupied: '已有对象',
      'out-of-bounds': '超出场景边界'
    }[reason] || reason;
  }

  var sliderIds = [
    ['waterLevel', 'waterLevelVal'],
    ['treeDensity', 'treeDensityVal'],
    ['shrubDensity', 'shrubDensityVal'],
    ['grassDensity', 'grassDensityVal'],
    ['windDirDeg', 'windDirVal'],
    ['windStrength', 'windStrengthVal']
  ];

  function syncControls() {
    var p = world.params;
    document.getElementById('seedInput').value = p.seed;
    sliderIds.forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      var label = document.getElementById(pair[1]);
      var key = pair[0];
      var val = p[key];
      el.value = val;
      label.textContent = key === 'windDirDeg' ? val + '°' : Number(val).toFixed(2);
    });
    Array.prototype.forEach.call(
      document.querySelectorAll('#seasonRow button'),
      function (b) { b.classList.toggle('active', b.dataset.season === p.season); }
    );
  }

  function renderSummary() {
    var s = E.ruleSummary(world);
    summaryEl.innerHTML =
      '<h2 style="margin-top:0">运行摘要</h2>' +
      '<dl>' +
      '<dt>Seed</dt><dd class="hash">' + s.seed + '</dd>' +
      '<dt>目标数量</dt><dd>树 ' + s.counts.tree +
      ' · 灌木 ' + s.counts.shrub + ' · 草 ' + s.counts.grass +
      ' （共 ' + s.total + '）</dd>' +
      '<dt>布局哈希</dt><dd class="hash">' + world.hash + '</dd>' +
      '<dt>当前规则摘要</dt><dd><ul>' +
      s.rules.map(function (r) { return '<li>' + r + '</li>'; }).join('') +
      '<li>季节 ' + world.params.season + '：只改颜色，不改布局</li>' +
      '</ul></dd>' +
      '<dt>场景边界</dt><dd>' + E.W + ' × ' + E.H + ' 格（' +
      canvas.width + ' × ' + canvas.height + ' px）</dd>' +
      '</dl>';
  }

  function regenerate(extra) {
    var seed = parseInt(document.getElementById('seedInput').value, 10) || 0;
    var edits = readSliderEdits();
    if (extra) Object.assign(edits, extra);
    edits.seed = seed;
    try {
      world = E.createWorld(edits);
      highlight = { affected: [], blockers: [], region: null };
      syncControls();
      renderSummary();
      draw();
      setStatus('已用 seed ' + seed + ' 显式重新生成，布局哈希 ' + world.hash, 'ok');
    } catch (err) {
      setStatus('生成失败：' + err.message, 'error');
    }
  }

  function readSliderEdits() {
    var edits = {};
    sliderIds.forEach(function (pair) {
      var key = pair[0];
      var raw = parseFloat(document.getElementById(key).value);
      edits[key] = key === 'windDirDeg' ? Math.round(raw) : raw;
    });
    return edits;
  }

  document.getElementById('regenBtn').addEventListener('click', function () {
    regenerate();
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-seed]'), function (b) {
    b.addEventListener('click', function () {
      document.getElementById('seedInput').value = b.dataset.seed;
      regenerate();
    });
  });
  sliderIds.forEach(function (pair) {
    document.getElementById(pair[0]).addEventListener('input', function () {
      document.getElementById(pair[1]).textContent =
        pair[0] === 'windDirDeg' ? this.value + '°' : parseFloat(this.value).toFixed(2);
    });
  });
  document.getElementById('applyParams').addEventListener('click', function () {
    var edits = readSliderEdits();
    var seed = parseInt(document.getElementById('seedInput').value, 10) || 0;
    if (seed !== world.params.seed) { regenerate(); return; }
    var before = E.regionHash(world, 0, 0, 24, 24);
    var res = E.updateParams(world, edits);
    var after = E.regionHash(world, 0, 0, 24, 24);
    highlight.affected = [];
    renderSummary();
    draw();
    setStatus('参数已应用，重算范围：' + res.rebuilt +
      (res.changedCells ? '，变更对象 ' + res.changedCells.length + ' 个' : '') +
      '；参照区域(0,0)-(24,24)哈希 ' +
      (before === after ? '保持不变 (' + after + ')' : '已变化 (' + after + ')') +
      '。当前布局哈希 ' + world.hash,
      before === after ? 'ok' : '');
  });

  Array.prototype.forEach.call(document.querySelectorAll('#seasonRow button'), function (b) {
    b.addEventListener('click', function () {
      var hashBefore = world.hash;
      world.params.season = b.dataset.season;
      syncControls();
      renderSummary();
      draw();
      setStatus('季节切换为 ' + world.params.season + '，仅外观变化；布局哈希保持 ' +
        hashBefore + '。', 'ok');
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('#toolRow button'), function (b) {
    b.addEventListener('click', function () {
      tool = b.dataset.tool;
      Array.prototype.forEach.call(
        document.querySelectorAll('#toolRow button'),
        function (x) { x.classList.toggle('active', x === b); }
      );
    });
  });

  var STORAGE_KEY = 'veg-generator-save-v1';
  document.getElementById('saveBtn').addEventListener('click', function () {
    localStorage.setItem(STORAGE_KEY, E.serialize(world));
    setStatus('参数与道路已保存（含布局哈希 ' + world.hash + '）。', 'ok');
  });
  document.getElementById('loadBtn').addEventListener('click', function () {
    var text = localStorage.getItem(STORAGE_KEY);
    if (!text) { setStatus('没有已保存的参数。', 'error'); return; }
    try {
      world = E.deserialize(text);
      highlight = { affected: [], blockers: [], region: null };
      syncControls();
      renderSummary();
      draw();
      setStatus('载入成功：确定性重建后的布局哈希与存档一致（' + world.hash + '）。', 'ok');
    } catch (err) {
      setStatus('载入失败：' + err.message, 'error');
    }
  });

  document.getElementById('selftestBtn').addEventListener('click', function () {
    var lines = [];
    function t(name, fn) {
      try { fn(); lines.push('ok - ' + name); }
      catch (err) { lines.push('FAIL - ' + name + ': ' + err.message); }
    }
    [1337, 20261116].forEach(function (seed) {
      var w = E.createWorld({ seed: seed });
      var w2 = E.createWorld({ seed: seed });
      t('seed ' + seed + ' 双次生成哈希一致', function () {
        if (w.hash !== w2.hash) throw new Error('hash differs');
      });
      t('seed ' + seed + ' 目标可达', function () {
        if (!E.astar(w.cells, w.start, w.target)) throw new Error('unreachable');
      });
      t('seed ' + seed + ' 水面无陆生植物', function () {
        w.objects.forEach(function (o) {
          if (w.cells[o.cellY * E.W + o.cellX].water) {
            throw new Error(o.id + ' on water');
          }
        });
      });
      t('seed ' + seed + ' 道路不穿树干中心', function () {
        var v = E.validateRoad(w, w.road);
        if (!v.ok) throw new Error(JSON.stringify(v.blockers[0]));
      });
      t('seed ' + seed + ' 对象不重叠且在边界内', function () {
        var seen = {};
        w.objects.forEach(function (o) {
          if (o.cellX < 0 || o.cellX >= E.W || o.cellY < 0 || o.cellY >= E.H) {
            throw new Error('out of bounds: ' + o.id);
          }
          if (seen[o.id]) throw new Error('duplicate ' + o.id);
          seen[o.id] = true;
        });
      });
      t('seed ' + seed + ' 存档载入哈希一致', function () {
        var loaded = E.deserialize(E.serialize(w));
        if (loaded.hash !== w.hash) throw new Error('hash mismatch');
      });
      t('seed ' + seed + ' 季节切换不改哈希', function () {
        var h = w.hash;
        w.params.season = 'winter';
        if (E.layoutHash(w) !== h) throw new Error('hash changed');
      });
      t('seed ' + seed + ' 单对象编辑不影响远处区域哈希', function () {
        var region = { x0: 0, y0: 0, x1: 24, y1: 24 };
        var before = E.regionHash(w, region.x0, region.y0, region.x1, region.y1);
        var cell = w.cells.find(function (c) {
          return !c.water && !c.road && !c.obj && c.x >= E.W * 0.6 && c.y >= E.H * 0.6;
        });
        var r = E.addTree(w, cell.x, cell.y);
        if (!r.ok) throw new Error(JSON.stringify(r));
        if (E.regionHash(w, region.x0, region.y0, region.x1, region.y1) !== before) {
          throw new Error('far region hash changed');
        }
      });
    });
    var failed = lines.filter(function (l) { return l.indexOf('FAIL') === 0; }).length;
    lines.unshift(failed === 0
      ? '内置自检通过（16 项 / 2 个 seed）'
      : '自检失败 ' + failed + ' 项');
    setStatus(lines.join('\n'), failed === 0 ? 'ok' : 'error');
  });

  world = E.createWorld({ seed: 1337 });
  syncControls();
  renderSummary();
  draw();
  setStatus('就绪：拖动道路黄色节点可重算植被；切换工具可加树或删对象。布局哈希 ' +
    world.hash, 'ok');
})();
