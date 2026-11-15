/* ============================================================
 * app.js — 交互、局部重算、存档与导出
 * ============================================================ */
(function () {
  'use strict';
  var VC = window.ValleyCloud, VR = window.ValleyRender;
  var W = VC.WORLD_W, H = VC.WORLD_H;
  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var state = {
    seed: 20261116,
    params: VC.defaultParams(),
    customObstacles: [],
    showTargets: true,
    showRegions: false,
    baseline: null,
    changed: null,
    phase: 0
  };
  var layout = null;

  var el = function (id) { return document.getElementById(id); };

  function recompute(scope) {
    var before = layout;
    layout = VC.generateLayout(state.seed, state.params, state.customObstacles);
    if (before && scope !== 'full') {
      state.changed = VC.diffRegions(before, layout);
    } else if (scope === 'full') {
      state.baseline = layout;
      state.changed = null;
    }
    updatePanels(scope);
  }

  // 风速仅影响风迹动画：不重新生成布局，也不改动任何区域哈希
  function updateWindSpeedOnly() {
    el('scopeOut').textContent = scopeLabel('windSpeed');
    el('regionDiff').textContent = '布局未重算，40 个区域哈希全部保持';
  }

  function updatePanels(scope) {
    el('seedOut').textContent = state.seed;
    el('targetOut').textContent = layout.route.ok ? layout.targetCount : 0;
    el('puffOut').textContent = layout.puffCount;
    el('terrainHash').textContent = layout.terrainHash;
    el('layoutHash').textContent = layout.layoutHash;
    el('scopeOut').textContent = scopeLabel(scope);
    el('rules').innerHTML = VC.ruleSummary(state.params)
      .map(function (r) { return '<li>' + r + '</li>'; }).join('');
    var regionText = state.changed
      ? '地形区域 ' + fmtRegions(state.changed.terrain) + ' / 云区域 ' + fmtRegions(state.changed.clouds)
      : '基线布局（全部 40 个区域已记录）';
    el('regionDiff').textContent = regionText;
    var banner = el('blockBanner');
    if (layout.route.ok) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      banner.textContent = '⛔ ' + (layout.blockage && layout.blockage.message || '路线阻断');
    }
    updateRegionTable();
  }

  function scopeLabel(scope) {
    return {
      humidity: '湿度 → 仅重算云带走廊与云团（地形哈希不变）',
      altitude: '高度 → 重算路径与云团（地形哈希不变）',
      windDir: '风向 → 重算路径、云团轮廓与阴影（地形哈希不变）',
      windSpeed: '风速 → 仅风迹动画，布局完全不重算',
      edit: '对象编辑 → 只重算受影响区域',
      full: '显式重新生成 → 全量重算并重置基线',
      load: '存档载入 → 按存档参数重算并核对哈希'
    }[scope] || scope;
  }

  function fmtRegions(arr) {
    return arr.length ? '[' + arr.join(',') + ']' : '无变化';
  }

  function updateRegionTable() {
    var base = state.baseline;
    var rows = layout.regions.map(function (r, i) {
      var tSame = !base || base.regions[i].terrainHash === r.terrainHash;
      var cSame = !base || base.regions[i].cloudHash === r.cloudHash;
      return '<tr class="' + (tSame && cSame ? '' : 'dirty') + '">' +
        '<td>' + i + '</td><td>' + r.terrainHash.slice(0, 8) + '</td>' +
        '<td>' + r.cloudHash.slice(0, 8) + '</td>' +
        '<td>' + (tSame && cSame ? '稳定' : '已重算') + '</td></tr>';
    }).join('');
    el('regionBody').innerHTML = rows;
  }

  // ---------------- 控件绑定 ----------------
  function bindSlider(id, key, scope) {
    var input = el(id), out = el(id + 'Val');
    input.addEventListener('input', function () {
      state.params[key] = Number(input.value);
      out.textContent = input.value + (key === 'humidity' || key === 'altitude' ? '%' : '');
      recompute(scope);
    });
  }
  bindSlider('humidity', 'humidity', 'humidity');
  el('windSpeed').addEventListener('input', function () {
    state.params.windSpeed = Number(el('windSpeed').value);
    el('windSpeedVal').textContent = el('windSpeed').value;
    updateWindSpeedOnly();
  });
  bindSlider('altitude', 'altitude', 'altitude');

  el('windDir').addEventListener('change', function (e) {
    state.params.windDir = e.target.value;
    recompute('windDir');
  });

  el('regen').addEventListener('click', function () {
    recompute('full'); // 显式重新生成：同 seed 必须得到相同哈希
  });
  el('newSeed').addEventListener('click', function () {
    state.seed = (Math.floor(Math.random() * 0xffffffff) >>> 0);
    el('seedInput').value = state.seed;
    state.customObstacles = [];
    recompute('full');
  });
  el('applySeed').addEventListener('click', function () {
    var v = Number(el('seedInput').value) >>> 0;
    state.seed = v;
    state.customObstacles = [];
    recompute('full');
  });

  el('toggleTargets').addEventListener('change', function (e) {
    state.showTargets = e.target.checked;
  });
  el('toggleRegions').addEventListener('change', function (e) {
    state.showRegions = e.target.checked;
  });

  // 画布点击：添加 / Shift 点击删除自定义障碍
  canvas.addEventListener('click', function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (W / rect.width);
    var y = (e.clientY - rect.top) * (H / rect.height);
    if (e.shiftKey) {
      state.customObstacles = state.customObstacles.filter(function (o) {
        return Math.hypot(o.x - x, o.y - y) > o.r + 6;
      });
    } else {
      state.customObstacles.push({
        id: 'custom-' + Date.now(), kind: 'custom',
        x: Math.round(x), y: Math.round(y), r: 24
      });
    }
    recompute('edit');
  });

  // ---------------- 保存 / 载入 ----------------
  var STORE_KEY = 'valley-cloud-snapshot-v' + VC.LAYOUT_VERSION;

  el('save').addEventListener('click', function () {
    var snapshot = VC.buildSnapshot(layout);
    localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
    el('ioStatus').textContent = '已保存到本地，layoutHash=' + snapshot.layoutHash.slice(0, 10);
  });

  el('load').addEventListener('click', function () {
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      el('ioStatus').textContent = '没有找到存档';
      return;
    }
    applySnapshot(JSON.parse(raw));
  });

  el('exportFile').addEventListener('click', function () {
    var snapshot = VC.buildSnapshot(layout);
    download('valley-cloud-seed' + state.seed + '.json', JSON.stringify(snapshot, null, 2));
  });

  el('importFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        applySnapshot(JSON.parse(reader.result));
      } catch (err) {
        el('ioStatus').textContent = '存档解析失败：' + err.message;
      }
    };
    reader.readAsText(file);
  });

  function applySnapshot(snapshot) {
    state.seed = snapshot.seed >>> 0;
    state.params = Object.assign(VC.defaultParams(), snapshot.params);
    state.customObstacles = snapshot.customObstacles || [];
    syncControls();
    recompute('load');
    var match = layout.layoutHash === snapshot.layoutHash &&
      layout.terrainHash === snapshot.terrainHash;
    el('ioStatus').textContent = match
      ? '载入成功，布局哈希与存档一致 ✓'
      : '哈希不一致（数据版本可能已变化）';
    el('ioStatus').className = match ? 'ok' : 'warn';
  }

  function syncControls() {
    el('seedInput').value = state.seed;
    el('humidity').value = state.params.humidity;
    el('humidityVal').textContent = state.params.humidity + '%';
    el('windSpeed').value = state.params.windSpeed;
    el('windSpeedVal').textContent = state.params.windSpeed;
    el('altitude').value = state.params.altitude;
    el('altitudeVal').textContent = state.params.altitude + '%';
    el('windDir').value = state.params.windDir;
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------------- PNG 导出（冻结当前画面，不含风迹动画相位文字） ----------------
  el('exportPng').addEventListener('click', function () {
    var exportCanvas = document.createElement('canvas');
    exportCanvas.width = W;
    exportCanvas.height = H;
    var ectx = exportCanvas.getContext('2d');
    VR.renderFrame(ectx, layout, {
      showTargets: state.showTargets,
      showRegions: state.showRegions,
      changed: state.changed,
      animate: false
    });
    ectx.fillStyle = 'rgba(255,255,255,0.85)';
    ectx.font = '13px monospace';
    ectx.fillText('seed=' + state.seed + '  layoutHash=' + layout.layoutHash, 14, H - 14);
    exportCanvas.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'valley-cloud-seed' + state.seed + '-' + layout.layoutHash.slice(0, 8) + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });

  el('runChecks').addEventListener('click', function () {
    var report = VC.runChecks();
    el('checkBody').innerHTML = report.results.map(function (r) {
      return '<tr class="' + (r.ok ? 'pass' : 'fail') + '"><td>' +
        (r.ok ? '✓' : '✗') + '</td><td>' + r.name + '</td><td>' + r.detail + '</td></tr>';
    }).join('');
    el('checkSummary').textContent = report.ok ? '全部通过' : '存在失败项';
    el('checkSummary').className = report.ok ? 'ok' : 'warn';
  });

  // ---------------- 动画循环 ----------------
  function frame() {
    state.phase += 0.016;
    VR.renderFrame(ctx, layout, {
      showTargets: state.showTargets,
      showRegions: state.showRegions,
      changed: state.changed,
      phase: state.phase
    });
    requestAnimationFrame(frame);
  }

  // ---------------- 初始化 ----------------
  el('seedInput').value = state.seed;
  recompute('full');
  frame();
})();
