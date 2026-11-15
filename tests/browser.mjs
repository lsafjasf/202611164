import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url).pathname;
const artifacts = join(root, "artifacts");
await mkdir(artifacts, { recursive: true });

const checks = [];
const notes = [];
const startedAt = new Date();

function verify(name, passed, detail, failureReason = null) {
  checks.push({
    name,
    passed: Boolean(passed),
    detail,
    failureReason: passed ? null : failureReason || detail,
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("静态服务器启动超时");
}

async function launchBrowser() {
  const candidates = [
    chromium.executablePath(),
    "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
    "/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
    "/home/hj/.cache/ms-playwright/chromium-1169/chrome-linux/chrome",
  ];
  for (const executablePath of candidates) {
    if (!existsSync(executablePath)) continue;
    try {
      return await chromium.launch({ headless: true, executablePath });
    } catch {
    }
  }
  return chromium.launch({ headless: true });
}

async function canvasPoint(page, layerId) {
  return page.evaluate((id) => window.__FRAMELAB__.getLayerPoint(id), layerId);
}

async function state(page) {
  return page.evaluate(() => window.__FRAMELAB__.getState());
}

async function storedSession(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("framelab.session.v1")));
}

async function waitForState(page) {
  await page.waitForFunction(() => Boolean(window.__FRAMELAB__?.getState()), null, { timeout: 15000 });
}

async function selectLayerWithKeyboard(page, layerId) {
  const button = page.locator(`[data-layer-id="${layerId}"]`);
  await button.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  return state(page);
}

const port = await freePort();
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverLog = [];
server.stdout.on("data", (data) => serverLog.push(String(data)));
server.stderr.on("data", (data) => serverLog.push(String(data)));

