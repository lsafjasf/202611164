import { getSelectedLayer } from "./model.js";

const FONT_STACK = '"Noto Sans SC Local", "Avenir Next", "Segoe UI", "PingFang SC", sans-serif';
const DISPLAY_STACK = '"Iowan Old Style", Georgia, "Noto Sans SC Local", "Songti SC", serif';

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBackground(ctx, state) {
  const { colorA, colorB, angle, grain, vignette } = state.background;
  const radians = (angle * Math.PI) / 180;
  const x = Math.cos(radians) * 480;
  const y = Math.sin(radians) * 270;
  const gradient = ctx.createLinearGradient(480 - x, 270 - y, 480 + x, 270 + y);
  gradient.addColorStop(0, colorA);
  gradient.addColorStop(1, colorB);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 960, 540);

  const glow = ctx.createRadialGradient(734, 116, 0, 734, 116, 370);
  glow.addColorStop(0, "rgba(255,255,255,0.18)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 960, 540);

  if (grain > 0) {
    const count = Math.round(grain * 13);
    let seed = 793 + state.revision * 17;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    ctx.save();
    for (let index = 0; index < count; index += 1) {
      const px = random() * 960;
      const py = random() * 540;
      const alpha = 0.035 + random() * 0.08;
      ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      ctx.fillRect(px, py, random() > 0.82 ? 2 : 1, 1);
    }
    ctx.restore();
  }

  if (vignette > 0) {
    const shade = ctx.createRadialGradient(480, 270, 120, 480, 270, 620);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, `rgba(0,0,0,${vignette / 100 + 0.15})`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 960, 540);
  }
}

function textLines(text) {
  return String(text || "").split("\n").slice(0, 4);
}

function drawText(ctx, layer) {
  const lines = textLines(layer.text);
  const lineHeight = layer.size * 1.15;
  ctx.font = `${layer.weight || 600} ${layer.size}px ${DISPLAY_STACK}`;
  ctx.textBaseline = "top";
  ctx.textAlign = layer.align === "center" ? "center" : "left";
  ctx.fillStyle = layer.fill;
  const x = layer.align === "center" ? layer.x + layer.width / 2 : layer.x;
  lines.forEach((line, index) => {
    ctx.fillText(line, x, layer.y + index * lineHeight);
  });
}

function drawLayer(ctx, layer) {
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.translate(-layer.width / 2, -layer.height / 2);
  if (layer.type === "text") {
    drawText(ctx, { ...layer, x: 0, y: 0 });
  } else {
    roundedRect(ctx, 0, 0, layer.width, layer.height, layer.radius);
    ctx.fillStyle = layer.fill;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function getTextHeight(layer) {
  return textLines(layer.text).length * layer.size * 1.15;
}

export function getLayerBounds(layer) {
  if (!layer) return null;
  return {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.type === "text" ? getTextHeight(layer) : layer.height
  };
}

function drawSelection(ctx, layer) {
  const bounds = getLayerBounds(layer);
  if (!bounds) return;
  ctx.save();
  ctx.strokeStyle = "#c8ff6a";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12);
  ctx.setLineDash([]);
  ctx.fillStyle = "#c8ff6a";
  for (const [x, y] of [
    [bounds.x - 6, bounds.y - 6],
    [bounds.x + bounds.width + 6, bounds.y - 6],
    [bounds.x - 6, bounds.y + bounds.height + 6],
    [bounds.x + bounds.width + 6, bounds.y + bounds.height + 6]
  ]) {
    ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
  }
  ctx.restore();
}

function drawSceneMeta(ctx, state) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `500 10px ${FONT_STACK}`;
  ctx.letterSpacing = "3px";
  ctx.fillText("PRISM / STUDIO", 34, 34);
  ctx.fillStyle = "rgba(255,255,255,0.32)";
  ctx.fillText(`REV ${String(state.revision).padStart(2, "0")}`, 34, 51);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.moveTo(34, 65);
  ctx.lineTo(92, 65);
  ctx.stroke();
  ctx.restore();
}

function drawRecoveryMark(ctx, message) {
  ctx.save();
  ctx.fillStyle = "rgba(10,12,11,0.82)";
  roundedRect(ctx, 28, 462, 286, 44, 22);
  ctx.fill();
  ctx.strokeStyle = "rgba(142,230,168,0.4)";
  ctx.stroke();
  ctx.fillStyle = "#8ee6a8";
  ctx.beginPath();
  ctx.arc(50, 484, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d9ffdf";
  ctx.font = `600 11px ${FONT_STACK}`;
  ctx.fillText(message, 66, 488);
  ctx.restore();
}

function drawFaultOverlay(ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(12,8,9,0.44)";
  ctx.fillRect(0, 0, 960, 540);
  ctx.strokeStyle = "rgba(255,107,107,0.12)";
  ctx.lineWidth = 1;
  for (let offset = -540; offset < 960; offset += 22) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + 540, 540);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(16,10,12,0.9)";
  roundedRect(ctx, 254, 205, 452, 132, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,107,107,0.38)";
  ctx.stroke();
  ctx.fillStyle = "#ff8f8f";
  ctx.font = `600 12px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.fillText("图像模块暂时不可用", 480, 250);
  ctx.fillStyle = "#f0d9d6";
  ctx.font = `500 20px ${DISPLAY_STACK}`;
  ctx.fillText("其他编辑内容已保留", 480, 284);
  ctx.fillStyle = "rgba(244,240,232,0.55)";
  ctx.font = `400 11px ${FONT_STACK}`;
  ctx.fillText("点击下方“重试图像操作”恢复画面", 480, 310);
  ctx.restore();
}

export function drawScene(ctx, state, options = {}) {
  if (!ctx) throw new Error("Canvas 2D 上下文不可用。");
  ctx.clearRect(0, 0, 960, 540);
  drawBackground(ctx, state);
  drawSceneMeta(ctx, state);
  for (const layer of state.layers) drawLayer(ctx, layer);
  if (options.failed) {
    drawFaultOverlay(ctx);
    return;
  }
  drawSelection(ctx, getSelectedLayer(state));
  if (options.recovered) {
    drawRecoveryMark(ctx, options.recoveryMessage || `已恢复 · ${state.layers.length} 个图层与文字保留`);
  }
}

export function hitTest(state, x, y) {
  for (let index = state.layers.length - 1; index >= 0; index -= 1) {
    const layer = state.layers[index];
    const bounds = getLayerBounds(layer);
    if (x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) {
      return layer.id;
    }
  }
  return null;
}

export function pointerToCanvas(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = 960 / (rect.width || 960);
  const scaleY = 540 / (rect.height || 540);
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

export function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}
