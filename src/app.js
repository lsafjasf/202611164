import {
  DEFAULT_PARAMS,
  SEED_PRESETS,
  TILE,
  deserializeScene,
  editTile,
  generateScene,
  hashToHex,
  indexOf,
  rulesSummary,
  serializeScene,
  updateVeinSize
} from "./scene-core.js";

const AUTO_SAVE_KEY = "depth-grid:autosave:v1";
const SNAPSHOT_KEY = "depth-grid:snapshot:v1";

const elements = {
  canvas: document.querySelector("#sceneCanvas"),
  canvasShell: document.querySelector("#canvasShell"),
  topSeed: document.querySelector("#topSeed"),
  topTargets: document.querySelector("#topTargets"),
  topHash: document.querySelector("#topHash"),
  bottomHash: document.querySelector("#bottomHash"),
  gridSize: document.querySelector("#gridSize"),
  canvasRevision: document.querySelector("#canvasRevision"),
  seedInput: document.querySelector("#seedInput"),
  seedState: document.querySelector("#seedState"),
  presetRow: document.querySelector("#presetRow"),
  regenerateButton: document.querySelector("#regenerateButton"),
  targetScore: document.querySelector("#targetScore"),
  targetList: document.querySelector("#targetList"),
  ruleSummary: document.querySelector("#ruleSummary"),
  boundaryState: document.querySelector("#boundaryState"),
  overlapState: document.querySelector("#overlapState"),
  digUsed: document.querySelector("#digUsed"),
  digLimit: document.querySelector("#digLimit"),
  budgetFill: document.querySelector("#budgetFill"),
  editFeedback: document.querySelector("#editFeedback"),
  routeAlert: document.querySelector("#routeAlert"),
  routeAlertText: document.querySelector("#routeAlertText"),
  tileInspector: document.querySelector("#tileInspector"),
  veinSizeInput: document.querySelector("#veinSizeInput"),
  veinSizeOutput: document.querySelector("#veinSizeOutput"),
  applyParamButton: document.querySelector("#applyParamButton"),
  saveButton: document.querySelector("#saveButton"),
  loadButton: document.querySelector("#loadButton"),
  exportButton: document.querySelector("#exportButton"),
  saveMeta: document.querySelector("#saveMeta"),
  saveLight: document.querySelector("#saveLight"),
  logList: document.querySelector("#logList"),
  logCount: document.querySelector("#logCount"),
  verifyBadge: document.querySelector("#verifyBadge"),
  verifyHash: document.querySelector("#verifyHash"),
  verifyRatio: document.querySelector("#verifyRatio"),
  verifyChanged: document.querySelector("#verifyChanged"),
  verifyRegion: document.querySelector("#verifyRegion"),
  verifyNote: document.querySelector("#verifyNote"),
  liveIndicator: document.querySelector("#liveIndicator"),
  toast: document.querySelector("#toast"),
  helpButton: document.querySelector("#helpButton"),
  helpDialog: document.querySelector("#helpDialog"),
  helpClose: document.querySelector("#helpClose")
};

const TOOL_HINTS = {
  inspect: "查看模式 · 点击网格读取地层与目标状态",
  dig: "挖除岩块 · 消耗 1 点额度并把岩块转为运输通道",
  seal: "设置障碍 · 点击通道制造阻断并定位断点"
};

const TILE_LABELS = {
  [TILE.ROCK]: "未开采岩块",
  [TILE.TUNNEL]: "运输通道",
  [TILE.ORE]: "矿脉岩层"
};

let scene = generateScene(SEED_PRESETS[0].seed, DEFAULT_PARAMS);
let tool = "inspect";
let hoveredCell = null;
let selectedCell = null;
let lastProof = null;
let pendingParam = scene.params.veinSize;
let toastTimer = null;
let restoredAutoSave = false;
let tileArt = [];
let lastSaveInfo = null;

function formatHash(hash) {
  return `0x${hashToHex(hash)}`;
}

function eventTime(iso) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date(iso));
  } catch {
    return "--:--:--";
  }
}

function showToast(message, type = "normal") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", type === "error");
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3200);
}

