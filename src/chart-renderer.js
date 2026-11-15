// Canvas 海图渲染：海面、区块网格、岛屿/浅滩、码头、灯塔、浮标、航线与阻断点。

import { WORLD, GRID, CHUNK } from "./config.js";

export class ChartRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dashOffset = 0;
    this.hover = null;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = WORLD.width * dpr;
    this.canvas.height = WORLD.height * dpr;
    this.canvas.style.width = `${WORLD.width}px`;
    this.canvas.style.height = `${WORLD.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(layout, highlightChunks = []) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    this.drawSea(ctx);
    this.drawChunks(ctx, highlightChunks);
    this.drawDredged(ctx, layout);
    this.drawShallows(ctx, layout);
    this.drawIslands(ctx, layout);
    this.drawObstacles(ctx, layout);
    this.drawRoute(ctx, layout);
    this.drawEndpoints(ctx, layout);
    this.drawBuoys(ctx, layout);
    this.drawBlockage(ctx, layout);
  }

  drawSea(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    grad.addColorStop(0, "#0e3a52");
    grad.addColorStop(1, "#0a2a3d");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.strokeStyle = "rgba(120,190,220,0.08)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= GRID.cols; gx += 4) {
      ctx.beginPath();
      ctx.moveTo(gx * 16 + 0.5, 0);
      ctx.lineTo(gx * 16 + 0.5, WORLD.height);
      ctx.stroke();
    }
    for (let gy = 0; gy <= GRID.rows; gy += 4) {
      ctx.beginPath();
      ctx.moveTo(0, gy * 16 + 0.5);
      ctx.lineTo(WORLD.width, gy * 16 + 0.5);
      ctx.stroke();
    }
  }

  drawChunks(ctx, highlight) {
    ctx.lineWidth = 1;
    for (let cy = 0; cy < WORLD.chunkRows; cy++) {
      for (let cx = 0; cx < WORLD.chunkCols; cx++) {
        const key = `${cx}-${cy}`;
        ctx.strokeStyle = "rgba(150,210,235,0.18)";
        ctx.strokeRect(cx * CHUNK.width, cy * CHUNK.height, CHUNK.width, CHUNK.height);
        if (highlight.includes(key)) {
          ctx.fillStyle = "rgba(255,210,90,0.14)";
          ctx.fillRect(cx * CHUNK.width, cy * CHUNK.height, CHUNK.width, CHUNK.height);
        }
      }
    }
  }

  drawDredged(ctx, layout) {
    ctx.fillStyle = "rgba(90,170,200,0.35)";
    for (const cell of layout.dredged) {
      ctx.fillRect(cell.gx * 16, cell.gy * 16, 16, 16);
    }
  }

  drawShallows(ctx, layout) {
    for (const s of layout.shallows) {
      ctx.fillStyle = "rgba(195,180,120,0.35)";
      ctx.strokeStyle = "rgba(230,215,150,0.7)";
      this.polygon(ctx, s.polygon);
    }
  }

  drawIslands(ctx, layout) {
    for (const island of layout.islands) {
      ctx.fillStyle = "#5c7a4f";
      ctx.strokeStyle = "#d8c98f";
      ctx.lineWidth = 2;
      this.polygon(ctx, island.polygon);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(island.x - 6, island.y - 6, Math.max(4, island.polygon.length), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawObstacles(ctx, layout) {
    for (const ob of layout.obstacles) {
      ctx.fillStyle = "rgba(200,80,70,0.85)";
      ctx.strokeStyle = "#ffd0c8";
      ctx.lineWidth = 1.5;
      this.polygon(ctx, ob.polygon);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.moveTo(ob.x - 5, ob.y - 5);
      ctx.lineTo(ob.x + 5, ob.y + 5);
      ctx.moveTo(ob.x + 5, ob.y - 5);
      ctx.lineTo(ob.x - 5, ob.y + 5);
      ctx.stroke();
    }
  }

  drawRoute(ctx, layout) {
    if (layout.routePoints.length < 2) return;
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -this.dashOffset;
    ctx.strokeStyle = layout.waypointOk ? "#7fe0ff" : "#ffb36b";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(layout.routePoints[0].x, layout.routePoints[0].y);
    for (const p of layout.routePoints.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }

  drawEndpoints(ctx, layout) {
    this.dockIcon(ctx, layout.dock);
    this.lighthouseIcon(ctx, layout.lighthouse);
  }

  dockIcon(ctx, dock) {
    ctx.fillStyle = "#c98a4b";
    ctx.fillRect(dock.x - 10, dock.y - 10, 20, 20);
    ctx.strokeStyle = "#f4e4c1";
    ctx.strokeRect(dock.x - 10, dock.y - 10, 20, 20);
    this.label(ctx, "码头", dock.x, dock.y - 16);
  }

  lighthouseIcon(ctx, light) {
    ctx.fillStyle = "#f5f0e6";
    ctx.beginPath();
    ctx.moveTo(light.x, light.y - 14);
    ctx.lineTo(light.x + 8, light.y + 10);
    ctx.lineTo(light.x - 8, light.y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#d94f3d";
    ctx.fillRect(light.x - 3, light.y - 4, 6, 5);
    ctx.fillStyle = "#ffe27a";
    ctx.beginPath();
    ctx.arc(light.x, light.y - 15, 3.5, 0, Math.PI * 2);
    ctx.fill();
    this.label(ctx, "灯塔", light.x, light.y - 24);
  }

  drawBuoys(ctx, layout) {
    for (const buoy of layout.buoys) {
      ctx.fillStyle = "#ff8c42";
      ctx.strokeStyle = "#fff3e0";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(buoy.x, buoy.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#fff3e0";
      ctx.beginPath();
      ctx.moveTo(buoy.x, buoy.y - 7);
      ctx.lineTo(buoy.x, buoy.y - 13);
      ctx.stroke();
    }
  }

  drawBlockage(ctx, layout) {
    const point = layout.blockage && layout.blockage.blockPoint;
    if (!point) return;
    const pulse = 6 + Math.sin(performance.now() / 180) * 2;
    ctx.strokeStyle = "#ff5252";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, pulse + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,82,82,0.25)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, pulse + 6, 0, Math.PI * 2);
    ctx.fill();
    this.label(ctx, "阻断点", point.x, point.y - 18, "#ffb3b3");
  }

  polygon(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  label(ctx, text, x, y, color = "#eaf4fb") {
    ctx.font = "11px sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(text, x, y);
  }

  hitTest(layout, x, y) {
    for (const buoy of layout.buoys) {
      if (Math.hypot(buoy.x - x, buoy.y - y) <= 10) return { type: "buoy", object: buoy };
    }
    return { type: "water", x, y };
  }
}
