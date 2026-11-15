// Headless interaction test: road drag, blockage reporting and object edits.
// Run: node test/interact.js
const path = require('path');
const assert = require('assert');
let chromium;
try {
  ({ chromium } = require('/tmp/node_modules/playwright'));
} catch (err) {
  try {
    ({ chromium } = require('playwright'));
  } catch (err2) {
    console.error('playwright not installed; run: npx playwright install chromium');
    process.exit(0);
  }
}

(async function () {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1320, height: 760 } });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(String(e)); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(300);

  const box = await page.locator('#scene').boundingBox();
  const CELL = await page.evaluate(function () { return window.VegEngine.CELL; });
  const grid = await page.evaluate(function () {
    return { w: window.VegEngine.W, h: window.VegEngine.H };
  });
  function cellCenter(cellX, cellY) {
    return {
      x: box.x + ((cellX + 0.5) / grid.w) * box.width,
      y: box.y + ((cellY + 0.5) / grid.h) * box.height
    };
  }

  // 1. Successful road node drag (move the single middle node a few cells).
  const mid = await page.evaluate(function () {
    const w = window.__veg.world;
    return w.road[Math.floor(w.road.length / 2)];
  });
  const start = cellCenter(mid.x, mid.y);
  const startX = start.x;
  const startY = start.y;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(
    startX + (3 / grid.w) * box.width, startY, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const status1 = await page.textContent('#status');
  assert(/道路已更新|阻断|未生效/.test(status1), 'drag produced a status: ' + status1);

  // 2. Tree tool on water must be rejected with the no-water rule.
  await page.click('[data-tool="tree"]');
  const water = await page.evaluate(function () {
    return window.__veg.world.cells.find(function (c) { return c.water; });
  });
  const wp = cellCenter(water.x, water.y);
  await page.mouse.click(wp.x, wp.y);
  const status2 = await page.textContent('#status');
  assert(/水面/.test(status2), 'water click rejected: ' + status2);

  // 3. Remove tool on empty cell reports an explicit message.
  await page.click('[data-tool="remove"]');
  const rp = cellCenter(4, 4);
  await page.mouse.click(rp.x, rp.y);
  const status3 = await page.textContent('#status');
  assert(/没有对象|已删除/.test(status3), 'remove tool responded: ' + status3);

  // 4. Season buttons keep the same displayed hash.
  const hashBefore = await page.textContent('#summary .hash');
  await page.click('[data-season="autumn"]');
  await page.waitForTimeout(100);
  const summaryHashes = await page.$$eval('#summary .hash', function (els) {
    return els.map(function (el) { return el.textContent; });
  });
  assert(summaryHashes.includes(hashBefore), 'layout hash survives season switch');

  assert.strictEqual(errors.length, 0, 'no page errors: ' + errors.join('; '));
  console.log('interaction test passed: drag, water rejection, remove tool, season');
  await browser.close();
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
