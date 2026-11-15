import { project, cellFaces, paintOrder, sceneBounds } from './geometry.js';
import { keyOf } from './model.js';

const COLORS = {
  road: '#6b7280',
  roadLine: '#8b93a1',
  target: '#f59e0b',
  plaza: '#d6c9a8',
  green: '#7fb069',
  wallA: '#c9b79c',
  wallB: '#b39f82',
  wallStroke: '#7c6d58',
  floorLine: 'rgba(60,50,40,0.35)',
  roof: {
    flat: '#9d4f4f',
    gable: '#b85c38',
    pyramid: '#7a5c9e',
    hip: '#3f7d6b',
  },
  roofEdge: 'rgba(40,30,25,0.55)',
  hidden: '#9aa3ad',
  selected: '#22d3ee',
  section: '#ef4444',
  route: '#38bdf8',
};

function pathPoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function fillStroke(ctx, pts, fill, stroke = COLORS.wallStroke) {
  pathPoly(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

export function isHidden(cell, view) {
  return cell.type === 'building' && view.hideBelow > 0 && cell.floors < view.hideBelow;
}

function drawGround(ctx, cell, view, origin, selected) {
  const pts = cellFaces(cell, view).ground.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }));
  const fill = selected ? COLORS.selected : COLORS[cell.type];
  fillStroke(ctx, pts, fill, 'rgba(40,40,40,0.35)');
  if (cell.type === 'road') {
    const a = pts[0];
    const c = pts[2];
    ctx.strokeStyle = COLORS.roadLine;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (cell.type === 'target') {
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cell.targetId, cx, cy);
  }
}

function drawBuilding(ctx, cell, view, origin, selected) {
  const { walls, roof } = cellFaces(cell, view);
  const hidden = isHidden(cell, view);
  const wallColors = hidden ? [COLORS.hidden, COLORS.hidden] : [COLORS.wallA, COLORS.wallB];
  walls.forEach((wall, i) => {
    const pts = wall.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }));
    fillStroke(ctx, pts, wallColors[i]);
  });
  // floor divider lines communicate the floor count.
  if (!hidden) {
    for (let f = 1; f < cell.floors; f++) {
      const p1 = project(cell.x, cell.y, f, view);
      const p2 = project(cell.x, cell.y + 1, f, view);
      const p3 = project(cell.x + 1, cell.y + 1, f, view);
      const p4 = project(cell.x + 1, cell.y, f, view);
      ctx.strokeStyle = COLORS.floorLine;
      ctx.beginPath();
      ctx.moveTo(p4.x + origin.x, p4.y + origin.y);
      ctx.lineTo(p3.x + origin.x, p3.y + origin.y);
      ctx.lineTo(p2.x + origin.x, p2.y + origin.y);
      ctx.stroke();
    }
  }
  const roofColor = hidden ? COLORS.hidden : COLORS.roof[cell.roof] || COLORS.roof.flat;
  for (const face of roof.faces) {
    const pts = face.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }));
    fillStroke(ctx, pts, roofColor, COLORS.roofEdge);
  }
  if (selected) {
    const edge = roof.edge.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }));
    ctx.strokeStyle = COLORS.selected;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(edge[0].x, edge[0].y);
    edge.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

