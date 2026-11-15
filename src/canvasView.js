/*
 * Canvas 视图:
 * - renderProgress: 导入中的进度可视化(低细节动画,省资源)
 * - renderEditor:   导入成功后恢复的时间轴编辑界面
 * - renderIdle:     空态 / 取消后回退界面
 */
(function (global) {
  'use strict';

  function setupCanvas(canvas) {
    const dpr = (global.devicePixelRatio || 1);
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 320;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function clear(ctx, w, h, bg) {
    ctx.fillStyle = bg || '#14171c';
    ctx.fillRect(0, 0, w, h);
  }

  /** 导入进度视图:进度条 + 已解析关键帧点阵(抽样,降低动画细节) */
  function renderProgress(canvas, info) {
    const { ctx, w, h } = setupCanvas(canvas);
    clear(ctx, w, h);
    const margin = 24;
    const barW = w - margin * 2;
    const barH = 18;
    const barY = h / 2 - barH / 2;
    ctx.fillStyle = '#262b33';
    ctx.fillRect(margin, barY, barW, barH);
    ctx.fillStyle = '#3d9df2';
    ctx.fillRect(margin, barY, barW * Math.min(1, info.progress || 0), barH);
    ctx.strokeStyle = '#4a5260';
    ctx.strokeRect(margin + 0.5, barY + 0.5, barW - 1, barH - 1);
    ctx.fillStyle = '#e6e9ee';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const pct = Math.round((info.progress || 0) * 100);
    ctx.fillText('导入中 ' + pct + '% · 已解析 ' +
      (info.parsedKeyframes || 0) + ' 帧 · 错误 ' +
      (info.errorCount || 0), w / 2, barY - 12);
    ctx.fillStyle = '#8b93a1';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('耗时 ' + (info.elapsedMs || 0).toFixed(0) +
      ' ms · 点击"取消导入"可安全回滚', w / 2, barY + barH + 22);
    const dots = Math.min(400, info.parsedKeyframes || 0);
    ctx.fillStyle = 'rgba(61,157,242,0.5)';
    const cols = 80;
    for (let i = 0; i < dots; i += 1) {
      const dx = margin + (i % cols) * (barW / cols);
      const dy = barY + barH + 34 + Math.floor(i / cols) * 6;
      if (dy < h - 6) ctx.fillRect(dx, dy, 3, 3);
    }
  }

  /** 编辑界面:时间轴 + 轨道行 + 关键帧标记 */
  function renderEditor(canvas, project) {
    const { ctx, w, h } = setupCanvas(canvas);
    clear(ctx, w, h, '#10141a');
    const kfs = project.keyframes;
    const marginL = 90;
    const marginR = 20;
    const marginT = 30;
    const marginB = 26;
    const plotW = w - marginL - marginR;
    const plotH = h - marginT - marginB;
    const tracks = [];
    const trackIndex = new Map();
    for (const kf of kfs) {
      if (!trackIndex.has(kf.track)) {
        trackIndex.set(kf.track, tracks.length);
        tracks.push(kf.track);
      }
    }
    const maxTime = kfs.reduce((m, kf) => Math.max(m, kf.time), 0) || 1;
    ctx.strokeStyle = '#2a3038';
    ctx.fillStyle = '#8b93a1';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const ticks = 8;
    for (let i = 0; i <= ticks; i += 1) {
      const x = marginL + (plotW * i) / ticks;
      ctx.beginPath();
      ctx.moveTo(x, marginT);
      ctx.lineTo(x, marginT + plotH);
      ctx.stroke();
      ctx.fillText((maxTime * i / ticks).toFixed(0) + 'ms', x, h - 10);
    }
    const rowH = tracks.length ? plotH / tracks.length : plotH;
    ctx.textAlign = 'right';
    tracks.forEach((name, i) => {
      const y = marginT + rowH * i + rowH / 2;
      ctx.fillStyle = '#aab2bf';
      ctx.fillText(String(name).slice(0, 12), marginL - 8, y + 3);
      ctx.strokeStyle = '#20262e';
      ctx.beginPath();
      ctx.moveTo(marginL, y);
      ctx.lineTo(marginL + plotW, y);
      ctx.stroke();
    });
    // 关键帧数量大时抽样绘制,保证渲染不卡顿;数据本身完整保留
    const maxDots = 6000;
    const stride = Math.max(1, Math.ceil(kfs.length / maxDots));
    ctx.fillStyle = '#f2b03d';
    for (let i = 0; i < kfs.length; i += stride) {
      const kf = kfs[i];
      const x = marginL + (kf.time / maxTime) * plotW;
      const y = marginT + rowH * trackIndex.get(kf.track) + rowH / 2;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#e6e9ee';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('工程: ' + project.name + ' · ' + kfs.length +
      ' 个关键帧 · ' + tracks.length + ' 条轨道' +
      (stride > 1 ? ' · 视图抽样 1/' + stride : ''), marginL, 18);
  }

  /** 空态 / 取消回退 */
  function renderIdle(canvas, message) {
    const { ctx, w, h } = setupCanvas(canvas);
    clear(ctx, w, h);
    ctx.fillStyle = '#8b93a1';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(message || '尚未加载工程', w / 2, h / 2);
  }

  const api = { renderProgress, renderEditor, renderIdle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.CanvasView = api;
})(typeof window !== 'undefined' ? window : globalThis);
