import {
  DEFAULT_TEST_PATH,
  applyMove,
  collectedCount,
  createExportSnapshot,
  createGame,
  describeState,
  fingerprint,
  getStateView,
  getTarget,
  restoreState,
  restartGame,
  undoMove
} from "./game.js";
import { AudioEngine } from "./audio.js";
import { GameRenderer } from "./renderer.js";

const STORAGE_KEYS = {
  state: "lumen-relay.state.v1",
  settings: "lumen-relay.settings.v1",
  lastExport: "lumen-relay.export.v1",
  report: "lumen-relay.report.v1"
};

const DEFAULT_SETTINGS = {
  sound: true,
  routeHint: true,
  highContrast: false
};

const KEY_TO_DIRECTION = {
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowDown: "down",
  ArrowLeft: "left",
  w: "up",
  W: "up",
  d: "right",
  D: "right",
  s: "down",
  S: "down",
  a: "left",
  A: "left"
};

const DIRECTION_ARROWS = {
  北: "↑",
  东北: "↗",
  东: "→",
  东南: "↘",
  南: "↓",
  西南: "↙",
  西: "←",
  西北: "↖",
  当前位置: "◎"
};

const COMPASS_ANGLES = {
  北: 0,
  东北: 45,
  东: 90,
  东南: 135,
  南: 180,
  西南: 225,
  西: 270,
  西北: 315,
  当前位置: 0
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  canvas: $("#gameCanvas"),
  gameRegion: $("#gameRegion"),
  statusBadge: $("#statusBadge"),
  statusLabel: $("#statusLabel"),
  positionChip: $("#positionChip"),
  moveChip: $("#moveChip"),
  energyChip: $("#energyChip"),
  eventStrip: $("#eventStrip"),
  eventIcon: $("#eventIcon"),
  eventMessage: $("#eventMessage"),
  positionValue: $("#positionValue"),
  positionNote: $("#positionNote"),
  targetDirection: $("#targetDirection"),
  targetArrow: $("#targetArrow"),
  targetNote: $("#targetNote"),
  fragmentValue: $("#fragmentValue"),
  fragmentBar: $("#fragmentBar"),
  resourceNote: $("#resourceNote"),
  objectiveIndex: $("#objectiveIndex"),
  objectiveTitle: $("#objectiveTitle"),
  objectiveDirection: $("#objectiveDirection"),
  objectiveDistance: $("#objectiveDistance"),
  objectiveCopy: $("#objectiveCopy"),
  objectiveProgressText: $("#objectiveProgressText"),
  objectiveProgress: $("#objectiveProgress"),
  compassNeedle: $("#compassNeedle"),
  undoButton: $("#undoButton"),
  restartButton: $("#restartButton"),
  canvasFocusButton: $("#canvasFocusButton"),
  soundToggle: $("#soundToggle"),
  routeHintToggle: $("#routeHintToggle"),
  contrastToggle: $("#contrastToggle"),
  gameSummary: $("#gameSummary"),
  livePolite: $("#livePolite"),
  liveAssertive: $("#liveAssertive"),
  runTestsButton: $("#runTestsButton"),
  testSummary: $("#testSummary"),
  testResults: $("#testResults"),
  exportButton: $("#exportButton"),
  exportStatus: $("#exportStatus"),
  restoreExportButton: $("#restoreExportButton")
};

let storageFailure = "";

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return { found: false, value: null };
    }
    return { found: true, value: JSON.parse(raw) };
  } catch (error) {
    storageFailure = `无法读取本地数据（${key}）：${error.message}`;
    return { found: true, value: null, error: storageFailure };
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    storageFailure = `本地保存失败（${key}）：${error.message}`;
    return { ok: false, error: storageFailure };
  }
}

function loadSettings() {
  const stored = readJSON(STORAGE_KEYS.settings);
  if (!stored.found || !stored.value || typeof stored.value !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    sound: stored.value.sound !== false,
    routeHint: stored.value.routeHint !== false,
    highContrast: stored.value.highContrast === true
  };
}

