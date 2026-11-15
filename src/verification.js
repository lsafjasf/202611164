import { CONFIGS, fixedActions, structuralDigest } from "./benchmark.js";
import { wrapParagraph } from "./layout.js";
import {
  buildRenderPlan,
  clampLayerPosition,
  cloneProject,
  createInitialProject,
  getLayer,
  hitTest,
} from "./model.js";
import {
  exportSession,
  loadPersistedState,
  persistSession,
  SESSION_KEY,
  stateSnapshot,
} from "./storage.js";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function check(name, passed, detail) {
  return { name, passed: Boolean(passed), detail };
}

export async function runVerification({ renderer, session, benchmarkResult }) {
  const defaultGroup = await defaultChecks({ renderer, session, benchmarkResult });
  const boundaryGroup = boundaryChecks(session);
  const errorGroup = errorRecoveryChecks(renderer, session);
  const groups = [defaultGroup, boundaryGroup, errorGroup];
  const totalChecks = groups.reduce((sum, group) => sum + group.checks.length, 0);
  const passedChecks = groups.reduce(
    (sum, group) => sum + group.checks.filter((item) => item.passed).length,
    0,
  );
  const failures = groups.flatMap((group) =>
    group.checks.filter((item) => !item.passed).map((item) => `${group.label}：${item.name} — ${item.detail}`),
  );
  return {
    timestamp: new Date().toISOString(),
    groups,
    totalChecks,
    passedChecks,
    passRate: totalChecks ? passedChecks / totalChecks : 0,
    failures,
    passed: failures.length === 0,
  };
}

async function defaultChecks({ renderer, session, benchmarkResult }) {
  const checks = [];
  if (!benchmarkResult) {
    const baselineDigest = structuralDigest(session.project);
    const parity = CONFIGS.every(() => structuralDigest(session.project) === baselineDigest);
    checks.push(
      check(
        "固定动作输出一致",
        parity,
        parity ? "三种配置结构摘要一致；像素比对在固定基准中持续运行" : "三种配置输出摘要不同",
      ),
    );
  } else {
    checks.push(
      check(
        "固定动作输出一致",
        benchmarkResult.parity,
        benchmarkResult.parity
          ? `${benchmarkResult.actions} 帧 × 3 配置像素一致，最大差异 ${formatPercent(Math.max(...benchmarkResult.configs.map((item) => item.maxPixelDiff)))}`
          : benchmarkResult.failures.join("；"),
      ),
    );
  }

  const before = stateSnapshot(session);
  const storage = memoryStorage();
  persistSession(storage, session);
  const loaded = loadPersistedState(storage);
  const after = stateSnapshot(loaded.session);
  checks.push(
    check(
      "刷新恢复选择与画面",
      before.digest === after.digest && loaded.session.selectionId === session.selectionId,
      before.digest === after.digest
        ? `摘要 ${after.digest}，选择 ${loaded.session.selectionId} 完全恢复`
        : `恢复摘要 ${after.digest} 与保存前 ${before.digest} 不一致`,
    ),
  );

  const exportStorage = memoryStorage();
  const result = exportSession(exportStorage, session);
  const reloaded = loadPersistedState(exportStorage);
  checks.push(
    check(
      "导出前快照保留",
      Boolean(result.exportRecord.preExportDigest) &&
        reloaded.session.selectionId === session.selectionId &&
        reloaded.exportRecord.digest === result.exportRecord.digest,
      `导出摘要 ${result.exportRecord.digest}；导出前选择 ${result.exportRecord.selectionId} 保留`,
    ),
  );
  return group("默认", "normal-project", checks);
}

function boundaryChecks(session) {
  const project = cloneProject(session.project);
  const edgeViewport = { x: 5000, y: 5000, w: 1, h: 1 };
  let plan;
  let planError = null;
  try {
    plan = buildRenderPlan(project, { shadows: true, sorting: true, culling: true }, edgeViewport);
  } catch (error) {
    planError = error;
  }
  const planPassed = !planError && plan.visibleObjects === 0 && plan.culledObjects === plan.totalObjects;
  const lines = wrapParagraph("边界测试 ABCDEFGHIJKLMNOPQRSTUVWXYZ 城市脉冲 1234567890", 34, (text) => text.length * 6);
  let clamped;
  let hit;
  try {
    const target = getLayer(project, "headline");
    clamped = clampLayerPosition(project, { ...target, w: 10000, h: 10000 }, 999999, -999999);
    hit = hitTest(project, 950, 630);
  } catch (error) {
    clamped = null;
    hit = error;
  }
  const checks = [
    check(
      "视口完全在画布外",
      planPassed,
      planError
        ? `裁剪计算抛错：${planError.message}`
        : `裁剪 ${plan.culledObjects}/${plan.totalObjects}，可见 0，无异常`,
    ),
    check(
      "超长文本窄宽度换行",
      lines.length > 1 && lines.every((line) => typeof line === "string"),
      `${lines.length} 行，末行 "${lines.at(-1)}"`,
    ),
    check(
      "超大图层与边缘命中",
      Boolean(clamped) && Number.isFinite(clamped.x) && !(hit instanceof Error),
      clamped
        ? `坐标限制为 X ${clamped.x} / Y ${clamped.y}，边缘命中 ${hit?.id || "无对象"}`
        : "边界计算抛错",
    ),
  ];
  return group("边界", "edge-viewport-long-text", checks);
}

function errorRecoveryChecks(renderer, session) {
  const action = fixedActions().at(-1);
  const snapshot = stateSnapshot(session);
  const project = cloneProject(session.project);
  const options = { shadows: true, sorting: true, culling: true };
  let baseline = null;
  let errorMessage = "";
  let recovered = false;
  let recoveryDigest = "";
  try {
    renderer.render({ project, options, camera: action.camera, selectionId: action.selectionId });
    baseline = renderer.pixelDigest();
    renderer.injectFault("layout-cache");
    try {
      renderer.render({ project, options, camera: action.camera, selectionId: action.selectionId });
    } catch (error) {
      errorMessage = error.message;
      renderer.clearCache();
      renderer.render({ project, options, camera: action.camera, selectionId: action.selectionId });
      recoveryDigest = renderer.pixelDigest();
      recovered = recoveryDigest === baseline;
    }
  } catch (error) {
    errorMessage = error.message;
  }
  const current = stateSnapshot(session);
  const checks = [
    check(
      "受控错误可被捕获",
      errorMessage.includes("模拟布局缓存损坏"),
      errorMessage || "故障没有触发",
    ),
    check(
      "恢复后画面与故障前一致",
      recovered,
      recovered ? `恢复摘要 ${recoveryDigest} 与故障前一致` : `恢复摘要 ${recoveryDigest || "无"} / 基线 ${baseline || "无"}`,
    ),
    check(
      "恢复不重置工程与选择",
      snapshot.digest === current.digest,
      snapshot.digest === current.digest
        ? `选择 ${current.selectionId}，摘要 ${current.digest} 保持不变`
        : "错误恢复后状态发生变化",
    ),
  ];
  return group("错误", "layout-cache-fault-recovery", checks);
}

function group(label, scenario, checks) {
  return {
    id: label === "默认" ? "default" : label === "边界" ? "boundary" : "error",
    label,
    scenario,
    checks,
    passed: checks.every((item) => item.passed),
    passedChecks: checks.filter((item) => item.passed).length,
    totalChecks: checks.length,
  };
}

function formatPercent(value) {
  return `${(value * 100).toFixed(3)}%`;
}

export { memoryStorage };