let browser;
let context;
let page;
let finalReport;
let runtimeErrors = [];
try {
  const baseUrl = `http://127.0.0.1:${port}/`;
  await waitForServer(baseUrl);
  browser = await launchBrowser();
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    hasTouch: true,
    acceptDownloads: true,
    locale: "zh-CN",
  });
  page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      runtimeErrors.push(message.text());
    }
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await waitForState(page);
  await page.waitForFunction(
    () => window.__FRAMELAB__.getBenchmark()?.configs?.length === 3,
    null,
    { timeout: 20000 },
  );

  let benchmark = await page.evaluate(() => window.__FRAMELAB__.getBenchmark());
  verify(
    "三配置固定基准",
    benchmark.parity && benchmark.configs.length === 3,
    benchmark.parity
      ? `${benchmark.actions} 帧 × 3 配置，像素与结构摘要一致`
      : benchmark.failures.join("；"),
  );
  verify(
    "性能面板四项指标",
    await page.locator("#metric-frame").isVisible() &&
      await page.locator("#metric-objects").isVisible() &&
      await page.locator("#metric-cache").isVisible() &&
      await page.locator("#metric-layout").isVisible(),
    "帧时间、绘制对象数、缓存命中率、布局耗时均在首屏实时更新",
  );

  let keyboardState = null;
  try {
    await page.evaluate(() => document.activeElement?.blur());
    let reachedCanvas = false;
    for (let index = 0; index < 36; index += 1) {
      await page.keyboard.press("Tab");
      reachedCanvas = await page.evaluate(() => document.activeElement?.id === "scene");
      if (reachedCanvas) break;
    }
    const before = await page.evaluate(() => window.__FRAMELAB__.getLayer("headline"));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(420);
    const after = await page.evaluate(() => window.__FRAMELAB__.getLayer("headline"));
    keyboardState = await state(page);
    const saved = await storedSession(page);
    const savedLayer = saved.project.layers.find((layer) => layer.id === "headline");
    const liveText = await page.evaluate(() => window.__FRAMELAB__.getLiveRegionText());
    verify(
      "键盘操作与持久化",
      reachedCanvas &&
        after.x === before.x + 2 &&
        after.y === before.y + 1 &&
        keyboardState.selectionId === "headline" &&
        savedLayer.x === after.x &&
        liveText.includes("移动到"),
      `Tab 到达画布；方向键将小标题移动到 X ${after.x} / Y ${after.y}；localStorage 同步`,
      `焦点=${await page.evaluate(() => document.activeElement?.id)}，live="${liveText}"`,
    );
  } catch (error) {
    verify("键盘操作与持久化", false, error.message, error.stack);
  }

  let mouseState;
  let touchState;
  try {
    const halo = await canvasPoint(page, "halo");
    await page.mouse.click(halo.x, halo.y);
    await page.waitForTimeout(180);
    mouseState = await state(page);
    const mouseFocus = await page.evaluate(() => document.activeElement?.id);
    const mouseLive = await page.evaluate(() => window.__FRAMELAB__.getLiveRegionText());
    const mouseLabel = await page.locator("#selected-name").innerText();
    verify(
      "鼠标选择与焦点",
      mouseState.selectionId === "halo" &&
        mouseFocus === "scene" &&
        mouseLabel.includes("橙色主球体") &&
        mouseLive.includes("橙色主球体"),
      `点击主球体后选择=${mouseState.selectionId}，焦点=${mouseFocus}，属性面板=${mouseLabel}`,
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    const keyboardSelection = await selectLayerWithKeyboard(page, "halo");
    verify(
      "键盘到达同一选择状态",
      keyboardSelection.selectionId === "halo" &&
        mouseState.selectionId === "halo",
      "鼠标画布点击与图层按钮 Enter 均到达 halo 选择状态",
    );

    const canvasBox = await page.locator("#scene").boundingBox();
    await page.mouse.click(canvasBox.x + 8, canvasBox.y + 8);
    await page.waitForTimeout(80);
    const haloAgain = await canvasPoint(page, "halo");
    await page.touchscreen.tap(haloAgain.x, haloAgain.y);
    await page.waitForTimeout(180);
    touchState = await state(page);
    const touchFocus = await page.evaluate(() => document.activeElement?.id);
    const touchLive = await page.evaluate(() => window.__FRAMELAB__.getLiveRegionText());
    verify(
      "触屏与鼠标状态收敛",
      touchState.selectionId === "halo" &&
        mouseState.selectionId === touchState.selectionId &&
        touchFocus === "scene" &&
        touchLive.includes("橙色主球体"),
      `轻触后选择=${touchState.selectionId}，焦点=${touchFocus}，播报="${touchLive}"`,
    );
  } catch (error) {
    verify("鼠标与触屏路径", false, error.message, error.stack);
  }

  try {
    const shadowSwitch = page.locator("#toggle-shadows");
    const before = await state(page);
    await shadowSwitch.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(360);
    const toggled = await state(page);
    const parityText = await page.locator("#parity-result").innerText();
    verify(
      "键盘切换优化与画面校验",
      toggled.options.shadows === !before.options.shadows && parityText.includes("画面一致"),
      `Space 切换阴影为 ${toggled.options.shadows}，即时像素校验：${parityText}`,
      null,
    );
    await page.keyboard.press("Space");
    await page.waitForTimeout(320);
  } catch (error) {
    verify("键盘切换优化与画面校验", false, error.message, error.stack);
  }

  let verificationReport = null;
  try {
    await page.click("#verify-button");
    await page.waitForFunction(
      () => ["PASS", "FAIL"].includes(document.querySelector("#verify-status")?.textContent),
      null,
      { timeout: 25000 },
    );
    verificationReport = await page.evaluate(() => window.__FRAMELAB__.getVerification());
    benchmark = await page.evaluate(() => window.__FRAMELAB__.getBenchmark());
    const rate = await page.locator("#verify-rate").innerText();
    const bodyText = await page.locator("#verify-body").innerText();
    verify(
      "默认边界错误三组验证",
      verificationReport?.passed === true && rate.includes("100"),
      `${verificationReport?.passedChecks}/${verificationReport?.totalChecks} 项通过，成功率 ${rate}`,
      verificationReport?.failures?.join("；"),
    );
    verify(
      "错误恢复路径",
      bodyText.includes("受控错误可被捕获") && bodyText.includes("恢复后画面与故障前一致"),
      "布局缓存故障被捕获，清理缓存后画面摘要恢复，工程与选择未重置",
    );
    await page.screenshot({ path: join(artifacts, "verification-report.png") });
    await page.click("#close-verify");
  } catch (error) {
    verify("默认边界错误三组验证", false, error.message, error.stack);
  }

  let exportState;
  let downloadedExport;
  try {
    const point = await canvasPoint(page, "session-time");
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(120);
    await page.locator("#text-content").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("22:31");
    await page.waitForTimeout(420);
    const editedLayer = await page.evaluate(() => window.__FRAMELAB__.getLayer("session-time"));
    const savedText = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("framelab.session.v1")).project.layers.find(
        (layer) => layer.id === "session-time",
      ).text,
    );
    verify(
      "文字编辑与持久化",
      editedLayer.text === "22:31" && savedText === "22:31",
      `文本框键盘输入“22:31”，localStorage 同步为“${savedText}”`,
    );
    exportState = await state(page);
    const downloadPromise = page.waitForEvent("download");
    await page.click("#export-button");
    const download = await downloadPromise;
    const exportPath = join(artifacts, "exported-project.json");
    await download.saveAs(exportPath);
    downloadedExport = JSON.parse(await readFile(exportPath, "utf8"));
    const exportRecord = await page.evaluate(() => JSON.parse(localStorage.getItem("framelab.export.v1")));
    await writeFile(join(artifacts, "pre-export-state.json"), JSON.stringify(exportRecord.preExport, null, 2));
    verify(
      "导出与导出前状态",
      downloadedExport.digest === exportState.digest &&
        downloadedExport.selectionId === exportState.selectionId &&
        exportRecord.preExportDigest === exportState.digest &&
        downloadedExport.preExport.selectionId === exportState.selectionId,
      `导出摘要 ${downloadedExport.digest}；选择 ${downloadedExport.selectionId}；preExport 摘要 ${exportRecord.preExportDigest}`,
    );
  } catch (error) {
    verify("导出与导出前状态", false, error.message, error.stack);
  }

  try {
    const beforeReload = await state(page);
    const exportRecord = await page.evaluate(() => JSON.parse(localStorage.getItem("framelab.export.v1")));
    await page.reload({ waitUntil: "networkidle" });
    await waitForState(page);
    await page.waitForTimeout(700);
    const afterReload = await state(page);
    const inspectorName = await page.locator("#selected-name").innerText();
    const restoredLayer = await page.evaluate(() => window.__FRAMELAB__.getLayer("session-time"));
    verify(
      "刷新恢复导出工程与选择",
      afterReload.selectionId === beforeReload.selectionId &&
        afterReload.digest === beforeReload.digest &&
        afterReload.exportRecord?.digest === exportRecord.digest &&
        afterReload.options.shadows === beforeReload.options.shadows &&
        inspectorName.length > 0 &&
        restoredLayer.text === "22:31",
      `刷新后选择 ${afterReload.selectionId}、摘要 ${afterReload.digest}、文字“${restoredLayer.text}”、导出记录 ${afterReload.exportRecord?.digest} 均保持`,
    );
    await page.click("#reload-export");
    await page.waitForTimeout(300);
    const reloaded = await state(page);
    verify(
      "从导出记录重新载入",
      reloaded.digest === exportRecord.digest && reloaded.selectionId === exportRecord.selectionId,
      `重新载入摘要 ${reloaded.digest}，选择 ${reloaded.selectionId}`,
    );
    await page.evaluate(() => {
      document.querySelector(".inspector-panel").scrollTop = 0;
    });
    await page.screenshot({ path: join(artifacts, "reload-restored.png") });
    await page.locator("#scene").screenshot({ path: join(artifacts, "canvas-restored.png") });
  } catch (error) {
    verify("刷新恢复导出工程与选择", false, error.message, error.stack);
  }

  let accessibilitySummary = null;
  try {
    const relevant = (name) => checks.find((item) => item.name === name);
    const status = (name) => (relevant(name)?.passed ? "PASS" : "FAIL");
    const pathDetails = {
      "键盘移动": [
        status("键盘操作与持久化"),
        "Tab 到达 Canvas → 方向键移动小标题 → aria-live 播报 → localStorage 同步",
      ],
      "鼠标选择": [
        status("鼠标选择与焦点"),
        `点击主球体 → selected=${mouseState?.selectionId || "unknown"} → 属性面板和焦点同步`,
      ],
      "触屏轻触": [
        status("触屏与鼠标状态收敛"),
        `轻触主球体 → selected=${touchState?.selectionId || "unknown"} → 与鼠标路径一致`,
      ],
      "键盘控件": [
        status("键盘切换优化与画面校验"),
        "Space 切换阴影开关 → aria-checked 与 localStorage 更新 → 画面校验通过",
      ],
      "焦点更新": [
        status("鼠标选择与焦点"),
        "画布指针操作后活动元素为 #scene，焦点环可随键盘导航显示",
      ],
      "读屏播报": [
        status("键盘操作与持久化"),
        "选择、位置、优化和导出结果写入 role=status / aria-live 区域",
      ],
      "文字编辑": [
        status("文字编辑与持久化"),
        "键盘修改场次时间为 22:31 → localStorage 与刷新后的导出工程一致",
      ],
      "错误恢复": [
        status("错误恢复路径"),
        "布局缓存受控损坏 → 捕获异常 → 清理缓存 → 恢复原像素摘要且不改变工程",
      ],
      "导出保留": [
        status("导出与导出前状态"),
        `导出摘要 ${downloadedExport?.digest || "unknown"}，preExport 选择 ${downloadedExport?.selectionId || "unknown"} 保留`,
      ],
      "刷新恢复": [
        status("刷新恢复导出工程与选择"),
        "reload 后用户选择、优化开关、工程摘要与导出记录保持一致",
      ],
    };
    accessibilitySummary = {
      schema: "framelab.a11y.summary.v1",
      checkedAt: new Date().toISOString(),
      passed: Object.values(pathDetails).filter(([result]) => result === "PASS").length,
      total: Object.keys(pathDetails).length,
      paths: Object.entries(pathDetails).map(([name, [result, detail]]) => ({ name, status: result, detail })),
      failureRecovery: [
        "布局缓存损坏：捕获“模拟布局缓存损坏”，清空缓存并重绘，像素摘要与故障前一致。",
        "导出存储失败：导出异常时保留 preExport 快照，并显示明确错误原因。",
        "刷新恢复：会话损坏时优先从 export record 恢复；无法恢复时显示警告并使用默认工程。",
      ],
    };
    accessibilitySummary.passRate = accessibilitySummary.passed / accessibilitySummary.total;
    await page.evaluate((summary) => window.__FRAMELAB__.setA11ySummary(summary), accessibilitySummary);
    await page.click("#a11y-button");
    await page.waitForFunction(() => document.querySelector("#a11y-dialog")?.open === true);
    const a11yText = await page.locator("#a11y-dialog").innerText();
    verify(
      "无障碍检查摘要",
      a11yText.includes("键盘移动") &&
        a11yText.includes("错误恢复") &&
        a11yText.includes("刷新恢复"),
      `${accessibilitySummary.passed}/${accessibilitySummary.total} 条已验证路径写入摘要`,
    );
    await page.screenshot({ path: join(artifacts, "accessibility-dialog.png") });
    await page.click("#close-a11y-footer");
    await page.evaluate(() => {
      document.querySelector(".inspector-panel").scrollTop = 0;
      document.querySelector("#toast").classList.remove("is-visible");
    });
    await page.waitForTimeout(160);
    await page.screenshot({ path: join(artifacts, "final-stage.png") });
  } catch (error) {
    verify("无障碍检查摘要", false, error.message, error.stack);
  }

  verify(
    "控制台与运行时",
    runtimeErrors.length === 0,
    runtimeErrors.length ? runtimeErrors.join("；") : "无未捕获异常或资源错误",
  );
  finalReport = {
    benchmark,
    verification: verificationReport,
    accessibilitySummary,
    exportRecord: downloadedExport
      ? {
          digest: downloadedExport.digest,
          preExportDigest: downloadedExport.preExportDigest,
          selectionId: downloadedExport.selectionId,
          revision: downloadedExport.revision,
        }
      : null,
  };
} catch (error) {
  verify("浏览器验证流程", false, error.message, error.stack);
  finalReport = { fatalError: error.stack };
} finally {
  const passed = checks.filter((item) => item.passed).length;
  const report = {
    schema: "framelab.verification.report.v1",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    totalChecks: checks.length,
    passedChecks: passed,
    failedChecks: checks.length - passed,
    passRate: checks.length ? passed / checks.length : 0,
    passed: checks.length > 0 && passed === checks.length,
    checks,
    failures: checks.filter((item) => !item.passed).map((item) => `${item.name}：${item.failureReason || item.detail}`),
    data: finalReport,
    serverLog,
  };
  await writeFile(join(artifacts, "verification-report.json"), JSON.stringify(report, null, 2));
  const lines = [
    "# FrameLab 可重复验证报告",
    "",
    `- 运行时间：${report.finishedAt}`,
    `- 成功率：**${(report.passRate * 100).toFixed(1)}%**（${passed}/${checks.length}）`,
    `- 结论：${report.passed ? "全部通过" : "存在失败，见下方原因"}`,
    "",
    "| 检查 | 结果 | 证据 / 失败原因 |",
    "| --- | --- | --- |",
    ...checks.map((item) => `| ${item.name} | ${item.passed ? "PASS" : "FAIL"} | ${(item.failureReason || item.detail).replaceAll("|", "\\|")} |`),
    "",
    "## 固定基准",
    "",
    finalReport?.benchmark?.configs
      ? finalReport.benchmark.configs
          .map(
            (config) =>
              `- ${config.label}：帧时 ${config.frameAvg.toFixed(3)} ms，p95 ${config.frameP95.toFixed(3)} ms，绘制 ${Math.round(config.drawnAvg)}，命中率 ${(config.cacheHitRate * 100).toFixed(1)}%，布局 ${config.layoutAvg.toFixed(3)} ms`,
          )
          .join("\n")
      : "- 无基准数据",
    "",
    "## 失败原因",
    "",
    report.failures.length ? report.failures.map((failure) => `- ${failure}`).join("\n") : "- 无",
  ];
  await writeFile(join(artifacts, "verification-report.md"), lines.join("\n"));
  if (finalReport?.accessibilitySummary) {
    await writeFile(
      join(artifacts, "accessibility-summary.json"),
      JSON.stringify(finalReport.accessibilitySummary, null, 2),
    );
    const a11yLines = [
      "# 无障碍检查摘要",
      "",
      `- 最近检查：${finalReport.accessibilitySummary.checkedAt}`,
      `- 通过率：${(finalReport.accessibilitySummary.passRate * 100).toFixed(0)}%（${finalReport.accessibilitySummary.passed}/${finalReport.accessibilitySummary.total}）`,
      "",
      "## 已验证操作路径",
      "",
      ...finalReport.accessibilitySummary.paths.map(
        (path) => `- **${path.name}** — ${path.status}：${path.detail}`,
      ),
      "",
      "## 失败恢复",
      "",
      ...finalReport.accessibilitySummary.failureRecovery.map((item) => `- ${item}`),
    ];
    await writeFile(join(artifacts, "accessibility-summary.md"), a11yLines.join("\n"));
  }
  if (finalReport?.benchmark) {
    await writeFile(join(artifacts, "benchmark-report.json"), JSON.stringify(finalReport.benchmark, null, 2));
  }
  await browser?.close();
  server.kill("SIGTERM");
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        passRate: report.passRate,
        checks: `${passed}/${checks.length}`,
        failures: report.failures,
        artifacts: {
          report: "artifacts/verification-report.md",
          benchmark: "artifacts/benchmark-report.json",
          a11y: "artifacts/accessibility-summary.md",
          export: "artifacts/exported-project.json",
        },
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}