const savedState = readJSON(STORAGE_KEYS.state);
let restoreFailure = "";
let state;
if (savedState.found) {
  const restored = restoreState(savedState.value);
  if (restored.ok) {
    state = restored.state;
  } else {
    restoreFailure = `存档恢复失败：${restored.error}。已创建新航程，设置与最近导出保持不变。`;
    state = createGame();
  }
} else {
  state = createGame();
}

let settings = loadSettings();
const savedExport = readJSON(STORAGE_KEYS.lastExport);
let lastExport =
  savedExport.value?.snapshot?.format === "lumen-relay-project" ? savedExport.value : null;
let lastReport = readJSON(STORAGE_KEYS.report).value || null;
let lastDirection = state.facing || "up";
let isTesting = false;
let announcementTimer = 0;

const audio = new AudioEngine({ enabled: settings.sound });
const renderer = new GameRenderer(elements.canvas);

function persistState() {
  return writeJSON(STORAGE_KEYS.state, state);
}

function persistSettings() {
  return writeJSON(STORAGE_KEYS.settings, settings);
}

function applySettings() {
  document.body.classList.toggle("high-contrast", settings.highContrast);
  elements.routeHintToggle.checked = settings.routeHint;
  elements.contrastToggle.checked = settings.highContrast;
  elements.soundToggle.setAttribute("aria-pressed", String(settings.sound));
  elements.soundToggle.setAttribute(
    "aria-label",
    settings.sound ? "关闭操作音" : "开启操作音"
  );
  audio.setEnabled(settings.sound);
}

function announce(text, urgent = false) {
  if (!text || isTesting) {
    return;
  }
  const region = urgent ? elements.liveAssertive : elements.livePolite;
  const other = urgent ? elements.livePolite : elements.liveAssertive;
  other.textContent = "";
  region.textContent = "";
  window.clearTimeout(announcementTimer);
  announcementTimer = window.setTimeout(() => {
    region.textContent = text;
  }, 18);
}

function eventIcon(type, tone) {
  if (tone === "error") {
    return "!";
  }
  if (type === "win") {
    return "★";
  }
  if (type === "fragment") {
    return "◆";
  }
  if (type === "undo" || type === "restart") {
    return "↶";
  }
  if (type === "export") {
    return "↧";
  }
  return "✦";
}

