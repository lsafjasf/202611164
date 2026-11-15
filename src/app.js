import "@fontsource-variable/noto-sans-sc";
import {
  DEFAULT_PARAMS,
  WORLD,
  addBlocker,
  generateWorld,
  hydrateWorld,
  moveBuilding,
  moveParkToBlock,
  normalizeSeed,
  removeBlocker,
  serializeWorld,
  updateDensity,
  validateSeeds,
} from "./generator.js";
import { renderScene } from "./renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const SAVE_KEY = "blockweave-scene-v1";

const canvas = $("#city-canvas");
const ctx = canvas.getContext("2d");
canvas.width = WORLD.width * 2;
canvas.height = WORLD.height * 2;

let world = generateWorld(DEFAULT_PARAMS);
const state = {
  mode: "select",
  selected: null,
  drag: null,
  hoverBlockId: null,
  flash: null,
  toastTimer: null,
  verificationTimer: null,
};

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function showToast(message, warning = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("warn", warning);
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  input.style.setProperty("--fill", `${((value - min) / (max - min)) * 100}%`);
}

function flashBlocks(blockIds) {
  state.flash = { blockIds: [...new Set(blockIds)], startedAt: performance.now() };
}

function seedLabel() {
  return String(world.params.seed);
}

function updateReport(title, detail) {
  const report = $("#update-report");
  report.innerHTML = `<span class="report-light"></span><div><strong></strong><p></p></div>`;
  report.querySelector("strong").textContent = title;
  report.querySelector("p").textContent = detail;
}

function updateTargetList() {
  const list = $("#target-list");
  list.replaceChildren();
  for (const target of world.targets) {
    const row = document.createElement("div");
    row.className = `target-row${target.reachable ? "" : " blocked"}`;
    row.innerHTML = `<i></i><b>${target.label}</b><span>${target.reachable ? `${Math.round(target.routeLength)} m` : "不可达"}</span>`;
    list.append(row);
  }
}

function targetDetail() {
  const report = world.blockerReport;
  if (!report) return "全部目标经道路网络可达";
  const critical = report.location.restoredTargets.length
    ? `可解除 ${report.location.restoredTargets.join("、")} 的阻断`
    : report.locations.map((item) => `${item.label} (${Math.round(item.x)}, ${Math.round(item.y)})`).join("；");
  return `${report.message}；${critical}`;
}

function updateVerificationStale() {
  const summary = $("#verify-summary");
  if (!summary.dataset.verified) return;
  summary.querySelector("strong").textContent = "参数已变化";
  summary.querySelector("p").textContent = "点击重跑校验当前 seed 与相邻 seed";
}

function updateUI() {
  const metrics = world.metrics;
  setText("#top-seed", `SEED ${seedLabel()}`);
  setText("#top-hash", `#${world.layoutHash}`);
  setText("#layout-hash", world.layoutHash);
  setText("#target-badge", metrics.targetCount);
  setText("#building-badge", metrics.buildingCount);
  setText("#green-badge", metrics.parkArea.toLocaleString("zh-CN"));
  setText("#reachable-ratio", `${metrics.reachableTargets}/${metrics.targetCount}`);
  setText("#coverage-stat", `${metrics.coverage.toFixed(1)}%`);
  setText("#path-stat", `${metrics.pathLength} m`);
  setText("#tree-stat", metrics.treeCount);
  setText("#served-stat", metrics.servedBuildings);
  setText("#density-value", `${world.params.density}%`);
  setText("#scale-value", `${world.params.blockScale}m`);
  $("#density-slider").value = world.params.density;
  $("#scale-slider").value = world.params.blockScale;
  $("#seed-input").value = seedLabel();
  setRangeFill($("#density-slider"));
  setRangeFill($("#scale-slider"));

  const routeAlert = $("#route-alert");
  routeAlert.hidden = !world.blockerReport;
  if (world.blockerReport) setText("#route-alert-text", targetDetail());
  updateTargetList();
  renderSelection();
}

