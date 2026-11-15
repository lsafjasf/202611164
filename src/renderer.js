import { WORLD } from "./generator.js";

const TAU = Math.PI * 2;

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function smoothPolygon(ctx, points) {
  if (!points.length) return;
  const first = points[0];
  const last = points.at(-1);
  ctx.beginPath();
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  ctx.closePath();
}

function drawBase(ctx, time) {
  ctx.fillStyle = "#07110e";
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  const wash = ctx.createRadialGradient(830, 190, 30, 830, 190, 760);
  wash.addColorStop(0, "rgba(102, 144, 91, 0.09)");
  wash.addColorStop(0.55, "rgba(31, 66, 48, 0.03)");
  wash.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  ctx.strokeStyle = "rgba(190, 222, 197, 0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD.width; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.height);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD.height; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(204, 243, 106, 0.09)";
  ctx.setLineDash([2, 7]);
  ctx.strokeRect(13.5, 13.5, WORLD.width - 27, WORLD.height - 27);
  ctx.setLineDash([]);

  const vignette = ctx.createRadialGradient(
    WORLD.width / 2,
    WORLD.height / 2,
    260,
    WORLD.width / 2,
    WORLD.height / 2,
    850,
  );
  vignette.addColorStop(0.62, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.36)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  void time;
}