function updateView(event = null, options = {}) {
  const view = getStateView(state);
  const target = getTarget(state);
  const progress = view.required ? Math.round((view.collected / view.required) * 100) : 100;
  const statusTone =
    state.status === "won" ? "success" : state.status === "failed" ? "error" : "info";
  const tone = event?.reason ? "error" : event?.type === "win" ? "success" : state.message.tone;
  const message = event?.message || state.message.text;

  elements.statusBadge.dataset.status = state.status;
  elements.statusLabel.textContent = view.statusLabel;
  elements.positionChip.textContent =
    `COL ${String(view.positionColumn).padStart(2, "0")} · ROW ${String(view.positionRow).padStart(2, "0")}`;
  elements.moveChip.textContent = `${String(state.moves).padStart(2, "0")} MOVES`;
  elements.energyChip.textContent = String(state.energy);
  elements.eventStrip.dataset.tone = tone;
  elements.eventIcon.textContent = eventIcon(event?.type, tone);
  elements.eventMessage.textContent = message;

  elements.positionValue.textContent = view.positionText;
  const coordinate = `${String.fromCharCode(65 + state.player.x)}${state.player.y + 1}`;
  elements.positionNote.textContent =
    state.status === "failed"
      ? `${coordinate} · 最后安全坐标`
      : state.status === "won"
        ? `${coordinate} · 信标坐标`
        : `${coordinate}${state.moves === 0 ? " · 起点 · 安全区" : " · 可移动"}`;
  elements.targetDirection.textContent = view.targetDirection;
  elements.targetArrow.textContent = DIRECTION_ARROWS[view.targetDirection] || "◎";
  elements.targetNote.textContent =
    state.status === "won"
      ? "信标已点亮 · 航程完成"
      : `${view.targetLabel} · ${view.targetDistance} 步`;
  elements.fragmentValue.textContent = String(view.collected);
  elements.fragmentBar.style.width = `${progress}%`;
  elements.resourceNote.textContent = `能量 ${view.energy} / ${view.maxEnergy}`;

  const totalSteps = view.required + 1;
  const currentStep =
    state.status === "won" ? totalSteps : Math.min(totalSteps, view.collected + 1);
  elements.objectiveIndex.textContent =
    `${String(currentStep).padStart(2, "0")} / ${String(totalSteps).padStart(2, "0")}`;
  elements.objectiveTitle.textContent =
    state.status === "won" ? "信标已点亮" : target.label;
  elements.objectiveDirection.textContent = view.targetDirection;
  elements.objectiveDistance.textContent =
    state.status === "won" ? `共 ${state.moves} 步` : `${view.targetDistance} 步`;
  elements.objectiveCopy.textContent =
    state.status === "won"
      ? `所有折光碎片已归位。本轮共用 ${state.moves} 步，剩余能量 ${state.energy}。`
      : state.status === "failed"
        ? "能量耗尽。使用撤回一步返回上一次安全移动，或重新开始本轮航程。"
        : target.kind === "fragment"
          ? `${target.label}在${view.targetDirection}方向。跟随虚线提示，或使用方向按钮逐格移动。`
          : `碎片已齐，信标在${view.targetDirection}方向。抵达后本轮完成。`;
  elements.objectiveProgressText.textContent = `${view.collected} / ${view.required} 碎片`;
  elements.objectiveProgress.style.width = `${progress}%`;
  elements.compassNeedle.style.transform =
    `rotate(${COMPASS_ANGLES[view.targetDirection] || 0}deg)`;
  elements.undoButton.disabled = state.history.length === 0;

  const summary = describeState(state);
  elements.gameSummary.textContent = summary;
  elements.gameRegion.setAttribute(
    "aria-label",
    `折光信标游戏区域，${view.statusLabel}`
  );
  elements.canvas.dataset.position = `${state.player.x},${state.player.y}`;
  elements.canvas.dataset.positionText = view.positionText;
  elements.canvas.dataset.target = `${target.x},${target.y}`;
  elements.canvas.dataset.targetDirection = view.targetDirection;
  elements.canvas.dataset.targetDistance = String(view.targetDistance);
  elements.canvas.dataset.fragments = `${view.collected}/${view.required}`;
  elements.canvas.dataset.energy = String(view.energy);
  elements.canvas.dataset.status = state.status;
  elements.canvas.dataset.failureReason = view.failureReason;
  elements.canvas.dataset.stateFingerprint = fingerprint(state);
  elements.canvas.dataset.message = message;
  elements.gameRegion.dataset.status = state.status;

  if (options.persist !== false) {
    const saved = persistState();
    if (!saved.ok && !options.suppressStorageNotice) {
      announce(saved.error, true);
    }
  }
  return { view, target, progress, tone, statusTone, summary };
}

function soundForEvent(event) {
  if (!event || (isTesting && event.type === "move")) {
    return;
  }
  if (event.reason) {
    audio.play("error");
  } else if (event.type === "win") {
    audio.play("win");
  } else if (event.type === "fragment") {
    audio.play("fragment");
  } else if (event.type === "undo" || event.type === "restart") {
    audio.play("undo");
  } else if (event.type === "move") {
    audio.play("move");
  }
}

function handleDirection(direction, source = "keyboard") {
  const result = applyMove(state, direction);
  state = result.state;
  lastDirection = state.facing || lastDirection;
  updateView(result);
  soundForEvent(result);
  announce(result.announcement || result.message, Boolean(result.reason));
  if (!isTesting) {
    elements.gameRegion.dataset.lastInput = source;
  }
  return result;
}

