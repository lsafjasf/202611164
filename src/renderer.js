import { layoutText } from './text-layout.js';

export const CANVAS_W = 900;
export const CANVAS_H = 600;

export function getCtx(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';
  return ctx;
}

export function toCanvasPoint(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

export function hitTest(shapes, point) {
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const shape = shapes[i];
    const withinX = point.x >= shape.x && point.x <= shape.x + shape.w;
    const withinY = point.y >= shape.y && point.y <= shape.y + shape.h;
    if (shape.type === 'circle') {
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      const rx = shape.w / 2;
      const ry = shape.h / 2;
      const dx = (point.x - cx) / rx;
      const dy = (point.y - cy) / ry;
      if (dx * dx + dy * dy <= 1) return shape;
    } else if (withinX && withinY) {
      return shape;
    }
  }
  return null;
}

function drawSelection(ctx, shape) {
  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(shape.x - 4, shape.y - 4, shape.w + 8, shape.h + 8);
  ctx.setLineDash([]);
  const handles = [
    [shape.x - 4, shape.y - 4],
    [shape.x + shape.w + 4, shape.y - 4],
    [shape.x - 4, shape.y + shape.h + 4],
    [shape.x + shape.w + 4, shape.y + shape.h + 4]
  ];
  ctx.fillStyle = '#fff';
  for (const [hx, hy] of handles) {
    ctx.beginPath();
    ctx.rect(hx - 4, hy - 4, 8, 8);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function render(ctx, canvas, state) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const shape of state.shapes) {
    ctx.save();
    if (shape.type === 'rect') {
      ctx.fillStyle = shape.fill;
      ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
    } else if (shape.type === 'circle') {
      ctx.fillStyle = shape.fill;
      ctx.beginPath();
      ctx.ellipse(
        shape.x + shape.w / 2,
        shape.y + shape.h / 2,
        shape.w / 2,
        shape.h / 2,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    } else if (shape.type === 'text') {
      const layout = layoutText(ctx, shape.text, shape.w, shape.fontSize);
      ctx.fillStyle = shape.fill;
      ctx.font = `${shape.fontSize}px "Noto Sans CJK SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
      layout.lines.forEach((line, idx) => {
        ctx.fillText(line, shape.x, shape.y + idx * layout.lineHeight);
      });
    }
    ctx.restore();
    if (shape.id === state.selectedId) drawSelection(ctx, shape);
  }
}

export function renderToCanvas(state) {
  const offscreen = document.createElement('canvas');
  offscreen.width = CANVAS_W;
  offscreen.height = CANVAS_H;
  const ctx = getCtx(offscreen);
  const exportState = { ...state, selectedId: null };
  render(ctx, offscreen, exportState);
  return offscreen;
}