function drawLandBlocks(ctx, world) {
  for (const block of world.blocks) {
    ctx.fillStyle = block.type === "built" ? "#14231c" : "#101e17";
    roundRect(ctx, block.x, block.y, block.w, block.h, 2);
    ctx.fill();

    if (block.type === "built") {
      ctx.strokeStyle = "rgba(190, 220, 197, 0.04)";
      ctx.lineWidth = 1;
      ctx.strokeRect(block.x + 5.5, block.y + 5.5, block.w - 11, block.h - 11);
      ctx.fillStyle = "rgba(215, 234, 219, 0.08)";
      for (let index = 0; index < 4; index += 1) {
        const px = block.x + 8 + ((index * 37 + block.col * 13) % Math.max(10, block.w - 16));
        const py = block.y + 9 + ((index * 29 + block.row * 17) % Math.max(10, block.h - 18));
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
}

function drawPark(ctx, park, selected) {
  const gradient = ctx.createLinearGradient(park.x, park.y, park.x + park.w, park.y + park.h);
  gradient.addColorStop(0, "#31553a");
  gradient.addColorStop(0.5, "#3e6a43");
  gradient.addColorStop(1, "#2b4d36");
  roundRect(ctx, park.x, park.y, park.w, park.h, 7);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = selected ? "rgba(204, 243, 106, 0.95)" : "rgba(147, 191, 117, 0.28)";
  ctx.lineWidth = selected ? 2 : 1;
  ctx.stroke();

  ctx.save();
  roundRect(ctx, park.x + 1, park.y + 1, park.w - 2, park.h - 2, 6);
  ctx.clip();
  ctx.strokeStyle = "rgba(205, 228, 172, 0.09)";
  ctx.lineWidth = 1;
  for (let ring = 0; ring < 5; ring += 1) {
    ctx.beginPath();
    ctx.ellipse(
      park.x + park.w * 0.62,
      park.y + park.h * 0.42,
      18 + ring * 17,
      11 + ring * 11,
      -0.25,
      0,
      TAU,
    );
    ctx.stroke();
  }
  const path = park.path;
  if (path) {
    ctx.strokeStyle = "rgba(224, 223, 187, 0.46)";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    path.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const tree of park.trees) {
    ctx.fillStyle = "rgba(1, 9, 4, 0.32)";
    ctx.beginPath();
    ctx.arc(tree.x + 1.8, tree.y + 2, tree.r + 1, 0, TAU);
    ctx.fill();
    const treeColor = ["#8bb861", "#79a957", "#a3c477"][tree.tone];
    ctx.fillStyle = treeColor;
    ctx.beginPath();
    ctx.arc(tree.x, tree.y, tree.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(226, 238, 173, 0.23)";
    ctx.beginPath();
    ctx.arc(tree.x - tree.r * 0.28, tree.y - tree.r * 0.32, tree.r * 0.46, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = "rgba(232, 240, 208, 0.62)";
  ctx.font = "600 7px 'SFMono-Regular', Consolas, 'Noto Sans SC Variable', monospace";
  ctx.letterSpacing = "1px";
  ctx.fillText(`${park.id} · GREEN`, park.x + 9, park.y + 14);
}

function drawWater(ctx, water) {
  ctx.save();
  smoothPolygon(ctx, water.points);
  ctx.fillStyle = "rgba(35, 85, 76, 0.85)";
  ctx.shadowColor = "rgba(63, 146, 146, 0.14)";
  ctx.shadowBlur = 16;
  ctx.fill();
  ctx.shadowBlur = 0;

  const gradient = ctx.createRadialGradient(
    water.x - 10,
    water.y - 12,
    3,
    water.x,
    water.y,
    water.w * 0.62,
  );
  gradient.addColorStop(0, "#286a78");
  gradient.addColorStop(0.55, "#205866");
  gradient.addColorStop(1, "#173f4b");
  smoothPolygon(ctx, water.points);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(122, 206, 210, 0.32)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.clip();

  ctx.strokeStyle = "rgba(143, 217, 218, 0.16)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 6; index += 1) {
    ctx.beginPath();
    ctx.ellipse(
      water.x + 7,
      water.y - 4,
      18 + index * 8,
      8 + index * 3.6,
      -0.16,
      Math.PI * 1.08,
      Math.PI * 1.88,
    );
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(209, 242, 230, 0.32)";
  ctx.beginPath();
  ctx.ellipse(water.x - 16, water.y - 16, 6, 2.5, -0.3, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(190, 232, 226, 0.62)";
  ctx.font = "600 7px 'SFMono-Regular', Consolas, 'Noto Sans SC Variable', monospace";
  ctx.fillText("WETLAND / 水系", water.x - 35, water.y + water.h * 0.43);
}

function drawRoads(ctx, world) {
  const half = world.grid.roadWidth / 2;
  ctx.save();
  for (const x of world.grid.xs) {
    ctx.fillStyle = "#06100d";
    ctx.fillRect(x - half, 0, world.grid.roadWidth, WORLD.height);
    ctx.fillStyle = "rgba(122, 153, 137, 0.19)";
    ctx.fillRect(x - half, 0, 1, WORLD.height);
    ctx.fillRect(x + half - 1, 0, 1, WORLD.height);
    ctx.strokeStyle = "rgba(190, 211, 194, 0.12)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([7, 12]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const y of world.grid.ys) {
    ctx.fillStyle = "#06100d";
    ctx.fillRect(0, y - half, WORLD.width, world.grid.roadWidth);
    ctx.fillStyle = "rgba(122, 153, 137, 0.19)";
    ctx.fillRect(0, y - half, WORLD.width, 1);
    ctx.fillRect(0, y + half - 1, WORLD.width, 1);
    ctx.strokeStyle = "rgba(190, 211, 194, 0.12)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([7, 12]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const target of world.targets) {
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.fillStyle = "rgba(218, 229, 214, 0.14)";
    for (let index = -3; index <= 3; index += 1) {
      ctx.fillRect(index * 5 - 1.5, -7, 2.2, 14);
    }
    ctx.restore();
  }

  ctx.fillStyle = "rgba(170, 196, 177, 0.18)";
  ctx.font = "500 6px 'SFMono-Regular', Consolas, 'Noto Sans SC Variable', monospace";
  ctx.fillText("NORTH LOOP", 57, world.grid.ys[0] - 12);
  ctx.fillText("SOUTH LOOP", 57, world.grid.ys.at(-1) - 12);
  ctx.save();
  ctx.translate(world.grid.xs.at(-1) + 12, 118);
  ctx.rotate(Math.PI / 2);
  ctx.fillText("EAST AVENUE", 0, 0);
  ctx.restore();
  ctx.restore();
}

const BUILDING_TONES = [
  { roof: "#6d8476", wall: "#3a5044", edge: "#849a8b" },
  { roof: "#7e846e", wall: "#444b3c", edge: "#9b9d89" },
  { roof: "#6b7a7a", wall: "#374848", edge: "#849797" },
  { roof: "#897b69", wall: "#4f463b", edge: "#a39783" },
];

function drawBuilding(ctx, building, selected) {
  const tone = BUILDING_TONES[building.tone % BUILDING_TONES.length];
  const extrusion = Math.max(2.5, building.tall * 0.18);
  const x = building.x;
  const y = building.y;
  const w = building.w;
  const h = building.h;

  ctx.fillStyle = "rgba(0, 4, 2, 0.46)";
  ctx.beginPath();
  ctx.moveTo(x + extrusion + 3, y + extrusion + 4);
  ctx.lineTo(x + w + extrusion + 3, y + extrusion + 4);
  ctx.lineTo(x + w + extrusion + 2, y + h + extrusion + 4);
  ctx.lineTo(x + extrusion + 2, y + h + extrusion + 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = tone.wall;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + extrusion, y + h + extrusion);
  ctx.lineTo(x + w + extrusion, y + h + extrusion);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(186, 209, 189, 0.46)";
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w + extrusion, y + extrusion);
  ctx.lineTo(x + w + extrusion, y + h + extrusion);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();

  const roofGradient = ctx.createLinearGradient(x, y, x + w, y + h);
  roofGradient.addColorStop(0, tone.edge);
  roofGradient.addColorStop(0.12, tone.roof);
  roofGradient.addColorStop(1, tone.wall);
  ctx.fillStyle = roofGradient;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = selected ? "#d9ff81" : "rgba(218, 237, 218, 0.24)";
  ctx.lineWidth = selected ? 2 : 0.7;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = "rgba(234, 241, 224, 0.13)";
  ctx.fillRect(x + w * 0.14, y + h * 0.14, w * 0.28, h * 0.08);
  ctx.fillRect(x + w * 0.14, y + h * 0.29, w * 0.18, h * 0.06);
  ctx.fillStyle = "rgba(5, 13, 9, 0.28)";
  ctx.fillRect(x + w * 0.63, y + h * 0.63, w * 0.18, h * 0.18);
  ctx.fillRect(x + w * 0.69, y + h * 0.67, w * 0.08, h * 0.08);

  if (building.kind === "civic") {
    ctx.fillStyle = "rgba(242, 183, 93, 0.84)";
    ctx.beginPath();
    ctx.arc(x + w - 6, y + 6, 3, 0, TAU);
    ctx.fill();
  }
  if (building.tall > 46) {
    ctx.strokeStyle = "rgba(208, 229, 210, 0.2)";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + 2);
    ctx.lineTo(x + w * 0.5, y + h - 2);
    ctx.stroke();
  }
}

function drawBuildings(ctx, world, selectedId) {
  for (const block of world.blocks) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(block.x, block.y, block.w, block.h);
    ctx.clip();
    for (const building of block.buildings) {
      drawBuilding(ctx, building, selectedId === building.id);
    }
    ctx.restore();
  }
}

function drawRoutes(ctx, world) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const route of world.routes) {
    if (route.points.length < 2) continue;
    ctx.strokeStyle = "rgba(204, 243, 106, 0.07)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    route.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.strokeStyle = "rgba(218, 251, 139, 0.46)";
    ctx.lineWidth = 1.35;
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    route.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  const start = world.start;
  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.fillStyle = "rgba(204, 243, 106, 0.12)";
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#0a1610";
  ctx.strokeStyle = "#ccf36a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ccf36a";
  ctx.font = "700 7px 'SFMono-Regular', Consolas, 'Noto Sans SC Variable', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("S", 0, 0.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(218, 231, 218, 0.72)";
  ctx.fillText("起点 / ORIGIN", 13, -10);
  ctx.restore();
}

function drawTargets(ctx, world, time) {
  world.targets.forEach((target, index) => {
    const blocked = !target.reachable;
    const color = blocked ? "#ff7d69" : "#ccf36a";
    const pulse = 10 + Math.sin(time / 440 + index * 1.4) * 2;
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.fillStyle = blocked ? "rgba(255, 125, 105, 0.1)" : "rgba(204, 243, 106, 0.11)";
    ctx.beginPath();
    ctx.arc(0, 0, pulse + 9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = blocked ? "rgba(255, 125, 105, 0.35)" : "rgba(204, 243, 106, 0.36)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, pulse, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#07110e";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (blocked) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-2.8, -2.8);
      ctx.lineTo(2.8, 2.8);
      ctx.moveTo(2.8, -2.8);
      ctx.lineTo(-2.8, 2.8);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 2.4, 0, TAU);
      ctx.fill();
    }

    const right = target.x < WORLD.width - 160;
    const labelX = right ? 15 : -48;
    const labelY = target.y < 120 ? 19 : -17;
    ctx.fillStyle = "rgba(6, 15, 11, 0.82)";
    ctx.fillRect(labelX - 4, labelY - 8, 37, 13);
    ctx.strokeStyle = blocked ? "rgba(255, 125, 105, 0.3)" : "rgba(204, 243, 106, 0.24)";
    ctx.lineWidth = 0.7;
    ctx.strokeRect(labelX - 4.5, labelY - 8.5, 38, 14);
    ctx.fillStyle = color;
    ctx.font = "600 7px 'SFMono-Regular', Consolas, 'Noto Sans SC Variable', monospace";
    ctx.fillText(`T${index + 1}`, labelX, labelY + 1);
    ctx.fillStyle = "rgba(222, 234, 220, 0.48)";
    ctx.font = "5.5px 'SFMono-Regular', Consolas, 'Noto Sans SC Variable', monospace";
    ctx.fillText(blocked ? "BLOCKED" : "ONLINE", labelX + 10, labelY + 0.8);
    ctx.restore();
  });
}

function drawBlockers(ctx, world, selectedId, time) {
  for (const blocker of world.blockers) {
    const selected = selectedId === blocker.id;
    ctx.save();
    ctx.translate(blocker.x, blocker.y);
    const pulse = 13 + Math.sin(time / 380 + blocker.x) * 1.5;
    ctx.strokeStyle = "rgba(255, 125, 105, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, pulse + 8, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#2a1714";
    ctx.strokeStyle = selected ? "#ffb09f" : "#ff7d69";
    ctx.lineWidth = selected ? 2 : 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#ff7d69";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.lineTo(4, 4);
    ctx.moveTo(4, -4);
    ctx.lineTo(-4, 4);
    ctx.stroke();
    ctx.restore();
  }

  const report = world.blockerReport;
  if (!report) return;
  const location = report.location;
  const boxWidth = 151;
  const boxHeight = 42;
  const left = location.x + 18 + boxWidth > WORLD.width ? location.x - boxWidth - 18 : location.x + 18;
  const top = location.y - 65 < 12 ? location.y + 16 : location.y - 65;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 125, 105, 0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(location.x, location.y - 11);
  ctx.lineTo(left + (left < location.x ? boxWidth : 0), top + 28);
  ctx.stroke();
  ctx.fillStyle = "rgba(23, 12, 10, 0.95)";
  roundRect(ctx, left, top, boxWidth, boxHeight, 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 125, 105, 0.66)";
  ctx.stroke();
  ctx.fillStyle = "#ff7d69";
  ctx.font = "700 7px 'SFMono-Regular', Consolas, 'Noto Sans SC Variable', monospace";
  ctx.fillText("ROUTE BLOCKED / 路线阻断", left + 9, top + 14);
  ctx.fillStyle = "rgba(238, 212, 204, 0.86)";
  ctx.font = "8px 'Noto Sans SC Variable', 'Microsoft YaHei', sans-serif";
  ctx.fillText(location.label, left + 9, top + 27);
  ctx.fillStyle = "rgba(188, 142, 132, 0.8)";
  ctx.font = "6.5px 'SFMono-Regular', Consolas, 'Noto Sans SC Variable', monospace";
  ctx.fillText(`X ${Math.round(location.x)}  ·  Y ${Math.round(location.y)}`, left + 9, top + 37);
  ctx.restore();
}

function drawSelection(ctx, world, selected) {
  if (!selected) return;
  ctx.save();
  if (selected.type === "park") {
    const park = world.parks.find((item) => item.id === selected.id);
    if (park) {
      ctx.strokeStyle = "#ccf36a";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(park.x - 2, park.y - 2, park.w + 4, park.h + 4);
      ctx.setLineDash([]);
    }
  }
  if (selected.type === "blocker") {
    const blocker = world.blockers.find((item) => item.id === selected.id);
    if (blocker) {
      ctx.strokeStyle = "#ffb09f";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(blocker.x, blocker.y, 17, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawFlash(ctx, world, view, time) {
  if (!view.flash || !view.flash.blockIds?.length) return;
  const elapsed = time - view.flash.startedAt;
  if (elapsed > 1200) return;
  const alpha = (1 - elapsed / 1200) * 0.28;
  for (const blockId of view.flash.blockIds) {
    const block = world.blocks.find((item) => item.id === blockId);
    if (!block) continue;
    ctx.fillStyle = `rgba(204, 243, 106, ${alpha})`;
    ctx.fillRect(block.x, block.y, block.w, block.h);
    ctx.strokeStyle = `rgba(204, 243, 106, ${alpha * 2})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(block.x + 0.5, block.y + 0.5, block.w - 1, block.h - 1);
  }
}

function drawDropTarget(ctx, world, view) {
  if (!view.dragPark || !view.hoverBlockId) return;
  const block = world.blocks.find((item) => item.id === view.hoverBlockId);
  if (!block) return;
  const valid = block.type === "built";
  ctx.save();
  ctx.fillStyle = valid ? "rgba(204, 243, 106, 0.14)" : "rgba(255, 125, 105, 0.13)";
  ctx.strokeStyle = valid ? "#ccf36a" : "#ff7d69";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.fillRect(block.inner.x, block.inner.y, block.inner.w, block.inner.h);
  ctx.strokeRect(block.inner.x, block.inner.y, block.inner.w, block.inner.h);
  ctx.setLineDash([]);
  ctx.fillStyle = valid ? "#ccf36a" : "#ff7d69";
  ctx.font = "8px 'Noto Sans SC Variable', 'Microsoft YaHei', sans-serif";
  ctx.fillText(valid ? `迁移公园至 ${block.id}` : "不可放置", block.inner.x + 8, block.inner.y + 15);
  ctx.restore();
}

export function renderScene(ctx, world, view = {}, time = 0) {
  ctx.save();
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  drawBase(ctx, time);
  drawLandBlocks(ctx, world);
  for (const park of world.parks) drawPark(ctx, park, view.selected?.id === park.id);
  for (const water of world.waters) drawWater(ctx, water);
  drawRoads(ctx, world);
  drawRoutes(ctx, world);
  drawBuildings(ctx, world, view.selected?.id);
  drawDropTarget(ctx, world, view);
  drawTargets(ctx, world, time);
  drawBlockers(ctx, world, view.selected?.id, time);
  drawSelection(ctx, world, view.selected);
  drawFlash(ctx, world, view, time);
  ctx.restore();
}
