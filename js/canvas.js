(function (root) {
  "use strict";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function sourceCode(clue) {
    if (clue.source === "main_end") return "主巷";
    const match = String(clue.source).match(/(\d+)$/);
    return match ? "J" + match[1] + "支巷" : clue.sourceLabel;
  }

  function EchoCanvas(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.oxygen = 100;
    this.targetOxygen = 100;
    this.logs = [];
    this.seed = "—";
    this.frame = 0;
    this.lastTime = 0;
    this.resizeObserver = null;
    this._bind();
    this.resize();
  }

  EchoCanvas.prototype._bind = function _bind() {
    this._onResize = () => this.resize();
    if (root.ResizeObserver) {
      this.resizeObserver = new root.ResizeObserver(this._onResize);
      this.resizeObserver.observe(this.canvas);
    } else {
      root.addEventListener("resize", this._onResize);
    }
  };

  EchoCanvas.prototype.resize = function resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(280, rect.width || 560);
    const height = Math.max(420, rect.height || 760);
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };

  EchoCanvas.prototype.setState = function setState(next) {
    this.oxygen = next.oxygen == null ? this.oxygen : next.oxygen;
    this.targetOxygen = this.oxygen;
    this.logs = next.logs || [];
    this.seed = next.seed || "—";
    this.draw();
    this.startAnimation();
  };

  EchoCanvas.prototype.startAnimation = function startAnimation() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.lastTime = performance.now();
    const tick = (time) => {
      const delta = Math.min(50, time - this.lastTime);
      this.lastTime = time;
      const diff = this.targetOxygen - this.oxygen;
      if (Math.abs(diff) > 0.05) {
        this.oxygen += diff * Math.min(0.34, delta / 190);
        this.draw();
        this.frame = requestAnimationFrame(tick);
      } else {
        this.oxygen = this.targetOxygen;
        this.draw();
        this.frame = 0;
      }
    };
    this.frame = requestAnimationFrame(tick);
  };

  EchoCanvas.prototype.draw = function draw() {
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    ctx.clearRect(0, 0, width, height);
    this._drawSurface(ctx, width, height);
    const gasHeight = Math.min(332, height * 0.43);
    this._drawCylinder(ctx, width, gasHeight);
    this._drawRecord(ctx, width, height, gasHeight + 12);
  };

  EchoCanvas.prototype._drawSurface = function _drawSurface(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(17, 24, 20, 0.97)");
    gradient.addColorStop(0.55, "rgba(11, 16, 13, 0.99)");
    gradient.addColorStop(1, "rgba(7, 10, 8, 1)");
    ctx.fillStyle = gradient;
    roundedRect(ctx, 0, 0, width, height, 18);
    ctx.fill();

    const glow = ctx.createRadialGradient(width * 0.42, 20, 0, width * 0.42, 20, gasHeightSafe(height));
    glow.addColorStop(0, "rgba(238, 172, 79, 0.12)");
    glow.addColorStop(0.45, "rgba(238, 172, 79, 0.025)");
    glow.addColorStop(1, "rgba(238, 172, 79, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height * 0.48);

    ctx.strokeStyle = "rgba(198, 173, 123, 0.14)";
    ctx.lineWidth = 1;
    roundedRect(ctx, 0.5, 0.5, width - 1, height - 1, 17.5);
    ctx.stroke();
  };

  function gasHeightSafe(height) {
    return Math.max(180, height * 0.44);
  }

  EchoCanvas.prototype._drawCylinder = function _drawCylinder(ctx, width, sectionHeight) {
    const oxygen = clamp(this.oxygen, 0, 100);
    const tankX = width * 0.285;
    const tankW = clamp(width * 0.2, 76, 116);
    const top = Math.max(70, sectionHeight * 0.27);
    const bottom = sectionHeight - 22;
    const bodyH = bottom - top;
    const low = oxygen <= 34;

    ctx.save();
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(221, 211, 181, 0.58)";
    ctx.font = "600 9px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.letterSpacing = "1.5px";
    ctx.fillText("OXYGEN / CYLINDER 07", 24, 24);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(221, 211, 181, 0.32)";
    ctx.fillText("LIVE PRESSURE", width - 24, 24);
    ctx.textAlign = "left";

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 12;
    roundedRect(ctx, tankX + 2, top + 2, tankW - 4, bodyH - 3, 23);
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fill();
    ctx.restore();

    const bodyGradient = ctx.createLinearGradient(tankX, 0, tankX + tankW, 0);
    bodyGradient.addColorStop(0, "#263127");
    bodyGradient.addColorStop(0.18, "#69705b");
    bodyGradient.addColorStop(0.34, "#3d493d");
    bodyGradient.addColorStop(0.72, "#283129");
    bodyGradient.addColorStop(0.9, "#111713");
    bodyGradient.addColorStop(1, "#303b30");
    roundedRect(ctx, tankX, top, tankW, bodyH, 22);
    ctx.fillStyle = bodyGradient;
    ctx.fill();

    ctx.save();
    roundedRect(ctx, tankX, top, tankW, bodyH, 22);
    ctx.clip();
    const shoulder = ctx.createLinearGradient(tankX, top, tankX, top + bodyH * 0.28);
    shoulder.addColorStop(0, "rgba(202, 202, 169, 0.14)");
    shoulder.addColorStop(1, "rgba(0, 0, 0, 0.26)");
    ctx.fillStyle = shoulder;
    ctx.fillRect(tankX, top, tankW, bodyH * 0.29);

    ctx.strokeStyle = "rgba(233, 217, 171, 0.075)";
    ctx.lineWidth = 1;
    for (let y = top + 30; y < bottom; y += 7) {
      ctx.beginPath();
      ctx.moveTo(tankX + 5, y);
      ctx.lineTo(tankX + tankW - 5, y + 2);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(116, 69, 38, 0.42)";
    ctx.beginPath();
    ctx.ellipse(tankX + tankW * 0.73, top + bodyH * 0.24, 13, 21, -0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(155, 83, 43, 0.23)";
    ctx.beginPath();
    ctx.ellipse(tankX + tankW * 0.76, top + bodyH * 0.78, 9, 17, 0.42, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(tankX + tankW / 2, top + bodyH * 0.44);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(235, 228, 203, 0.74)";
    ctx.font = "700 42px Bahnschrift, 'Arial Narrow', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("O₂", 0, 0);
    ctx.restore();

    ctx.fillStyle = "rgba(225, 215, 187, 0.66)";
    ctx.font = "600 8px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("BREATHING AIR", tankX + tankW / 2, top + bodyH * 0.68);
    ctx.fillText("MINE RESCUE / 30 MPa", tankX + tankW / 2, top + bodyH * 0.72);

    ctx.save();
    ctx.beginPath();
    ctx.rect(tankX, bottom - 34, tankW, 34);
    ctx.clip();
    ctx.fillStyle = low ? "rgba(151, 54, 32, 0.9)" : "rgba(192, 140, 54, 0.78)";
    for (let x = tankX - 32; x < tankX + tankW + 32; x += 19) {
      ctx.save();
      ctx.translate(x, bottom - 14);
      ctx.rotate(-0.55);
      ctx.fillRect(0, -22, 9, 48);
      ctx.restore();
    }
    ctx.fillStyle = low ? "#f2c0a2" : "#14140f";
    ctx.font = "700 8px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(low ? "LOW O₂" : "RESCUE UNIT", tankX + tankW / 2, bottom - 15);
    ctx.restore();

    const valveX = tankX + tankW / 2;
    const valveY = top;
    ctx.fillStyle = "#716032";
    roundedRect(ctx, valveX - 18, valveY - 41, 36, 34, 6);
    ctx.fill();
    ctx.fillStyle = "#a68c49";
    roundedRect(ctx, valveX - 27, valveY - 50, 54, 14, 5);
    ctx.fill();
    ctx.fillStyle = "#3d392a";
    roundedRect(ctx, valveX - 11, valveY - 63, 22, 17, 4);
    ctx.fill();
    ctx.fillStyle = "#ba9d56";
    ctx.beginPath();
    ctx.arc(valveX, valveY - 66, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#181710";
    ctx.beginPath();
    ctx.arc(valveX, valveY - 66, 6, 0, Math.PI * 2);
    ctx.fill();

    this._drawGauge(ctx, width, tankX + tankW, top + 20, oxygen, low);

    ctx.strokeStyle = "rgba(211, 196, 157, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tankX + 7, top + 15);
    ctx.lineTo(tankX + 7, bottom - 7);
    ctx.stroke();

    ctx.fillStyle = low ? "rgba(215, 99, 64, 0.92)" : "rgba(229, 188, 108, 0.9)";
    ctx.font = "700 11px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText("O₂", tankX, bottom + 13);
    ctx.fillStyle = "rgba(231, 220, 191, 0.72)";
    ctx.font = "500 9px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("剩余 " + Math.round(oxygen) + "%", tankX + 25, bottom + 13);
    ctx.restore();
  };

  EchoCanvas.prototype._drawGauge = function _drawGauge(ctx, width, tankRight, top, oxygen, low) {
    const radius = width < 430 ? 39 : 46;
    const centerX = Math.min(width - radius - 42, tankRight + radius + 30);
    const centerY = top + radius + 6;
    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;

    ctx.save();
    ctx.strokeStyle = "rgba(159, 141, 94, 0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tankRight - 14, centerY);
    ctx.lineTo(centerX - radius + 6, centerY);
    ctx.stroke();

    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#6f6040";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#27271f";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 3, 0, Math.PI * 2);
    ctx.fill();

    const face = ctx.createRadialGradient(centerX - 9, centerY - 11, 2, centerX, centerY, radius);
    face.addColorStop(0, "#e5dfc8");
    face.addColorStop(0.62, "#cbc3aa");
    face.addColorStop(1, "#8c866f");
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(72, 66, 49, 0.6)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 20; i += 1) {
      const angle = start + (end - start) * (i / 20);
      const inner = radius - (i % 5 === 0 ? 10 : 5);
      ctx.beginPath();
      ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
      ctx.lineTo(centerX + Math.cos(angle) * (radius - 2), centerY + Math.sin(angle) * (radius - 2));
      ctx.stroke();
    }

    ctx.fillStyle = "#37362c";
    ctx.font = "700 7px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labels = [[0, "0"], [10, "50"], [20, "100"]];
    labels.forEach(function (label) {
      const angle = start + (end - start) * (label[0] / 20);
      ctx.fillText(label[1], centerX + Math.cos(angle) * (radius - 17), centerY + Math.sin(angle) * (radius - 17));
    });

    ctx.fillStyle = "rgba(59, 54, 41, 0.74)";
    ctx.font = "600 7px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("O₂ %", centerX, centerY + 20);
    ctx.fillStyle = low ? "#883724" : "#3e4d35";
    ctx.font = "700 12px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(Math.round(oxygen), centerX, centerY + 32);

    const needleAngle = start + (end - start) * clamp(oxygen / 100, 0, 1);
    ctx.strokeStyle = low ? "#8d2f1e" : "#5b2f1c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - Math.cos(needleAngle) * 8, centerY - Math.sin(needleAngle) * 8);
    ctx.lineTo(centerX + Math.cos(needleAngle) * (radius - 13), centerY + Math.sin(needleAngle) * (radius - 13));
    ctx.stroke();
    ctx.fillStyle = "#292820";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(96, 82, 50, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 8, Math.PI * 1.1, Math.PI * 1.76);
    ctx.stroke();
    ctx.restore();
  };

  EchoCanvas.prototype._drawRecord = function _drawRecord(ctx, width, height, y) {
    const marginX = clamp(width * 0.035, 12, 22);
    const paperW = width - marginX * 2;
    const paperH = height - y - 18;
    const logs = this.logs.slice(-10);
    const compact = paperW < 390;
    const rowH = clamp((paperH - 94) / Math.max(7, logs.length), compact ? 18 : 20, compact ? 23 : 25);
    const columns = compact
      ? [
          { title: "序", x: 12, align: "left" },
          { title: "声源", x: 31, align: "left" },
          { title: "时差", x: paperW * 0.42, align: "right" },
          { title: "方位", x: paperW * 0.55, align: "center" },
          { title: "频带", x: paperW * 0.73, align: "right" },
          { title: "强度", x: paperW - 12, align: "right" }
        ]
      : [
          { title: "序", x: 18, align: "left" },
          { title: "声源", x: 54, align: "left" },
          { title: "时差", x: 153, align: "right" },
          { title: "方位", x: 224, align: "center" },
          { title: "频带", x: 271, align: "right" },
          { title: "强度", x: paperW - 52, align: "right" }
        ];

    ctx.save();
    ctx.translate(marginX + paperW / 2, y + paperH / 2);
    ctx.rotate(-0.006);
    ctx.translate(-paperW / 2, -paperH / 2);
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#ddd6bc";
    roundedRect(ctx, 0, 0, paperW, paperH, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowColor = "transparent";

    const paper = ctx.createLinearGradient(0, 0, paperW, paperH);
    paper.addColorStop(0, "#eee8d1");
    paper.addColorStop(0.55, "#dfd8bd");
    paper.addColorStop(1, "#cbc3a8");
    ctx.fillStyle = paper;
    roundedRect(ctx, 0, 0, paperW, paperH, 3);
    ctx.fill();

    ctx.strokeStyle = "rgba(137, 80, 52, 0.2)";
    ctx.lineWidth = 1;
    for (let lineY = 58; lineY < paperH - 24; lineY += 21) {
      ctx.beginPath();
      ctx.moveTo(14, lineY);
      ctx.lineTo(paperW - 13, lineY);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(84, 65, 47, 0.13)";
    ctx.beginPath();
    ctx.ellipse(paperW * 0.78, 21, 34, 15, -0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(113, 76, 44, 0.1)";
    ctx.beginPath();
    ctx.ellipse(paperW * 0.18, paperH * 0.87, 42, 18, 0.22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(35, 38, 31, 0.84)";
    ctx.beginPath();
    ctx.rect(0, 0, paperW, 35);
    ctx.fill();
    ctx.fillStyle = "#e6debf";
    ctx.font = "700 10px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("回声记录 / ECHO LOG", 15, 18);
    ctx.font = "500 7px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(230, 222, 191, 0.54)";
    ctx.textAlign = "right";
    ctx.fillText("SEED " + this.seed, paperW - 14, 18);

    ctx.fillStyle = "rgba(55, 50, 38, 0.82)";
    ctx.font = "700 " + (compact ? 6.4 : 7) + "px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "middle";
    columns.forEach(function (column) {
      ctx.textAlign = column.align;
      ctx.fillText(column.title, column.x, 48);
    });
    ctx.strokeStyle = "rgba(69, 58, 42, 0.55)";
    ctx.beginPath();
    ctx.moveTo(14, 58.5);
    ctx.lineTo(paperW - 14, 58.5);
    ctx.stroke();

    if (!logs.length) {
      ctx.fillStyle = "rgba(62, 57, 45, 0.4)";
      ctx.font = "500 9px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("等待第一次敲击。", paperW / 2, 112);
      ctx.font = "500 7px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText("NO TRANSDUCER DATA", paperW / 2, 130);
    } else {
      logs.forEach((clue, index) => {
        const rowY = 69 + index * rowH;
        const ink = clue.strengthLabel === "被掩蔽" ? 0.5 : 0.82;
        ctx.fillStyle = "rgba(48, 44, 34, " + ink + ")";
        ctx.font = "500 " + (compact ? 6.8 : 7.5) + "px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";
        const values = [
          "P" + String(clue.probeIndex).padStart(2, "0"),
          sourceCode(clue),
          clue.delayMs.toFixed(1) + "ms",
          clue.bearing,
          Math.round(clue.bandHz) + "Hz",
          clue.strengthLabel
        ];
        columns.forEach(function (column, columnIndex) {
          ctx.textAlign = column.align;
          ctx.fillText(values[columnIndex], column.x, rowY);
        });
      });
    }

    const footerY = paperH - 13;
    ctx.strokeStyle = "rgba(69, 58, 42, 0.4)";
    ctx.beginPath();
    ctx.moveTo(14, footerY - 9);
    ctx.lineTo(paperW - 14, footerY - 9);
    ctx.stroke();
    ctx.fillStyle = "rgba(69, 58, 42, 0.52)";
    ctx.font = "500 6.5px 'Noto Sans SC Local', ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText("现场回响原样誊录 · 未作推断", 15, footerY);
    ctx.textAlign = "right";
    ctx.fillText(String(Math.min(10, logs.length)).padStart(2, "0") + " / 10", paperW - 14, footerY);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(210, 194, 154, 0.32)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(marginX + paperW - 54, y + 1);
    ctx.lineTo(marginX + paperW - 27, y - 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(196, 178, 132, 0.35)";
    ctx.beginPath();
    ctx.arc(marginX + paperW - 26, y - 8, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  root.EchoCanvas = EchoCanvas;
})(typeof window !== "undefined" ? window : globalThis);
