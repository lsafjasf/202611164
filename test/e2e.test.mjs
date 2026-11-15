import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => { throw e; });

const SEED = 20261116;
await page.goto(base);
await page.fill('#seedInput', String(SEED));
await page.click('#startBtn');
await page.waitForFunction(() => !document.getElementById('player').classList.contains('hidden'));
const ruleInfoRun1 = await page.textContent('#ruleInfo');

// Investigation phase must not leak answers
const settleHidden = await page.$eval('#settlement', (el) => el.classList.contains('hidden'));
assert.ok(settleHidden, 'settlement hidden before submission');
const bodyText = await page.textContent('body');
assert.ok(!bodyText.includes('真实路线'), 'no answer leak during investigation');

// Play + pause controls work
await page.click('.seg-card button');
await page.waitForTimeout(300);
assert.match(await page.textContent('#nowPlaying'), /正在播放/);
await page.click('#pauseBtn');
await page.waitForTimeout(300);
assert.match(await page.textContent('#pauseBtn'), /继续/);
await page.click('#pauseBtn');
await page.waitForTimeout(300);
assert.match(await page.textContent('#pauseBtn'), /暂停/);

// Pull ground truth from the page's own logic module (test-only shortcut)
const truth = await page.evaluate(async (seed) => {
  const { generateCase } = await import('./js/case.js');
  const c = generateCase(seed);
  return {
    order: [1, 2, 3, 4].map((p) => c.segments.find((s) => s.order === p).id),
    directions: Object.fromEntries(c.directionTargets.map((id) => [id, c.segments[id].pan])),
    targets: c.directionTargets,
  };
}, SEED);

// --- Round 1: wrong conclusion ---
const wrongOrder = truth.order.slice().reverse();
for (let pos = 1; pos <= 4; pos++) {
  await page.selectOption(`select[data-pos="${pos}"]`, String(wrongOrder[pos - 1]));
}
for (const id of truth.targets) {
  const flip = truth.directions[id] === 'left' ? 'right' : 'left';
  await page.check(`input[name="dir-${id}"][value="${flip}"]`);
}
await page.click('#submitBtn');
const feedback = await page.textContent('#feedback');
assert.match(feedback, /顺序维度/, 'wrong run flags order dimension');
assert.match(feedback, /方位维度/, 'wrong run flags direction dimension');
assert.match(feedback, /时间锚点/, 'wrong run points at time anchor');
assert.match(await page.textContent('#attemptsInfo'), /剩余尝试 \d+\/\d+/, 'attempt counter updates');
assert.ok(
  await page.$eval('#settlement', (el) => el.classList.contains('hidden')),
  'no settlement reveal after a failed attempt with tries left'
);

// --- Round 2: same-seed restart, correct conclusion ---
await page.click('#restartBtn');
await page.waitForFunction(
  () => document.getElementById('ruleInfo').textContent.startsWith('Seed')
);
const ruleInfoRun2 = await page.textContent('#ruleInfo');
assert.equal(ruleInfoRun2, ruleInfoRun1, 'same seed keeps clue order & penalty rules');
for (let pos = 1; pos <= 4; pos++) {
  await page.selectOption(`select[data-pos="${pos}"]`, String(truth.order[pos - 1]));
}
for (const id of truth.targets) {
  await page.check(`input[name="dir-${id}"][value="${truth.directions[id]}"]`);
}
await page.click('#submitBtn');
await page.waitForFunction(() => !document.getElementById('settlement').classList.contains('hidden'));
assert.match(await page.textContent('#settleTitle'), /推断成立/, 'correct conclusion settles');
const settleText = await page.textContent('#settlement');
assert.match(settleText, /真实路线/, 'route revealed at settlement');
assert.match(settleText, /汽笛基频 \d+ Hz/, 'frequency band shown per segment');
assert.match(settleText, /钟声 ×\d/, 'time anchor shown per segment');
assert.match(settleText, /最终得分：1000/, 'no penalty after clean solve');
const okCells = await page.$$eval('#settleTable td.ok', (els) => els.length);
assert.equal(okCells, 4, 'all four segments judged correct');

await browser.close();
server.close();
console.log('E2E tests passed: wrong conclusion flagged per-dimension, correct conclusion settled, same-seed restart consistent.');
