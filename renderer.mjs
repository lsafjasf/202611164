import { mulberry32 } from "./case-engine.mjs";

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height, ratio };
}

export class CanvasWorld {
  constructor(iceCanvas, scopeCanvas) {
    this.iceCanvas = iceCanvas;
    this.scopeCanvas = scopeCanvas;
    this.terrain = null;
    this.snow = [];
    this.lastCase = null;
  }

  setCase(caseData) {
    if (this.lastCase?.signature === caseData.signature) return;
    this.lastCase = caseData;
    const random = mulberry32(caseData.seedHash ^ 0xc1a5);
    const ridges = [];
    const cracks = [];
    for (let index = 0; index < 22; index += 1) {
      const startX = random();
      const startY = random() * 1.2 - 0.1;
      const length = 0.1 + random() * 0.45;
      const points = [];
      for (let step = 0; step < 5; step += 1) {
        points.push({
          x: startX + length * (step / 4),
          y: startY + (random() - 0.5) * 0.08 + Math.sin(step) * 0.025
        });
      }
      ridges.push({ points, width: 0.5 + random() * 1.7, alpha: 0.04 + random() * 0.1 });
    }
    for (let index = 0; index < 19; index += 1) {
      const startX = random();
      const startY = random();
      const points = [{ x: startX, y: startY }];
      let angle = random() * Math.PI * 2;
      for (let step = 0; step < 4 + Math.floor(random() * 5); step += 1) {
        angle += (random() - 0.5) * 0.7;
        const previous = points[points.length - 1];
        points.push({
          x: previous.x + Math.cos(angle) * (0.018 + random() * 0.03),
          y: previous.y + Math.sin(angle) * (0.018 + random() * 0.03)
        });
      }
      cracks.push({ points, alpha: 0.05 + random() * 0.11 });
    }
    this.snow = Array.from({ length: 115 }, () => ({
      x: random(),
      y: random(),
      size: 0.4 + random() * 1.7,
      speed: 9 + random() * 38,
      drift: (random() - 0.4) * 18,
      alpha: 0.12 + random() * 0.42,
      phase: random() * Math.PI * 2
    }));
    this.terrain = { ridges, cracks };
  }

  drawIce({ caseData, receiver, velocity, trail, selectedIndex, signals, time, weather, bursting, unstable, running }) {
    const { context, width, height } = fitCanvas(this.iceCanvas);
    context.clearRect(0, 0, width, height);

    const base = context.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, "#0e343d");
    base.addColorStop(0.48, "#0a2832");
    base.addColorStop(1, "#061a21");
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(
      receiver.x * width,
      receiver.y * height,
      0,
      receiver.x * width,
      receiver.y * height,
      Math.max(width, height) * 0.58
    );
    glow.addColorStop(0, "rgba(88, 188, 177, 0.11)");
    glow.addColorStop(0.55, "rgba(37, 100, 101, 0.035)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    this.drawGrid(context, width, height);
    this.drawTerrain(context, width, height);
    this.drawTrail(context, width, height, trail);
    this.drawSignalHalo(context, width, height, receiver, signals, selectedIndex, time, bursting);
    this.drawReceiver(context, width, height, receiver, velocity, time, unstable, running);
    this.drawSnow(context, width, height, time, weather);

    if (weather > 0.02) {
      context.fillStyle = `rgba(195, 221, 221, ${weather * 0.34})`;
      context.fillRect(0, 0, width, height);
      this.drawWhiteout(context, width, height, time, weather);
    }

    context.fillStyle = "rgba(4, 18, 22, 0.48)";
    context.fillRect(0, 0, width, height);
    const light = context.createRadialGradient(
      receiver.x * width,
      receiver.y * height,
      0,
      receiver.x * width,
      receiver.y * height,
      width * 0.42
    );
    light.addColorStop(0, "rgba(6, 24, 29, 0)");
    light.addColorStop(1, "rgba(2, 10, 13, 0.46)");
    context.fillStyle = light;
    context.fillRect(0, 0, width, height);
  }

