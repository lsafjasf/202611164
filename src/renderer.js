import { collectedCount, getTarget } from "./game.js";

const COLORS = {
  board: "#0a171a",
  boardAlt: "#0c1b1e",
  grid: "rgba(158, 224, 206, 0.11)",
  gridStrong: "rgba(158, 224, 206, 0.22)",
  mint: "#71f0ce",
  lime: "#c8f26c",
  amber: "#ffbd66",
  red: "#ff8585",
  text: "#eef8f3",
  muted: "#8aa39d",
  wall: "#26383b"
};

const DIRECTION_ANGLE = {
  up: -Math.PI / 2,
  right: 0,
  down: Math.PI / 2,
  left: Math.PI
};

function seededStars(count) {
  let seed = 7321;
  return Array.from({ length: count }, () => {
    seed = (seed * 16807) % 2147483647;
    const x = (seed % 1000) / 1000;
    seed = (seed * 16807) % 2147483647;
    const y = (seed % 1000) / 1000;
    seed = (seed * 16807) % 2147483647;
    const alpha = 0.08 + (seed % 100) / 520;
    return { x, y, alpha };
  });
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = 920;
    this.height = 560;
    this.dpr = 1;
    this.stars = seededStars(92);
    this.particles = [];
    this.previousPlayer = null;
    this.previousFragments = 0;
    this.lastDirection = "up";
    this.lastStateStatus = "playing";
    this.lastFrameTime = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  getGeometry(state) {
    const cols = state.config.cols;
    const rows = state.config.rows;
    const compact = this.width < 540;
    const availableWidth = this.width - (compact ? 36 : 150);
    const availableHeight = this.height - (compact ? 92 : 124);
    const cell = Math.max(22, Math.min(availableWidth / cols, availableHeight / rows, 88));
    const boardWidth = cell * cols;
    const boardHeight = cell * rows;
    return {
      cols,
      rows,
      cell,
      x: (this.width - boardWidth) / 2,
      y: (this.height - boardHeight) / 2 + (compact ? 5 : 8),
      width: boardWidth,
      height: boardHeight,
      compact
    };
  }

  cellCenter(geometry, x, y) {
    return {
      x: geometry.x + (x + 0.5) * geometry.cell,
      y: geometry.y + (y + 0.5) * geometry.cell
    };
  }

  spawnMoveParticles(state, geometry, reducedMotion) {
    if (!this.previousPlayer || reducedMotion) {
      this.previousPlayer = { ...state.player };
      return;
    }
    if (
      this.previousPlayer.x === state.player.x &&
      this.previousPlayer.y === state.player.y
    ) {
      return;
    }
    const point = this.cellCenter(geometry, state.player.x, state.player.y);
    const collected =
      collectedCount(state) > this.previousFragments &&
      state.fragments.some(
        (fragment) =>
          fragment.x === state.player.x &&
          fragment.y === state.player.y &&
          fragment.collected
      );
    const count = collected ? 22 : 9;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.3;
      const speed = (collected ? 26 : 12) + Math.random() * (collected ? 35 : 18);
      this.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.035 + Math.random() * 0.035,
        color: collected ? COLORS.lime : COLORS.mint,
        size: collected ? 2.5 : 1.5
      });
    }
    this.previousPlayer = { ...state.player };
  }

  updateParticles(delta) {
    for (const particle of this.particles) {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= 0.97;
      particle.vy *= 0.97;
      particle.life -= particle.decay;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  drawBackdrop() {
    const context = this.context;
    const gradient = context.createRadialGradient(
      this.width * 0.52,
      this.height * 0.46,
      20,
      this.width * 0.52,
      this.height * 0.46,
      this.width * 0.72
    );
    gradient.addColorStop(0, "#102326");
    gradient.addColorStop(0.5, "#0a171a");
    gradient.addColorStop(1, "#071013");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);
    for (const star of this.stars) {
      context.beginPath();
      context.arc(
        star.x * this.width,
        star.y * this.height,
        star.x > 0.72 ? 0.85 : 0.55,
        0,
        Math.PI * 2
      );
      context.fillStyle = `rgba(201, 243, 230, ${star.alpha})`;
      context.fill();
    }
    context.save();
    context.strokeStyle = "rgba(113, 240, 206, 0.035)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.42, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.52, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  drawBoard(state, geometry, target, highContrast) {
    const context = this.context;
    const { x, y, cell, cols, rows } = geometry;
    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.42)";
    context.shadowBlur = 32;
    roundedRect(context, x - 8, y - 8, geometry.width + 16, geometry.height + 16, 18);
    context.fillStyle = "rgba(4, 10, 11, 0.72)";
    context.fill();
    context.restore();

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const gap = Math.max(2, cell * 0.045);
        const cx = x + col * cell + gap;
        const cy = y + row * cell + gap;
        const size = cell - gap * 2;
        roundedRect(context, cx, cy, size, size, Math.max(5, cell * 0.1));
        const isTarget = target && target.x === col && target.y === row;
        context.fillStyle =
          (row + col) % 2 === 0 ? COLORS.board : COLORS.boardAlt;
        context.fill();
        context.strokeStyle = isTarget
          ? "rgba(255, 189, 102, 0.36)"
          : highContrast
            ? COLORS.gridStrong
            : COLORS.grid;
        context.lineWidth = isTarget ? 1.5 : 0.7;
        context.stroke();
        if (isTarget && state.status === "playing") {
          roundedRect(context, cx + 2, cy + 2, size - 4, size - 4, Math.max(4, cell * 0.08));
          context.strokeStyle = "rgba(255, 189, 102, 0.1)";
          context.setLineDash([3, 5]);
          context.stroke();
          context.setLineDash([]);
        }
      }
    }
  }

  drawRouteHint(state, geometry, target) {
    if (!target || state.status === "won") {
      return;
    }
    const context = this.context;
    const from = this.cellCenter(geometry, state.player.x, state.player.y);
    const to = this.cellCenter(geometry, target.x, target.y);
    context.save();
    context.strokeStyle = "rgba(200, 242, 108, 0.3)";
    context.lineWidth = 1;
    context.setLineDash([2, 7]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const markerDistance = Math.min(38, Math.hypot(to.x - from.x, to.y - from.y) * 0.38);
    const mx = from.x + Math.cos(angle) * markerDistance;
    const my = from.y + Math.sin(angle) * markerDistance;
    context.translate(mx, my);
    context.rotate(angle);
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(5, 0);
    context.lineTo(-3, -4);
    context.lineTo(-3, 4);
    context.closePath();
    context.fillStyle = "rgba(200, 242, 108, 0.66)";
    context.fill();
    context.restore();
  }

  drawObstacles(state, geometry, time, reducedMotion) {
    const context = this.context;
    for (const obstacle of state.config.obstacles) {
      const center = this.cellCenter(geometry, obstacle.x, obstacle.y);
      const cell = geometry.cell;
      context.save();
      context.translate(center.x, center.y);
      roundedRect(context, -cell * 0.34, -cell * 0.34, cell * 0.68, cell * 0.68, cell * 0.1);
      context.fillStyle = "#142427";
      context.fill();
      context.strokeStyle = "rgba(133, 169, 164, 0.16)";
      context.lineWidth = 1;
      context.stroke();
      context.rotate(((obstacle.x + obstacle.y) % 3) * 0.16);
      const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(time * 0.0012 + obstacle.x) * 0.05;
      context.beginPath();
      context.moveTo(-cell * 0.23, cell * 0.12);
      context.lineTo(-cell * 0.06, -cell * 0.22);
      context.lineTo(cell * 0.07, -cell * 0.03);
      context.lineTo(cell * 0.23, -cell * 0.2);
      context.lineTo(cell * 0.25, cell * 0.15);
      context.closePath();
      context.fillStyle = COLORS.wall;
      context.fill();
      context.strokeStyle = `rgba(138, 183, 176, ${pulse})`;
      context.lineWidth = 0.8;
      context.stroke();
      context.beginPath();
      context.moveTo(-cell * 0.16, cell * 0.03);
      context.lineTo(cell * 0.1, cell * 0.03);
      context.strokeStyle = "rgba(5, 14, 16, 0.55)";
      context.stroke();
      context.restore();
    }
  }

  drawFragments(state, geometry, time, reducedMotion) {
    const context = this.context;
    for (const fragment of state.fragments) {
      if (fragment.collected) {
        const center = this.cellCenter(geometry, fragment.x, fragment.y);
        context.save();
        context.globalAlpha = 0.12;
        context.beginPath();
        context.arc(center.x, center.y, Math.max(3, geometry.cell * 0.05), 0, Math.PI * 2);
        context.fillStyle = COLORS.lime;
        context.fill();
        context.restore();
        continue;
      }
      const center = this.cellCenter(geometry, fragment.x, fragment.y);
      const pulse = reducedMotion ? 0.75 : 0.65 + Math.sin(time * 0.003 + fragment.x) * 0.2;
      const size = geometry.cell * 0.16;
      context.save();
      context.translate(center.x, center.y);
      context.shadowColor = "rgba(113, 240, 206, 0.75)";
      context.shadowBlur = geometry.cell * 0.28;
      context.rotate(Math.PI / 4);
      context.fillStyle = `rgba(113, 240, 206, ${pulse})`;
      roundedRect(context, -size / 2, -size / 2, size, size, 1.5);
      context.fill();
      context.strokeStyle = "rgba(226, 255, 246, 0.85)";
      context.lineWidth = 0.8;
      context.stroke();
      context.restore();
      context.save();
      context.strokeStyle = `rgba(113, 240, 206, ${pulse * 0.35})`;
      context.lineWidth = 0.7;
      context.beginPath();
      context.arc(center.x, center.y, geometry.cell * 0.29, 0, Math.PI * 2);
      context.stroke();
      context.restore();
      if (geometry.cell > 42) {
        context.save();
        context.fillStyle = "rgba(191, 234, 222, 0.72)";
        context.font = `600 ${Math.max(7, geometry.cell * 0.1)}px "Avenir Next", "Noto Sans SC", sans-serif`;
        context.textAlign = "center";
        context.fillText(`碎片 ${fragment.ordinal}`, center.x, center.y + geometry.cell * 0.35);
        context.restore();
      }
    }
  }

  drawBeacon(state, geometry, time, reducedMotion) {
    const context = this.context;
    const center = this.cellCenter(geometry, state.config.beacon.x, state.config.beacon.y);
    const cell = geometry.cell;
    const active = collectedCount(state) >= state.config.requiredFragments || state.status === "won";
    const pulse = reducedMotion ? 0.55 : 0.5 + Math.sin(time * 0.0022) * 0.16;
    context.save();
    context.translate(center.x, center.y);
    for (let ring = 0; ring < 3; ring += 1) {
      context.beginPath();
      context.arc(0, 0, cell * (0.13 + ring * 0.11), 0, Math.PI * 2);
      context.strokeStyle = `rgba(255, 189, 102, ${pulse * (0.82 - ring * 0.2)})`;
      context.lineWidth = ring === 0 ? 2 : 0.8;
      context.stroke();
    }
    context.beginPath();
    context.moveTo(0, -cell * 0.15);
    context.lineTo(cell * 0.11, 0);
    context.lineTo(0, cell * 0.15);
    context.lineTo(-cell * 0.11, 0);
    context.closePath();
    context.fillStyle = active ? "rgba(255, 189, 102, 0.88)" : "rgba(255, 189, 102, 0.34)";
    context.shadowColor = "rgba(255, 189, 102, 0.62)";
    context.shadowBlur = active ? cell * 0.34 : cell * 0.12;
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(255, 238, 200, 0.9)";
    context.lineWidth = 0.7;
    context.stroke();
    context.restore();
    if (geometry.cell > 42) {
      context.save();
      context.fillStyle = "rgba(255, 220, 167, 0.75)";
      context.font = `600 ${Math.max(7, geometry.cell * 0.1)}px "Avenir Next", "Noto Sans SC", sans-serif`;
      context.textAlign = "center";
      context.fillText("信标", center.x, center.y + geometry.cell * 0.39);
      context.restore();
    }
  }

  drawPlayer(state, geometry, time, reducedMotion) {
    const context = this.context;
    const center = this.cellCenter(geometry, state.player.x, state.player.y);
    const cell = geometry.cell;
    const pulse = reducedMotion ? 0.7 : 0.68 + Math.sin(time * 0.004) * 0.15;
    context.save();
    const glow = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, cell * 0.48);
    glow.addColorStop(0, `rgba(200, 242, 108, ${0.22 * pulse})`);
    glow.addColorStop(1, "rgba(200, 242, 108, 0)");
    context.fillStyle = glow;
    context.fillRect(center.x - cell * 0.5, center.y - cell * 0.5, cell, cell);
    context.beginPath();
    context.arc(center.x, center.y, cell * 0.27, 0, Math.PI * 2);
    context.strokeStyle = "rgba(200, 242, 108, 0.42)";
    context.lineWidth = 1;
    context.setLineDash([2, 4]);
    context.stroke();
    context.setLineDash([]);
    context.translate(center.x, center.y);
    context.rotate(DIRECTION_ANGLE[this.lastDirection] ?? -Math.PI / 2);
    context.beginPath();
    context.moveTo(cell * 0.15, 0);
    context.lineTo(-cell * 0.09, -cell * 0.11);
    context.lineTo(-cell * 0.035, 0);
    context.lineTo(-cell * 0.09, cell * 0.11);
    context.closePath();
    context.fillStyle = COLORS.lime;
    context.shadowColor = "rgba(200, 242, 108, 0.75)";
    context.shadowBlur = cell * 0.23;
    context.fill();
    context.shadowBlur = 0;
    context.restore();
    context.save();
    context.beginPath();
    context.arc(center.x, center.y, Math.max(1.5, cell * 0.035), 0, Math.PI * 2);
    context.fillStyle = "#f5ffe3";
    context.fill();
    context.restore();
  }

  drawParticles() {
    const context = this.context;
    for (const particle of this.particles) {
      context.save();
      context.globalAlpha = Math.max(0, particle.life) * 0.65;
      context.fillStyle = particle.color;
      context.shadowColor = particle.color;
      context.shadowBlur = 7;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  drawCoordinateLabels(state, geometry) {
    const context = this.context;
    const { cell, x, y } = geometry;
    if (cell < 36) {
      return;
    }
    context.save();
    context.fillStyle = "rgba(168, 206, 195, 0.32)";
    context.font = `500 ${Math.max(7, cell * 0.105)}px "SFMono-Regular", monospace`;
    context.textAlign = "center";
    for (let col = 0; col < geometry.cols; col += 1) {
      context.fillText(
        String.fromCharCode(65 + col),
        x + cell * (col + 0.5),
        y - Math.max(10, cell * 0.18)
      );
    }
    context.textAlign = "right";
    for (let row = 0; row < geometry.rows; row += 1) {
      context.fillText(
        String(row + 1).padStart(2, "0"),
        x - Math.max(9, cell * 0.17),
        y + cell * (row + 0.5) + 3
      );
    }
    context.restore();
  }

  drawResultOverlay(state, geometry, reducedMotion) {
    if (state.status === "playing") {
      return;
    }
    const context = this.context;
    const won = state.status === "won";
    const collected = collectedCount(state);
    const centerX = geometry.x + geometry.width / 2;
    const centerY = geometry.y + geometry.height / 2;
    const cardWidth = Math.min(330, geometry.width * 0.68);
    const cardHeight = won ? 157 : 171;
    context.save();
    context.fillStyle = "rgba(4, 10, 11, 0.57)";
    context.fillRect(0, 0, this.width, this.height);
    roundedRect(context, centerX - cardWidth / 2, centerY - cardHeight / 2, cardWidth, cardHeight, 16);
    context.fillStyle = won ? "rgba(17, 31, 27, 0.97)" : "rgba(31, 18, 20, 0.97)";
    context.fill();
    context.strokeStyle = won ? "rgba(200, 242, 108, 0.48)" : "rgba(255, 133, 133, 0.5)";
    context.lineWidth = 1;
    context.stroke();
    context.textAlign = "center";
    context.fillStyle = won ? COLORS.lime : COLORS.red;
    context.font = '600 11px "SFMono-Regular", monospace';
    context.fillText(won ? "MISSION COMPLETE" : "SIGNAL INTERRUPTED", centerX, centerY - 46);
    context.fillStyle = COLORS.text;
    context.font = '500 28px "Iowan Old Style", "Noto Sans SC", serif';
    context.fillText(won ? "航程完成" : "能量耗尽", centerX, centerY - 7);
    context.fillStyle = "rgba(218, 237, 230, 0.72)";
    context.font = '500 11px "Avenir Next", "Noto Sans SC", "PingFang SC", sans-serif';
    const detail = won
      ? `${state.moves} 步 · 碎片 ${collected}/${state.config.requiredFragments} · 剩余能量 ${state.energy}`
      : `最后位置 ${String.fromCharCode(65 + state.player.x)}${state.player.y + 1} · 碎片 ${collected}/${state.config.requiredFragments}`;
    context.fillText(detail, centerX, centerY + 22);
    context.fillStyle = won ? "rgba(200, 242, 108, 0.7)" : "rgba(255, 179, 179, 0.72)";
    context.font = '500 9px "SFMono-Regular", monospace';
    context.fillText(won ? "PRESS R TO REPLAY" : "Z TO UNDO · R TO RESTART", centerX, centerY + 48);
    if (!reducedMotion && won) {
      const ringRadius = 150 + Math.sin(performance.now() * 0.002) * 8;
      context.beginPath();
      context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      context.strokeStyle = "rgba(200, 242, 108, 0.08)";
      context.stroke();
    }
    context.restore();
  }

  render(state, options = {}, time = performance.now()) {
    const delta = Math.min(2.5, Math.max(0, (time - this.lastFrameTime) / 16.67));
    this.lastFrameTime = time;
    const context = this.context;
    const geometry = this.getGeometry(state);
    const target = getTarget(state);
    const reducedMotion = Boolean(options.reducedMotion);
    if (options.lastDirection) {
      this.lastDirection = options.lastDirection;
    }
    this.spawnMoveParticles(state, geometry, reducedMotion);
    this.updateParticles(reducedMotion ? 0 : delta);
    context.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();
    this.drawBoard(state, geometry, target, options.highContrast);
    if (options.routeHint) {
      this.drawRouteHint(state, geometry, target);
    }
    this.drawCoordinateLabels(state, geometry);
    this.drawObstacles(state, geometry, time, reducedMotion);
    this.drawBeacon(state, geometry, time, reducedMotion);
    this.drawFragments(state, geometry, time, reducedMotion);
    this.drawParticles();
    this.drawPlayer(state, geometry, time, reducedMotion);
    this.drawResultOverlay(state, geometry, reducedMotion);
    this.previousFragments = collectedCount(state);
    this.lastStateStatus = state.status;
  }
}