function renderSelection() {
  const detail = $("#selection-detail");
  const empty = $("#empty-selection");
  if (!state.selected) {
    detail.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  detail.hidden = false;
  detail.replaceChildren();

  let object;
  let title;
  let tag;
  let fields = [];
  let tip = "";
  let canDelete = false;
  if (state.selected.type === "building") {
    object = world.blocks.flatMap((block) => block.buildings).find(
      (item) => item.id === state.selected.id,
    );
    if (!object) return clearSelection();
    const block = world.blocks.find((item) => item.id === object.blockId);
    title = object.kind === "civic" ? "公共建筑" : object.kind === "office" ? "办公塔楼" : "街区住宅";
    tag = object.id;
    fields = [
      ["街区", object.blockId],
      ["坐标", `${Math.round(object.x)}, ${Math.round(object.y)}`],
      ["占地", `${Math.round(object.w)} × ${Math.round(object.h)} m`],
      ["高度", `${object.tall} m`],
    ];
    tip = `拖拽仅重算 ${block.id}；其他 ${world.blocks.length - 1} 个街区坐标与哈希保持。`;
  } else if (state.selected.type === "park") {
    object = world.parks.find((item) => item.id === state.selected.id);
    if (!object) return clearSelection();
    title = "邻里公园";
    tag = object.id;
    fields = [
      ["街区", object.blockId],
      ["面积", `${Math.round(object.w * object.h).toLocaleString("zh-CN")} m²`],
      ["树木", `${object.trees.length} 棵`],
      ["步道", `${object.path?.length ?? 0} m`],
    ];
    tip = "拖动到另一建筑街区即可搬迁；步道长度、服务建筑与绿化统计会同步更新。";
  } else if (state.selected.type === "blocker") {
    object = world.blockers.find((item) => item.id === state.selected.id);
    if (!object) return clearSelection();
    title = "道路阻断";
    tag = object.id;
    fields = [
      ["位置", `${Math.round(object.x)}, ${Math.round(object.y)}`],
      ["影响路段", `${object.blockedEdgeIds.length} 条`],
      ["不可达目标", `${world.targets.filter((target) => !target.reachable).length} 个`],
      ["临界阻断", world.blockerReport?.location.id === object.id ? "是" : "否"],
    ];
    tip = world.blockerReport?.message ?? "该阻断未造成目标失联。";
    canDelete = true;
  }

  const head = document.createElement("div");
  head.className = "selection-head";
  head.innerHTML = `<strong>${title}</strong><span class="object-tag">${tag}</span>`;
  const grid = document.createElement("div");
  grid.className = "selection-grid";
  for (const [label, value] of fields) {
    const item = document.createElement("div");
    item.innerHTML = `<span>${label}</span><b>${value}</b>`;
    grid.append(item);
  }
  const note = document.createElement("p");
  note.className = "selection-tip";
  note.textContent = tip;
  detail.append(head, grid, note);
  if (canDelete) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "danger-btn";
    button.textContent = "移除该道路阻断";
    button.addEventListener("click", () => {
      removeBlocker(world, object.id);
      clearSelection();
      updateUI();
      updateReport("阻断已移除", "路网与目标可达性已重新计算");
      flashBlocks(world.blocks.map((block) => block.id));
      showToast("道路阻断已移除，目标可达性已恢复");
    });
    detail.append(button);
  }
}

function clearSelection() {
  state.selected = null;
  renderSelection();
}

function renderVerification(result) {
  const summary = $("#verify-summary");
  summary.dataset.verified = "true";
  summary.classList.toggle("failed", !result.pass);
  summary.innerHTML = `<span class="verify-icon">${result.pass ? "✓" : "!"}</span><div><strong>${result.pass ? "双 seed 校验通过" : "校验未通过"}</strong><p>${result.pass ? "确定性、可达性、零重叠、边界均通过" : "请查看下方失败项"}</p></div>`;
  const list = $("#verify-list");
  list.replaceChildren();
  result.seeds.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "verify-row";
    const check = entry.checks;
    const status = entry.pass ? "PASS" : "FAIL";
    row.innerHTML = `
      <div class="verify-row-head"><span>${index === 0 ? "A" : "B"} · SEED ${entry.seed}</span><span>${status}</span></div>
      <p>#${entry.layoutHash} · 路网 ${check.roadConnected ? "连通" : "断开"} · 目标 ${check.reachable}/${check.targetCount}</p>
      <p>重叠 ${check.overlapCount} · 边界 ${check.boundaryCorrect ? "正确" : "越界"} · 复现 ${entry.deterministic ? "一致" : "失败"}</p>
    `;
    list.append(row);
  });
}

