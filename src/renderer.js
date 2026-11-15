export function getViewTransform(document, width, height, padding = 0.9) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale =
    Math.min(safeWidth / Math.max(1, document.width), safeHeight / Math.max(1, document.height)) *
    padding;
  return {
    scale,
    offsetX: (safeWidth - document.width * scale) / 2,
    offsetY: (safeHeight - document.height * scale) / 2,
  };
}

export function screenToWorld(point, document, width, height) {
  const view = getViewTransform(document, width, height);
  return {
    x: (point.x - view.offsetX) / view.scale,
    y: (point.y - view.offsetY) / view.scale,
  };
}

function roundedRect(context, x, y, width, height, radius) {
  if (typeof context.roundRect === "function") {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  context.beginPath();
  context.rect(x, y, width, height);
}

function drawShape(context, shape, offset = null) {
  const x = shape.x + (offset?.x || 0);
  const y = shape.y + (offset?.y || 0);
  const centerX = x + shape.width / 2;
  const centerY = y + shape.height / 2;
  context.save();
  context.globalAlpha = shape.opacity ?? 1;
  context.translate(centerX, centerY);
  context.rotate((((shape.rotation || 0) * Math.PI) / 180));
  context.translate(-centerX, -centerY);
  context.fillStyle = shape.color;
  context.strokeStyle = "rgba(255,255,255,0.42)";
  context.lineWidth = Math.max(0.5, Math.min(shape.width, shape.height) * 0.018);

  if (shape.type === "ellipse") {
    context.beginPath();
    context.ellipse(centerX, centerY, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  } else if (shape.type === "text") {
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.fillStyle = "rgba(7, 12, 20, 0.72)";
    roundedRect(context, x, y, shape.width, shape.height, Math.min(14, shape.height / 4));
    context.fill();
    context.fillStyle = shape.color;
    const fontSize = Math.max(8, Math.min(shape.height * 0.42, shape.width / 8));
    context.font = `600 ${fontSize}px "Loom Sans", "Segoe UI", sans-serif`;
    context.fillText(shape.text || "", centerX, centerY, shape.width * 0.88);
  } else {
    roundedRect(
      context,
      x,
      y,
      shape.width,
      shape.height,
      Math.min(16, shape.width * 0.08, shape.height * 0.16),
    );
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawGrid(context, document, mode) {
  if (mode === "reduced") return;
  const step = Math.max(32, Math.round(Math.min(document.width, document.height) / 18));
  context.save();
  context.strokeStyle = "rgba(128, 153, 190, 0.10)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= document.width; x += step) {
    context.moveTo(x, 0);
    context.lineTo(x, document.height);
  }
  for (let y = 0; y <= document.height; y += step) {
    context.moveTo(0, y);
    context.lineTo(document.width, y);
  }
  context.stroke();
  context.restore();
}

export function drawDocument(
  context,
  document,
  {
    width = document.width,
    height = document.height,
    dpr = 1,
    mode = "full",
    selected = new Set(),
    dragOffset = null,
    background = "#0b1018",
  } = {},
) {
  const view = getViewTransform(document, width, height);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(view.offsetX, view.offsetY);
  context.scale(view.scale, view.scale);
  context.fillStyle = "#111827";
  context.fillRect(0, 0, document.width, document.height);
  drawGrid(context, document, mode);

  if (mode === "full") {
    context.shadowColor = "rgba(0, 0, 0, 0.38)";
    context.shadowBlur = 18;
    context.shadowOffsetY = 8;
  }
  for (const shape of document.objects) {
    const offset = selected.has(shape.id) && dragOffset ? dragOffset : null;
    drawShape(context, shape, offset);
  }
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;

  for (const shape of document.objects) {
    if (!selected.has(shape.id)) continue;
    const offset = dragOffset || { x: 0, y: 0 };
    context.save();
    context.strokeStyle = mode === "full" ? "#6ee7b7" : "#93c5fd";
    context.lineWidth = 2 / view.scale;
    context.setLineDash(mode === "full" ? [8 / view.scale, 5 / view.scale] : []);
    context.strokeRect(
      shape.x + offset.x,
      shape.y + offset.y,
      shape.width,
      shape.height,
    );
    context.restore();
  }
  context.restore();
}

export function drawThumbnail(canvas, shape) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0f1722";
  context.fillRect(0, 0, width, height);
  const scale = Math.min((width - 16) / Math.max(0.01, shape.width), (height - 16) / Math.max(0.01, shape.height));
  context.save();
  context.translate(width / 2, height / 2);
  context.scale(scale, scale);
  context.translate(-(shape.x + shape.width / 2), -(shape.y + shape.height / 2));
  drawShape(context, { ...shape, rotation: 0, opacity: 1 }, null);
  context.restore();
}

export function exportDocumentJson(session) {
  const document = session.exportDocument();
  return `${JSON.stringify(document, null, 2)}\n`;
}
