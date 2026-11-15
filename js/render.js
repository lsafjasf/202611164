// Canvas 渲染：滚动谱面 + 金属梳齿/转轴。视觉位置完全由 Transport 虚拟时间推导。
import { beatDurationSec, virtualToBeat, PITCH_COUNT, pitchName } from './core.js';

const TRACK_COLORS = { t1: '#8ab4f8', t2: '#e0a458', t3: '#9d7be0' };
const STATUS_COLOR = { ok: '#6fd08a', masked: '#c9a14b', leak: '#e06464' };

export class Renderer {
  constructor(scoreCanvas, cylinderCanvas, project, events) {
    this.score = scoreCanvas;
    this.cyl = cylinderCanvas;
    this.project = project;
    this.events = events;
    this.flashes = new Map(); // noteId -> 强度 0..1
    this.fit();
  }

  fit() {
    for (const canvas of [this.score, this.cyl]) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(320, Math.round(rect.width * dpr));
      canvas.height = Math.round(Number(canvas.getAttribute('height')) * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  update(project, events) {
    this.project = project;
    this.events = events;
  }

  // 像素/秒：让一拍宽度稳定（120px/拍，速度越快滚动越快）
  get pxPerSec() {
    return (120 * this.project.bpm * this.project.speed) / 60;
  }

  // 记录拨齿闪光（由调度器/渲染循环依据事件时间判定，保证音画同步）
  pulseAt(virtualTime) {
    for (const ev of this.events.sounded) {
      const dt = virtualTime - ev.time;
      if (dt >= 0 && dt < 0.09 && !this.flashes.has(ev.noteId + Math.floor(ev.time * 1000))) {
        this.flashes.set(ev.noteId + Math.floor(ev.time * 1000), { pitch: ev.pitch, t: 1 });
      }
    }
    for (const [k, f] of this.flashes) {
      f.t -= 0.05;
      if (f.t <= 0) this.flashes.delete(k);
    }
  }

  drawScore(transport) {
    const ctx = this.score.getContext('2d');
    const w = this.score.clientWidth;
    const h = this.score.clientHeight;
    const vt = transport.virtualTime;
    const px = this.pxPerSec;
    const playheadX = w * 0.32;
    const beatSec = beatDurationSec(this.project.bpm) / this.project.speed;
    const currentBeat = virtualToBeat(vt, this.project.bpm, this.project.speed);

    ctx.clearRect(0, 0, w, h);
    // 背景网格
    ctx.strokeStyle = '#2a2e3e';
    ctx.lineWidth = 1;
    const firstBeat = Math.floor(currentBeat) - Math.ceil(playheadX / (px * beatSec)) - 1;
    for (let b = firstBeat; ; b += 1) {
      const x = playheadX + (b - currentBeat) * beatSec * px;
      if (x > w + 20) break;
      if (x < -20) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
      ctx.strokeStyle = b % 4 === 0 ? '#3b4055' : '#232634';
      ctx.stroke();
      if (b >= 0 && b % 4 === 0) {
        ctx.fillStyle = '#6a7088';
        ctx.font = '11px monospace';
        ctx.fillText(`${b}`, x + 3, h - 6);
      }
    }
    // 轨道水平分隔
    const rowH = h / this.project.tracks.length;
    this.project.tracks.forEach((tr, i) => {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.035)';
      ctx.fillRect(0, i * rowH, w, rowH);
      ctx.strokeStyle = '#333748';
      ctx.beginPath(); ctx.moveTo(0, i * rowH); ctx.lineTo(w, i * rowH); ctx.stroke();
      ctx.fillStyle = TRACK_COLORS[tr.id] || '#aaa';
      ctx.font = '12px sans-serif';
      ctx.fillText(tr.name, 8, i * rowH + 16);
    });
    // 音符（含掩蔽/漏音状态色）
    for (const ev of this.events.all) {
      const x = playheadX + (ev.time - vt) * px;
      if (x < -24 || x > w + 24) continue;
      const trackIdx = this.project.tracks.findIndex((t) => t.id === ev.trackId);
      if (trackIdx < 0) continue;
      const pitchH = (rowH - 14) / PITCH_COUNT;
      const y = trackIdx * rowH + 8 + (PITCH_COUNT - 1 - ev.pitch) * pitchH;
      const r = Math.max(4, Math.min(8, pitchH * 0.42));
      ctx.beginPath();
      ctx.arc(x, y + r, r, 0, Math.PI * 2);
      ctx.fillStyle = ev.status === 'ok'
        ? (TRACK_COLORS[ev.trackId] || '#888')
        : STATUS_COLOR[ev.status];
      ctx.globalAlpha = ev.status === 'leak' ? 0.45 : ev.status === 'masked' ? 0.75 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (Math.abs(ev.time - vt) < 0.07 && ev.status !== 'leak') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // 播放头
    ctx.strokeStyle = '#e0a458';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(playheadX, 0); ctx.lineTo(playheadX, h); ctx.stroke();
  }

  drawCylinder(transport) {
    const ctx = this.cyl.getContext('2d');
    const w = this.cyl.clientWidth;
    const h = this.cyl.clientHeight;
    const vt = transport.virtualTime;
    const cx = w * 0.5;
    const cy = h * 0.52;
    const radius = Math.min(h * 0.34, w * 0.075);
    const rot = vt * this.project.speed * 2.2; // 转轴角度与虚拟时间严格绑定

    ctx.clearRect(0, 0, w, h);
    // 转轴主体
    const grad = ctx.createLinearGradient(cx - radius, 0, cx + radius, 0);
    grad.addColorStop(0, '#5b4626');
    grad.addColorStop(0.5, '#caa15e');
    grad.addColorStop(1, '#4a3820');
    ctx.fillStyle = grad;
    roundRect(ctx, cx - radius, cy - radius * 2.1, radius * 2, radius * 4.2, 10);
    ctx.fill();
    ctx.strokeStyle = '#2e2414';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 表面拨钉：随转轴旋转，位置 = 固定工程角度 + 旋转量
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, cx - radius, cy - radius * 2.1, radius * 2, radius * 4.2, 10);
    ctx.clip();
    for (const ev of this.events.all) {
      if (ev.status === 'leak') continue;
      const base = (ev.beat * 0.9 + ev.pitch * 0.37) % (Math.PI * 2);
      const ang = base + rot;
      const nx = Math.sin(ang);
      if (nx < -0.6) continue; // 背面不画
      const x = cx + nx * radius;
      const y = cy + Math.cos(ang) * radius * 1.9;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = ev.status === 'masked' ? STATUS_COLOR.masked : '#f4e4c4';
      ctx.globalAlpha = 0.35 + 0.65 * ((nx + 0.6) / 1.6);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 两排金属梳齿（12 个音高 × 两排）
    const combW = w * 0.2;
    for (let row = 0; row < 2; row += 1) {
      const baseX = cx + radius + 18 + row * 26;
      const toothW = (combW - 18) / PITCH_COUNT;
      for (let p = 0; p < PITCH_COUNT; p += 1) {
        const x = baseX + p * toothW;
        const flash = this._flashForPitch(p);
        const th = 30 + (p / PITCH_COUNT) * 46 + flash * 7;
        const tg = ctx.createLinearGradient(x, cy, x, cy + th);
        tg.addColorStop(0, flash > 0 ? '#ffe9b8' : '#b9c1d4');
        tg.addColorStop(1, '#6b748c');
        ctx.fillStyle = tg;
        ctx.fillRect(x, cy - 4, toothW - 2, th);
        ctx.strokeStyle = '#3a4050';
        ctx.strokeRect(x, cy - 4, toothW - 2, th);
        if (p % 2 === 0) {
          ctx.fillStyle = '#8b92a8';
          ctx.font = '9px monospace';
          ctx.fillText(pitchName(p).slice(0, 2), x, cy - 8);
        }
      }
    }
    // 节拍读数
    const beat = virtualToBeat(vt, this.project.bpm, this.project.speed);
    ctx.fillStyle = '#e8eaf2';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(`beat ${beat.toFixed(3)} / ${this.project.totalBeats}`, 14, 22);
    ctx.fillStyle = '#9aa0b5';
    ctx.fillText(`t = ${vt.toFixed(3)}s`, 14, 40);
  }

  _flashForPitch(pitch) {
    let m = 0;
    for (const f of this.flashes.values()) {
      if (f.pitch === pitch && f.t > m) m = f.t;
    }
    return m;
  }

  // 画布坐标 → (trackIndex, pitch, beat)，用于点击/拖放编辑
  locate(clientX, clientY, virtualTime = transportRef.virtualTime) {
    const rect = this.score.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const rowH = h / this.project.tracks.length;
    const trackIdx = Math.max(0, Math.min(this.project.tracks.length - 1, Math.floor(y / rowH)));
    const pitchH = (rowH - 14) / PITCH_COUNT;
    const pitch = PITCH_COUNT - 1 - Math.floor((y - trackIdx * rowH - 8) / pitchH);
    const playheadX = w * 0.32;
    const px = this.pxPerSec;
    const beatSec = beatDurationSec(this.project.bpm) / this.project.speed;
    const beat = Math.round(((x - playheadX) / px + virtualTime) / beatSec * 4) / 4; // 吸附 1/16
    return { trackIdx, pitch: Math.max(0, Math.min(PITCH_COUNT - 1, pitch)), beat: Math.max(0, beat) };
  }

  locateNote(clientX, clientY, virtualTime = transportRef.virtualTime) {
    const rect = this.score.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const vt = virtualTime;
    const px = this.pxPerSec;
    const playheadX = rect.width * 0.32;
    let best = null;
    let bestD = 14;
    const rowH = rect.height / this.project.tracks.length;
    for (const ev of this.events.all) {
      const ex = playheadX + (ev.time - vt) * px;
      const ti = this.project.tracks.findIndex((t) => t.id === ev.trackId);
      if (ti < 0) continue;
      const pitchH = (rowH - 14) / PITCH_COUNT;
      const ey = ti * rowH + 8 + (PITCH_COUNT - 1 - ev.pitch) * pitchH + 6;
      const d = Math.hypot(ex - x, ey - y);
      if (d < bestD) { bestD = d; best = ev; }
    }
    return best;
  }
}

export const transportRef = { virtualTime: 0 };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