function runVerification() {
  const result = validateSeeds(world.params.seed, {
    density: world.params.density,
    blockScale: world.params.blockScale,
  });
  renderVerification(result);
}

function scheduleVerification() {
  clearTimeout(state.verificationTimer);
  state.verificationTimer = setTimeout(runVerification, 260);
}

function setSaveProof(text, status = "") {
  const proof = $("#save-proof b");
  proof.textContent = text;
  proof.className = status;
}

function regenerateWorld(nextParams = {}, title = "场景已重新生成") {
  const params = {
    seed: nextParams.seed ?? world.params.seed,
    density: nextParams.density ?? world.params.density,
    blockScale: nextParams.blockScale ?? world.params.blockScale,
  };
  const previousHash = world.layoutHash;
  world = generateWorld(params);
  state.selected = null;
  state.drag = null;
  flashBlocks(world.blocks.map((block) => block.id));
  updateUI();
  updateReport(
    title,
    `seed ${world.params.seed} · ${world.metrics.buildingCount} 栋建筑 · 全量 ${world.blocks.length} 街区`,
  );
  setSaveProof("场景尚未保存", "");
  showToast(`${title} · #${world.layoutHash}${previousHash === world.layoutHash ? "（布局未变）" : ""}`);
  scheduleVerification();
}

function saveScene() {
  try {
    const snapshot = serializeWorld(world);
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
    setSaveProof(`已保存 #${world.layoutHash}`, "good");
    updateReport("场景已保存", `参数与对象位置已写入本地 · #${world.layoutHash}`);
    showToast(`已保存场景 #${world.layoutHash}`);
  } catch (error) {
    setSaveProof("保存失败", "bad");
    showToast(`保存失败：${error.message}`, true);
  }
}

function loadScene() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    setSaveProof("没有本地快照", "bad");
    showToast("没有可载入的本地场景，请先保存", true);
    return;
  }
  try {
    const snapshot = JSON.parse(raw);
    const expectedHash = snapshot.layoutHash;
    world = hydrateWorld(snapshot);
    state.selected = null;
    state.drag = null;
    const matches = world.layoutHash === expectedHash;
    updateUI();
    setSaveProof(
      matches ? `载入哈希一致 #${world.layoutHash}` : `哈希不一致 ${expectedHash} → ${world.layoutHash}`,
      matches ? "good" : "bad",
    );
    updateReport(
      matches ? "载入校验通过" : "载入校验失败",
      matches
        ? `参数与布局哈希一致 · #${world.layoutHash} · ${world.metrics.buildingCount} 栋建筑`
        : `保存值 #${expectedHash} 与重算值 #${world.layoutHash} 不同`,
    );
    showToast(matches ? `载入完成，布局哈希一致 #${world.layoutHash}` : "载入失败：布局哈希不一致", !matches);
    flashBlocks(world.blocks.map((block) => block.id));
    scheduleVerification();
  } catch (error) {
    setSaveProof("载入失败", "bad");
    showToast(`载入失败：${error.message}`, true);
  }
}

function bindParameterControls() {
  const densitySlider = $("#density-slider");
  densitySlider.addEventListener("input", () => {
    setText("#density-value", `${densitySlider.value}%`);
    setRangeFill(densitySlider);
  });
  densitySlider.addEventListener("change", () => {
    const previous = world.params.density;
    const result = updateDensity(world, Number(densitySlider.value));
    flashBlocks(result.affectedBlocks);
    updateUI();
    updateReport(
      `密度 ${previous}% → ${world.params.density}%`,
      result.affectedCount
        ? `仅重算 ${result.affectedCount}/${result.totalBlocks} 个受影响街区 · ${result.preservedCount} 个街区哈希保持`
        : `没有街区布局发生变化 · ${result.preservedCount} 个街区哈希保持`,
    );
    setSaveProof("参数已修改，尚未保存", "");
    updateVerificationStale();
    scheduleVerification();
  });

  const scaleSlider = $("#scale-slider");
  scaleSlider.addEventListener("input", () => {
    setText("#scale-value", `${scaleSlider.value}m`);
    setRangeFill(scaleSlider);
  });
  scaleSlider.addEventListener("change", () => {
    regenerateWorld(
      { blockScale: Number(scaleSlider.value) },
      `街区尺度调整为 ${scaleSlider.value}m`,
    );
  });
}

