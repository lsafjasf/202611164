// Canvas renderer: terrain, coverage circles, routes, objects, blocked markers.

import { isWater } from './terrain.js';
import { OBJECT_TYPES } from './placement.js';

const TYPE_RADIUS = { village: 5, tower: 4, supply: 4 };

export class Renderer {
  constructor(canvas, scene, cellSize = 8) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = scene;
    this.cellSize = cellSize;
    this.hoverId = null;
    this.selectedId = null;
    this.dragPreview = null;
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.scene.params;
    this.canvas.width = width * this.cellSize * dpr;
    this.canvas.height = height * this.cellSize * dpr;
    this.canvas.style.width = `${width * this.cellSize}px`;
    this.canvas.style.height = `${height * this.cellSize}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  cellAtPixel(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor((px - rect.left) / this.cellSize),
      y: Math.floor((py - rect.top) / this.cellSize),
    };
  }

  objectAtPixel(px, py) {
    const cell = this.cellAtPixel(px, py);
    return this.scene.objects.find((o) =>
      Math.hypot(o.x - cell.x, o.y - cell.y) <= 1.2);
  }

  draw() {
    const ctx = this.ctx;
    const size = this.cellSize;
    const { width, height } = this.scene.params;
    ctx.clearRect(0, 0, width * size, height * size);
    this.drawTerrain();
    this.drawAffectedRegion();
    this.drawRoutes();
    this.drawCoverage();
    this.drawObjects();
    this.drawBlocked();
    if (this.dragPreview) this.drawDragPreview();
    this.drawBorder();
  }

  drawTerrain() {
    const ctx = this.ctx;
    const size = this.cellSize;
    const terrain = this.scene.terrain;
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        if (isWater(terrain, x, y)) {
          ctx.fillStyle = '#33587a';
        } else {
          const shade = 0.86 + terrain.elevation[y * terrain.width + x] * 0.12;
          ctx.fillStyle = `rgba(110, 155, 95, ${shade})`;
        }
        ctx.fillRect(x * size, y * size, size, size);
      }
    }
  }

  drawBorder() {
    const ctx = this.ctx;
    const size = this.cellSize;
    const { width, height } = this.scene.params;
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width * size - 2, height * size - 2);
  }

  drawAffectedRegion() {
    const region = this.scene.affectedRegion;
    if (!region) return;
    const ctx = this.ctx;
    const size = this.cellSize;
    const { width, height } = this.scene.params;
    const x = Math.max(0, region.minX) * size;
    const y = Math.max(0, region.minY) * size;
    const w = (Math.min(width - 1, region.maxX) - Math.max(0, region.minX) + 1) * size;
    const h = (Math.min(height - 1, region.maxY) - Math.max(0, region.minY) + 1) * size;
    ctx.save();
    ctx.strokeStyle = '#f4c542';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  drawRoutes() {
    const ctx = this.ctx;
    const size = this.cellSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const edge of this.scene.edges.values()) {
      ctx.beginPath();
      edge.path.forEach((cell, i) => {
        const px = cell.x * size + size / 2;
        const py = cell.y * size + size / 2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = 'rgba(245, 235, 205, 0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawCoverage() {
    const ctx = this.ctx;
    const size = this.cellSize;
    for (const obj of this.scene.objects) {
      const color = OBJECT_TYPES[obj.type].color;
      ctx.beginPath();
      ctx.arc(obj.x * size + size / 2, obj.y * size + size / 2,
        obj.radius * size, 0, Math.PI * 2);
      ctx.fillStyle = hexWithAlpha(color, 0.16);
      ctx.fill();
      ctx.strokeStyle = hexWithAlpha(color, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  drawObjects() {
    const ctx = this.ctx;
    const size = this.cellSize;
    for (const obj of this.scene.objects) {
      const cx = obj.x * size + size / 2;
      const cy = obj.y * size + size / 2;
      const r = TYPE_RADIUS[obj.type];
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = OBJECT_TYPES[obj.type].color;
      ctx.fill();
      ctx.strokeStyle = obj.id === this.selectedId ? '#f4c542' : '#1f2937';
      ctx.lineWidth = obj.id === this.selectedId ? 2.5 : 1.5;
      ctx.stroke();
      ctx.fillStyle = '#1f2937';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(OBJECT_TYPES[obj.type].label[0], cx, cy + 3);
    }
  }

  drawBlocked() {
    const ctx = this.ctx;
    const size = this.cellSize;
    for (const report of this.scene.lastBlocked) {
      if (report.barrierCells) {
        ctx.fillStyle = 'rgba(224, 82, 82, 0.85)';
        for (const [x, y] of report.barrierCells) {
          ctx.fillRect(x * size, y * size, size, size);
        }
      }
      const end = report.toPos;
      const cx = end.x * size + size / 2;
      const cy = end.y * size + size / 2;
      ctx.strokeStyle = '#e05252';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 6);
      ctx.lineTo(cx + 6, cy + 6);
      ctx.moveTo(cx + 6, cy - 6);
      ctx.lineTo(cx - 6, cy + 6);
      ctx.stroke();
    }
  }

  drawDragPreview() {
    const ctx = this.ctx;
    const size = this.cellSize;
    const { x, y, valid } = this.dragPreview;
    const cx = x * size + size / 2;
    const cy = y * size + size / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = valid ? 'rgba(111, 207, 151, 0.6)' : 'rgba(224, 82, 82, 0.6)';
    ctx.fill();
  }
}

function hexWithAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
