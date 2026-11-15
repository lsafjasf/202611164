import { trackWaveform } from "./notes.js";
import { trackAudibility, trackEnvelopeAt } from "./project.js";
import { secondsPerBeat } from "./transport.js";

const COLORS = {
  ink: "#f4f4ef",
  muted: "#8a8f99",
  grid: "rgba(255,255,255,0.075)",
  gridStrong: "rgba(255,255,255,0.16)",
  panel: "rgba(15,18,24,0.74)",
  row: "rgba(255,255,255,0.026)",
  playhead: "#f5f7e8",
  automation: "#f2e07a"
};

export class TimelineRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.project = null;
    this.selectedId = null;
    this.position = 0;
    this.playing = false;
    this.waveCache = new Map();
    this.notes = [];
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.left = 138;
    this.right = 20;
    this.top = 54;
    this.rowHeight = 92;
    this.bottom = 18;
    this.dropPreview = null;
    this.hover = null;
  }

  setProject(project, notes) {
    const revisionChanged = this.project?.revision !== project.revision;
    this.project = project;
    this.notes = notes;
    this.notesByTrack = new Map(project.tracks.map((track) => [
      track.id,
      notes.filter((note) => note.trackId === track.id)
    ]));
    if (revisionChanged) this.waveCache.clear();
  }

  setSelected(id) {
    this.selectedId = id;
  }

  setPlayback(position, playing) {
    this.position = position;
    this.playing = playing;
  }

  setDropPreview(preview) {
    this.dropPreview = preview;
  }

  setHover(hover) {
    this.hover = hover;
  }

  resize() {
    if (!this.project) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const wantedHeight = this.top + this.project.tracks.length * this.rowHeight + this.bottom;
    this.width = Math.max(660, rect.width);
    this.height = wantedHeight;
    this.canvas.style.height = `${wantedHeight}px`;
    const pixelWidth = Math.round(this.width * this.dpr);
    const pixelHeight = Math.round(this.height * this.dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
  }

  get timelineWidth() {
    return this.width - this.left - this.right;
  }

  timeToX(time) {
    return this.left + (time / this.project.length) * this.timelineWidth;
  }

  xToTime(x) {
    return Math.max(0, Math.min(this.project.length, ((x - this.left) / this.timelineWidth) * this.project.length));
  }

  rows() {
    return this.project.tracks.map((track, index) => ({
      track,
      index,
      y: this.top + index * this.rowHeight,
      height: this.rowHeight
    }));
  }

  clipRect(track) {
    const row = this.rows().find((item) => item.track.id === track.id);
    if (!row) return null;
    const x = this.timeToX(track.start);
    const end = this.timeToX(track.start + track.duration);
    return { x, y: row.y + 10, width: Math.max(4, end - x), height: row.height - 18, row };
  }

  automationY(track, value) {
    const row = this.rows().find((item) => item.track.id === track.id);
    return row.y + row.height - 12 - (Math.max(0, Math.min(1.5, value)) / 1.5) * 29;
  }

  automationValueFromY(track, y) {
    const row = this.rows().find((item) => item.track.id === track.id);
    return Math.max(0, Math.min(1.5, ((row.y + row.height - 12 - y) / 29) * 1.5));
  }

  pointRect(track, point) {
    return {
      x: this.timeToX(track.start + point.time),
      y: this.automationY(track, point.value)
    };
  }

  hitTest(clientX, clientY) {
    if (!this.project) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (y < this.top) return { kind: "ruler", time: this.xToTime(x) };
    for (const row of this.rows()) {
      if (y < row.y || y > row.y + row.height) continue;
      const track = row.track;
      const clip = this.clipRect(track);
      if (x < clip.x || x > clip.x + clip.width) return { kind: "track", track, row };
      for (let pointIndex = 0; pointIndex < track.automation.length; pointIndex += 1) {
        const point = track.automation[pointIndex];
        const pointPosition = this.pointRect(track, point);
        if (Math.hypot(x - pointPosition.x, y - pointPosition.y) <= 10) {
          return { kind: "automation", track, point, pointIndex, row };
        }
      }
      if (Math.abs(x - clip.x) <= 9 && Math.abs(y - (clip.y + 9)) <= 12) {
        return { kind: "fadeIn", track, row };
      }
      if (Math.abs(x - (clip.x + clip.width)) <= 9 && Math.abs(y - (clip.y + 9)) <= 12) {
        return { kind: "fadeOut", track, row };
      }
      if (x > clip.x + clip.width - 10) return { kind: "resize", track, row };
      return { kind: "clip", track, row, offset: this.xToTime(x) - track.start };
    }
    return null;
  }

  waveform(track) {
    const key = `${this.project.revision}:${track.id}:${track.start}:${track.duration}:${this.project.bpm}`;
    if (!this.waveCache.has(key)) {
      this.waveCache.set(key, trackWaveform(track, this.project, 300));
      if (this.waveCache.size > 18) this.waveCache.delete(this.waveCache.keys().next().value);
    }
    return this.waveCache.get(key);
  }

  draw() {
    if (!this.project) return;
    this.resize();
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground(ctx);
    this.drawRuler(ctx);
    for (const row of this.rows()) this.drawRow(ctx, row);
    this.drawDropPreview(ctx);
    this.drawPlayhead(ctx);
  }

  drawBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, "#12161d");
    gradient.addColorStop(0.58, "#0e1218");
    gradient.addColorStop(1, "#17191d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawRuler(ctx) {
    const beatSeconds = secondsPerBeat(this.project.bpm);
    const beatCount = Math.ceil(this.project.length / beatSeconds);
    ctx.fillStyle = "rgba(255,255,255,0.024)";
    ctx.fillRect(0, 0, this.width, this.top);
    for (let beat = 0; beat <= beatCount; beat += 1) {
      const time = beat * beatSeconds;
      if (time > this.project.length + 1e-7) break;
      const x = this.timeToX(time);
      const bar = beat % 4 === 0;
      ctx.strokeStyle = bar ? COLORS.gridStrong : COLORS.grid;
      ctx.lineWidth = bar ? 1.2 : 0.75;
      ctx.beginPath();
      ctx.moveTo(x, bar ? 20 : 33);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    ctx.font = "500 10px 'DM Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.muted;
    for (let second = 0; second <= this.project.length; second += 2) {
      const x = this.timeToX(second);
      ctx.fillStyle = second % 4 === 0 ? "#b7bbc1" : COLORS.muted;
      ctx.fillText(`${second}s`, x, 15);
      ctx.fillRect(x - 0.5, 20, 1, 7);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "#d9dbd4";
    ctx.font = "600 11px 'DM Mono', ui-monospace, monospace";
    ctx.fillText("20 SEC / 40 BEATS", 16, 35);
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`${this.project.bpm} BPM`, this.width - 20, 35);
  }

  drawRow(ctx, row) {
    const { track, y, height } = row;
    const selected = track.id === this.selectedId;
    ctx.fillStyle = row.index % 2 ? "rgba(255,255,255,0.018)" : COLORS.row;
    ctx.fillRect(0, y, this.width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.065)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + height - 0.5);
    ctx.lineTo(this.width, y + height - 0.5);
    ctx.stroke();
    this.drawTrackLabel(ctx, row);
    const clip = this.clipRect(track);
    this.drawClip(ctx, row, clip);
    if (selected) {
      ctx.strokeStyle = `${track.color}aa`;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(clip.x + 0.5, clip.y + 0.5, clip.width - 1, clip.height - 1);
    }
  }

  drawTrackLabel(ctx, row) {
    const { track, y, height } = row;
    const selected = track.id === this.selectedId;
    ctx.fillStyle = selected ? "rgba(255,255,255,0.055)" : "transparent";
    ctx.fillRect(0, y, this.left - 10, height - 1);
    ctx.fillStyle = track.color;
    ctx.beginPath();
    ctx.arc(20, y + 27, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "600 15px 'Noto Sans SC', system-ui, sans-serif";
    ctx.fillStyle = selected ? COLORS.ink : "#d6d7d2";
    ctx.textAlign = "left";
    ctx.fillText(track.name, 34, y + 31);
    ctx.font = "500 9px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(track.type.toUpperCase(), 34, y + 46);
    const level = Math.min(
      1,
      trackEnvelopeAt(track, this.position) * trackAudibility(this.project, track)
    );
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.fillRect(16, y + 62, this.left - 36, 3);
    ctx.fillStyle = track.color;
    ctx.fillRect(16, y + 62, (this.left - 36) * level, 3);
    ctx.font = "500 10px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.fillText(`${track.gain.toFixed(2)}`, this.left - 20, y + 81);
    ctx.textAlign = "left";
  }

  drawClip(ctx, row, clip) {
    const { track } = row;
    this.roundedPath(ctx, clip.x, clip.y, clip.width, clip.height, 8);
    const background = ctx.createLinearGradient(clip.x, clip.y, clip.x, clip.y + clip.height);
    background.addColorStop(0, `${track.color}2d`);
    background.addColorStop(1, `${track.color}10`);
    ctx.fillStyle = background;
    ctx.fill();
    ctx.strokeStyle = `${track.color}70`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    this.roundedPath(ctx, clip.x, clip.y, clip.width, clip.height, 8);
    ctx.clip();
    this.drawWaveform(ctx, row, clip);
    this.drawNotes(ctx, row, clip);
    this.drawFades(ctx, row, clip);
    this.drawAutomation(ctx, row, clip);
    ctx.restore();
    this.drawHandles(ctx, row, clip);
    ctx.font = "600 9px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = `${track.color}dd`;
    ctx.textAlign = "left";
    ctx.fillText(track.id.toUpperCase(), clip.x + 10, clip.y + 14);
    if (this.project.tracks.some((candidate) => candidate.solo) && track.solo) {
      ctx.fillStyle = "#f2e07a";
      ctx.textAlign = "right";
      ctx.fillText("SOLO", clip.x + clip.width - 10, clip.y + 14);
    }
  }

  drawWaveform(ctx, row, clip) {
    const { track } = row;
    const waveform = this.waveform(track);
    const center = clip.y + clip.height * 0.49;
    const amplitude = clip.height * 0.27;
    ctx.beginPath();
    for (let index = 0; index < waveform.length; index += 1) {
      const x = clip.x + (index / (waveform.length - 1)) * clip.width;
      ctx.lineTo(x, center - waveform[index] * amplitude);
    }
    for (let index = waveform.length - 1; index >= 0; index -= 1) {
      const x = clip.x + (index / (waveform.length - 1)) * clip.width;
      ctx.lineTo(x, center + waveform[index] * amplitude * 0.72);
    }
    ctx.closePath();
    const waveGradient = ctx.createLinearGradient(clip.x, 0, clip.x + clip.width, 0);
    waveGradient.addColorStop(0, `${track.color}2c`);
    waveGradient.addColorStop(0.5, `${track.color}96`);
    waveGradient.addColorStop(1, `${track.color}36`);
    ctx.fillStyle = waveGradient;
    ctx.fill();
    ctx.strokeStyle = `${track.color}80`;
    ctx.lineWidth = 0.65;
    ctx.stroke();
    ctx.strokeStyle = `${track.color}36`;
    ctx.beginPath();
    ctx.moveTo(clip.x, center);
    ctx.lineTo(clip.x + clip.width, center);
    ctx.stroke();
  }

  drawNotes(ctx, row, clip) {
    const { track } = row;
    const notes = this.notesByTrack.get(track.id) || [];
    const beatSeconds = secondsPerBeat(this.project.bpm);
    const selected = track.id === this.selectedId;
    for (const note of notes) {
      const x = this.timeToX(note.time);
      if (x < clip.x - 3 || x > clip.x + clip.width + 3) continue;
      const pitch = Math.max(0, Math.min(1, (note.pitch + 24) / 64));
      const y = clip.y + clip.height * 0.74 - pitch * clip.height * 0.35;
      const active = Math.abs(this.position - note.time) < beatSeconds * 0.16;
      ctx.strokeStyle = active ? "#ffffff" : `${track.color}${selected ? "c0" : "72"}`;
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 2.5);
      ctx.lineTo(x, y + 2.5);
      ctx.stroke();
      if (active) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawFades(ctx, row, clip) {
    const { track } = row;
    const fadeInWidth = (track.fadeIn / track.duration) * clip.width;
    const fadeOutWidth = (track.fadeOut / track.duration) * clip.width;
    if (fadeInWidth > 0) {
      const gradient = ctx.createLinearGradient(clip.x, 0, clip.x + fadeInWidth, 0);
      gradient.addColorStop(0, "rgba(5,7,10,0.52)");
      gradient.addColorStop(1, "rgba(5,7,10,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(clip.x, clip.y, fadeInWidth, clip.height);
      ctx.strokeStyle = "rgba(255,255,255,0.24)";
      ctx.beginPath();
      ctx.moveTo(clip.x, clip.y + 4);
      ctx.lineTo(clip.x + fadeInWidth, clip.y + clip.height);
      ctx.stroke();
    }
    if (fadeOutWidth > 0) {
      const x = clip.x + clip.width - fadeOutWidth;
      const gradient = ctx.createLinearGradient(x, 0, x + fadeOutWidth, 0);
      gradient.addColorStop(0, "rgba(5,7,10,0)");
      gradient.addColorStop(1, "rgba(5,7,10,0.52)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, clip.y, fadeOutWidth, clip.height);
      ctx.strokeStyle = "rgba(255,255,255,0.24)";
      ctx.beginPath();
      ctx.moveTo(x, clip.y + clip.height);
      ctx.lineTo(x + fadeOutWidth, clip.y + 4);
      ctx.stroke();
    }
  }

  drawAutomation(ctx, row, clip) {
    const { track } = row;
    const selected = track.id === this.selectedId;
    ctx.beginPath();
    track.automation.forEach((point, index) => {
      const x = this.timeToX(track.start + point.time);
      const y = this.automationY(track, point.value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = selected ? "rgba(242,224,122,0.86)" : "rgba(242,224,122,0.25)";
    ctx.lineWidth = selected ? 1.4 : 0.8;
    ctx.stroke();
    for (const point of track.automation) {
      const position = this.pointRect(track, point);
      if (position.x < clip.x - 1 || position.x > clip.x + clip.width + 1) continue;
      ctx.fillStyle = "#11151a";
      ctx.strokeStyle = selected ? COLORS.automation : "rgba(242,224,122,0.44)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(position.x, position.y, selected ? 4.2 : 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawHandles(ctx, row, clip) {
    if (row.track.id !== this.selectedId) return;
    const { track } = row;
    const y = clip.y + 9;
    for (const [x, color] of [
      [clip.x, track.color],
      [clip.x + clip.width, track.color]
    ]) {
      ctx.fillStyle = "#11151a";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawDropPreview(ctx) {
    if (!this.dropPreview) return;
    const row = this.rows().find((item) => item.track.id === this.dropPreview.trackId);
    if (!row) return;
    const x = this.timeToX(this.dropPreview.time);
    ctx.fillStyle = `${row.track.color}22`;
    ctx.strokeStyle = `${row.track.color}aa`;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(x, row.y + 10, 86, row.height - 18);
    ctx.strokeRect(x + 0.5, row.y + 10.5, 85, row.height - 19);
    ctx.setLineDash([]);
  }

  drawPlayhead(ctx) {
    const x = this.timeToX(this.position);
    const beatSeconds = secondsPerBeat(this.project.bpm);
    const beatPhase = (this.position % beatSeconds) / beatSeconds;
    if (this.playing) {
      ctx.fillStyle = `rgba(245,247,232,${0.018 + (1 - beatPhase) * 0.022})`;
      ctx.fillRect(x - 18, this.top, 36, this.height - this.top);
    }
    ctx.strokeStyle = COLORS.playhead;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 22);
    ctx.lineTo(x + 0.5, this.height);
    ctx.stroke();
    ctx.fillStyle = COLORS.playhead;
    ctx.beginPath();
    ctx.moveTo(x - 5, 20);
    ctx.lineTo(x + 5, 20);
    ctx.lineTo(x, 27);
    ctx.closePath();
    ctx.fill();
    ctx.font = "500 10px 'DM Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    const label = `${this.position.toFixed(2)}s`;
    const labelWidth = ctx.measureText(label).width + 10;
    ctx.fillStyle = "#eceee4";
    this.roundedPath(ctx, x - labelWidth / 2, 4, labelWidth, 13, 4);
    ctx.fill();
    ctx.fillStyle = "#15191f";
    ctx.fillText(label, x, 13.5);
    ctx.textAlign = "left";
  }

  roundedPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
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
}
