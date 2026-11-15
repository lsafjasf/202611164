import { layoutText } from './text-layout.js';

const FONT_STACK = "'Noto Sans CJK SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif";

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function buildSvg(ctx, state, width, height) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>'
  ];
  for (const shape of state.shapes) {
    if (shape.type === 'rect') {
      parts.push(
        `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${shape.fill}"/>`
      );
    } else if (shape.type === 'circle') {
      parts.push(
        `<circle cx="${shape.x + shape.w / 2}" cy="${shape.y + shape.h / 2}" r="${Math.min(shape.w, shape.h) / 2}" fill="${shape.fill}"/>`
      );
    } else if (shape.type === 'text') {
      const boxW = Math.max(shape.w, 40);
      const layout = layoutText(ctx, shape.text, boxW, shape.fontSize);
      parts.push(
        `<text font-family="${FONT_STACK}" font-size="${shape.fontSize}" fill="${shape.fill}" xml:space="preserve">`
      );
      layout.lines.forEach((line, idx) => {
        const y = shape.y + shape.fontSize + idx * layout.lineHeight;
        parts.push(
          `<tspan x="${shape.x}" y="${y.toFixed(1)}">${escapeXml(line)}</tspan>`
        );
      });
      parts.push('</text>');
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportSvg(ctx, state, size) {
  const svg = buildSvg(ctx, state, size.width, size.height);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'poster.svg');
  return svg;
}

export function exportPng(canvas, filename = 'poster.png') {
  if (typeof canvas.toDataURL !== 'function') {
    throw new Error('canvas.toDataURL unavailable');
  }
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png')) {
    throw new Error('PNG encoding returned an unexpected payload');
  }
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return dataUrl;
}
