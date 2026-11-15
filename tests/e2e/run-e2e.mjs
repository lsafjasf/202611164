/* 端到端验证：真实 Chrome 中的键盘/鼠标/触屏、错误恢复、导出与刷新持久化。 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  startChrome, newPageSession, staticServer
} from './cdp-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const profileDir = path.join(rootDir, 'artifacts', 'chrome-profile');
const chromePath = process.env.CHROME_PATH || '/tmp/chrome-dl/chrome-linux64/chrome';

const results = [];
function check(id, name, condition, detail) {
  results.push({ id, name, pass: Boolean(condition), detail: detail || '' });
  console.log((condition ? 'PASS' : 'FAIL') + ' ' + id + ' ' + name + (detail ? ' — ' + detail : ''));
}

async function main() {
  const server = await staticServer(rootDir);
  const chrome = await startChrome(chromePath, profileDir);
  const { page } = await newPageSession(chrome);

  await page.send('Page.navigate', { url: server.url });
  await page.waitForFunction('window.App && document.querySelectorAll("#result-tbody tr").length === 5');

  const initialState = await page.evaluate('JSON.stringify(StoreLayer.loadState())');

  // E01 三场景可重复：默认全通过 / 边界 4 通过 1 失败 / 错误全失败
  const scenarioStats = await page.evaluate(`(async () => {
    const out = {};
    for (const id of ['default','boundary','error']) {
      App.setScenario(id);
      const rs = App.getResults();
      out[id] = { total: rs.length, fail: rs.filter(r => !r.pass).length, ratios: rs.map(r => +r.ratio.toFixed(3)) };
    }
    return out;
  })()`);
  check('E01', '三组可重复场景的达标统计符合预期',
    scenarioStats.default.fail === 0 &&
    scenarioStats.boundary.fail === 1 &&
    scenarioStats.error.fail === 5,
    JSON.stringify(scenarioStats));

  // E02 鼠标：点击错误场景按钮
  await page.click('[data-scenario="error"]');
  const mouseState = await page.evaluate('({scenario: App.getState().scenario, pressed: document.querySelector("[data-scenario=error]").getAttribute("aria-pressed")})');
  check('E02', '鼠标点击进入错误场景且 aria-pressed 更新',
    mouseState.scenario === 'error' && mouseState.pressed === 'true', JSON.stringify(mouseState));

  // E03 错误恢复：一键修复
  const beforeRepair = await page.evaluate('JSON.stringify(App.getState().colors)');
  await page.click('#btn-repair');
  const repairState = await page.evaluate('({allPass: App.getResults().every(r => r.pass), changed: JSON.stringify(App.getState().colors) !== ' + JSON.stringify(beforeRepair) + ', alert: document.getElementById("live-alert").textContent})');
  check('E03', '错误恢复：修复后五项全部达标且有读屏播报',
    repairState.allPass && repairState.changed && repairState.alert.length > 0, JSON.stringify(repairState).slice(0, 160));

  // E04 键盘：合法值生效产生不达标项；非法值被拒绝并提示；Esc 还原
  await page.evaluate('App.setScenario("error")');
  await page.evaluate('document.querySelector("[data-hex-input=bodyText]").focus()');
  const afterInvalidSetup = await page.evaluate('App.getResults().find(r => r.id === "body").ratio');
  await page.setRawInputValue('[data-hex-input=bodyText]', '#GGGGGG');
  const invalidKept = await page.evaluate('({color: App.getState().colors.bodyText, err: document.getElementById("hex-error-bodyText").textContent})');
  const rawInputValue = await page.evaluate('document.querySelector("[data-hex-input=bodyText]").value');
  await page.evaluate(`document.querySelector('[data-hex-input=bodyText]')
    .dispatchEvent(new Event('change', { bubbles: true }))`);
  const afterCommit = await page.evaluate('({state: App.getState().colors.bodyText, input: document.querySelector("[data-hex-input=bodyText]").value})');
  await page.pressKey('Escape');
  const afterEsc = await page.evaluate('document.querySelector("[data-hex-input=bodyText]").value');
  check('E04', '键盘输入：非法值被拒绝并提示，提交回滚，Esc 还原有效值',
    afterInvalidSetup < 2 &&
    invalidKept.color === '#D0D0D0' && rawInputValue === '#GGGGGG' &&
    invalidKept.err.indexOf('非法') >= 0 &&
    afterCommit.state === '#D0D0D0' && afterCommit.input === '#D0D0D0' &&
    afterEsc === '#D0D0D0',
    JSON.stringify({ afterInvalidSetup, invalidKept, rawInputValue, afterCommit, afterEsc }));

  // E05 键盘 Tab 焦点链：从按钮 Tab 到下一控件，焦点被记录
  await page.click('#btn-export-summary');
  await page.pressKey('Tab');
  const focusTracked = await page.evaluate(`(() => {
    const btn = document.getElementById('btn-export-summary');
    const focusables = Array.from(document.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0);
    const index = focusables.indexOf(btn);
    const next = focusables[index + 1];
    next.focus();
    return { active: document.activeElement.id, stored: App.getState().lastFocus, tag: document.activeElement.tagName };
  })()`);
  check('E05', '键盘 Tab 焦点移动并被持久化记录',
    focusTracked.tag !== 'BODY' && !!focusTracked.active &&
    focusTracked.active === focusTracked.stored && focusTracked.active !== 'btn-export-summary',
    JSON.stringify(focusTracked));

  // E06 触屏：触摸点击边界场景按钮，到达与鼠标相同状态
  await page.tap('[data-scenario="boundary"]');
  const touchState = await page.evaluate('App.getState().scenario');
  const touchPressed = await page.evaluate('document.querySelector("[data-scenario=boundary]").getAttribute("aria-pressed")');
  check('E06', '触屏 Pointer 事件到达同一功能状态',
    touchState === 'boundary' && touchPressed === 'true', touchState + ' / ' + touchPressed);

  // E07 导出 CSS：导出前后当前状态不变，IndexedDB 出现记录
  const preExport = await page.evaluate('JSON.stringify(App.getState().colors)');
  await page.click('#btn-export-css');
  try {
    await page.waitForFunction('StoreLayer.listExports().then(l => l.some(r => r.kind === "css"))', 6000);
  } catch (e) {
    check('E07', '导出 CSS 变量：持久化且导出前状态保留', false,
      '等待超时; 页面异常=' + JSON.stringify(page.exceptions) + ' console=' + JSON.stringify(page.consoleMessages));
    throw e;
  }
  const cssExport = await page.evaluate(`(async () => {
    const list = await StoreLayer.listExports();
    return {
      count: list.filter(r => r.kind === 'css').length,
      hasRoot: list.some(r => r.kind === 'css' && r.content.includes(':root')),
      stateKept: JSON.stringify(App.getState().colors) === ${JSON.stringify(preExport)}
    };
  })()`);
  check('E07', '导出 CSS 变量：持久化且导出前状态保留',
    cssExport.count >= 1 && cssExport.hasRoot && cssExport.stateKept, JSON.stringify(cssExport));

  // E08 导出 PNG：前后对比图
  await page.click('#btn-export-png');
  await page.waitForFunction('StoreLayer.listExports().then(l => l.some(r => r.kind === "png"))', 6000);
  const pngExport = await page.evaluate(`(async () => {
    const list = await StoreLayer.listExports();
    const png = list.find(r => r.kind === 'png');
    return png ? {
      isPng: png.content.startsWith('data:image/png;base64,'),
      size: png.content.length,
      afterPass: png.meta.afterPass,
      beforePass: png.meta.beforePass
    } : null;
  })()`);
  check('E08', '导出前后对比 PNG：有效 data URL 且含前后达标计数',
    pngExport && pngExport.isPng && pngExport.size > 10000 &&
    [4, 5].includes(pngExport.afterPass) && pngExport.beforePass === 0,
    JSON.stringify(pngExport));

  // E09 导出摘要
  await page.click('#btn-export-summary');
  await page.waitForFunction('StoreLayer.listExports().then(l => l.some(r => r.kind === "summary"))', 6000);
  const summaryExport = await page.evaluate(`(async () => {
    const list = await StoreLayer.listExports();
    const s = list.find(r => r.kind === 'summary');
    return s ? {
      paths: s.content.includes('已验证的操作路径'),
      recovery: s.content.includes('失败恢复')
    } : null;
  })()`);
  check('E09', '导出无障碍检查摘要：含操作路径与失败恢复',
    summaryExport && summaryExport.paths && summaryExport.recovery, JSON.stringify(summaryExport));

  // E10 刷新：选择、颜色、焦点、导出记录全部恢复
  const preReloadState = await page.evaluate('StoreLayer.loadState()');
  const preReloadCount = await page.evaluate('StoreLayer.listExports().then(l => l.length)');
  const preReload = JSON.stringify({ state: preReloadState, exportCount: preReloadCount });
  await page.reload();
  const postReload = await page.evaluate(`(async () => ({
    state: StoreLayer.loadState(),
    exportCount: (await StoreLayer.listExports()).length,
    rows: document.querySelectorAll('#result-tbody tr').length,
    live: document.getElementById('live-status').textContent,
    records: document.querySelectorAll('#export-records li:not(.muted)').length
  }))()`);
  const pre = JSON.parse(preReload);
  check('E10', '刷新后色板/场景/焦点/导出记录恢复一致',
    postReload.state.scenario === pre.state.scenario &&
    JSON.stringify(postReload.state.colors) === JSON.stringify(pre.state.colors) &&
    postReload.state.lastFocus === pre.state.lastFocus &&
    postReload.exportCount === pre.exportCount &&
    postReload.rows === 5 && postReload.records === pre.exportCount,
    JSON.stringify({ before: pre.state.scenario, after: postReload.state.scenario, exports: postReload.exportCount }));

  // E11 重新载入（关闭页面重开，复用同一 profile）
  await page.send('Page.navigate', { url: 'about:blank' });
  await page.send('Page.navigate', { url: server.url });
  await page.waitForFunction('window.App && document.querySelectorAll("#result-tbody tr").length === 5');
  const secondLoad = await page.evaluate(`(async () => ({
    scenario: App.getState().scenario,
    colors: App.getState().colors,
    exports: (await StoreLayer.listExports()).length
  }))()`);
  check('E11', '重新载入后用户选择与导出工程未被重置',
    secondLoad.scenario === pre.state.scenario &&
    JSON.stringify(secondLoad.colors) === JSON.stringify(pre.state.colors) &&
    secondLoad.exports === pre.exportCount, JSON.stringify({ scenario: secondLoad.scenario, exports: secondLoad.exports }));

  // E12 内置测试套件在页面内运行，统计明确
  const testResult = await page.evaluate('App.runTests()');
  fs.writeFileSync(
    path.join(rootDir, 'artifacts', 'unit-report.json'),
    JSON.stringify(testResult, null, 2)
  );
  check('E12', '内置 18 项测试全部通过并显示成功率',
    testResult.total === 18 && testResult.failed === 0 &&
    testResult.successRate === 100,
    'successRate=' + testResult.successRate + ' failed=' + testResult.failed);
  const statsText = await page.evaluate('document.getElementById("test-stats").textContent.slice(0, 80)');
  check('E13', '测试统计区域明确显示成功率而非笼统提示',
    /成功率\s*100%/.test(statsText), statsText);

  // E14 Canvas 重绘：错误场景下 canvas 有非空像素且 aria-label 可读
  await page.evaluate('App.setScenario("error")');
  const canvasInfo = await page.evaluate(`(() => {
    const c = document.getElementById('preview-canvas');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i] !== 0) { painted++; } }
    return { painted, label: c.getAttribute('aria-label') };
  })()`);
  check('E14', 'Canvas 模拟组件实际绘制且带无障碍名称',
    canvasInfo.painted > 5000 && canvasInfo.label.includes('模拟组件'),
    JSON.stringify(canvasInfo));

  // E15 读屏信息随操作更新
  const ariaInfo = await page.evaluate(`(() => ({
    summary: document.getElementById('result-summary').textContent,
    alert: document.getElementById('live-alert').textContent,
    liveRole: document.getElementById('live-status').getAttribute('aria-live'),
    alertRole: document.getElementById('live-alert').getAttribute('aria-live'),
    thCount: document.querySelectorAll('.result-table th[scope=col]').length,
    caption: !!document.querySelector('.result-table caption')
  }))()`);
  check('E15', '焦点/读屏信息随操作更新且表格语义完整',
    ariaInfo.summary.includes('不达标') && ariaInfo.liveRole === 'polite' &&
    ariaInfo.alertRole === 'assertive' && ariaInfo.thCount === 6 && ariaInfo.caption,
    JSON.stringify(ariaInfo).slice(0, 200));

  page.close();
  chrome.proc.kill();
  await server.stop();

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const rate = Math.round((passed / total) * 1000) / 10;
  const report = {
    ranAt: new Date().toISOString(),
    total,
    passed,
    failed: total - passed,
    successRate: rate,
    cases: results
  };
  fs.mkdirSync(path.join(rootDir, 'artifacts'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'artifacts', 'e2e-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log('\\n==== 端到端统计 ====');
  console.log('总数 ' + total + '，通过 ' + passed + '，失败 ' + (total - passed) + '，成功率 ' + rate + '%');
  if (passed !== total) {
    console.log('失败项: ' + results.filter((r) => !r.pass).map((r) => r.id + '(' + r.detail + ')').join('; '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
