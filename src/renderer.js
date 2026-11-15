import { BEATS_PER_STEP, STEPS_PER_BAR } from "./project.js";

const TRACKS = 4;

export class SequencerRenderer {
  constructor(canvas, meterCanvas, callbacks = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.meterCanvas = meterCanvas;
    this.meterContext = meterCanvas.getContext("2d");
    this.onSelect = callbacks.onSelect || (() => {});
    this.onToggle = callbacks.onToggle || (() => {});
    this.onPaint = callbacks.onPaint || (() => {});
    this.onTrackSelect = callbacks.onTrackSelect || (() => {});
    this.project = null;
    this.selectedTrack = 0;
    this.selectedStep = 0;
    this.width = 0;
    this.height = 0;
    this.meterWidth = 0;
    this.meterHeight = 0;
    this.dpr = 1;
    this.pointer = null;
    this.paintValue = null;
    this.lastPaintCell = "";
    this.smoothLevels = [0, 0, 0, 0, 0];
    this.peakLevels = [0, 0, 0, 0, 0];
    this.layout = { left: 112, right: 18, top: 42, bottom: 14, rowHeight: 80, columnWidth: 40 };
    this.bindPointerEvents();
    this.observeSize();
  }

  setProject(project) {
    this.project = project;
  }

  setSelection(trackIndex, stepIndex) {
    this.selectedTrack = trackIndex;
    this.selectedStep = stepIndex;
  }

  observeSize() {
    const resize = () => this.measure();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(this.canvas);
    this.resizeObserver.observe(this.meterCanvas);
    window.addEventListener("resize", resize);
    resize();
  }

  measure() {
    const rect = this.canvas.getBoundingClientRect();
    const meterRect = this.meterCanvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.meterWidth = Math.max(1, meterRect.width);
    this.meterHeight = Math.max(1, meterRect.height);
    setCanvasSize(this.canvas, this.context, this.width, this.height, this.dpr);
    setCanvasSize(
      this.meterCanvas,
      this.meterContext,
      this.meterWidth,
      this.meterHeight,
      this.dpr,
    );
    const compact = this.width < 620;
    this.layout.left = compact ? 72 : 112;
    this.layout.right = compact ? 8 : 18;
    this.layout.top = compact ? 36 : 42;
    this.layout.bottom = 10;
    this.layout.rowHeight =
      (this.height - this.layout.top - this.layout.bottom) / TRACKS;
    this.layout.columnWidth =
      (this.width - this.layout.left - this.layout.right) / STEPS_PER_BAR;
  }

  bindPointerEvents() {
    this.canvas.addEventListener("pointerdown", (event) => {
      const point = this.hitTest(event);
      if (!point) {
        return;
      }
      this.canvas.setPointerCapture(event.pointerId);
      if (point.kind === "label") {
        this.onTrackSelect(point.track);
        return;
      }
      this.onSelect(point.track, point.step);
      const step = this.project.tracks[point.track].steps[point.step];
      this.paintValue = !step.on;
      this.lastPaintCell = `${point.track}:${point.step}`;
      this.onToggle(point.track, point.step, this.paintValue);
      this.pointer = point;
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.pointer || this.paintValue === null) {
        return;
      }
      const point = this.hitTest(event);
      if (!point || point.kind === "label") {
        return;
      }
      const cell = `${point.track}:${point.step}`;
      if (cell === this.lastPaintCell) {
        return;
      }
      this.lastPaintCell = cell;
      this.onSelect(point.track, point.step);
      this.onPaint(point.track, point.step, this.paintValue);
    });

