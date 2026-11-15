// Renders the real page in headless Chromium and writes screenshots.
// Run: node test/screenshot.js
const path = require('path');
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
  page.on('console', function (m) {
    if (m.type() === 'error') errors.push(m.text());
  });
  const url = 'file://' + path.join(__dirname, '..', 'index.html');
  await page.goto(url);
  await page.waitForTimeout(300);
  const out = path.join(__dirname, '..', 'artifacts');
  await page.screenshot({ path: path.join(out, 'seed1337-summer.png') });

  await page.click('[data-seed="20261116"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'seed20261116-summer.png') });

  await page.click('[data-season="winter"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, 'seed20261116-winter.png') });

  await page.click('[data-season="summer"]');
  await page.click('[data-tool="road"]');
  await page.evaluate(function () {
    const w = window.__veg.world;
    window.__dragTarget = w.road[Math.floor(w.road.length / 2)];
  });
  const box = await page.locator('#scene').boundingBox();
  const dims = await page.evaluate(function () {
    return { w: window.VegEngine.W, h: window.VegEngine.H, t: window.__dragTarget };
  });
  const cx = box.x + ((dims.t.x + 0.5) / dims.w) * box.width;
  const cy = box.y + ((dims.t.y + 0.5) / dims.h) * box.height;
  const offsets = [[0, 2], [0, -2], [2, 0], [-2, 0], [0, 3], [0, -3]];
  let succeeded = false;
  for (const [ox, oy] of offsets) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(
      cx + (ox / dims.w) * box.width,
      cy + (oy / dims.h) * box.height, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const txt = await page.textContent('#status');
    if (/道路已更新/.test(txt)) { succeeded = true; break; }
  }
  await page.screenshot({ path: path.join(out, 'road-drag.png') });
  if (!succeeded) throw new Error('no drag offset succeeded for screenshot');

  await page.click('#selftestBtn');
  await page.waitForTimeout(200);
  const status = await page.textContent('#status');
  if (!/内置自检通过/.test(status)) {
    console.error(status);
    process.exit(1);
  }
  await page.screenshot({ path: path.join(out, 'selftest.png') });
  if (errors.length) {
    console.error('page errors:', errors);
    process.exit(1);
  }
  console.log('screenshots written to artifacts/; self-test passed in-browser');
  await browser.close();
})();