function drawSectionLine(ctx, city, view, origin) {
  const row = view.sectionRow;
  if (row < 0 || row >= city.rules.height) return;
  const lift = 0.05;
  const p0 = project(0, row, lift, view);
  const p1 = project(city.rules.width, row, lift, view);
  ctx.strokeStyle = COLORS.section;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(p0.x + origin.x, p0.y + origin.y);
  ctx.lineTo(p1.x + origin.x, p1.y + origin.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}

function drawRoute(ctx, route, view, origin) {
  if (!route || route.length < 2) return;
  ctx.strokeStyle = COLORS.route;
  ctx.lineWidth = 3;
  ctx.beginPath();
  route.forEach((step, i) => {
    const p = project(step.x + 0.5, step.y + 0.5, 0.08, view);
    const sx = p.x + origin.x;
    const sy = p.y + origin.y;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.stroke();
  ctx.lineWidth = 1;
}

// Full city draw. origin centers the scene inside the canvas.
export function renderCity(canvas, city, view, options = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const bounds = sceneBounds(city, view);
  const pad = 24;
  const origin = {
    x: (canvas.width / dpr - bounds.width) / 2 - bounds.minX,
    y: (canvas.height / dpr - bounds.height) / 2 - bounds.minY + pad / 2,
  };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const selectedKey = options.selected ? keyOf(options.selected.x, options.selected.y) : null;
  for (const cell of paintOrder(city)) {
    const selected = keyOf(cell.x, cell.y) === selectedKey;
    if (cell.type === 'building') drawBuilding(ctx, cell, view, origin, selected);
    else drawGround(ctx, cell, view, origin, selected);
  }
  drawRoute(ctx, options.route, view, origin);
  drawSectionLine(ctx, city, view, origin);
  return { bounds, origin };
}

// Convert a screen click to a grid cell using the same origin math.
export function pickCell(canvas, city, view, screenX, screenY) {
  const dpr = window.devicePixelRatio || 1;
  const bounds = sceneBounds(city, view);
  const pad = 24;
  const origin = {
    x: (canvas.width / dpr - bounds.width) / 2 - bounds.minX,
    y: (canvas.height / dpr - bounds.height) / 2 - bounds.minY + pad / 2,
  };
  const x = screenX - origin.x;
  const y = screenY - origin.y;
  // Inverse of the iso projection at z=0 (diamond tile pick).
  const halfW = view.tileSize / 2;
  const halfH = view.tileSize / 4;
  const gx = x / halfW;
  const gy = y / halfH;
  const col = Math.floor((gx + gy) / 2);
  const row = Math.floor((gy - gx) / 2);
  if (col < 0 || row < 0 || col >= city.rules.width || row >= city.rules.height) return null;
  return { x: col, y: row };
}

// Section profile drawn on its own canvas: fixed side-elevation scale.
export function renderProfile(canvas, city, view) {
  const row = view.sectionRow;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (row < 0 || row >= city.rules.height) return null;
  const colW = 26;
  const fh = view.floorHeight;
  const baseY = canvas.height / dpr - 28;
  const left = 18;
  for (let x = 0; x < city.rules.width; x++) {
    const cell = city.cells.get(keyOf(x, row));
    if (!cell) continue;
    const px = left + x * colW;
    if (cell.type === 'building') {
      const hidden = isHidden(cell, view);
      // Known structure remains visible in the profile even while hidden in 3D.
      const h = cell.floors * fh;
      ctx.fillStyle = hidden ? COLORS.hidden : COLORS.wallB;
      ctx.fillRect(px, baseY - h, colW - 3, h);
      ctx.fillStyle = hidden ? '#7c858f' : COLORS.roof[cell.roof];
      ctx.fillRect(px, baseY - h - 8, colW - 3, 8);
      ctx.strokeStyle = COLORS.wallStroke;
      ctx.strokeRect(px, baseY - h, colW - 3, h);
      ctx.fillStyle = '#1f2937';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${cell.floors}F`, px + (colW - 3) / 2, baseY - h / 2);
    } else {
      ctx.fillStyle = COLORS[cell.type];
      ctx.fillRect(px, baseY - 10, colW - 3, 10);
    }
    ctx.fillStyle = '#374151';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(x), px + (colW - 3) / 2, baseY + 14);
  }
  ctx.strokeStyle = COLORS.section;
  ctx.beginPath();
  ctx.moveTo(8, baseY + 2);
  ctx.lineTo(canvas.width / dpr - 8, baseY + 2);
  ctx.stroke();
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Section row y=${row}`, 10, 16);
  return { row };
}
