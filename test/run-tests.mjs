import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let base = '';
const results = [];

function record(name, pass, reason = '') {
  results.push({ name, pass, reason });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : ` -- ${reason}`}`);
}

function check(name, condition, reason) {
  record(name, Boolean(condition), reason);
}

const server = spawn(process.execPath, ['scripts/server.mjs'], { cwd: root });
for (let i = 0; i < 50; i += 1) {
  if (!base) {
    const chunk = server.stdout.read();
    if (chunk) {
      const match = String(chunk).match(/LISTENING (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) base = match[1];
    }
  }
  if (!base) {
    await new Promise((r) => setTimeout(r, 100));
    continue;
  }
  try {
    const res = await fetch(`${base}/index.html`);
    if (res.ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
if (!base) throw new Error('test server failed to start');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto(base, { waitUntil: 'networkidle' });

  await page.click('#btn-rect');
  await page.click('#btn-text');
  const initialCount = await page.evaluate(() => window.__editor.store.state.shapes.length);
  check('default-add-shapes', initialCount === 2, `shape count=${initialCount}`);

  await page.selectOption('#lang-select', 'en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  const afterLangCount = await page.evaluate(() => window.__editor.store.state.shapes.length);
  check('language-switch-keeps-shapes', afterLangCount === 2, `count after switch=${afterLangCount}`);
  check('language-persisted', (await page.evaluate(() => window.__editor.store.state.lang)) === 'en', 'lang not en');

  const orphanInfo = await page.evaluate(async (long) => {
    const mod = await import('/src/text-layout.js');
    const canvas = document.getElementById('poster-canvas');
    const ctx = canvas.getContext('2d');
    const layout = mod.layoutText(ctx, long, 220, 18);
    const last = layout.lines[layout.lines.length - 1];
    const tokens = mod.tokenize(last).filter((tk) => tk.kind !== 'space');
    return { lines: layout.lines.length, lastTokens: tokens.length, last, allLines: layout.lines };
  }, 'This is a long string used to verify automatic wrapping of mixed CJK 中文内容 and English words plus digits 12345, which must wrap at the boundary width without leaving an orphan character behind.');
  check('boundary-wrap-lines', orphanInfo.lines >= 4, `lines=${orphanInfo.lines}`);
  check('boundary-no-orphan', orphanInfo.lastTokens >= 2, `orphan="${orphanInfo.last}"`);

  const target = await page.evaluate(() => {
    const shape = window.__editor.store.state.shapes[0];
    window.__editor.store.select(shape.id);
    return shape;
  });
  await page.focus('#poster-canvas');
  const beforeMove = { x: target.x, y: target.y, id: target.id };
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const afterMove = await page.evaluate(() => {
    const s = window.__editor.store.state.shapes.find((x) => x.id === window.__editor.store.state.selectedId);
    return { x: s.x, y: s.y };
  });
  check('keyboard-moves-shape', afterMove.x === beforeMove.x + 5 && afterMove.y === beforeMove.y + 5,
    `before=${JSON.stringify(beforeMove)} after=${JSON.stringify(afterMove)}`);
  const liveText = await page.locator('#live-region').textContent();
  check('screen-reader-announcement', /Moved|移动/.test(liveText || ''), `live="${liveText}"`);

  await page.keyboard.press('Delete');
  const afterDelete = await page.evaluate(() => window.__editor.store.state.shapes.length);
  check('keyboard-deletes-shape', afterDelete === 1, `count=${afterDelete}`);

  const storage = await page.context().storageState();
  const touchContext = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 900 }, storageState: storage });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(base, { waitUntil: 'networkidle' });
  await touchPage.waitForFunction(() => window.__editor);
  const persistedBefore = await touchPage.evaluate(() => window.__editor.store.state.shapes.length);
  check('reload-restores-project', persistedBefore === 1, `persisted count=${persistedBefore}`);
  const box = await touchPage.locator('#poster-canvas').boundingBox();
  await touchPage.touchscreen.tap(box.x + 120, box.y + 120);
  await touchPage.waitForTimeout(150);
  const touchSelection = await touchPage.evaluate(() => window.__editor.store.state.selectedId);
  check('touch-reaches-selection', Boolean(touchSelection), 'no selection after touch tap');
  await touchContext.close();

  const downloaded = [];
  page.on('download', (d) => downloaded.push(d.suggestedFilename()));
  await page.click('#btn-png');
  await page.waitForTimeout(300);
  await page.click('#btn-svg');
  await page.waitForTimeout(300);
  check('export-png-and-svg', downloaded.includes('poster.png') && downloaded.includes('poster.svg'),
    `downloads=${JSON.stringify(downloaded)}`);

  const exportRecord = await page.evaluate(() => window.__editor.store.state.exports.length);
  const keptCount = await page.evaluate(() => window.__editor.store.state.shapes.length);
  check('export-recorded-and-state-kept', exportRecord >= 2 && keptCount === 1,
    `exports=${exportRecord}, shapes=${keptCount}`);
  const snapshot = await page.evaluate(() => localStorage.getItem('poster-editor/pre-export-snapshot/v1'));
  check('pre-export-snapshot-exists', Boolean(snapshot), 'snapshot missing');

  await page.click('#btn-tests');
  await page.waitForSelector('#test-summary[data-passed]');
  const summary = await page.evaluate(() => {
    const el = document.getElementById('test-summary');
    return { passed: el.dataset.passed, total: el.dataset.total, rate: el.dataset.rate, text: el.textContent };
  });
  check('self-test-all-pass', summary.passed === summary.total,
    `${summary.passed}/${summary.total} :: ${summary.text}`);
  check('self-test-shows-rate', /\d+%/.test(summary.text), `summary="${summary.text}"`);

  const failureRows = await page.locator('#test-results li.fail').count();
  check('self-test-no-failure-rows', failureRows === 0, `${failureRows} failure rows`);

  const storageRecovery = await page.evaluate(async () => {
    const { store } = window.__editor;
    const before = store.state.shapes.length;
    store.forceFailure = true;
    const ok = store.persist();
    store.forceFailure = false;
    const restored = store.restorePreExportSnapshot();
    return { ok, restored, before, after: store.state.shapes.length, status: document.getElementById('live-region').textContent };
  });
  check('error-storage-detected', storageRecovery.ok === false, 'persist returned true');
  check('error-snapshot-restore', storageRecovery.restored === true, 'restore returned false');
  check('error-announced', /restored|Restored|恢复/.test(storageRecovery.status), `status="${storageRecovery.status}"`);

  await page.reload({ waitUntil: 'networkidle' });
  const afterReload = await page.evaluate(() => ({
    count: window.__editor.store.state.shapes.length,
    lang: window.__editor.store.state.lang,
    exports: window.__editor.store.state.exports.length
  }));
  check('reload-state-consistent', afterReload.count === 2 && afterReload.lang === 'en' && afterReload.exports >= 2,
    JSON.stringify(afterReload));

  const overflow = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('button, label, select').forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1 && el.tagName === 'BUTTON') bad.push(el.id || el.textContent);
    });
    return bad;
  });
  check('no-button-overflow', overflow.length === 0, `overflow=${JSON.stringify(overflow)}`);

  check('no-runtime-errors', errors.length === 0, errors.join(' | '));

  await mkdir(join(root, 'artifacts'), { recursive: true });
  const passed = results.filter((r) => r.pass).length;
  const report = {
    total: results.length,
    passed,
    failed: results.length - passed,
    rate: `${Math.round((passed / results.length) * 100)}%`,
    at: new Date().toISOString(),
    results
  };
  await writeFile(join(root, 'artifacts', 'test-report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${passed}/${results.length} passed (${report.rate})`);
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  await browser.close();
  server.kill();
}
