/*
 * Canvas 场景：海面、灯塔（含闪光光束）、浮标地图、带船舱的小船、雾带。
 * 礁石在调查阶段不绘制，仅在提交后返航/结算阶段揭示，避免提前泄密。
 */
(function (root) {
  'use strict';

  var W = 960, H = 560;

  function buoyPositions() {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var row = i < 5 ? 0 : 1;
      var col = i % 5;
      pts.push({ x: 230 + col * 118, y: 292 + row * 96 });
    }
    return pts;
  }

  function Scene(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buoys = buoyPositions();
    this.fogOffset = 0;
  }

  Scene.prototype.size = function () { return { w: W, h: H }; };

  Scene.prototype._sea = function (t) {
    var ctx = this.ctx;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1d33');
    g.addColorStop(0.55, '#10324d');
    g.addColorStop(1, '#0a2438');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(140,200,235,0.10)';
    ctx.lineWidth = 1.5;
    for (var y = 180; y < H; y += 34) {
      ctx.beginPath();
      for (var x = 0; x <= W; x += 24) {
        var yy = y + Math.sin((x + t * 0.03) / 42) * 4;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  };

  Scene.prototype._lighthouse = function (flashOn) {
    var ctx = this.ctx;
    var lx = 852, baseY = 268;
    ctx.fillStyle = '#26313d';
    ctx.beginPath();
    ctx.moveTo(lx - 70, baseY + 70);
    ctx.quadraticCurveTo(lx, baseY + 30, lx + 70, baseY + 70);
    ctx.lineTo(lx + 70, H);
    ctx.lineTo(lx - 70, H);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#e8e4d8';
    ctx.beginPath();
    ctx.moveTo(lx - 20, baseY);
    ctx.lineTo(lx + 20, baseY);
    ctx.lineTo(lx + 13, baseY - 108);
    ctx.lineTo(lx - 13, baseY - 108);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c0392b';
    [baseY - 30, baseY - 74].forEach(function (y) {
      ctx.fillRect(lx - 16, y, 32, 14);
    });
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(lx - 17, baseY - 122, 34, 14);

    // 灯室
    ctx.fillStyle = '#f5d76e';
    ctx.fillRect(lx - 10, baseY - 140, 20, 18);
    if (flashOn) {
      var glow = ctx.createRadialGradient(lx, baseY - 131, 2, lx, baseY - 131, 46);
      glow.addColorStop(0, 'rgba(255,235,150,0.95)');
      glow.addColorStop(1, 'rgba(255,235,150,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(lx, baseY - 131, 46, 0, Math.PI * 2);
      ctx.fill();
      this._beam(lx, baseY - 131);
    }
  };

  Scene.prototype._beam = function (lx, ly) {
    var ctx = this.ctx;
    var g = ctx.createLinearGradient(lx, ly, 120, ly + 60);
    g.addColorStop(0, 'rgba(255,236,160,0.42)');
    g.addColorStop(1, 'rgba(255,236,160,0.02)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(lx - 6, ly - 6);
    ctx.lineTo(110, ly - 70);
    ctx.lineTo(110, ly + 130);
    ctx.lineTo(lx - 6, ly + 6);
    ctx.closePath();
    ctx.fill();
  };

  Scene.prototype._buoys = function (targets, reachIndex) {
    var self = this;
    this.buoys.forEach(function (p, i) {
      var ctx = self.ctx;
      // 调查阶段所有浮标外观一致，路线信息只能从闪光电码推断。
      ctx.fillStyle = '#7f8c8d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.stroke();
      ctx.fillStyle = '#f4f7fa';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(i), p.x, p.y + 4);
      if (reachIndex >= 0 && targets.indexOf(i) !== -1 && targets.indexOf(i) <= reachIndex) {
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    });
  };

  function reefPositions(route) {
    // 礁石位于“非路线”浮标附近；坐标由 seed 决定，调查阶段不显示。
    var reefs = [];
    for (var i = 0; i < 10; i++) {
      if (route.indexOf(i) === -1) {
        var h = LHCase.hashSeed('reef:' + i + ':' + route.join('-'));
        var b = buoyPositions()[i];
        reefs.push({
          x: b.x + 34 + hashRand(h) * 18,
          y: b.y - 26 + hashRand(LHCase.hashSeed('reef2:' + h)) * 16
        });
      }
    }
    return reefs;
  }
  // mulberry32 未导出，场景仅需要稳定扰动，改用 hashSeed 派生整数。
  function hashRand(h) { return ((h ^ (h >>> 13)) >>> 0) / 4294967296; }

  Scene.prototype._reefs = function (route) {
    var ctx = this.ctx;
    var self = this;
    reefPositions(route).forEach(function (p) {
      var h2 = LHCase.hashSeed('rock:' + p.x);
      p.rx = hashRand(h2) * 10;
      ctx.fillStyle = '#4a5a68';
      ctx.beginPath();
      ctx.moveTo(p.x - 14, p.y + 6);
      ctx.lineTo(p.x - 4, p.y - 12 - p.rx * 0.4);
      ctx.lineTo(p.x + 6, p.y - 6);
      ctx.lineTo(p.x + 14, p.y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(231,76,60,0.85)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(p.x - 18, p.y - 20, 36, 32);
      ctx.setLineDash([]);
      ctx.fillStyle = '#e74c3c';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('礁', p.x, p.y - 24);
    });
  };

  Scene.prototype._boat = function (x, y, heading, hullTint) {
    var ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    // 船体
    ctx.fillStyle = hullTint || '#8e5a3b';
    ctx.beginPath();
    ctx.moveTo(-26, -10);
    ctx.lineTo(20, -10);
    ctx.quadraticCurveTo(30, 0, 20, 10);
    ctx.lineTo(-26, 10);
    ctx.quadraticCurveTo(-32, 0, -26, -10);
    ctx.closePath();
    ctx.fill();
    // 船舱
    ctx.fillStyle = '#f1f4f7';
    ctx.fillRect(-12, -8, 16, 16);
    ctx.fillStyle = '#34495e';
    ctx.fillRect(-8, -5, 8, 5);
    ctx.fillRect(-8, 1, 8, 4);
    // 桅杆与小旗
    ctx.strokeStyle = '#d7dde3';
    ctx.beginPath();
    ctx.moveTo(-4, -8);
    ctx.lineTo(-4, -24);
    ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(-4, -24);
    ctx.lineTo(8, -19);
    ctx.lineTo(-4, -15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  Scene.prototype._fog = function (t) {
    var ctx = this.ctx;
    this.fogOffset = (this.fogOffset + 0.12) % 1000;
    ctx.fillStyle = 'rgba(200,214,226,0.06)';
    for (var i = -1; i < 3; i++) {
      var fx = ((i * 420 - this.fogOffset) % (W + 420));
      ctx.beginPath();
      ctx.ellipse(fx, 150 + Math.sin(t * 0.001 + i) * 18, 260, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // state: phase, boat{x,y,heading}, flashOn, targets, route(揭示礁用),
  // showReefs, reachedCount, crashed
  Scene.prototype.render = function (state) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this._sea(state.t);
    this._fog(state.t);
    this._buoys(state.targets || [], state.reachedCount == null ? -1 : state.reachedCount);
    if (state.showReefs) this._reefs(state.route || []);
    this._lighthouse(!!state.flashOn);
    this._boat(state.boat.x, state.boat.y, state.boat.heading || 0,
      state.crashed ? '#7d2f2f' : null);
    if (state.hornOn) {
      ctx.strokeStyle = 'rgba(120,200,255,0.5)';
      ctx.lineWidth = 2;
      for (var k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.arc(852, 137, 26 + k * 14 + (state.t % 10), -0.7, 0.7);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
  };

  root.LHScene = Scene;
  root.LHSceneSize = { w: W, h: H };
  root.LHSceneSize = { w: W, h: H };
})(window);
