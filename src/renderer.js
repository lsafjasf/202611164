// Canvas 渲染：8 只玻璃杯、水位、振动波形、温度色变、裂纹、节拍指示。
// 振动相位直接取 AudioContext.currentTime，绘制与发声共用同一时钟 → 音画同步。

export class GlassRenderer {
  constructor(canvas, project, ctx) {
    this.canvas = canvas;
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.project = project;
    this.audioCtx = ctx;
    this.active = new Map(); // trackIndex => 振动到期时间(音频时钟)
    this.currentStep = -1;
    this.heatMap = new Array(project.tracks.length).fill(0);
    this._raf = null;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.width = rect.width;
    this.height = rect.height;
  }

  pulse(trackIndex, until) {
    this.active.set(trackIndex, Math.max(this.active.get(trackIndex) || 0, until));
  }

  setStep(step) {
    this.currentStep = step;
  }

  start() {
    if (this._raf) return;
    const loop = () => {
      this.draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.active.clear();
    this.draw();
  }

  glassRect(index) {
    const gap = this.width * 0.02;
    const glassW = (this.width - gap * 9) / 8;
    return { x: gap + index * (glassW + gap), w: glassW,
      top: this.height * 0.14, h: this.height * 0.72 };
  }

  draw() {
    const g = this.canvas.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.width, this.height);
    const now = this.audioCtx ? this.audioCtx.currentTime : 0;
    this.project.tracks.forEach((track, i) => this.drawGlass(g, i, track, now));
    this.drawBeatBar(g);
  }

  roundRectPath(g, x, y, w, h, r) {
    if (typeof g.roundRect === 'function') {
      g.roundRect(x, y, w, h, r);
      return;
    }
    const radius = Math.min(r, w / 2, h / 2);
    g.moveTo(x + radius, y);
    g.arcTo(x + w, y, x + w, y + h, radius);
    g.arcTo(x + w, y + h, x, y + h, radius);
    g.arcTo(x, y + h, x, y, radius);
    g.arcTo(x, y, x + w, y, radius);
    g.closePath();
  }

  drawGlass(g, i, track, now) {
    const { x, w, top, h } = this.glassRect(i);
    const waterH = h * track.water;
    const waterY = top + h - waterH;
    g.save();
    // 杯体
    g.beginPath();
    this.roundRectPath(g, x, top, w, h, w * 0.18);
    g.fillStyle = 'rgba(210, 235, 255, 0.18)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = track.broken ? '#8a8f99' : '#9fc7e8';
    g.stroke();

    // 水位（温度越高越偏红）
    g.save();
    g.beginPath();
    this.roundRectPath(g, x, top, w, h, w * 0.18);
    g.clip();
    const heat = this.heatMap[i] / 100;
    const grad = g.createLinearGradient(0, waterY, 0, top + h);
    grad.addColorStop(0, `rgba(${80 + heat * 175}, ${150 - heat * 90}, 255, 0.55)`);
    grad.addColorStop(1, `rgba(${40 + heat * 175}, ${110 - heat * 70}, 220, 0.75)`);
    g.fillStyle = grad;
    g.fillRect(x, waterY, w, waterH);

    // 振动波形：仅在活跃时间窗内绘制
    const until = this.active.get(i) || 0;
    if (until > now && !track.broken) {
      const decay = Math.min(1, (until - now) / 1.2);
      g.beginPath();
      for (let px = 0; px <= w; px += 2) {
        const phase = now * 14 + (px / w) * Math.PI * 6 + i;
        const y = waterY + Math.sin(phase) * 4 * decay;
        if (px === 0) g.moveTo(x + px, y); else g.lineTo(x + px, y);
      }
      g.strokeStyle = `rgba(255,255,255,${0.75 * decay})`;
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.restore();

    if (track.broken) this.drawCracks(g, x, w, top, h);

    // 标签
    g.fillStyle = '#dfe9f5';
    g.font = '12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(`杯 ${i + 1}`, x + w / 2, top + h + 18);
    g.restore();
  }

  drawCracks(g, x, w, top, h) {
    g.save();
    g.strokeStyle = '#e8edf3';
    g.lineWidth = 1;
    const cx = x + w / 2;
    const cy = top + h * 0.35;
    for (let a = 0; a < 6; a += 1) {
      const angle = (a / 6) * Math.PI * 2 + 0.3;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(angle) * w * 0.42, cy + Math.sin(angle) * h * 0.4);
      g.stroke();
    }
    g.fillStyle = '#ff9a9a';
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('已破裂', cx, top - 6);
    g.restore();
  }

  drawBeatBar(g) {
    const barH = 6;
    const y = this.height - 12;
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, y, this.width, barH);
    if (this.currentStep < 0) return;
    const total = Math.max(1, this.project.melody.length);
    const ratio = (this.currentStep + 1) / total;
    g.fillStyle = '#6fd3ff';
    g.fillRect(0, y, this.width * Math.min(1, ratio), barH);
  }
}