function bindSeedControls() {
  const applySeed = () => {
    const seed = normalizeSeed($("#seed-input").value);
    if (seed === world.params.seed) {
      showToast("seed 未变化");
      return;
    }
    regenerateWorld({ seed }, `seed 已切换为 ${seed}`);
  };
  $("#apply-seed").addEventListener("click", applySeed);
  $("#seed-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applySeed();
  });
  $("#random-seed-btn").addEventListener("click", () => {
    const seed = 10000 + Math.floor(Math.random() * 899999);
    $("#seed-input").value = seed;
    regenerateWorld({ seed }, `已生成新 seed ${seed}`);
  });
  $("#regenerate-btn").addEventListener("click", () => {
    regenerateWorld({}, "已按当前参数显式重新生成");
  });
}

function eventPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * WORLD.width,
    y: ((event.clientY - rect.top) / rect.height) * WORLD.height,
  };
}

function buildingAt(point) {
  for (const block of world.blocks) {
    for (let index = block.buildings.length - 1; index >= 0; index -= 1) {
      const building = block.buildings[index];
      if (
        point.x >= building.x &&
        point.x <= building.x + building.w &&
        point.y >= building.y &&
        point.y <= building.y + building.h
      ) {
        return building;
      }
    }
  }
  return null;
}

function parkAt(point) {
  return (
    world.parks.find(
      (park) =>
        point.x >= park.x &&
        point.x <= park.x + park.w &&
        point.y >= park.y &&
        point.y <= park.y + park.h,
    ) ?? null
  );
}

function blockerAt(point) {
  return (
    world.blockers.find(
      (blocker) => Math.hypot(blocker.x - point.x, blocker.y - point.y) <= 18,
    ) ?? null
  );
}

function blockAt(point) {
  return (
    world.blocks.find(
      (block) =>
        point.x >= block.x &&
        point.x <= block.x + block.w &&
        point.y >= block.y &&
        point.y <= block.y + block.h,
    ) ?? null
  );
}

function setMode(mode) {
  state.mode = mode;
  $$(".mode-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  $("#canvas-wrap").classList.toggle("tool-blocker", mode === "blocker");
  setText(
    "#mode-hint",
    mode === "blocker"
      ? "点击道路放置一次阻断；切回选择工具后可检查并移除。"
      : "拖动楼栋微调位置，拖动公园即可搬迁到空街区。",
  );
}

function describeAffected(result, action) {
  if (!result.ok) return;
  const preserved = `${result.preservedCount}/${result.totalBlocks} 个未受影响街区哈希保持`;
  if (result.affectedCount === 1) {
    updateReport(`${action} · ${result.affectedBlocks[0]}`, `仅 1 个街区重算 · ${preserved}`);
  } else {
    updateReport(
      `${action} · ${result.affectedCount} 个街区`,
      `${result.affectedBlocks.join("、")} 重算 · ${preserved}`,
    );
  }
}

function handleBlockerPlacement(point) {
  const result = addBlocker(world, point.x, point.y);
  if (!result.ok) {
    showToast(result.reason, true);
    return;
  }
  state.selected = { type: "blocker", id: result.blocker.id };
  updateUI();
  setSaveProof("局部编辑，尚未保存", "");
  if (result.report) {
    updateReport(
      "路线阻断已定位",
      `${result.report.location.label} (${Math.round(result.report.location.x)}, ${Math.round(result.report.location.y)}) · ${result.report.unreachableTargets.join("、")} 不可达`,
    );
    showToast(result.report.message, true);
  } else {
    updateReport("道路阻断已放置", "当前所有目标仍可通过替代路径到达");
    showToast("阻断已放置；目标仍可从替代路径到达");
  }
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const point = eventPoint(event);
  canvas.setPointerCapture(event.pointerId);
  if (state.mode === "blocker") {
    handleBlockerPlacement(point);
    return;
  }

  const blocker = blockerAt(point);
  if (blocker) {
    state.selected = { type: "blocker", id: blocker.id };
    updateUI();
    return;
  }
  const building = buildingAt(point);
  if (building) {
    state.selected = { type: "building", id: building.id };
    state.drag = {
      type: "building",
      id: building.id,
      start: point,
      origin: { x: building.x, y: building.y },
      moved: false,
      lastResult: null,
    };
    $("#canvas-wrap").classList.add("drag-building");
    renderSelection();
    return;
  }
  const park = parkAt(point);
  if (park) {
    state.selected = { type: "park", id: park.id };
    state.drag = {
      type: "park",
      id: park.id,
      start: point,
      moved: false,
      originBlockId: park.blockId,
    };
    state.hoverBlockId = park.blockId;
    $("#canvas-wrap").classList.add("drag-park");
    renderSelection();
    return;
  }
  clearSelection();
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.drag) return;
  const point = eventPoint(event);
  if (state.drag.type === "building") {
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    if (!state.drag.moved && Math.hypot(dx, dy) < 1.5) return;
    state.drag.moved = true;
    const result = moveBuilding(
      world,
      state.drag.id,
      state.drag.origin.x + dx,
      state.drag.origin.y + dy,
    );
    if (result.ok) state.drag.lastResult = result;
    $("#canvas-wrap").classList.add("dragging");
  } else if (state.drag.type === "park") {
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    if (Math.hypot(dx, dy) > 2) state.drag.moved = true;
    state.hoverBlockId = blockAt(point)?.id ?? null;
  }
});

