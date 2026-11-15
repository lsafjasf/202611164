import { waveformPeaks } from "./drums.js";

const HANDLE_HIT = 16;

export class WaveformEditor {
  constructor(canvas, kit, handlers = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.kit = kit;
    this.onSelect = handlers.onSelect ?? (() => {});
    this.onCrop = handlers.onCrop ?? (() => {});
    this.project = null;
    this.selected = 0;
    this.drag = null;
    this.hover = null;
    this.energy = new Map();
    this.peaks = new Map();
    this.sourcePeaks = waveformPeaks(kit.source, 900);
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.frame = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());

    this.resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
    canvas.addEventListener("pointercancel", (event) => this.pointerUp(event));
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.canvas.style.cursor = "default";
      this.invalidate();
    });
  }

  setProject(project) {
    this.project = project;
    this.invalidate();
  }

  setSelected(index) {
    this.selected = index;
    this.invalidate();
  }

  setEnergy(trackId, value) {
    this.energy.set(trackId, value);
    this.invalidate();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.invalidate();
  }

  invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  geometry() {
    const left = 18;
    const right = this.width - 18;
    const sourceTop = 24;
    const sourceHeight = 74;
    const editTop = 126;
    const editBottom = this.height - 34;
    return {
      left,
      right,
      width: Math.max(1, right - left),
      sourceTop,
      sourceBottom: sourceTop + sourceHeight,
      editTop,
      editBottom,
      editHeight: Math.max(30, editBottom - editTop),
    };
  }

  draw() {
    if (!this.project || !this.width || !this.height) return;
    const context = this.context;
    const geometry = this.geometry();
    context.clearRect(0, 0, this.width, this.height);
    this.drawSource(context, geometry);
    this.drawEditor(context, geometry);
  }

  drawSource(context, geometry) {
    const trackIndex = this.selected;
    context.fillStyle = "#101318";
    roundedRect(context, geometry.left, geometry.sourceTop, geometry.width, 74, 10);
    context.fill();
    const laneWidth = geometry.width / 4;
    const peaks = this.sourcePeaks;

    this.kit.slices.forEach((slice, index) => {
      const track = this.project.tracks[index];
      const x = geometry.left + laneWidth * index;
      context.fillStyle =
        index === trackIndex ? `${track.color}24` : "rgba(255,255,255,0.018)";
      context.fillRect(x + 1, geometry.sourceTop + 1, laneWidth - 2, 72);
      context.strokeStyle = index === trackIndex ? track.color : "#293039";
      context.lineWidth = index === trackIndex ? 1.5 : 1;
      if (index > 0) {
        context.beginPath();
        context.moveTo(x, geometry.sourceTop + 8);
        context.lineTo(x, geometry.sourceBottom - 8);
        context.stroke();
      }

      const startBucket = Math.floor((index / 4) * peaks.length);
      const endBucket = Math.floor(((index + 1) / 4) * peaks.length);
      const center = geometry.sourceTop + 39;
      context.strokeStyle = index === trackIndex ? track.color : "#626b76";
      context.globalAlpha = index === trackIndex ? 0.92 : 0.52;
      context.lineWidth = 1.35;
      context.beginPath();
      const columns = Math.max(32, Math.floor(laneWidth - 20));
      for (let column = 0; column < columns; column += 1) {
        const bucket = Math.floor(
          startBucket + ((endBucket - startBucket) * column) / columns,
        );
        const amplitude = Math.max(1.2, peaks[bucket] * 25);
        const px = x + 10 + (column / columns) * (laneWidth - 20);
        context.moveTo(px, center - amplitude);
        context.lineTo(px, center + amplitude);
      }
      context.stroke();
      context.globalAlpha = 1;

      context.fillStyle = index === trackIndex ? track.color : "#7e8792";
      context.font = "600 9px 'DM Mono', monospace";
      context.fillText(`0${index + 1} ${slice.name}`, x + 11, geometry.sourceTop + 15);
      if (index === trackIndex) {
        context.fillStyle = "#f4f1e8";
        context.fillRect(x + 11, geometry.sourceTop + 62, 18, 2);
      }
    });

    context.fillStyle = "#737c87";
    context.font = "500 9px 'DM Mono', monospace";
    context.fillText("SYNTH SOURCE / 4 SLICES", geometry.left, 15);
    context.textAlign = "right";
    context.fillText(`${this.kit.duration.toFixed(2)} s`, geometry.right, 15);
    context.textAlign = "left";
  }

  drawEditor(context, geometry) {
    const track = this.project.tracks[this.selected];
    const slice = this.kit.slices[this.selected];
    const center = geometry.editTop + geometry.editHeight / 2;
    const intensity = this.energy.get(track.id) ?? 0;
    const peaks = this.getPeaks(slice, Math.floor(geometry.width * 1.5));
    const startX = geometry.left + track.start * geometry.width;
    const endX = geometry.left + track.end * geometry.width;

    const gradient = context.createLinearGradient(
      0,
      geometry.editTop,
      0,
      geometry.editBottom,
    );
    gradient.addColorStop(0, "#171b21");
    gradient.addColorStop(1, "#0c0f13");
    context.fillStyle = gradient;
    roundedRect(
      context,
      geometry.left,
      geometry.editTop,
      geometry.width,
      geometry.editHeight,
      10,
    );
    context.fill();

    context.strokeStyle = "rgba(255,255,255,0.055)";
    context.lineWidth = 1;
    for (let tick = 0; tick <= 10; tick += 1) {
      const x = geometry.left + (tick / 10) * geometry.width;
      context.beginPath();
      context.moveTo(x, geometry.editTop + 7);
      context.lineTo(x, geometry.editBottom - 7);
      context.stroke();
    }

    this.drawWaveform(context, geometry, peaks, center, track.color, 0.22);
    context.save();
    context.beginPath();
    context.rect(startX, geometry.editTop, Math.max(1, endX - startX), geometry.editHeight);
    context.clip();
    this.drawWaveform(context, geometry, peaks, center, track.color, 0.64 + intensity * 0.36);
    context.restore();

    context.fillStyle = "rgba(3,6,9,0.68)";
    context.fillRect(geometry.left, geometry.editTop, Math.max(0, startX - geometry.left), geometry.editHeight);
    context.fillRect(endX, geometry.editTop, Math.max(0, geometry.right - endX), geometry.editHeight);

    this.drawFadeEnvelope(context, geometry, track, startX, endX);

    context.strokeStyle = track.color;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(startX, geometry.editTop + 5);
    context.lineTo(startX, geometry.editBottom - 5);
    context.moveTo(endX, geometry.editTop + 5);
    context.lineTo(endX, geometry.editBottom - 5);
    context.stroke();
    this.drawHandle(context, startX, geometry.editTop + 14, track.color, "IN");
    this.drawHandle(context, endX, geometry.editTop + 14, track.color, "OUT");

    context.font = "500 9px 'DM Mono', monospace";
    context.fillStyle = "#6e7782";
    context.fillText("CROP / FADE ENVELOPE", geometry.left, geometry.editTop - 13);
    context.textAlign = "right";
    context.fillStyle = track.color;
    context.fillText(
      `${Math.round(track.start * slice.duration * 1000)} ms  →  ${Math.round(
        track.end * slice.duration * 1000,
      )} ms`,
      geometry.right,
      geometry.editTop - 13,
    );
    context.textAlign = "left";

    context.fillStyle = "#59626d";
    context.font = "500 8px 'DM Mono', monospace";
    context.fillText("0.0 s", geometry.left, geometry.editBottom + 15);
    context.textAlign = "right";
    context.fillText(`${slice.duration.toFixed(2)} s`, geometry.right, geometry.editBottom + 15);
    context.textAlign = "left";
  }

  drawWaveform(context, geometry, peaks, center, color, opacity) {
    context.strokeStyle = color;
    context.globalAlpha = opacity;
    context.lineWidth = 1.15;
    context.beginPath();
    const columns = Math.max(2, Math.floor(geometry.width));
    const amplitude = geometry.editHeight * 0.37;
    for (let column = 0; column < columns; column += 1) {
      const index = Math.min(
        peaks.length - 1,
        Math.floor((column / columns) * peaks.length),
      );
      const x = geometry.left + (column / columns) * geometry.width;
      const height = Math.max(0.8, peaks[index] * amplitude);
      context.moveTo(x, center - height);
      context.lineTo(x, center + height);
    }
    context.stroke();
    context.globalAlpha = 1;
  }

  drawFadeEnvelope(context, geometry, track, startX, endX) {
    const top = geometry.editTop + 12;
    const bottom = geometry.editBottom - 12;
    const duration = this.kit.slices[this.selected].duration;
    const fadeInX = startX + (track.fadeIn / duration) * geometry.width;
    const fadeOutX = endX - (track.fadeOut / duration) * geometry.width;
    context.strokeStyle = "rgba(255,255,255,0.8)";
    context.lineWidth = 1.1;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(startX, bottom);
    context.lineTo(Math.min(fadeInX, endX), top);
    context.lineTo(Math.max(fadeOutX, startX), top);
    context.lineTo(endX, bottom);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = `${this.project.tracks[this.selected].color}12`;
    context.beginPath();
    context.moveTo(startX, bottom);
    context.lineTo(Math.min(fadeInX, endX), top);
    context.lineTo(Math.min(fadeInX, endX), bottom);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(Math.max(fadeOutX, startX), top);
    context.lineTo(endX, bottom);
    context.lineTo(Math.max(fadeOutX, startX), bottom);
    context.closePath();
    context.fill();
  }

  drawHandle(context, x, y, color, label) {
    context.fillStyle = color;
    roundedRect(context, x - 13, y - 8, 26, 16, 5);
    context.fill();
    context.fillStyle = "#0b0d10";
    context.font = "700 7px 'DM Mono', monospace";
    context.textAlign = "center";
    context.fillText(label, x, y + 2.5);
    context.textAlign = "left";
  }

  getPeaks(slice, count) {
    const bucketCount = Math.max(120, Math.min(1200, Math.round(count / 50) * 50));
    if (!this.peaks.has(slice.id)) {
      this.peaks.set(slice.id, waveformPeaks(slice.data, 1200));
    }
    const source = this.peaks.get(slice.id);
    if (bucketCount === source.length) return source;
    const sampled = new Float32Array(bucketCount);
    for (let index = 0; index < bucketCount; index += 1) {
      sampled[index] = source[Math.floor((index / bucketCount) * source.length)];
    }
    return sampled;
  }

  pointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  pointerDown(event) {
    if (!this.project) return;
    const point = this.pointerPosition(event);
    const geometry = this.geometry();
    if (point.y >= geometry.sourceTop && point.y <= geometry.sourceBottom) {
      const index = Math.max(
        0,
        Math.min(3, Math.floor((point.x - geometry.left) / (geometry.width / 4))),
      );
      this.setSelected(index);
      this.onSelect(index);
      return;
    }
    if (point.y < geometry.editTop || point.y > geometry.editBottom) return;
    const track = this.project.tracks[this.selected];
    const startX = geometry.left + track.start * geometry.width;
    const endX = geometry.left + track.end * geometry.width;
    const startDistance = Math.abs(point.x - startX);
    const endDistance = Math.abs(point.x - endX);
    if (Math.min(startDistance, endDistance) <= HANDLE_HIT) {
      this.drag = startDistance <= endDistance ? "start" : "end";
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.style.cursor = "ew-resize";
    }
  }

  pointerMove(event) {
    if (!this.project) return;
    const point = this.pointerPosition(event);
    const geometry = this.geometry();
    const track = this.project.tracks[this.selected];
    if (this.drag) {
      const normalized = Math.max(
        0,
        Math.min(1, (point.x - geometry.left) / geometry.width),
      );
      if (this.drag === "start") {
        track.start = Math.min(normalized, track.end - 0.02);
      } else {
        track.end = Math.max(normalized, track.start + 0.02);
      }
      track.start = Number(track.start.toFixed(4));
      track.end = Number(track.end.toFixed(4));
      this.onCrop(track);
      this.invalidate();
      return;
    }
    const startX = geometry.left + track.start * geometry.width;
    const endX = geometry.left + track.end * geometry.width;
    const near =
      point.y >= geometry.editTop &&
      point.y <= geometry.editBottom &&
      Math.min(Math.abs(point.x - startX), Math.abs(point.x - endX)) <= HANDLE_HIT;
    this.canvas.style.cursor = near ? "ew-resize" : "default";
  }

  pointerUp(event) {
    if (!this.drag) return;
    this.drag = null;
    this.canvas.style.cursor = "default";
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const clamped = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + clamped, y);
  context.arcTo(x + width, y, x + width, y + height, clamped);
  context.arcTo(x + width, y + height, x, y + height, clamped);
  context.arcTo(x, y + height, x, y, clamped);
  context.arcTo(x, y, x + width, y, clamped);
  context.closePath();
}