    const finish = () => {
      this.pointer = null;
      this.paintValue = null;
      this.lastPaintCell = "";
    };
    this.canvas.addEventListener("pointerup", finish);
    this.canvas.addEventListener("pointercancel", finish);
    this.canvas.addEventListener("pointerleave", (event) => {
      if (event.buttons === 0) {
        finish();
      }
    });
  }

  hitTest(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const { left, right, top, bottom, rowHeight, columnWidth } = this.layout;
    const track = Math.floor((y - top) / rowHeight);
    if (track < 0 || track >= TRACKS || y > this.height - bottom) {
      return null;
    }
    if (x < left) {
      return { kind: "label", track };
    }
    if (x > this.width - right) {
      return null;
    }
    const step = Math.floor((x - left) / columnWidth);
    if (step < 0 || step >= STEPS_PER_BAR) {
      return null;
    }
    return { kind: "cell", track, step };
  }

  draw(frame) {
    if (!this.project) {
      return;
    }
    this.drawGrid(frame);
    this.drawMeters(frame.levels || { tracks: [0, 0, 0, 0], master: 0 });
  }

  drawGrid(frame) {
    const context = this.context;
    const { width, height, layout } = this;
    const project = this.project;
    const position = frame.position;
    context.clearRect(0, 0, width, height);

    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#0d1117");
    background.addColorStop(1, "#090c10");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    this.drawGridGuides(frame);
    this.drawStepLabels(frame);
    for (let track = 0; track < TRACKS; track += 1) {
      this.drawTrackLabel(track);
      for (let step = 0; step < STEPS_PER_BAR; step += 1) {
        this.drawStepCell(track, step, frame);
      }
    }
    this.drawPlayhead(position);
  }

  drawGridGuides(frame) {
    const context = this.context;
    const { left, right, top, bottom, rowHeight, columnWidth } = this.layout;
    const gridBottom = this.height - bottom;
    const gridWidth = this.width - left - right;

    for (let group = 0; group < 4; group += 1) {
      context.fillStyle = group % 2 === 0 ? "rgba(255,255,255,0.013)" : "rgba(0,0,0,0.08)";
      context.fillRect(left + group * columnWidth * 4, top - 12, columnWidth * 4, gridBottom - top + 12);
    }

    context.strokeStyle = "#1c222b";
    context.lineWidth = 1;
    for (let step = 0; step <= STEPS_PER_BAR; step += 1) {
      const x = Math.round(left + step * columnWidth) + 0.5;
      context.globalAlpha = step % 4 === 0 ? 0.8 : 0.38;
      context.beginPath();
      context.moveTo(x, top - 9);
      context.lineTo(x, gridBottom);
      context.stroke();
    }
    context.globalAlpha = 1;

    for (let track = 1; track < TRACKS; track += 1) {
      const y = Math.round(top + track * rowHeight) + 0.5;
      context.strokeStyle = "#1c222b";
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(this.width, y);
      context.stroke();
    }

    context.fillStyle = "#151a21";
    context.fillRect(left, top - 19, gridWidth, 1);
  }

  drawStepLabels(frame) {
    const context = this.context;
    const { left, top, columnWidth } = this.layout;
    context.save();
    context.font = '8px "SFMono-Regular", "Cascadia Code", monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let step = 0; step < STEPS_PER_BAR; step += 1) {
      const x = left + (step + 0.5) * columnWidth;
      context.fillStyle = frame.position.patternStep === step ? "#ff6a3d" : "#59616e";
      context.fillText(String(step + 1).padStart(2, "0"), x, top - 8);
    }
    context.fillStyle = "#363e4a";
    context.font = '7px "SFMono-Regular", "Cascadia Code", monospace';
    context.textAlign = "left";
    context.fillText("STEP", 16, top - 8);
    context.restore();
  }

  drawTrackLabel(trackIndex) {
    const context = this.context;
    const { top, rowHeight, left } = this.layout;
    const track = this.project.tracks[trackIndex];
    const y = top + trackIndex * rowHeight;
    const selected = trackIndex === this.selectedTrack;
    context.save();
    if (selected) {
      context.fillStyle = "rgba(255,255,255,0.025)";
      context.fillRect(0, y + 2, left - 9, rowHeight - 4);
    }
    context.fillStyle = track.color;
    context.fillRect(10, y + rowHeight / 2 - 13, 2, 26);
    context.fillStyle = selected ? "#e7e4dc" : "#9aa2ad";
    context.font = '700 10px "SFMono-Regular", "Cascadia Code", monospace';
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(track.name, 21, y + rowHeight / 2 - 7);
    context.fillStyle = "#515a67";
    context.font = '7px "SFMono-Regular", "Cascadia Code", monospace';
    context.fillText(
      `TRK 0${trackIndex + 1} · ${track.tune >= 0 ? "+" : ""}${track.tune}`,
      21,
      y + rowHeight / 2 + 8,
    );
    context.fillStyle = colorAlpha(track.color, 0.15);
    context.fillRect(21, y + rowHeight / 2 + 17, Math.max(2, (left - 35) * (track.gain / 1.5)), 2);
    context.restore();
  }

  drawStepCell(trackIndex, stepIndex, frame) {
    const context = this.context;
    const { left, top, rowHeight, columnWidth } = this.layout;
    const track = this.project.tracks[trackIndex];
    const step = track.steps[stepIndex];
    const gapX = columnWidth > 30 ? 4 : 2.5;
    const gapY = 7;
    const x = left + stepIndex * columnWidth + gapX;
    const y = top + trackIndex * rowHeight + gapY;
    const width = columnWidth - gapX * 2;
    const height = rowHeight - gapY * 2;
    const radius = Math.min(5, width * 0.16);
    const selected = trackIndex === this.selectedTrack && stepIndex === this.selectedStep;
    const current = frame.position.patternStep === stepIndex && frame.state !== "stopped";

    const flash = getFlash(
      frame.recentEvents,
      trackIndex,
      stepIndex,
      frame.audioTime,
    );

    context.save();
    roundedRect(context, x, y, width, height, radius);
    context.fillStyle = step.on ? colorAlpha(track.color, 0.1 + flash * 0.18) : "#11151b";
    context.fill();
    context.lineWidth = selected ? 1.4 : 1;
    context.strokeStyle = selected
      ? "rgba(235,239,242,0.88)"
      : step.on
        ? colorAlpha(track.color, 0.46 + flash * 0.3)
        : "#242b34";
    context.stroke();

    if (step.on) {
      const energy = Math.max(0.08, step.velocity / 127);
      const fillHeight = (height - 4) * energy;
      const gradient = context.createLinearGradient(0, y + height - fillHeight, 0, y + height);
      gradient.addColorStop(0, colorAlpha(track.color, 0.36 + flash * 0.22));
      gradient.addColorStop(1, colorAlpha(track.color, 0.04));
      roundedRect(context, x + 2, y + height - fillHeight - 2, width - 4, fillHeight, radius - 1);
      context.fillStyle = gradient;
      context.fill();

      context.fillStyle = colorAlpha(track.color, 0.9);
      roundedRect(context, x + 5, y + 6, Math.max(5, width * 0.2), 2, 1);
      context.fill();
      drawPanIndicator(context, x, y, width, height, step, track.color);
      context.fillStyle = "#87909d";
      context.font = '6px "SFMono-Regular", "Cascadia Code", monospace';
      context.textAlign = "right";
      context.textBaseline = "bottom";
      context.fillText(`${step.velocity}`, x + width - 4, y + height - 8);
      context.textAlign = "left";
      context.fillStyle = step.probability < 100 ? "#c2c8d0" : "#626b78";
      context.fillText(
        step.probability < 100 ? `P${step.probability}` : "P·",
        x + 4,
        y + height - 3,
      );
    } else {
      context.fillStyle = "#323a45";
      context.beginPath();
      context.arc(x + width / 2, y + height / 2, 1.6, 0, Math.PI * 2);
      context.fill();
    }

    if (flash > 0.02) {
      context.shadowColor = track.color;
      context.shadowBlur = 14 * flash;
      context.strokeStyle = colorAlpha(track.color, flash * 0.95);
      context.lineWidth = 1.5;
      roundedRect(context, x, y, width, height, radius);
      context.stroke();
    }

    if (current) {
      context.fillStyle = colorAlpha("#f3f0e8", 0.72);
      context.fillRect(x + width / 2 - 6, y + height - 2, 12, 2);
    }
    context.restore();
  }

  drawPlayhead(position) {
    if (!position || position.state === "stopped") {
      return;
    }
    const context = this.context;
    const { left, right, top, bottom, columnWidth } = this.layout;
    const withinBar = position.stepFloat % STEPS_PER_BAR;
    const x = left + withinBar * columnWidth;
    const gridBottom = this.height - bottom;
    context.save();
    const glow = context.createLinearGradient(x - columnWidth, 0, x + columnWidth, 0);
    glow.addColorStop(0, "rgba(255,106,61,0)");
    glow.addColorStop(0.5, "rgba(255,106,61,0.055)");
    glow.addColorStop(1, "rgba(255,106,61,0)");
    context.fillStyle = glow;
    context.fillRect(x - columnWidth, top - 16, columnWidth * 2, gridBottom - top + 16);
    context.strokeStyle = position.state === "paused" ? "#6b7481" : "#ff6a3d";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x + 0.5, top - 17);
    context.lineTo(x + 0.5, gridBottom);
    context.stroke();
    context.fillStyle = context.strokeStyle;
    context.beginPath();
    context.moveTo(x - 4, top - 20);
    context.lineTo(x + 5, top - 20);
    context.lineTo(x + 0.5, top - 14);
    context.closePath();
    context.fill();
    context.restore();
  }

  drawMeters(levels) {
    const context = this.meterContext;
    const width = this.meterWidth;
    const height = this.meterHeight;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0c0f14";
    context.fillRect(0, 0, width, height);

    const input = [
      levels.tracks?.[0] || 0,
      levels.tracks?.[1] || 0,
      levels.tracks?.[2] || 0,
      levels.tracks?.[3] || 0,
      levels.master || 0,
    ];
    for (let index = 0; index < this.smoothLevels.length; index += 1) {
      const target = input[index];
      const coefficient = target > this.smoothLevels[index] ? 0.58 : 0.14;
      this.smoothLevels[index] += (target - this.smoothLevels[index]) * coefficient;
      this.peakLevels[index] = Math.max(
        this.smoothLevels[index],
        this.peakLevels[index] - 0.0055,
      );
    }

    const labels = ["KICK", "SNARE", "HI-HAT", "PERC", "MASTER"];
    const colors = [
      this.project?.tracks?.[0]?.color || "#ff6a3d",
      this.project?.tracks?.[1]?.color || "#ffce5c",
      this.project?.tracks?.[2]?.color || "#6ee7bf",
      this.project?.tracks?.[3]?.color || "#8da8ff",
      "#f4f1e8",
    ];
    const leftPad = width < 620 ? 8 : 16;
    const rightPad = width < 620 ? 8 : 16;
    const available = width - leftPad - rightPad;
    const slotWidth = available / 5;

    context.strokeStyle = "#1d222b";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(leftPad, 4.5);
    context.lineTo(width - rightPad, 4.5);
    context.stroke();

    for (let index = 0; index < 5; index += 1) {
      const x = leftPad + index * slotWidth;
      const barX = x + 7;
      const barY = 24;
      const barWidth = Math.max(16, slotWidth - 54);
      const level = this.smoothLevels[index];
      const peak = this.peakLevels[index];

      context.font = '7px "SFMono-Regular", "Cascadia Code", monospace';
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillStyle = index === 4 ? "#89919d" : colors[index];
      context.fillText(labels[index], x + 7, 14);
      context.fillStyle = "#3c4450";
      context.textAlign = "right";
      context.fillText(meterDbLabel(level), x + slotWidth - 8, 14);

      context.fillStyle = "#171c23";
      context.fillRect(barX, barY, barWidth, 7);
      const segmentCount = Math.max(8, Math.floor(barWidth / 7));
      const segmentGap = 2;
      const segmentWidth = (barWidth - segmentGap * (segmentCount - 1)) / segmentCount;
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const threshold = (segment + 1) / segmentCount;
        const active = level >= threshold - 0.03;
        let color = colors[index];
        if (threshold > 0.8) {
          color = "#ff6a3d";
        } else if (threshold > 0.62) {
          color = "#ffce5c";
        }
        context.fillStyle = active ? colorAlpha(color, 0.88) : "#252b34";
        context.fillRect(
          barX + segment * (segmentWidth + segmentGap),
          barY,
          segmentWidth,
          7,
        );
      }

      const peakX = barX + clamp(peak, 0, 1) * barWidth;
      context.fillStyle = colorAlpha(colors[index], 0.9);
      context.fillRect(Math.max(barX, peakX - 1), barY + 9, 2, 2);

      context.fillStyle = "#242b34";
      context.fillRect(barX, barY + 13, barWidth * 0.62, 1);
      context.fillRect(barX + barWidth * 0.82, barY + 13, barWidth * 0.18, 1);
    }

    context.strokeStyle = "#1d222b";
    context.beginPath();
    context.moveTo(leftPad, height - 8.5);
    context.lineTo(width - rightPad, height - 8.5);
    context.stroke();
    context.fillStyle = "#353d49";
    context.font = '6px "SFMono-Regular", "Cascadia Code", monospace';
    context.textAlign = "left";
    context.fillText("LIVE LEVELS · PEAK HOLD", leftPad, height - 2);
    context.textAlign = "right";
    context.fillText("−48   −24   −12   −6   0 dBFS", width - rightPad, height - 2);
  }
}

function setCanvasSize(canvas, context, width, height, dpr) {
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawPanIndicator(context, x, y, width, height, step, color) {
  const panX = x + 6 + ((step.pan + 100) / 200) * (width - 12);
  context.strokeStyle = "rgba(160,169,181,0.23)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 6, y + height - 5.5);
  context.lineTo(x + width - 6, y + height - 5.5);
  context.stroke();
  context.fillStyle = colorAlpha(color, 0.95);
  context.fillRect(panX - 1, y + height - 7, 2, 3);
}

function getFlash(events, trackIndex, stepIndex, now) {
  let flash = 0;
  for (const event of events) {
    if (event.trackIndex === trackIndex && event.step === stepIndex) {
      const age = Math.max(0, now - event.time);
      flash = Math.max(flash, Math.max(0, 1 - age / 0.13));
    }
  }
  return flash;
}

function colorAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((character) => character + character).join("")
    : value;
  const number = Number.parseInt(normalized, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function meterDbLabel(level) {
  if (level <= 0.002) {
    return "−∞";
  }
  const db = 20 * Math.log10(level);
  return `${db > -0.5 ? "0" : db.toFixed(0)} dB`;
}