function handleUndo(source = "keyboard") {
  const result = undoMove(state);
  state = result.state;
  lastDirection = state.facing || "up";
  updateView(result);
  soundForEvent(result);
  announce(result.announcement || result.message, !result.ok);
  if (!isTesting) {
    elements.gameRegion.dataset.lastInput = source;
  }
  return result;
}

function handleRestart(source = "keyboard") {
  const result = restartGame(state);
  state = result.state;
  lastDirection = "up";
  updateView(result);
  soundForEvent(result);
  announce(result.announcement || result.message);
  if (!isTesting) {
    elements.gameRegion.dataset.lastInput = source;
  }
  return result;
}

function exportFilename(date = new Date()) {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  return `lumen-relay-project-${stamp}.json`;
}

function renderLastExport() {
  if (!lastExport?.snapshot) {
    elements.exportStatus.textContent = "导出不会改变当前位置、资源、设置或测试选择。";
    elements.restoreExportButton.disabled = true;
    return;
  }
  const exportedAt = new Date(lastExport.exportedAt);
  const timeText = Number.isNaN(exportedAt.valueOf())
    ? lastExport.exportedAt
    : exportedAt.toLocaleString("zh-CN", { hour12: false });
  elements.exportStatus.textContent =
    `最近导出 ${timeText} · 指纹 ${lastExport.stateFingerprint}。` +
    "刷新后仍保留；如需回退，可显式恢复该工程。";
  elements.restoreExportButton.disabled = false;
}

function downloadSnapshot(snapshot, filename) {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.setAttribute("aria-hidden", "true");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportProject({ download = true } = {}) {
  const beforeFingerprint = fingerprint(state);
  const exportedAt = new Date().toISOString();
  const filename = exportFilename(new Date(exportedAt));
  try {
    const snapshot = createExportSnapshot(state, settings, exportedAt);
    if (download) {
      downloadSnapshot(snapshot, filename);
    }
    const afterFingerprint = fingerprint(state);
    if (beforeFingerprint !== afterFingerprint) {
      throw new Error("导出过程改变了游戏状态");
    }
    const record = {
      exportedAt,
      filename,
      stateFingerprint: snapshot.stateFingerprint,
      snapshotFingerprint: snapshot.snapshotFingerprint,
      snapshot
    };
    const saved = writeJSON(STORAGE_KEYS.lastExport, record);
    lastExport = record;
    renderLastExport();
    audio.play("export");
    const savedSuffix = saved.ok
      ? "最近导出记录已持久化。"
      : `但最近导出记录未持久化：${saved.error}`;
    const text =
      `工程已导出：${filename}。导出前状态保持不变，指纹 ${beforeFingerprint}。${savedSuffix}`;
    announce(text, !saved.ok);
    return {
      ok: true,
      filename,
      fingerprint: beforeFingerprint,
      persisted: saved.ok,
      warning: saved.ok ? "" : saved.error,
      snapshot
    };
  } catch (error) {
    const reason = `导出失败：${error.message}。当前航程未被修改，指纹仍为 ${beforeFingerprint}。`;
    announce(reason, true);
    elements.eventStrip.dataset.tone = "error";
    elements.eventIcon.textContent = "!";
    elements.eventMessage.textContent = reason;
    audio.play("error");
    return { ok: false, reason, fingerprint: beforeFingerprint };
  }
}

function restoreLastExport() {
  if (!lastExport?.snapshot?.state) {
    announce("恢复失败：尚无可恢复的导出工程。", true);
    return { ok: false, reason: "尚无可恢复的导出工程" };
  }
  const restored = restoreState(lastExport.snapshot.state);
  if (!restored.ok) {
    const reason = `恢复导出工程失败：${restored.error}`;
    announce(reason, true);
    return { ok: false, reason };
  }
  state = restored.state;
  lastDirection = state.facing || "up";
  const result = {
    type: "export",
    reason: "",
    message: `已显式恢复 ${lastExport.filename} 中的工程状态。`,
    announcement: `已恢复最近导出工程。${describeState(state)}`
  };
  updateView(result);
  announce(result.announcement);
  audio.play("export");
  return { ok: true };
}

function setTestState(nextState) {
  state = nextState;
  lastDirection = state.facing || "up";
  updateView(null, { persist: false, suppressStorageNotice: true });
}

function dispatchTestKey(key) {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  );
}