function setTool(nextTool) {
  tool = nextTool;
  document.querySelectorAll(".tool-button").forEach((button) => {
    const active = button.dataset.tool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.editFeedback.textContent = TOOL_HINTS[tool];
  elements.canvas.style.cursor =
    tool === "inspect" ? "crosshair" : tool === "seal" ? "not-allowed" : "cell";
}

function seedIsPending() {
  return (
    elements.seedInput.value.trim().toUpperCase() !== scene.seed.toUpperCase()
  );
}

function updateSeedState() {
  const pending = seedIsPending();
  elements.seedState.textContent = pending ? "待生成" : "已载入";
  elements.seedState.classList.toggle("pending", pending);
  document.querySelectorAll(".preset-chip").forEach((chip) => {
    chip.classList.toggle(
      "active",
      chip.dataset.seed.toUpperCase() ===
        elements.seedInput.value.trim().toUpperCase()
    );
  });
}

function setScene(nextScene) {
  scene = nextScene;
  pendingParam = scene.params.veinSize;
  elements.seedInput.value = scene.seed;
  elements.veinSizeInput.value = String(scene.params.veinSize);
  prepareTileArt();
  updateSeedState();
  renderUI();
  renderCanvas(performance.now());
}

function resetSelection() {
  hoveredCell = null;
  selectedCell = null;
  updateInspector();
}

function regenerateScene() {
  const nextSeed = elements.seedInput.value.trim() || SEED_PRESETS[0].seed;
  scene = generateScene(nextSeed, {
    veinSize: scene.params.veinSize,
    tunnelWidth: scene.params.tunnelWidth
  });
  lastProof = null;
  pendingParam = scene.params.veinSize;
  resetSelection();
  setScene(scene);
  autosave();
  showToast(`已按 seed ${scene.seed} 显式重新生成`);
}

function targetRouteMap() {
  return new Map(
    scene.network.routes.map((route) => [route.targetId, route])
  );
}

function renderHeader() {
  const reachable = scene.validation.reachableCount;
  const total = scene.validation.targetCount;
  elements.topSeed.textContent = scene.seed;
  elements.topTargets.textContent = `${reachable} / ${total}`;
  elements.topTargets.style.color = scene.validation.reachable
    ? "var(--safe)"
    : "var(--danger)";
  elements.topHash.textContent = formatHash(scene.layoutHash);
  elements.bottomHash.textContent = hashToHex(scene.layoutHash);
  elements.gridSize.textContent = `${scene.width}×${scene.height}`;
  elements.canvasRevision.textContent = `REV ${String(
    scene.revision
  ).padStart(3, "0")}`;
  elements.liveIndicator.textContent = scene.validation.reachable
    ? "LIVE"
    : "BROKEN";
  elements.liveIndicator.style.color = scene.validation.reachable
    ? "var(--safe)"
    : "var(--danger)";
}

function renderTargets() {
  const routes = targetRouteMap();
  const targets = [
    ...scene.objects.veins.map((vein) => ({
      ...vein,
      kind: "VEIN"
    })),
    { ...scene.objects.station, kind: "PLANT", color: "#8fa8c8" }
  ];
  elements.targetList.innerHTML = targets
    .map((target) => {
      const route = routes.get(target.id);
      const reachable = Boolean(route);
      return `
        <div class="target-row">
          <i class="target-dot ${reachable ? "reachable" : "blocked"}"
             style="background:${target.color};color:${target.color}"></i>
          <span class="target-name">
            ${target.name}
            <small>${target.kind} ${String(target.x).padStart(2, "0")}:${String(
              target.y
            ).padStart(2, "0")}</small>
          </span>
          <span class="target-distance ${reachable ? "ok" : "bad"}">${
            reachable ? `${route.distance} STEP` : "BLOCKED"
          }</span>
        </div>`;
    })
    .join("");
  elements.targetScore.textContent = `${scene.validation.reachableCount}/${scene.validation.targetCount}`;
  elements.targetScore.classList.toggle("blocked", !scene.validation.reachable);
}

function renderRules() {
  elements.ruleSummary.textContent = rulesSummary(scene);
  elements.boundaryState.textContent = scene.validation.boundaryValid
    ? "VALID"
    : "INVALID";
  elements.boundaryState.className = scene.validation.boundaryValid
    ? "valid"
    : "invalid";
  elements.overlapState.textContent = scene.validation.objectsOverlap
    ? "FOUND"
    : "NONE";
  elements.overlapState.className = scene.validation.objectsOverlap
    ? "has-overlap"
    : "none";
}

function renderToolState() {
  const remaining = scene.digLimit - scene.digUsed;
  elements.digUsed.textContent = String(scene.digUsed);
  elements.digLimit.textContent = String(scene.digLimit);
  elements.budgetFill.style.width = `${(remaining / scene.digLimit) * 100}%`;
  elements.budgetFill.style.background = remaining > 2
    ? "var(--amber)"
    : "var(--danger)";
}

function renderRouteAlert() {
  const marker = scene.blockedMarkers?.[0];
  if (!marker) {
    elements.routeAlert.hidden = true;
    return;
  }
  const names = marker.targetIds
    ?.map((id) => {
      const target =
        scene.objects.veins.find((vein) => vein.id === id) ||
        (id === scene.objects.station.id ? scene.objects.station : null);
      return target?.name;
    })
    .filter(Boolean)
    .join("、");
  elements.routeAlert.hidden = false;
  elements.routeAlertText.textContent = `阻断坐标 (${marker.x}, ${marker.y}) · ${names || "目标"}不可达`;
}

function renderProof() {
  const totalCells = scene.width * scene.height;
  if (!lastProof) {
    elements.verifyBadge.textContent = "STANDBY";
    elements.verifyBadge.className = "verify-badge";
    elements.verifyHash.textContent = "--------";
    elements.verifyRatio.textContent = "—";
    elements.verifyChanged.textContent = "0 格";
    elements.verifyRegion.textContent = "—";
    elements.verifyNote.textContent =
      "执行一次编辑后，这里会对比受影响区域之外的逐格哈希。";
    return;
  }

  const stable = lastProof.unaffectedStable;
  const ratio = (lastProof.unaffectedCount / totalCells) * 100;
  elements.verifyBadge.textContent = stable ? "HASH STABLE" : "HASH DRIFT";
  elements.verifyBadge.className = `verify-badge ${
    stable ? "stable" : "unstable"
  }`;
  elements.verifyHash.textContent = lastProof.unaffectedHashAfter;
  elements.verifyRatio.textContent = `${ratio.toFixed(1)}%`;
  elements.verifyChanged.textContent = `${lastProof.changedCount} 格`;
  elements.verifyRegion.textContent =
    lastProof.mode === "param"
      ? `${lastProof.affectedRects.length} 区 / ${lastProof.recomputedCells} 格`
      : lastProof.mode === "save"
        ? "整图回放"
        : "1 格";
  elements.verifyNote.textContent =
    lastProof.mode === "param"
      ? `仅重算 ${lastProof.recomputedCells}/${totalCells} 格（${(
          lastProof.regionRatio * 100
        ).toFixed(1)}%）；区域外哈希 ${
          stable ? "完全一致" : "发生变化"
        }。`
      : lastProof.mode === "save"
        ? `保存参数 ${lastProof.savedHash} → 载入重算 ${lastProof.loadedHash}；布局哈希${
            stable ? "完全一致" : "不一致"
          }。`
      : `仅修改 1 格；其余 ${lastProof.unaffectedCount} 格坐标与哈希${
          stable ? "保持不变" : "发生变化"
        }。`;
}

function actionLabel(entry) {
  if (entry.action === "dig") return "删除岩块";
  if (entry.action === "seal") return "设置障碍";
  if (entry.action === "param") return "局部重算";
  return entry.action;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderLog() {
  elements.logCount.textContent = `${scene.editLog.length} EVENTS`;
  if (scene.editLog.length === 0) {
    elements.logList.innerHTML = `
      <div class="empty-log">
        <span>NO EDITS YET</span>
        每次修改都会生成可达性检查与区域哈希证明。
      </div>`;
    return;
  }

  elements.logList.innerHTML = scene.editLog
    .slice()
    .reverse()
    .slice(0, 20)
    .map((entry) => {
      const coordinates =
        entry.x === null || entry.y === undefined
          ? entry.label
          : `${entry.label} @ ${entry.x},${entry.y}`;
      const detail =
        entry.action === "param"
          ? `${entry.proof?.recomputedCells || 0} 格局部重算 · ${entry.proof?.changedCount || 0} 格变更`
          : entry.blockers?.length
            ? `阻断 @ ${entry.blockers.map((blocker) => `${blocker.x},${blocker.y}`).join(" / ")}`
            : `未影响区 ${entry.proof?.unaffectedCount || 0} 格`;
      return `
        <div class="log-entry" title="${escapeHtml(eventTime(entry.at))}">
          <span class="log-rev">REV ${String(entry.revision).padStart(3, "0")}</span>
          <span class="log-action">${escapeHtml(actionLabel(entry))}</span>
          <span class="log-detail">${escapeHtml(
            `${coordinates} · ${detail}`
          )}</span>
          <span class="log-result ${entry.reachable ? "" : "bad"}">${
            entry.reachable ? "REACHABLE" : "BLOCKED"
          }</span>
        </div>`;
    })
    .join("");
}

function renderSaveMeta() {
  const saved = Boolean(lastSaveInfo);
  elements.saveLight.classList.toggle("saved", saved);
  if (!saved) {
    elements.saveMeta.textContent = "尚未保存 · 编辑会自动写入浏览器草稿";
    return;
  }
  const hash = lastSaveInfo.hash || hashToHex(scene.layoutHash);
  elements.saveMeta.textContent = `${
    lastSaveInfo.source === "auto" ? "自动草稿" : "已保存"
  } ${eventTime(lastSaveInfo.at)} · ${hash}`;
}

function renderPendingParam() {
  const minimum = Number(elements.veinSizeInput.min);
  const maximum = Number(elements.veinSizeInput.max);
  const progress = ((pendingParam - minimum) / (maximum - minimum)) * 100;
  elements.veinSizeOutput.textContent = pendingParam.toFixed(2);
  elements.veinSizeInput.style.setProperty(
    "--range-progress",
    `${progress.toFixed(1)}%`
  );
  elements.applyParamButton.textContent =
    Math.abs(pendingParam - scene.params.veinSize) < 0.001
      ? "重算受影响矿区"
      : `应用 ${pendingParam.toFixed(2)} 并局部重算`;
}

function updateInspector() {
  const cell = hoveredCell || selectedCell;
  if (!cell) {
    elements.tileInspector.innerHTML = `
      <span class="inspector-coord">X -- / Y --</span>
      <span class="inspector-name">悬停查看地层</span>`;
    return;
  }
  const index = indexOf(cell.x, cell.y, scene.width);
  const tile = scene.grid[index];
  const object = [
    scene.objects.entrance,
    scene.objects.station,
    ...scene.objects.veins
  ].find((item) => item.x === cell.x && item.y === cell.y);
  const label = object ? object.name : TILE_LABELS[tile];
  elements.tileInspector.innerHTML = `
    <span class="inspector-coord">X ${String(cell.x).padStart(
      2,
      "0"
    )} / Y ${String(cell.y).padStart(2, "0")}</span>
    <span class="inspector-name">${escapeHtml(label)}</span>`;
}

function renderUI() {
  renderHeader();
  renderTargets();
  renderRules();
  renderToolState();
  renderRouteAlert();
  renderProof();
  renderLog();
  renderSaveMeta();
  renderPendingParam();
  updateInspector();
}

function prepareTileArt() {
  tileArt = new Array(scene.width * scene.height);
  for (let y = 0; y < scene.height; y += 1) {
    for (let x = 0; x < scene.width; x += 1) {
      const index = indexOf(x, y, scene.width);
      let value =
        (Math.imul(x + 11, 374761393) ^
          Math.imul(y + 17, 668265263) ^
          scene.layoutHash) >>>
        0;
      value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
      const shade = ((value >>> 8) & 255) / 255;
      const glint = ((value >>> 19) & 63) / 63;
      tileArt[index] = { shade, glint, value };
    }
  }
}

const canvasContext = elements.canvas.getContext("2d");
const MONO_FONT = '"SFMono-Regular", "Cascadia Code", Consolas, monospace';
let canvasView = {
  cell: 24,
  offsetX: 0,
  offsetY: 0,
  width: 0,
  height: 0,
  dpr: 1
};

function resizeCanvas() {
  const rect = elements.canvasShell.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  elements.canvas.width = Math.max(1, Math.round(rect.width * dpr));
  elements.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  canvasContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvasView = {
    ...canvasView,
    width: rect.width,
    height: rect.height,
    dpr
  };
  renderCanvas(performance.now());
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function prepareView() {
  const padding = canvasView.width < 560 ? 15 : 26;
  const availableWidth = canvasView.width - padding * 2;
  const availableHeight = canvasView.height - padding * 2;
  const cell = Math.max(
    8,
    Math.floor(
      Math.min(availableWidth / scene.width, availableHeight / scene.height)
    )
  );
  return {
    padding,
    cell,
    mapWidth: cell * scene.width,
    mapHeight: cell * scene.height,
    offsetX: Math.round((canvasView.width - cell * scene.width) / 2),
    offsetY: Math.round((canvasView.height - cell * scene.height) / 2)
  };
}

function cellCenter(view, x, y) {
  return {
    x: view.offsetX + (x + 0.5) * view.cell,
    y: view.offsetY + (y + 0.5) * view.cell
  };
}

function isWalkable(tile) {
  return tile === TILE.TUNNEL || tile === TILE.ORE;
}

function veinAtCell(x, y) {
  let nearest = scene.objects.veins[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const vein of scene.objects.veins) {
    const nextDistance = Math.abs(vein.x - x) + Math.abs(vein.y - y);
    if (nextDistance < distance) {
      nearest = vein;
      distance = nextDistance;
    }
  }
  return nearest;
}

function drawRockCell(context, view, x, y, tileIndex) {
  const art = tileArt[tileIndex] || { shade: 0.5, glint: 0.5, value: 0 };
  const px = view.offsetX + x * view.cell;
  const py = view.offsetY + y * view.cell;
  const c = view.cell;
  const lightness = 12.5 + art.shade * 6;
  context.fillStyle = `hsl(207 12% ${lightness.toFixed(2)}%)`;
  context.fillRect(px + 0.65, py + 0.65, c - 1.3, c - 1.3);
  context.fillStyle = `rgba(196, 210, 224, ${0.025 + art.glint * 0.025})`;
  context.fillRect(px + 0.65, py + 0.65, c - 1.3, 1);
  context.fillStyle = "rgba(0, 0, 0, 0.2)";
  context.fillRect(px + 0.65, py + c - 1.45, c - 1.3, 0.8);

  if (art.glint > 0.72 && c > 17) {
    context.strokeStyle = "rgba(3, 6, 9, 0.32)";
    context.lineWidth = 0.65;
    context.beginPath();
    const startX = px + c * (0.25 + art.shade * 0.25);
    const startY = py + c * (0.22 + art.glint * 0.2);
    context.moveTo(startX, startY);
    context.lineTo(startX + c * 0.18, startY + c * 0.2);
    context.lineTo(startX + c * 0.1, startY + c * 0.42);
    context.stroke();
  }
}

function drawCarvedCell(context, view, x, y, tileIndex) {
  const c = view.cell;
  const px = view.offsetX + x * view.cell;
  const py = view.offsetY + y * view.cell;
  const center = { x: px + c / 2, y: py + c / 2 };
  context.fillStyle = "#080d11";
  context.fillRect(px, py, c, c);

  context.lineCap = "round";
  context.strokeStyle = "#152028";
  context.lineWidth = Math.max(2, c * 0.54);
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (
      nx < 0 ||
      nx >= scene.width ||
      ny < 0 ||
      ny >= scene.height ||
      !isWalkable(scene.grid[indexOf(nx, ny, scene.width)])
    ) {
      continue;
    }
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(center.x + dx * c * 0.6, center.y + dy * c * 0.6);
    context.stroke();
  }
  context.fillStyle = "#0e171c";
  context.beginPath();
  context.arc(center.x, center.y, c * 0.29, 0, Math.PI * 2);
  context.fill();

  if (scene.grid[tileIndex] === TILE.ORE) {
    drawOreShards(context, view, x, y, tileIndex, center);
  }
}

function drawOreShards(context, view, x, y, tileIndex, center) {
  const vein = veinAtCell(x, y);
  const art = tileArt[tileIndex] || { shade: 0.5, glint: 0.5, value: 1 };
  const c = view.cell;
  const shardCount = c > 18 ? 3 : 2;

  context.save();
  context.translate(center.x, center.y);
  context.fillStyle = vein.color;
  context.shadowColor = vein.color;
  context.shadowBlur = c * 0.22;
  context.globalAlpha = 0.7;
  for (let index = 0; index < shardCount; index += 1) {
    const angle = art.shade * Math.PI * 2 + index * 2.1;
    const offsetX = Math.cos(angle) * c * 0.18;
    const offsetY = Math.sin(angle) * c * 0.16;
    const size = c * (0.1 + ((art.glint + index * 0.19) % 1) * 0.1);
    context.beginPath();
    context.moveTo(offsetX, offsetY - size);
    context.lineTo(offsetX + size * 0.62, offsetY);
    context.lineTo(offsetX, offsetY + size);
    context.lineTo(offsetX - size * 0.62, offsetY);
    context.closePath();
    context.fill();
  }
  context.restore();
}

function drawTransportRoutes(context, view, time) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const route of scene.network.routes) {
    if (route.path.length < 2) continue;
    const points = route.path.map((point) =>
      cellCenter(view, point.x, point.y)
    );
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = "rgba(1, 5, 7, 0.75)";
    context.lineWidth = Math.max(3, view.cell * 0.22);
    context.stroke();
    context.strokeStyle = route.color;
    context.globalAlpha = 0.36;
    context.lineWidth = Math.max(1, view.cell * 0.09);
    context.shadowColor = route.color;
    context.shadowBlur = 5;
    context.stroke();

    context.setLineDash([view.cell * 0.22, view.cell * 0.5]);
    context.lineDashOffset = -(time * 0.018) % (view.cell * 0.72);
    context.globalAlpha = 0.88;
    context.strokeStyle = "#dffcf7";
    context.lineWidth = Math.max(0.8, view.cell * 0.045);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
  }
  context.restore();
}

function drawEntrance(context, view, time) {
  const { x, y } = cellCenter(
    view,
    scene.objects.entrance.x,
    scene.objects.entrance.y
  );
  const c = view.cell;
  const pulse = (Math.sin(time * 0.003) + 1) / 2;

  context.save();
  context.translate(x, y);
  context.strokeStyle = `rgba(240, 164, 69, ${0.28 + pulse * 0.2})`;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(0, 0, c * (0.38 + pulse * 0.08), 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#17120c";
  context.beginPath();
  context.arc(0, 0, c * 0.31, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#f0a445";
  context.lineWidth = 1.4;
  context.beginPath();
  context.arc(0, 0, c * 0.21, -Math.PI * 0.8, Math.PI * 0.8);
  context.stroke();
  context.fillStyle = "#f6c77c";
  context.beginPath();
  context.moveTo(c * 0.08, -c * 0.14);
  context.lineTo(c * 0.23, 0);
  context.lineTo(c * 0.08, c * 0.14);
  context.closePath();
  context.fill();
  context.restore();

  if (c >= 19) {
    context.fillStyle = "rgba(246, 199, 124, 0.72)";
    context.font = `${Math.max(6.5, c * 0.27)}px ${MONO_FONT}`;
    context.textAlign = "left";
    context.fillText("ENTRY", x - c * 0.12, y + c * 0.62);
  }
}

function drawStation(context, view, time) {
  const { x, y } = cellCenter(
    view,
    scene.objects.station.x,
    scene.objects.station.y
  );
  const c = view.cell;
  const pulse = (Math.sin(time * 0.0025 + 1) + 1) / 2;
  const radius = c * 0.32;

  context.save();
  context.translate(x, y);
  context.rotate(Math.PI / 4);
  context.fillStyle = "#121a21";
  context.strokeStyle = "rgba(143, 168, 200, 0.82)";
  context.lineWidth = 1.1;
  context.fillRect(-radius, -radius, radius * 2, radius * 2);
  context.strokeRect(-radius, -radius, radius * 2, radius * 2);
  context.rotate(-Math.PI / 4);
  context.fillStyle = `rgba(143, 168, 200, ${0.5 + pulse * 0.45})`;
  context.fillRect(-c * 0.16, -c * 0.17, c * 0.06, c * 0.34);
  context.fillRect(-c * 0.03, -c * 0.23, c * 0.06, c * 0.46);
  context.fillRect(c * 0.1, -c * 0.12, c * 0.06, c * 0.24);
  context.restore();

  if (c >= 19) {
    context.fillStyle = "rgba(172, 191, 214, 0.68)";
    context.font = `${Math.max(6.2, c * 0.24)}px ${MONO_FONT}`;
    context.textAlign = "right";
    context.fillText("PLANT", x + c * 0.12, y + c * 0.62);
  }
}

function drawVeinMarkers(context, view, time) {
  const unreachable = new Set(
    scene.network.unreachableTargets.map((target) => target.id)
  );
  scene.objects.veins.forEach((vein, index) => {
    const { x, y } = cellCenter(view, vein.x, vein.y);
    const c = view.cell;
    const blocked = unreachable.has(vein.id);
    const color = blocked ? "#ff6f61" : vein.color;
    const pulse = (Math.sin(time * 0.0027 + index * 1.4) + 1) / 2;
    context.save();
    context.translate(x, y);
    context.rotate(Math.PI / 4);
    context.strokeStyle = color;
    context.globalAlpha = 0.72 + pulse * 0.22;
    context.lineWidth = 1.2;
    const size = c * (0.23 + pulse * 0.035);
    context.strokeRect(-size, -size, size * 2, size * 2);
    context.globalAlpha = 0.22;
    context.fillStyle = color;
    context.fillRect(-size, -size, size * 2, size * 2);
    context.restore();

    if (c >= 19) {
      context.fillStyle = color;
      context.font = `600 ${Math.max(6.2, c * 0.23)}px ${MONO_FONT}`;
      context.textAlign = "left";
      context.fillText(`V${index + 1}`, x + c * 0.24, y - c * 0.22);
    }
  });
}

function drawBlockedMarkers(context, view, time) {
  for (const marker of scene.blockedMarkers || []) {
    const { x, y } = cellCenter(view, marker.x, marker.y);
    const c = view.cell;
    const pulse = (Math.sin(time * 0.005) + 1) / 2;
    context.save();
    context.strokeStyle = "#ff6f61";
    context.lineWidth = 1.5;
    context.shadowColor = "#ff6f61";
    context.shadowBlur = 9;
    context.globalAlpha = 0.55;
    context.strokeRect(
      x - c * (0.37 + pulse * 0.09),
      y - c * (0.37 + pulse * 0.09),
      c * (0.74 + pulse * 0.18),
      c * (0.74 + pulse * 0.18)
    );
    context.globalAlpha = 1;
    context.lineWidth = 1.8;
    context.beginPath();
    context.moveTo(x - c * 0.21, y - c * 0.21);
    context.lineTo(x + c * 0.21, y + c * 0.21);
    context.moveTo(x + c * 0.21, y - c * 0.21);
    context.lineTo(x - c * 0.21, y + c * 0.21);
    context.stroke();
    context.restore();

    if (c >= 18) {
      const label = `BLOCK ${marker.x}:${marker.y}`;
      context.font = `600 ${Math.max(6.2, c * 0.23)}px ${MONO_FONT}`;
      const textWidth = context.measureText(label).width;
      context.fillStyle = "rgba(63, 19, 17, 0.94)";
      context.fillRect(x - textWidth / 2 - 4, y - c * 0.82, textWidth + 8, 14);
      context.strokeStyle = "rgba(255, 111, 97, 0.5)";
      context.strokeRect(
        x - textWidth / 2 - 4,
        y - c * 0.82,
        textWidth + 8,
        14
      );
      context.fillStyle = "#ffaaa2";
      context.textAlign = "center";
      context.fillText(label, x, y - c * 0.82 + 10);
    }
  }
}

function drawCursor(context, view) {
  const active = hoveredCell || selectedCell;
  if (!active) return;
  const isHover = Boolean(hoveredCell);
  const px = view.offsetX + active.x * view.cell;
  const py = view.offsetY + active.y * view.cell;
  const color =
    tool === "seal" && isHover
      ? "#ff6f61"
      : tool === "dig" && isHover
        ? "#f0a445"
        : "#dfe7ee";
  context.save();
  context.globalAlpha = isHover ? 1 : 0.58;
  context.strokeStyle = color;
  context.lineWidth = 1.2;
  context.strokeRect(
    px + 1.2,
    py + 1.2,
    view.cell - 2.4,
    view.cell - 2.4
  );
  if (tool === "seal" && isHover) {
    context.beginPath();
    context.moveTo(px + view.cell * 0.34, py + view.cell * 0.34);
    context.lineTo(px + view.cell * 0.66, py + view.cell * 0.66);
    context.moveTo(px + view.cell * 0.66, py + view.cell * 0.34);
    context.lineTo(px + view.cell * 0.34, py + view.cell * 0.66);
    context.stroke();
  }
  context.restore();
}

function drawMapFrame(context, view) {
  context.save();
  context.strokeStyle = "rgba(240, 164, 69, 0.32)";
  context.lineWidth = 1;
  context.strokeRect(
    view.offsetX - 2,
    view.offsetY - 2,
    view.mapWidth + 4,
    view.mapHeight + 4
  );
  context.strokeStyle = "rgba(177, 191, 208, 0.12)";
  context.strokeRect(
    view.offsetX - 6,
    view.offsetY - 6,
    view.mapWidth + 12,
    view.mapHeight + 12
  );
  const corner = Math.min(13, view.cell * 0.55);
  context.strokeStyle = "rgba(240, 164, 69, 0.7)";
  context.lineWidth = 1.2;
  const corners = [
    [view.offsetX - 6, view.offsetY - 6, 1, 1],
    [view.offsetX + view.mapWidth + 6, view.offsetY - 6, -1, 1],
    [view.offsetX - 6, view.offsetY + view.mapHeight + 6, 1, -1],
    [
      view.offsetX + view.mapWidth + 6,
      view.offsetY + view.mapHeight + 6,
      -1,
      -1
    ]
  ];
  for (const [x, y, sx, sy] of corners) {
    context.beginPath();
    context.moveTo(x + sx * corner, y);
    context.lineTo(x, y);
    context.lineTo(x, y + sy * corner);
    context.stroke();
  }
  context.restore();
}

function drawBackground(context, time) {
  const width = canvasView.width;
  const height = canvasView.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#080b0f";
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(
    width * 0.52,
    height * 0.46,
    0,
    width * 0.52,
    height * 0.46,
    width * 0.7
  );
  glow.addColorStop(0, "rgba(37, 51, 57, 0.32)");
  glow.addColorStop(0.58, "rgba(13, 20, 24, 0.18)");
  glow.addColorStop(1, "rgba(2, 4, 6, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.1;
  context.strokeStyle = "#a7b6c2";
  context.lineWidth = 0.55;
  const drift = (time * 0.002) % 46;
  for (let x = -height; x < width + height; x += 46) {
    context.beginPath();
    context.moveTo(x + drift, 0);
    context.lineTo(x - height + drift, height);
    context.stroke();
  }
  context.restore();
}

function drawScene(context, view, time) {
  context.save();
  drawRoundedRect(
    context,
    view.offsetX,
    view.offsetY,
    view.mapWidth,
    view.mapHeight,
    1
  );
  context.clip();

  const mapShade = context.createLinearGradient(
    view.offsetX,
    view.offsetY,
    view.offsetX,
    view.offsetY + view.mapHeight
  );
  mapShade.addColorStop(0, "#12181e");
  mapShade.addColorStop(1, "#0b1015");
  context.fillStyle = mapShade;
  context.fillRect(view.offsetX, view.offsetY, view.mapWidth, view.mapHeight);

  for (let y = 0; y < scene.height; y += 1) {
    for (let x = 0; x < scene.width; x += 1) {
      const tileIndex = indexOf(x, y, scene.width);
      const tile = scene.grid[tileIndex];
      if (tile === TILE.ROCK) {
        drawRockCell(context, view, x, y, tileIndex);
      } else {
        drawCarvedCell(context, view, x, y, tileIndex);
      }
    }
  }

  drawTransportRoutes(context, view, time);
  drawEntrance(context, view, time);
  drawStation(context, view, time);
  drawVeinMarkers(context, view, time);
  drawBlockedMarkers(context, view, time);
  drawCursor(context, view);

  const vignette = context.createRadialGradient(
    view.offsetX + view.mapWidth / 2,
    view.offsetY + view.mapHeight / 2,
    view.mapWidth * 0.2,
    view.offsetX + view.mapWidth / 2,
    view.offsetY + view.mapHeight / 2,
    view.mapWidth * 0.67
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.23)");
  context.fillStyle = vignette;
  context.fillRect(view.offsetX, view.offsetY, view.mapWidth, view.mapHeight);
  context.restore();
  drawMapFrame(context, view);
}

function renderCanvas(time = 0) {
  if (!canvasContext || !canvasView.width || !canvasView.height) return;
  drawBackground(canvasContext, time);
  const view = prepareView();
  canvasView = {
    ...canvasView,
    cell: view.cell,
    offsetX: view.offsetX,
    offsetY: view.offsetY
  };
  drawScene(canvasContext, view, time);
}

function animateCanvas(time) {
  renderCanvas(time);
  window.requestAnimationFrame(animateCanvas);
}

function cellFromPointer(event) {
  const rect = elements.canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const x = Math.floor((localX - canvasView.offsetX) / canvasView.cell);
  const y = Math.floor((localY - canvasView.offsetY) / canvasView.cell);
  if (x < 0 || x >= scene.width || y < 0 || y >= scene.height) {
    return null;
  }
  return { x, y };
}

function handleCanvasClick(event) {
  const cell = cellFromPointer(event);
  if (!cell) return;
  if (tool === "inspect") {
    selectedCell = cell;
    updateInspector();
    const index = indexOf(cell.x, cell.y, scene.width);
    const tile = scene.grid[index];
    const object = [
      scene.objects.entrance,
      scene.objects.station,
      ...scene.objects.veins
    ].find((item) => item.x === cell.x && item.y === cell.y);
    showToast(
      `${cell.x},${cell.y} · ${object ? object.name : TILE_LABELS[tile]}`
    );
    return;
  }

  const result = editTile(scene, cell.x, cell.y, tool);
  if (!result.ok) {
    showToast(result.reason, "error");
    return;
  }
  scene = result.scene;
  lastProof = { ...result.proof, mode: "edit" };
  selectedCell = cell;
  hoveredCell = cell;
  prepareTileArt();
  autosave();
  renderUI();
  renderCanvas(performance.now());
  if (result.blockers.length > 0) {
    const blocker = result.blockers[0];
    elements.editFeedback.textContent = `路线断开 · 阻断 @ ${blocker.x}, ${blocker.y}`;
    showToast(
      `路线断开：阻断位于 (${blocker.x}, ${blocker.y})，可切换挖除工具修复`,
      "error"
    );
  } else if (tool === "dig") {
    elements.editFeedback.textContent = `已删除 (${cell.x}, ${cell.y}) 岩块 · 路线即时重算`;
    showToast(
      scene.validation.reachable
        ? `岩块已删除，${scene.validation.reachableCount}/${scene.validation.targetCount} 目标可达`
        : "岩块已删除，仍有目标不可达"
    );
  } else {
    elements.editFeedback.textContent = `障碍已设置 · 目标仍全部可达`;
    showToast("障碍已设置，运输网络保持连通");
  }
}

function applyPendingParam() {
  const result = updateVeinSize(scene, pendingParam);
  if (!result.ok) {
    showToast(result.reason, "error");
    return;
  }
  scene = result.scene;
  lastProof = { ...result.proof, mode: "param" };
  selectedCell = null;
  hoveredCell = null;
  prepareTileArt();
  autosave();
  renderUI();
  renderCanvas(performance.now());
  showToast(
    `局部重算完成：${result.proof.recomputedCells} 格，未影响区哈希${
      result.proof.unaffectedStable ? "保持一致" : "发生变化"
    }`
  );
}

function persistEnvelope(key, source) {
  const payload = serializeScene(scene);
  const envelope = {
    at: new Date().toISOString(),
    hash: payload.layoutHash,
    payload
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    showToast("浏览器存储不可用，无法写入存档", "error");
    return null;
  }
  lastSaveInfo = { at: envelope.at, hash: envelope.hash, source };
  renderSaveMeta();
  elements.saveLight.classList.add("saved");
  return envelope;
}

function autosave() {
  persistEnvelope(AUTO_SAVE_KEY, "auto");
}

function saveSnapshot() {
  const envelope = persistEnvelope(SNAPSHOT_KEY, "manual");
  if (envelope) {
    showToast(`快照已保存 · 哈希 ${envelope.hash}`);
  }
}

function loadSnapshot(silent = false) {
  let raw;
  try {
    raw = window.localStorage.getItem(SNAPSHOT_KEY);
  } catch {
    raw = null;
  }
  if (!raw) {
    if (!silent) showToast("没有可载入的手动快照", "error");
    return false;
  }

  try {
    const envelope = JSON.parse(raw);
    const restored = deserializeScene(envelope.payload);
    if (!restored.hashMatch) {
      throw new Error(
        `哈希不一致：${restored.savedHash} → ${restored.loadedHash}`
      );
    }
    scene = restored.scene;
    lastSaveInfo = {
      at: envelope.at,
      hash: envelope.hash,
      source: "manual"
    };
    lastProof = {
      mode: "save",
      changedCount: 0,
      affectedRects: [],
      recomputedCells: scene.width * scene.height,
      regionRatio: 1,
      unaffectedCount: scene.width * scene.height,
      unaffectedHashBefore: restored.savedHash,
      unaffectedHashAfter: restored.loadedHash,
      savedHash: restored.savedHash,
      loadedHash: restored.loadedHash,
      unaffectedStable: true
    };
    resetSelection();
    setScene(scene);
    if (!silent) {
      showToast(
        `快照已载入 · 布局哈希一致 ${restored.loadedHash}`
      );
    }
    return true;
  } catch (error) {
    if (!silent) showToast(`载入失败：${error.message}`, "error");
    return false;
  }
}

function restoreAutoSave() {
  let raw;
  try {
    raw = window.localStorage.getItem(AUTO_SAVE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const envelope = JSON.parse(raw);
    const restored = deserializeScene(envelope.payload);
    if (!restored.hashMatch) return;
    scene = restored.scene;
    lastSaveInfo = {
      at: envelope.at,
      hash: envelope.hash,
      source: "auto"
    };
    restoredAutoSave = true;
  } catch {
    restoredAutoSave = false;
  }
}

function exportJson() {
  const payload = serializeScene(scene);
  const envelope = {
    format: "depth-grid-scene",
    exportedAt: new Date().toISOString(),
    verification: {
      layoutHash: payload.layoutHash,
      targetCount: scene.validation.targetCount,
      reachableCount: scene.validation.reachableCount,
      boundaryValid: scene.validation.boundaryValid,
      objectsOverlap: scene.validation.objectsOverlap,
      editRecordCount: scene.editLog.length
    },
    payload
  };
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `depth-grid-${scene.seed}-${hashToHex(scene.layoutHash)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("场景、seed、参数与编辑记录已导出");
}

function buildPresetChips() {
  elements.presetRow.innerHTML = SEED_PRESETS.map(
    (preset) =>
      `<button class="preset-chip" type="button" data-seed="${preset.seed}" title="${preset.seed}">
        ${preset.seed.split("-")[0]} · ${preset.label}
      </button>`
  ).join("");
  elements.presetRow.querySelectorAll(".preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      elements.seedInput.value = chip.dataset.seed;
      updateSeedState();
      elements.editFeedback.textContent = `SEED 已选择 · 点击“重新生成场景”应用`;
    });
  });
}

function bindEvents() {
  document.querySelectorAll(".tool-button").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    hoveredCell = cellFromPointer(event);
    updateInspector();
  });
  elements.canvas.addEventListener("pointerleave", () => {
    hoveredCell = null;
    updateInspector();
  });
  elements.canvas.addEventListener("click", handleCanvasClick);

  elements.seedInput.addEventListener("input", updateSeedState);
  elements.seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") regenerateScene();
  });
  elements.regenerateButton.addEventListener("click", regenerateScene);

  elements.veinSizeInput.addEventListener("input", () => {
    pendingParam = Number(elements.veinSizeInput.value);
    renderPendingParam();
  });
  elements.applyParamButton.addEventListener("click", applyPendingParam);

  elements.saveButton.addEventListener("click", saveSnapshot);
  elements.loadButton.addEventListener("click", () => loadSnapshot(false));
  elements.exportButton.addEventListener("click", exportJson);

  elements.helpButton.addEventListener("click", () => {
    elements.helpDialog.showModal();
  });
  elements.helpClose.addEventListener("click", () => {
    elements.helpDialog.close();
  });
  elements.helpDialog.addEventListener("click", (event) => {
    if (event.target === elements.helpDialog) {
      elements.helpDialog.close();
    }
  });

  window.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.key === "1") setTool("inspect");
    if (event.key === "2") setTool("dig");
    if (event.key === "3") setTool("seal");
    if (event.key === "Escape") {
      if (elements.helpDialog.open) {
        elements.helpDialog.close();
      } else {
        setTool("inspect");
        resetSelection();
      }
    }
  });

  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(elements.canvasShell);
  window.addEventListener("resize", resizeCanvas);
}

function initialize() {
  buildPresetChips();
  bindEvents();
  restoreAutoSave();
  setScene(scene);
  setTool("inspect");
  resizeCanvas();
  if (!restoredAutoSave) {
    autosave();
  } else {
    renderSaveMeta();
    window.setTimeout(() => {
      showToast(`已恢复自动草稿 · ${scene.seed}`);
    }, 350);
  }
  window.requestAnimationFrame(animateCanvas);
}

initialize();