function finishPointerInteraction() {
  const drag = state.drag;
  state.drag = null;
  state.hoverBlockId = null;
  $("#canvas-wrap").classList.remove("dragging", "drag-building", "drag-park");
  if (!drag) return;
  if (drag.type === "building" && drag.moved && drag.lastResult?.ok) {
    flashBlocks(drag.lastResult.affectedBlocks);
    updateUI();
    describeAffected(drag.lastResult, "楼栋微调");
    setSaveProof("局部编辑，尚未保存", "");
    showToast(`楼栋位置已更新 · ${drag.lastResult.preservedCount} 个街区哈希保持不变`);
  }
}

canvas.addEventListener("pointerup", (event) => {
  const drag = state.drag;
  if (drag?.type === "park" && drag.moved) {
    const point = eventPoint(event);
    const targetBlock = blockAt(point);
    if (!targetBlock) {
      showToast("请将公园放到街区范围内", true);
    } else if (targetBlock.id !== drag.originBlockId) {
      const result = moveParkToBlock(world, drag.id, targetBlock.id);
      if (result.ok) {
        flashBlocks(result.affectedBlocks);
        updateUI();
        describeAffected(
          result,
          `公园迁移 · ${result.oldBlockId} → ${result.newBlockId}`,
        );
        setSaveProof("局部编辑，尚未保存", "");
        showToast(
          `公园已迁移 · 步道 ${world.metrics.pathLength}m · 服务 ${world.metrics.servedBuildings} 栋建筑`,
        );
      } else {
        updateUI();
        showToast(result.reason, true);
      }
    } else {
      updateUI();
    }
  }
  finishPointerInteraction();
});

canvas.addEventListener("pointercancel", finishPointerInteraction);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMode("select");
    clearSelection();
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    state.selected?.type === "blocker" &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)
  ) {
    removeBlocker(world, state.selected.id);
    clearSelection();
    updateUI();
    updateReport("道路阻断已移除", "目标可达性与路网状态已同步重算");
    setSaveProof("局部编辑，尚未保存", "");
    showToast("道路阻断已移除");
  }
});

function bindActions() {
  $$(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  $("#save-btn").addEventListener("click", saveScene);
  $("#load-btn").addEventListener("click", loadScene);
  $("#verify-btn").addEventListener("click", runVerification);
}

function animate(time) {
  renderScene(
    ctx,
    world,
    {
      selected: state.selected,
      flash: state.flash,
      dragPark: state.drag?.type === "park",
      hoverBlockId: state.hoverBlockId,
    },
    time,
  );
  requestAnimationFrame(animate);
}

bindParameterControls();
bindSeedControls();
bindActions();
setMode("select");
updateUI();
updateReport("场景已就绪", `${world.blocks.length} 个街区 · 拖动对象或调整参数开始规划`);
scheduleVerification();
requestAnimationFrame(animate);