function testDetail(label, ok, detail = "") {
  return { label, ok: Boolean(ok), detail };
}

async function runDefaultTest() {
  const details = [];
  setTestState(createGame());
  for (const direction of DEFAULT_TEST_PATH) {
    const key = { up: "ArrowUp", right: "ArrowRight", down: "ArrowDown", left: "ArrowLeft" }[
      direction
    ];
    dispatchTestKey(key);
  }
  const view = getStateView(state);
  details.push(
    testDetail(
      "键盘完成航程",
      state.status === "won",
      `状态 ${view.statusLabel}，${state.moves} 步`
    )
  );
  details.push(
    testDetail(
      "抵达信标坐标",
      state.player.x === state.config.beacon.x && state.player.y === state.config.beacon.y,
      `${view.positionText}`
    )
  );
  details.push(
    testDetail(
      "资源计数",
      view.collected === view.required && view.energy > 0,
      `碎片 ${view.collected}/${view.required}，能量 ${view.energy}/${view.maxEnergy}`
    )
  );
  const domConsistent =
    elements.gameSummary.textContent === describeState(state) &&
    elements.positionValue.textContent === view.positionText &&
    elements.targetDirection.textContent === view.targetDirection &&
    Number(elements.fragmentValue.textContent) === view.collected &&
    Number(elements.energyChip.textContent) === view.energy;
  details.push(
    testDetail(
      "视觉与读屏摘要",
      domConsistent,
      domConsistent ? "位置、目标、碎片、能量一致" : "DOM 与状态模型不一致"
    )
  );
  const beforeExportFingerprint = fingerprint(state);
  const snapshot = createExportSnapshot(state, settings, "2026-11-16T00:00:00.000Z");
  const afterExportFingerprint = fingerprint(state);
  details.push(
    testDetail(
      "导出前状态保留",
      beforeExportFingerprint === afterExportFingerprint &&
        snapshot.stateFingerprint === beforeExportFingerprint,
      `指纹 ${beforeExportFingerprint}`
    )
  );
  details.push(
    testDetail("通关操作音", audio.lastPlayed === "win", `最近音效 ${audio.lastPlayed || "无"}`)
  );
  const passed = details.every((item) => item.ok);
  return {
    id: "default",
    name: "默认 · 键盘完成整局",
    passed,
    details,
    reason: passed ? "" : details.find((item) => !item.ok)?.label || "未知失败"
  };
}

async function runBoundaryTest() {
  const details = [];
  setTestState(createGame());
  dispatchTestKey("ArrowLeft");
  const blockedView = getStateView(state);
  details.push(
    testDetail(
      "西侧边界不移动",
      state.player.x === 0 && state.player.y === 5,
      blockedView.positionText
    )
  );
  details.push(
    testDetail(
      "边界原因明确",
      blockedView.failureReason.includes("地图边界"),
      blockedView.failureReason || "缺少失败原因"
    )
  );
  details.push(
    testDetail(
      "边界不消耗能量",
      state.energy === state.config.startEnergy,
      `能量 ${state.energy}/${state.config.maxEnergy}`
    )
  );
  details.push(
    testDetail(
      "失败原因进入读屏摘要",
      elements.gameSummary.textContent.includes("地图边界"),
      "读屏摘要包含失败原因"
    )
  );
  dispatchTestKey("ArrowUp");
  const recoveredView = getStateView(state);
  details.push(
    testDetail(
      "方向移动恢复",
      state.player.x === 0 && state.player.y === 4 && recoveredView.failureReason === "",
      `${recoveredView.positionText}，失败原因已清除`
    )
  );
  const passed = details.every((item) => item.ok);
  return {
    id: "boundary",
    name: "边界 · 地图边缘与恢复",
    passed,
    details,
    reason: passed ? "" : details.find((item) => !item.ok)?.label || "未知失败"
  };
}

