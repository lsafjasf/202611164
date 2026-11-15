function roundedRect(context, command) {
  const radius = Math.min(command.radius, command.width / 2, command.height / 2);
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(command.x, command.y, command.width, command.height, Math.max(0, radius));
  } else {
    context.rect(command.x, command.y, command.width, command.height);
  }
}

function wrapText(context, text, maxWidth, maxLines) {
  if (!text) return [];
  const lines = [];
  let line = "";
  for (const character of text) {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      if (lines.length >= maxLines) return lines;
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

export function drawCommands(context, commands) {
  context.save();
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  for (const command of commands) {
    context.save();
    context.globalAlpha = command.opacity ?? 1;
    if (command.kind === "rect") {
      roundedRect(context, command);
      if (command.fill && command.fill !== "transparent") {
        context.fillStyle = command.fill;
        context.fill();
      }
      if (command.stroke) {
        context.strokeStyle = command.stroke;
        context.lineWidth = command.strokeWidth ?? 1;
        context.stroke();
      }
    } else if (command.kind === "text") {
      context.beginPath();
      context.rect(command.x, command.y - command.font.size, command.width, command.height + 4);
      context.clip();
      context.fillStyle = command.fill;
      context.textAlign = command.align === "center" ? "center" : command.align === "right" ? "right" : "left";
      context.textBaseline = "alphabetic";
      context.font = `${command.font.weight} ${command.font.size}px ${command.font.family}`;
      const lineHeight = command.font.size * command.font.lineHeight;
      const maxLines = Math.max(1, Math.floor((command.height + lineHeight) / lineHeight));
      const lines = wrapText(context, command.text, command.width, maxLines);
      const textX = command.align === "center"
        ? command.x + command.width / 2
        : command.align === "right"
          ? command.x + command.width
          : command.x;
      lines.forEach((line, index) => {
        context.fillText(line, textX, command.y + index * lineHeight);
      });
    }
    context.restore();
  }
  context.restore();
}

export function drawSelection(context, layout, viewport) {
  if (!layout || layout.hidden) return;
  context.save();
  context.strokeStyle = "#2457d6";
  context.lineWidth = 1.5;
  context.setLineDash([5, 4]);
  context.strokeRect(
    Math.max(0, layout.x) + 0.75,
    Math.max(0, layout.y) + 0.75,
    Math.max(0, layout.width - 1.5),
    Math.max(0, layout.height - 1.5),
  );
  context.setLineDash([]);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#2457d6";
  const corners = [
    [layout.x, layout.y],
    [layout.x + layout.width, layout.y],
    [layout.x, layout.y + layout.height],
    [layout.x + layout.width, layout.y + layout.height],
  ];
  for (const [x, y] of corners) {
    if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;
    context.beginPath();
    context.rect(x - 3, y - 3, 6, 6);
    context.fill();
    context.stroke();
  }
  context.restore();
}

export function resizeCanvas(canvas, viewport) {
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.round(viewport.width * ratio);
  const height = Math.round(viewport.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

export function canvasPoint(canvas, event, viewport) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * viewport.width,
    y: ((event.clientY - bounds.top) / bounds.height) * viewport.height,
  };
}

export function hitTest(layouts, point) {
  const items = [...layouts.values()];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const layout = items[index];
    if (layout.hidden) continue;
    if (
      point.x >= layout.x
      && point.x <= layout.x + layout.width
      && point.y >= layout.y
      && point.y <= layout.y + layout.height
    ) {
      return layout.id;
    }
  }
  return null;
}

export function renderPng(commands, viewport) {
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  drawCommands(context, commands);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas PNG encoding returned an empty blob"));
    }, "image/png");
  });
}
