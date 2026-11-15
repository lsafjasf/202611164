import { CHART_BEATS, DIFFICULTIES, LANES } from "./config.js";

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.session = null;
    this.project = null;
    this.pulses = [];
    this.particles = [];
    this.lastTime = performance.now();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setSession(session) {
    this.session = session;
    this.project = session.project;
  }

  setProject(project) {
    this.project = project;
  }

  flashLane(laneId, grade) {
    const laneIndex = LANES.findIndex((lane) => lane.id === laneId);
    if (laneIndex < 0) return;
    this.pulses.push({ laneIndex, grade, start: performance.now() });
    const geometry = this.getGeometry();
    const lane = geometry.laneCenters[laneIndex];
    const count = grade === "perfect" ? 12 : grade === "miss" ? 3 : 7;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5;
      const speed = 35 + Math.random() * 85;
      this.particles.push({
        x: lane,
        y: geometry.judgeY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 25,
        life: 1,
        color: LANES[laneIndex].color
      });
    }
  }

  getGeometry() {
    const sidePadding = Math.max(24, this.width * 0.065);
    const laneAreaWidth = Math.min(this.width - sidePadding * 2, 660);
    const laneWidth = laneAreaWidth / 4;
    const left = (this.width - laneAreaWidth) / 2;
    const judgeY = this.height * 0.79;
    return {
      left,
      laneWidth,
      laneAreaWidth,
      judgeY,
      top: 24,
      laneCenters: LANES.map((_, index) => left + laneWidth * (index + 0.5))
    };
  }

  render(now = performance.now()) {
    const ctx = this.ctx;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.session || !this.project) return;

    const position = this.session.currentPosition();
    const geometry = this.getGeometry();
    this.drawStage(position, geometry, now);
    this.drawLanes(position, geometry);
    this.drawNotes(position, geometry);
    this.drawJudgeLine(position, geometry, now);
    this.drawKeyDeck(position, geometry);
    this.drawFrameDetails(position, geometry);
    this.drawParticles(dt);
  }

  drawStage(position, geometry, now) {
    const ctx = this.ctx;
    const bg = ctx.createLinearGradient(0, 0, 0, this.height);
    bg.addColorStop(0, "#0b0e18");
    bg.addColorStop(0.55, "#090b13");
    bg.addColorStop(1, "#070910");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    const halo = ctx.createRadialGradient(
      this.width / 2,
      geometry.judgeY,
      10,
      this.width / 2,
      geometry.judgeY,
      geometry.laneAreaWidth * 0.8
    );
    halo.addColorStop(0, "rgba(77, 100, 150, 0.10)");
    halo.addColorStop(0.5, "rgba(45, 52, 90, 0.04)");
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    const horizon = geometry.judgeY;
    for (let line = 0; line < 11; line += 1) {
      const y = 26 + (line / 10) * (horizon - 40);
      ctx.beginPath();
      ctx.moveTo(geometry.left - 70, y);
      ctx.lineTo(geometry.left + geometry.laneAreaWidth + 70, y);
      ctx.stroke();
    }
    for (let column = -8; column <= 8; column += 1) {
      const x = this.width / 2 + column * 72;
      ctx.beginPath();
      ctx.moveTo(this.width / 2 + column * 10, 28);
      ctx.lineTo(x, horizon - 24);
      ctx.stroke();
    }
    ctx.restore();

    const beat = ((position.localBeat % 1) + 1) % 1;
    const pulse = Math.max(0, 1 - beat * 4);
    if (pulse > 0) {
      const sweep = ctx.createLinearGradient(0, 0, 0, this.height);
      sweep.addColorStop(0, "rgba(255,255,255,0)");
      sweep.addColorStop(0.75, `rgba(255,255,255,${pulse * 0.018})`);
      sweep.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sweep;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  drawLanes(position, geometry) {
    const ctx = this.ctx;
    for (let index = 0; index < LANES.length; index += 1) {
      const lane = LANES[index];
      const x = geometry.left + index * geometry.laneWidth;
      const laneGradient = ctx.createLinearGradient(0, 0, 0, geometry.judgeY);
      laneGradient.addColorStop(0, hexToRgba(lane.color, 0.01));
      laneGradient.addColorStop(0.76, hexToRgba(lane.color, 0.035));
      laneGradient.addColorStop(1, hexToRgba(lane.color, 0.075));
      ctx.fillStyle = laneGradient;
      ctx.fillRect(x + 1, 0, geometry.laneWidth - 2, geometry.judgeY + 20);

      if (index > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.075)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 20);
        ctx.lineTo(x, geometry.judgeY + 20);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    ctx.beginPath();
    ctx.moveTo(geometry.left + geometry.laneAreaWidth, 20);
    ctx.lineTo(geometry.left + geometry.laneAreaWidth, geometry.judgeY + 20);
    ctx.stroke();

    const activeLanes = this.session.audio.mix;
    for (let index = 0; index < LANES.length; index += 1) {
      const x = geometry.left + index * geometry.laneWidth;
      const settings = activeLanes.get(LANES[index].id);
      const channelAlpha = 0.025 + settings.gain * 0.04;
      ctx.fillStyle = hexToRgba(LANES[index].color, channelAlpha);
      ctx.fillRect(x + 1, 20, geometry.laneWidth - 2, geometry.judgeY - 20);
    }
  }

  drawNotes(position, geometry) {
    const ctx = this.ctx;
    const difficulty = DIFFICULTIES[this.project.difficulty];
    const travel = difficulty.travelSeconds / this.project.speed;
    const beatTravel = travel / (60 / this.project.bpm);
    const visibleTop = 12;
    const judged = this.session.judged;
    const cycle = position.cycle;

    for (const note of this.session.chart.notes) {
      let deltaBeat = note.beat - position.localBeat;
      let noteCycle = cycle;
      if (deltaBeat < -CHART_BEATS / 2) {
        deltaBeat += CHART_BEATS;
        noteCycle += 1;
      } else if (deltaBeat > CHART_BEATS / 2) {
        deltaBeat -= CHART_BEATS;
        noteCycle -= 1;
      }
      if (deltaBeat > beatTravel || deltaBeat < -beatTravel * 0.38) continue;
      if (judged.has(`${noteCycle}:${note.id}`)) continue;

      const lane = LANES[note.lane];
      const x = geometry.laneCenters[note.lane];
      const y = geometry.judgeY - (deltaBeat / beatTravel) * (geometry.judgeY - visibleTop);
      const noteWidth = geometry.laneWidth * 0.72;
      const noteHeight = 13;
      const proximity = Math.max(0, 1 - Math.abs(deltaBeat) / 2);

      ctx.save();
      ctx.shadowColor = lane.color;
      ctx.shadowBlur = 9 + proximity * 16;
      const body = ctx.createLinearGradient(x, y - noteHeight / 2, x, y + noteHeight / 2);
      body.addColorStop(0, "#f7f8f3");
      body.addColorStop(0.12, lane.color);
      body.addColorStop(0.88, lane.color);
      body.addColorStop(1, hexToRgba(lane.color, 0.55));
      ctx.fillStyle = body;
      roundedRect(ctx, x - noteWidth / 2, y - noteHeight / 2, noteWidth, noteHeight, 4);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(6, 8, 14, 0.68)";
      const tickWidth = Math.max(7, noteWidth * 0.11);
      roundedRect(ctx, x - tickWidth / 2, y - 4, tickWidth, 8, 1);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillRect(x - noteWidth * 0.28, y - 1, noteWidth * 0.1, 2);
      ctx.restore();
    }
  }

  drawJudgeLine(position, geometry, now) {
    const ctx = this.ctx;
    const beatFraction = ((position.localBeat % 1) + 1) % 1;
    const pulse = Math.max(0, 1 - beatFraction * 3.4);
    const lineGlow = ctx.createLinearGradient(
      geometry.left,
      0,
      geometry.left + geometry.laneAreaWidth,
      0
    );
    lineGlow.addColorStop(0, "rgba(255,255,255,0.08)");
    lineGlow.addColorStop(0.2, "rgba(216,255,62,0.72)");
    lineGlow.addColorStop(0.5, "rgba(255,255,255,0.95)");
    lineGlow.addColorStop(0.8, "rgba(216,255,62,0.72)");
    lineGlow.addColorStop(1, "rgba(255,255,255,0.08)");

    ctx.save();
    ctx.shadowColor = "rgba(216,255,62,0.6)";
    ctx.shadowBlur = 10 + pulse * 15;
    ctx.strokeStyle = lineGlow;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(geometry.left - 15, geometry.judgeY);
    ctx.lineTo(geometry.left + geometry.laneAreaWidth + 15, geometry.judgeY);
    ctx.stroke();
    ctx.restore();

    for (let index = 0; index < LANES.length; index += 1) {
      const x = geometry.laneCenters[index];
      const isPulse = this.pulses.some((item) => (
        item.laneIndex === index && now - item.start < 180
      ));
      ctx.save();
      ctx.strokeStyle = hexToRgba(LANES[index].color, isPulse ? 0.9 : 0.28);
      ctx.shadowColor = LANES[index].color;
      ctx.shadowBlur = isPulse ? 22 : 0;
      ctx.lineWidth = isPulse ? 2.2 : 1;
      ctx.beginPath();
      ctx.moveTo(x - geometry.laneWidth * 0.35, geometry.judgeY);
      ctx.lineTo(x + geometry.laneWidth * 0.35, geometry.judgeY);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "rgba(216,255,62,0.58)";
    ctx.font = "8px 'DM Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText("JUDGE", geometry.left - 9, geometry.judgeY + 3);
    ctx.textAlign = "left";
    ctx.fillText("0.00", geometry.left + geometry.laneAreaWidth + 9, geometry.judgeY + 3);
    ctx.restore();
  }

  drawKeyDeck(position, geometry) {
    const ctx = this.ctx;
    const y = geometry.judgeY + 32;
    const height = Math.min(65, this.height - y - 16);
    if (height < 25) return;

    for (let index = 0; index < LANES.length; index += 1) {
      const lane = LANES[index];
      const x = geometry.left + geometry.laneWidth * index + 4;
      const width = geometry.laneWidth - 8;
      const pulse = this.pulses.find((item) => (
        item.laneIndex === index && performance.now() - item.start < 220
      ));
      const alpha = pulse ? 0.95 : 0.42;

      ctx.fillStyle = pulse
        ? hexToRgba(lane.color, 0.18)
        : "rgba(255,255,255,0.018)";
      roundedRect(ctx, x, y, width, height, 5);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(lane.color, alpha);
      ctx.lineWidth = pulse ? 1.5 : 1;
      roundedRect(ctx, x, y, width, height, 5);
      ctx.stroke();

      const keySize = Math.min(22, height - 26);
      ctx.fillStyle = pulse ? lane.color : "rgba(255,255,255,0.04)";
      roundedRect(
        ctx,
        x + width / 2 - keySize / 2,
        y + 8,
        keySize,
        keySize,
        4
      );
      ctx.fill();
      ctx.strokeStyle = hexToRgba(lane.color, 0.45);
      ctx.stroke();
      ctx.fillStyle = pulse ? "#080a10" : lane.color;
      ctx.font = `500 10px 'DM Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lane.key.toUpperCase(), x + width / 2, y + 8 + keySize / 2);

      if (height > 48) {
        ctx.fillStyle = "rgba(190,193,207,0.46)";
        ctx.font = "7px 'DM Mono', monospace";
        ctx.fillText(lane.instrument, x + width / 2, y + height - 10);
      }
    }
    ctx.textBaseline = "alphabetic";
  }

  drawFrameDetails(position, geometry) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(155,160,180,0.52)";
    ctx.font = "8px 'DM Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      `${this.project.difficulty.toUpperCase()} / ${this.project.bpm} BPM`,
      24,
      28
    );
    ctx.fillText(`BAR ${String(Math.floor(position.localBeat / 4) + 1).padStart(2, "0")}`, 24, 41);
    ctx.textAlign = "right";
    ctx.fillText(
      `${Math.round(this.session.liveAccuracy)}% ACC`,
      this.width - 24,
      28
    );
    ctx.fillText(
      `${this.project.loop ? "LOOP ON" : "ONE SHOT"} · ${this.project.speed.toFixed(1)}×`,
      this.width - 24,
      41
    );

    const barWidth = 54;
    for (let index = 0; index < 4; index += 1) {
      const x = this.width - 24 - (3 - index) * (barWidth + 3);
      const beatInBar = Math.floor(position.localBeat) % 4;
      const active = beatInBar === index;
      ctx.fillStyle = active ? "rgba(216,255,62,0.9)" : "rgba(255,255,255,0.08)";
      ctx.fillRect(x, 50, barWidth, active ? 2 : 1);
    }
    ctx.restore();
  }

  drawParticles(dt) {
    const ctx = this.ctx;
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 80 * dt;
      particle.life -= dt * 2.4;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, 2, 2);
    }
    ctx.globalAlpha = 1;
    this.pulses = this.pulses.filter((pulse) => performance.now() - pulse.start < 400);
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