  drawGrid(context, width, height) {
    context.save();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(172, 224, 219, 0.075)";
    context.setLineDash([3, 7]);
    for (let index = 1; index < 8; index += 1) {
      const x = (width * index) / 8;
      const y = (height * index) / 8;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.strokeStyle = "rgba(155, 220, 213, 0.2)";
    context.setLineDash([5, 6]);
    context.beginPath();
    context.moveTo(width / 2, 0);
    context.lineTo(width / 2, height);
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    context.setLineDash([]);

    const labels = [
      ["NW", 0.13, 0.47],
      ["NE", 0.87, 0.47],
      ["SW", 0.13, 0.81],
      ["SE", 0.87, 0.81]
    ];
    context.font = "600 8px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillStyle = "rgba(172, 224, 219, 0.28)";
    for (const [label, x, y] of labels) {
      context.fillText(label, width * x, height * y);
    }
    context.restore();
  }

  drawTerrain(context, width, height) {
    if (!this.terrain) return;
    context.save();
    for (const ridge of this.terrain.ridges) {
      context.beginPath();
      ridge.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.lineWidth = ridge.width;
      context.strokeStyle = `rgba(194, 234, 230, ${ridge.alpha})`;
      context.stroke();
    }
    for (const crack of this.terrain.cracks) {
      context.beginPath();
      crack.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.lineWidth = 0.7;
      context.strokeStyle = `rgba(3, 17, 21, ${crack.alpha + 0.08})`;
      context.stroke();
      context.strokeStyle = `rgba(140, 208, 202, ${crack.alpha * 0.55})`;
      context.stroke();
    }
    context.restore();
  }

  drawTrail(context, width, height, trail) {
    if (!trail.length) return;
    context.save();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(127, 231, 212, 0.24)";
    context.beginPath();
    trail.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.restore();
  }

  drawSignalHalo(context, width, height, receiver, signals, selectedIndex, time, bursting) {
    const signal = signals[selectedIndex];
    if (!signal) return;
    const x = receiver.x * width;
    const y = receiver.y * height;
    const intensity = Math.min(1, signal.strength / 90);
    const pulse = bursting ? 0.55 + Math.sin(time * 7) * 0.2 : 0.16;
    context.save();
    context.strokeStyle = `rgba(127, 231, 212, ${0.12 + intensity * 0.46 * pulse})`;
    context.lineWidth = 1;
    context.setLineDash([2, 4]);
    context.beginPath();
    context.arc(x, y, 21 + intensity * 55 + (bursting ? Math.sin(time * 4) * 3 : 0), 0, Math.PI * 2);
    context.stroke();
    if (intensity > 0.72) {
      context.strokeStyle = `rgba(127, 231, 212, ${0.08 + intensity * 0.24})`;
      context.beginPath();
      context.arc(x, y, 68 + intensity * 50, -0.42, 0.42);
      context.stroke();
    }
    context.restore();
  }

  drawReceiver(context, width, height, receiver, velocity, time, unstable, running) {
    const x = receiver.x * width;
    const y = receiver.y * height;
    const speed = Math.hypot(velocity.x, velocity.y);
    const heading = speed > 0.004 ? Math.atan2(velocity.y, velocity.x) : -Math.PI / 2;
    context.save();
    context.translate(x, y);

    if (running) {
      const ring = (time * 0.22) % 1;
      context.strokeStyle = `rgba(127, 231, 212, ${(1 - ring) * 0.16})`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(0, 0, 12 + ring * 29, 0, Math.PI * 2);
      context.stroke();
    }

    context.rotate(heading);
    context.fillStyle = unstable ? "#ffc069" : "#a5f3e6";
    context.shadowColor = unstable ? "#ffc069" : "#7fe7d4";
    context.shadowBlur = 12;
    context.beginPath();
    context.moveTo(9, 0);
    context.lineTo(-6, 5.5);
    context.lineTo(-3, 0);
    context.lineTo(-6, -5.5);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "rgba(4, 21, 25, 0.9)";
    context.beginPath();
    context.arc(0, 0, 7.5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = unstable ? "#ffc069" : "#7fe7d4";
    context.lineWidth = 1;
    context.stroke();
    context.rotate(-heading);
    context.fillStyle = "#7fe7d4";
    context.beginPath();
    context.arc(0, 0, 2.4, 0, Math.PI * 2);
    context.fill();

    context.font = "600 7px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillStyle = "rgba(193, 233, 227, 0.72)";
    context.fillText("RX-04", 0, 24);
    context.restore();
  }

  drawSnow(context, width, height, time, weather) {
    context.save();
    const density = 0.55 + weather * 0.8;
    for (const flake of this.snow) {
      if (flake.phase > density) continue;
      const x = (flake.x * width + time * flake.drift + width) % width;
      const y = (flake.y * height + time * flake.speed) % height;
      context.fillStyle = `rgba(219, 241, 238, ${flake.alpha * (0.35 + weather * 0.55)})`;
      context.beginPath();
      context.arc(x, y, flake.size * (1 + weather * 0.35), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  drawWhiteout(context, width, height, time, weather) {
    context.save();
    context.strokeStyle = `rgba(231, 243, 241, ${weather * 0.18})`;
    context.lineWidth = 1;
    for (let index = 0; index < 26; index += 1) {
      const y = ((index * 37 + time * 70) % height) + Math.sin(index * 2.4) * 8;
      const startX = ((index * 89 + time * 31) % (width * 1.2)) - width * 0.1;
      context.beginPath();
      context.moveTo(startX, y);
      context.lineTo(startX + 90 + (index % 5) * 27, y - 6);
      context.stroke();
    }
    context.restore();
  }

  drawScope({ time, frequency, doppler, strength, bursting, weather, unstable, color, running }) {
    const { context, width, height } = fitCanvas(this.scopeCanvas);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(1, 13, 17, 0.55)";
    context.fillRect(0, 0, width, height);

    context.save();
    context.strokeStyle = "rgba(167, 226, 219, 0.07)";
    context.lineWidth = 1;
    for (let index = 1; index < 8; index += 1) {
      const x = (width * index) / 8;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let index = 1; index < 4; index += 1) {
      const y = (height * index) / 4;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.strokeStyle = "rgba(173, 228, 220, 0.16)";
    context.setLineDash([3, 5]);
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    context.setLineDash([]);
    context.restore();

    const active = bursting && running;
    const amplitude = active
      ? height * (0.1 + Math.min(0.34, strength / 290))
      : height * 0.014;
    const carrierScale = frequency / 430;
    const hex = color.replace("#", "");
    const rgb = unstable
      ? [255, 192, 105]
      : [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];

    context.save();
    context.lineWidth = 1.15;
    context.strokeStyle = `rgba(${rgb.join(",")}, ${active ? 0.92 : 0.28})`;
    context.shadowColor = `rgba(${rgb.join(",")}, 0.5)`;
    context.shadowBlur = active ? 6 : 0;
    context.beginPath();
    const center = height / 2;
    for (let x = 0; x <= width; x += 1) {
      const normalized = x / Math.max(1, width);
      const phase = normalized * 65 * carrierScale + time * 17;
      const fade = Math.sin(normalized * Math.PI);
      let sample = Math.sin(phase) * amplitude * fade;
      sample += Math.sin(phase * 2.13 + time * 3.7) * amplitude * 0.14;
      if (unstable) {
        sample += Math.sin(phase * 0.41 + time * 32) * amplitude * 0.44;
        sample += Math.sin(x * 0.83 + time * 21) * amplitude * 0.09;
      }
      if (weather > 0.05) {
        sample += Math.sin(x * 1.71 + time * 41) * amplitude * weather * 0.4;
      }
      const y = center + sample;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    context.restore();

    if (unstable) {
      context.fillStyle = "rgba(255, 192, 105, 0.78)";
      context.font = "600 7px SFMono-Regular, Consolas, monospace";
      context.fillText("MOTION NOISE", 10, 13);
    } else if (weather > 0.35) {
      context.fillStyle = "rgba(225, 240, 238, 0.7)";
      context.font = "600 7px SFMono-Regular, Consolas, monospace";
      context.fillText("WHITEOUT / PARTIAL MASK", 10, 13);
    } else if (active) {
      context.fillStyle = `rgba(${rgb.join(",")}, 0.7)`;
      context.font = "600 7px SFMono-Regular, Consolas, monospace";
      context.fillText("BURST LOCK", 10, 13);
    }

    const sweepX = (time * width * 0.11) % width;
    const sweep = context.createLinearGradient(sweepX - 28, 0, sweepX + 2, 0);
    sweep.addColorStop(0, "rgba(127, 231, 212, 0)");
    sweep.addColorStop(1, "rgba(127, 231, 212, 0.08)");
    context.fillStyle = sweep;
    context.fillRect(sweepX - 28, 0, 30, height);
  }
}
