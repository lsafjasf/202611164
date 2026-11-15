/* ============================================================
 * render.js — Canvas 渲染：山脊 / 云带 / 阴影 / 风迹 / 阻断标记
 * 布局数据全部来自 core.js（确定性），本文件只负责绘制与动画
 * ============================================================ */
(function (root) {
  'use strict';
  var VC = root.ValleyCloud;
  var W = VC.WORLD_W, H = VC.WORLD_H;
  var SUN = { x: 780, y: 70, dx: 26, dy: 34 };

  function drawSky(ctx) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e1d2e');
    g.addColorStop(0.45, '#27435f');
    g.addColorStop(1, '#6f8ba6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,236,190,0.9)';
    ctx.beginPath();
    ctx.arc(SUN.x, SUN.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,236,190,0.12)';
    ctx.beginPath();
    ctx.arc(SUN.x, SUN.y, 46, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRidge(ctx, ridge) {
    var layer = ridge.layer, profile = ridge.profile;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(profile[0].x, profile[0].y);
    for (var i = 1; i < profile.length; i++) ctx.lineTo(profile[i].x, profile[i].y);
    ctx.lineTo(W, H);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, layer.base - layer.amp, 0, H);
    grad.addColorStop(0, layer.color);
    grad.addColorStop(1, shade(layer.color, -28));
    ctx.fillStyle = grad;
    ctx.fill();
    // 雪线：高于阈值的峰顶段贴白
    var snowY = layer.base - layer.amp * layer.snow;
    ctx.strokeStyle = 'rgba(236,242,248,0.85)';
    ctx.lineWidth = 3;
    for (var si = 1; si < profile.length; si++) {
      var a = profile[si - 1], b = profile[si];
      if (a.y <= snowY || b.y <= snowY) {
        ctx.beginPath();
        ctx.moveTo(a.x, Math.max(a.y, snowY - 14));
        ctx.lineTo(b.x, Math.max(b.y, snowY - 14));
        ctx.stroke();
      }
    }
  }

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, Math.min(255, (n >> 16) + amt));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    var b = Math.max(0, Math.min(255, (n & 255) + amt));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawTerrain(ctx, layout) {
    drawSky(ctx);
    layout.terrain.ridges.forEach(function (ridge) { drawRidge(ctx, ridge); });
  }

  function drawClouds(ctx, layout) {
    if (!layout.route.ok) return;
    // 先画阴影：与云团同布局，随风向变化整体平移，保证轮廓与阴影同步
    ctx.save();
    ctx.filter = 'blur(6px)';
    ctx.fillStyle = 'rgba(10,18,28,0.35)';
    layout.puffs.forEach(function (p) {
      ctx.beginPath();
      ctx.ellipse(p.x + SUN.dx, p.y + SUN.dy, p.rx * 1.05, p.ry * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
    // 云团本体
    layout.puffs.forEach(function (p) {
      var grad = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.1,
        p.x, p.y, p.r);
      grad.addColorStop(0, 'rgba(255,255,255,' + (p.alpha + 0.25) + ')');
      grad.addColorStop(0.7, 'rgba(232,238,246,' + p.alpha + ')');
      grad.addColorStop(1, 'rgba(214,224,236,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawTargets(ctx, layout) {
    if (!layout.route.ok) return;
    ctx.strokeStyle = 'rgba(120,210,255,0.85)';
    ctx.fillStyle = 'rgba(120,210,255,0.95)';
    ctx.lineWidth = 2;
    layout.route.targets.forEach(function (t, i) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,210,255,0.95)';
      ctx.font = '11px monospace';
      var label = '#' + i;
      var tw = ctx.measureText(label).width;
      var lx = t.x + 8;
      if (lx + tw > W - 4) lx = t.x - 8 - tw;
      var ly = t.y - 7 < 12 ? t.y + 16 : t.y - 7;
      ctx.fillText(label, lx, ly);
    });
  }

  function drawWindTraces(ctx, layout, phase) {
    if (!layout.route.ok) return;
    var speed = layout.params.windSpeed;
    var dirVec = windVector(layout.params.windDir);
    var len = 18 + speed * 0.5;
    var count = 26;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    for (var i = 0; i < count; i++) {
      var seed = i * 97.13;
      var baseX = (seed * 3.7 + phase * speed * dirVec[0]) % W;
      var baseY = (seed * 7.3 + phase * speed * dirVec[1]) % H;
      if (baseX < 0) baseX += W;
      if (baseY < 0) baseY += H;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(baseX + dirVec[0] * len, baseY + dirVec[1] * len);
      ctx.stroke();
    }
  }

  function windVector(dir) {
    if (dir === 'E') return [1, 0];
    if (dir === 'W') return [-1, 0];
    if (dir === 'S') return [0, 1];
    return [0, -1];
  }

  function drawCustomObstacles(ctx, layout) {
    layout.customObstacles.forEach(function (o) {
      ctx.strokeStyle = 'rgba(255,150,120,0.95)';
      ctx.fillStyle = 'rgba(255,120,90,0.25)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function drawBlockage(ctx, layout) {
    if (layout.route.ok) return;
    var b = layout.blockage;
    if (!b) return;
    ctx.strokeStyle = 'rgba(255,80,80,0.95)';
    ctx.fillStyle = 'rgba(255,80,80,0.18)';
    ctx.lineWidth = 2;
    (b.blockers || []).forEach(function (o) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    });
    if (b.anchor) {
      var ax = b.anchor.x, ay = b.anchor.y;
      ctx.strokeStyle = '#ff5a5a';
      ctx.beginPath();
      ctx.moveTo(ax - 12, ay - 12); ctx.lineTo(ax + 12, ay + 12);
      ctx.moveTo(ax + 12, ay - 12); ctx.lineTo(ax - 12, ay + 12);
      ctx.stroke();
    }
  }

  function drawRegionGrid(ctx, layout, changed) {
    var rw = W / VC.REGION_COLS, rh = H / VC.REGION_ROWS;
    ctx.font = '10px monospace';
    for (var i = 0; i < VC.REGION_COLS * VC.REGION_ROWS; i++) {
      var rx = (i % VC.REGION_COLS) * rw;
      var ry = Math.floor(i / VC.REGION_COLS) * rh;
      var isChanged = changed && (changed.terrain.indexOf(i) !== -1 || changed.clouds.indexOf(i) !== -1);
      ctx.strokeStyle = isChanged ? 'rgba(255,210,90,0.9)' : 'rgba(255,255,255,0.18)';
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = isChanged ? 'rgba(255,210,90,0.95)' : 'rgba(255,255,255,0.4)';
      ctx.fillText(String(i), rx + 4, ry + 12);
    }
  }

  function renderFrame(ctx, layout, opts) {
    opts = opts || {};
    ctx.clearRect(0, 0, W, H);
    drawTerrain(ctx, layout);
    drawCustomObstacles(ctx, layout);
    drawClouds(ctx, layout);
    if (opts.showTargets) drawTargets(ctx, layout);
    drawBlockage(ctx, layout);
    if (opts.showRegions) drawRegionGrid(ctx, layout, opts.changed);
    if (opts.animate !== false) drawWindTraces(ctx, layout, opts.phase || 0);
  }

  root.ValleyRender = {
    renderFrame: renderFrame,
    windVector: windVector,
    W: W, H: H
  };
})(typeof self !== 'undefined' ? self : this);