async function runErrorTest() {
  const details = [];
  setTestState(createGame({ startEnergy: 1 }, { title: "低能量演练" }));
  dispatchTestKey("ArrowUp");
  const failedView = getStateView(state);
  details.push(
    testDetail("低能量触发耗尽", state.status === "failed", failedView.statusLabel)
  );
  details.push(
    testDetail(
      "失败原因可读",
      failedView.failureReason.includes("能量耗尽") &&
        elements.gameSummary.textContent.includes("能量耗尽"),
      failedView.failureReason || "缺少具体原因"
    )
  );
  details.push(
    testDetail(
      "失败状态阻止继续移动",
      applyMove(state, "up").ok === false,
      "状态模型拒绝终局后的移动"
    )
  );
  dispatchTestKey("z");
  const recoveredView = getStateView(state);
  details.push(
    testDetail(
      "键盘撤回恢复安全状态",
      state.status === "playing" &&
        recoveredView.failureReason === "" &&
        state.player.x === 0 &&
        state.player.y === 5,
      `${recoveredView.statusLabel}，${recoveredView.positionText}`
    )
  );
  details.push(
    testDetail(
      "恢复后 HUD 同步",
      elements.positionValue.textContent === recoveredView.positionText &&
        elements.canvas.dataset.status === "playing" &&
        elements.gameSummary.textContent === describeState(state),
      "位置、状态与读屏摘要一致"
    )
  );
  const passed = details.every((item) => item.ok);
  return {
    id: "error",
    name: "错误 · 能量耗尽后恢复",
    passed,
    details,
    reason: passed ? "" : details.find((item) => !item.ok)?.label || "未知失败"
  };
}

function renderTestCard(result) {
  const card = elements.testResults.querySelector(`[data-test="${result.id}"]`);
  if (!card) {
    return;
  }
  card.dataset.state = result.passed ? "pass" : "fail";
  const icon = card.querySelector(".test-status-icon");
  icon.textContent = result.passed ? "●" : "!";
  const list = card.querySelector("[data-details]");
  list.replaceChildren();
  for (const detail of result.details) {
    const item = document.createElement("li");
    item.dataset.ok = String(detail.ok);
    item.textContent = `${detail.label}：${detail.detail}`;
    list.appendChild(item);
  }
}

function renderTestReport(report, { prefix = "" } = {}) {
  if (!report?.results?.length) {
    return;
  }
  for (const result of report.results) {
    renderTestCard(result);
  }
  const passed = report.results.filter((result) => result.passed).length;
  const total = report.results.length;
  const rate = total ? Math.round((passed / total) * 100) : 0;
  const failures = report.results.filter((result) => !result.passed);
  const mark = elements.testSummary.querySelector(".summary-mark");
  const paragraph = elements.testSummary.querySelector("p");
  elements.testSummary.dataset.state = failures.length ? "fail" : "pass";
  mark.textContent = failures.length ? "!" : "✓";
  const timeText = report.timestamp
    ? new Date(report.timestamp).toLocaleString("zh-CN", { hour12: false })
    : "";
  const lead = prefix || (timeText ? `上次记录 ${timeText} · ` : "");
  if (failures.length) {
    paragraph.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = `${lead}${passed}/${total} 通过 · 成功率 ${rate}%。`;
    paragraph.appendChild(strong);
    paragraph.appendChild(
      document.createTextNode(
        ` 失败原因：${failures
          .map((result) => `${result.name}（${result.reason}）`)
          .join("；")}`
      )
    );
  } else {
    paragraph.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = `${lead}${passed}/${total} 通过 · 成功率 ${rate}%。`;
    paragraph.appendChild(strong);
    paragraph.appendChild(
      document.createTextNode(
        " 键盘通关、边界恢复、错误恢复与导出前状态保留均已验证。"
      )
    );
  }
}

