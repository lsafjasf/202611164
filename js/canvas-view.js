/* Canvas 模拟组件渲染：正文、大号文字、按钮、描边与焦点环，含达标/不达标标记。 */
(function () {
  'use strict';

  function roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function badge(ctx, x, y, pass, ratioText) {
    ctx.save();
    ctx.font = '600 13px system-ui, sans-serif';
    const label = (pass ? '达标 ' : '不达标 ') + ratioText;
    const w = ctx.measureText(label).width + 18;
    roundedRect(ctx, x, y, w, 22, 11);
    ctx.fillStyle = pass ? '#1A7F37' : '#C62828';
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 9, y + 12);
    ctx.restore();
    return w;
  }

  function drawScene(ctx, colors, results, x0, y0, width, height, title) {
    ctx.save();
    roundedRect(ctx, x0, y0, width, height, 12);
    ctx.fillStyle = colors.pageBg;
    ctx.fill();
    ctx.fillStyle = colors.panelBg;
    roundedRect(ctx, x0 + 16, y0 + 52, width - 32, height - 72, 10);
    ctx.fill();

    ctx.fillStyle = colors.bodyText;
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, x0 + 24, y0 + 32);

    const innerX = x0 + 32;
    let cursorY = y0 + 92;
    const byId = {};
    results.forEach(function (r) { byId[r.id] = r; });

    ctx.fillStyle = colors.bodyText;
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('正文：界面配色对比度实时检查（16px 常规）', innerX, cursorY);
    badge(ctx, innerX + 380, cursorY - 16, byId.body.pass, window.Contrast.formatRatio(byId.body.ratio));
    cursorY += 44;

    ctx.fillStyle = colors.largeText;
    ctx.font = '700 24px system-ui, sans-serif';
    ctx.fillText('大号标题 24px 粗体', innerX, cursorY);
    badge(ctx, innerX + 200, cursorY - 16, byId.large.pass, window.Contrast.formatRatio(byId.large.ratio));
    cursorY += 52;

    const btnW = 168;
    const btnH = 44;
    roundedRect(ctx, innerX, cursorY, btnW, btnH, 8);
    ctx.fillStyle = colors.btnBg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.btnBorder;
    ctx.stroke();
    ctx.fillStyle = colors.btnText;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('主要操作按钮', innerX + btnW / 2, cursorY + 28);
    ctx.textAlign = 'left';
    badge(ctx, innerX + btnW + 16, cursorY + 11, byId.button.pass,
      window.Contrast.formatRatio(byId.button.ratio));
    badge(ctx, innerX + btnW + 132, cursorY + 11, byId.component.pass,
      window.Contrast.formatRatio(byId.component.ratio));
    cursorY += btnH + 36;

    const focusX = innerX;
    roundedRect(ctx, focusX, cursorY, btnW, btnH, 8);
    ctx.fillStyle = colors.btnBg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.btnBorder;
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = colors.focusRing;
    roundedRect(ctx, focusX - 6, cursorY - 6, btnW + 12, btnH + 12, 10);
    ctx.stroke();
    ctx.fillStyle = colors.btnText;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('聚焦状态按钮', focusX + btnW / 2, cursorY + 28);
    ctx.textAlign = 'left';
    badge(ctx, focusX + btnW + 16, cursorY + 11, byId.focus.pass,
      window.Contrast.formatRatio(byId.focus.ratio));
    ctx.restore();
  }

  function drawPreview(canvas, colors) {
    const ctx = canvas.getContext('2d');
    const results = window.Palettes.evaluate(colors);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawScene(ctx, colors, results, 0, 0, canvas.width, canvas.height, '当前色板 · 模拟组件预览');
    return results;
  }

  function renderComparison(beforeColors, afterColors) {
    const canvas = document.createElement('canvas');
    canvas.width = 1120;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const beforeResults = window.Palettes.evaluate(beforeColors);
    const afterResults = window.Palettes.evaluate(afterColors);
    drawScene(ctx, beforeColors, beforeResults, 20, 16, 530, 388, '调整前（保存的基线）');
    drawScene(ctx, afterColors, afterResults, 570, 16, 530, 388, '调整后（当前色板）');
    ctx.strokeStyle = '#C9D1D9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(560, 16);
    ctx.lineTo(560, 404);
    ctx.stroke();
    return canvas.toDataURL('image/png');
  }

  window.CanvasView = {
    drawPreview: drawPreview,
    renderComparison: renderComparison
  };
})();