function updateRunningCard(id) {
  const card = elements.testResults.querySelector(`[data-test="${id}"]`);
  if (!card) {
    return;
  }
  card.dataset.state = "running";
  card.querySelector(".test-status-icon").textContent = "◌";
  const list = card.querySelector("[data-details]");
  list.replaceChildren();
  const item = document.createElement("li");
  item.textContent = "正在执行确定性检查…";
  list.appendChild(item);
}

async function runAllChecks() {
  if (elements.runTestsButton.disabled) {
    return lastReport;
  }
  const originalState = structuredClone(state);
  const originalDirection = lastDirection;
  const originalExport = lastExport ? structuredClone(lastExport) : null;
  elements.runTestsButton.disabled = true;
  elements.runTestsButton.innerHTML = '<span aria-hidden="true">◌</span> 检查运行中';
  elements.testSummary.dataset.state = "running";
  elements.testSummary.querySelector(".summary-mark").textContent = "◌";
  elements.testSummary.querySelector("p").textContent =
    "正在依次执行默认、边界和错误检查；当前航程已暂存。";
  isTesting = true;
  const results = [];
  const tests = [
    ["default", runDefaultTest],
    ["boundary", runBoundaryTest],
    ["error", runErrorTest]
  ];
  try {
    for (const [id, test] of tests) {
      updateRunningCard(id);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      try {
        results.push(await test());
      } catch (error) {
        const fallbackDetails = [
          testDetail("测试执行", false, `异常：${error.message}`)
        ];
        results.push({
          id,
          name: id,
          passed: false,
          details: fallbackDetails,
          reason: `异常：${error.message}`
        });
      }
      renderTestCard(results[results.length - 1]);
    }
  } finally {
    state = originalState;
    lastDirection = originalDirection;
    lastExport = originalExport;
    isTesting = false;
    const restoreResult = { type: "restore", reason: "", message: state.message.text };
    updateView(restoreResult, { persist: true, suppressStorageNotice: true });
    renderLastExport();
    elements.runTestsButton.disabled = false;
    elements.runTestsButton.innerHTML = '<span aria-hidden="true">▶</span> 运行全部检查';
  }
  const passed = results.filter((result) => result.passed).length;
  lastReport = {
    timestamp: new Date().toISOString(),
    passed,
    total: results.length,
    successRate: results.length ? Math.round((passed / results.length) * 100) : 0,
    results
  };
  writeJSON(STORAGE_KEYS.report, lastReport);
  renderTestReport(lastReport, { prefix: "本次检查 · " });
  return lastReport;
}

let lastPointerType = "mouse";
document.addEventListener(
  "pointerdown",
  (event) => {
    lastPointerType = event.pointerType || "mouse";
  },
  { capture: true, passive: true }
);

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const activeTag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) {
    return;
  }
  const direction = KEY_TO_DIRECTION[event.key];
  if (direction) {
    event.preventDefault();
    audio.ensureContext();
    handleDirection(direction, "keyboard");
    return;
  }
  if (event.key === "z" || event.key === "Z") {
    event.preventDefault();
    audio.ensureContext();
    handleUndo("keyboard");
    return;
  }
  if (event.key === "r" || event.key === "R") {
    event.preventDefault();
    audio.ensureContext();
    handleRestart("keyboard");
  }
});

for (const button of $$("[data-move]")) {
  button.addEventListener("click", () => {
    audio.ensureContext();
    handleDirection(button.dataset.move, lastPointerType === "touch" ? "touch" : "mouse");
  });
}

elements.undoButton.addEventListener("click", () => {
  audio.ensureContext();
  handleUndo(lastPointerType === "touch" ? "touch" : "mouse");
});

elements.restartButton.addEventListener("click", () => {
  audio.ensureContext();
  handleRestart(lastPointerType === "touch" ? "touch" : "mouse");
});

elements.canvasFocusButton.addEventListener("click", () => {
  elements.gameRegion.focus({ preventScroll: true });
  announce(describeState(state));
});

elements.gameRegion.addEventListener("pointerdown", () => {
  if (document.activeElement !== elements.gameRegion) {
    elements.gameRegion.focus({ preventScroll: true });
  }
});

elements.gameRegion.addEventListener("focus", () => {
  elements.gameSummary.textContent = describeState(state);
  announce(describeState(state));
});

elements.soundToggle.addEventListener("click", () => {
  settings.sound = !settings.sound;
  applySettings();
  const saved = persistSettings();
  const text = settings.sound
    ? "操作音已开启。移动、收集、错误与完成时播放 Web Audio 音效。"
    : "操作音已关闭。键盘、鼠标与触屏操作保持不变。";
  announce(saved.ok ? text : `${text} ${saved.error}`, !saved.ok);
});

elements.routeHintToggle.addEventListener("change", () => {
  settings.routeHint = elements.routeHintToggle.checked;
  const saved = persistSettings();
  const text = settings.routeHint ? "已显示目标路线提示。" : "已隐藏目标路线提示。";
  announce(saved.ok ? text : `${text} ${saved.error}`, !saved.ok);
});

elements.contrastToggle.addEventListener("change", () => {
  settings.highContrast = elements.contrastToggle.checked;
  applySettings();
  const saved = persistSettings();
  const text = settings.highContrast ? "已启用高对比度显示。" : "已恢复标准对比度。";
  announce(saved.ok ? text : `${text} ${saved.error}`, !saved.ok);
});

elements.runTestsButton.addEventListener("click", () => {
  runAllChecks();
});

elements.exportButton.addEventListener("click", () => {
  exportProject({ download: true });
});

elements.restoreExportButton.addEventListener("click", () => {
  restoreLastExport();
});

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener?.("change", (event) => {
  reducedMotion = event.matches;
});

function animationFrame(time) {
  renderer.render(
    state,
    {
      routeHint: settings.routeHint,
      highContrast: settings.highContrast,
      reducedMotion,
      lastDirection
    },
    time
  );
  window.requestAnimationFrame(animationFrame);
}

applySettings();
updateView(null, { persist: false, suppressStorageNotice: true });
renderLastExport();
if (lastReport) {
  renderTestReport(lastReport);
}
window.requestAnimationFrame(animationFrame);

if (restoreFailure) {
  elements.eventStrip.dataset.tone = "error";
  elements.eventIcon.textContent = "!";
  elements.eventMessage.textContent = restoreFailure;
  window.setTimeout(() => announce(restoreFailure, true), 120);
} else if (storageFailure) {
  elements.eventStrip.dataset.tone = "error";
  elements.eventIcon.textContent = "!";
  elements.eventMessage.textContent = storageFailure;
  window.setTimeout(() => announce(storageFailure, true), 120);
}

window.__LUMEN__ = {
  getState: () => structuredClone(state),
  getSettings: () => structuredClone(settings),
  getLastExport: () => (lastExport ? structuredClone(lastExport) : null),
  getLastReport: () => (lastReport ? structuredClone(lastReport) : null),
  getSummary: () => describeState(state),
  fingerprint: () => fingerprint(state),
  exportProject,
  restoreLastExport,
  runAllChecks,
  loadScenario(name) {
    if (name === "error") {
      state = createGame({ startEnergy: 1 }, { title: "低能量演练" });
    } else {
      state = createGame({}, { title: "默认星图" });
    }
    lastDirection = state.facing || "up";
    const message =
      name === "error"
        ? "已载入低能量演练：初始能量为 1。"
        : "已载入默认星图。";
    updateView({ type: "restore", reason: "", message });
    announce(`${message}${describeState(state)}`);
    return structuredClone(state);
  }
};
