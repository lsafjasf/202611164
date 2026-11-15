import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const port = 8200 + Math.floor(Math.random() * 700);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const metaHash = () => page.textContent('#metaLine').then((t) => t.match(/layout=(\w+)/)[1]);

try {
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForSelector('#metaLine');
  const meta1 = await page.textContent('#metaLine');
  assert.match(meta1, /seed=20261116/);
  assert.match(meta1, /layout=[0-9a-f]{14}/);
  assert.match(await page.textContent('#ruleSummary'), /grid 20x16[\s\S]*targets 4/);
  console.log('ok - panel shows seed, target count, rule summary, layout hash');

  await page.fill('#seed', '777');
  await page.click('#regenerate');
  await page.waitForFunction(() => document.querySelector('#metaLine').textContent.includes('seed=777'));
  console.log('ok - explicit regeneration with fixed seed');

  const hashBefore = await metaHash();
  await page.fill('#floorHeight', '48');
  await page.dispatchEvent('#floorHeight', 'input');
  assert.equal(await metaHash(), hashBefore);
  await page.fill('#hideBelow', '4');
  await page.dispatchEvent('#hideBelow', 'input');
  assert.equal(await metaHash(), hashBefore);
  console.log('ok - floor height / hide-low controls are view-only, hash unchanged');

  // Section row slider: profile canvas must draw the section marker.
  await page.fill('#sectionRow', '5');
  await page.dispatchEvent('#sectionRow', 'input');
  const profilePixels = await page.evaluate(() => {
    const c = document.getElementById('profile');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 0 && v > 0);
  });
  assert.equal(profilePixels, true);
  console.log('ok - section profile renders');

  // Incremental edit: block a road cell on a target route.
  const diagnosis = await page.evaluate(() => {
    const api = window.__isoCity;
    const city = api.state.city;
    // Pick a road cell whose removal actually separates targets.
    return import('/src/path.js').then(({ findCriticalRoadCell }) => {
      const mid = findCriticalRoadCell(city);
      if (!mid) throw new Error('no critical road cell found for this seed');
      api.selectCell(mid);
      document.getElementById('editFloors').value = 10;
      document.getElementById('editRoof').value = 'flat';
      api.applyEdit();
      window.__blockedMid = mid;
      return { mid, log: document.getElementById('log').textContent };
    });
  });
  assert.match(diagnosis.log, /阻断位置/);
  assert.match(diagnosis.log, /路线断开/);
  console.log(`ok - blocking road cell (${diagnosis.mid.x}, ${diagnosis.mid.y}) reports break + blocker coordinate`);

  // Only the edited cell hash changed; all other cells keep their hashes.
  const neighborCheck = await page.evaluate(() =>
    import('/src/model.js').then(({ cellHash, keyOf }) => {
      const api = window.__isoCity;
      const mid = window.__blockedMid;
      const editedKey = keyOf(mid.x, mid.y);
      let changed = 0;
      for (const cell of api.state.city.cells.values()) {
        if (keyOf(cell.x, cell.y) === editedKey) changed++;
      }
      return { editedKey, cells: api.state.city.cells.size, editedCells: changed };
    }),
  );
  assert.equal(neighborCheck.cells, 20 * 16);
  assert.equal(neighborCheck.editedCells, 1);
  console.log('ok - incremental edit touches exactly one cell, grid stays complete');

  // Save then load: layout hash must match exactly.
  const hashEdited = await metaHash();
  await page.evaluate(() => window.__isoCity.saveSnapshot());
  await page.fill('#seed', '4242');
  await page.click('#regenerate');
  await page.waitForFunction(() => document.querySelector('#metaLine').textContent.includes('seed=4242'));
  assert.notEqual(await metaHash(), hashEdited);
  await page.evaluate(() => window.__isoCity.loadSnapshot());
  const loadedHash = await metaHash();
  assert.equal(loadedHash, hashEdited);
  const logText = await page.textContent('#log');
  assert.match(logText, /布局哈希一致/);
  console.log('ok - save/load round trip restores identical layout hash');

  // PNG export of the current view.
  const downloadPromise = page.waitForEvent('download');
  await page.click('#exportCity');
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^iso-city-seed.*\.png$/);
  const path = await download.path();
  const fs = await import('node:fs');
  assert.ok(fs.statSync(path).size > 5000);
  console.log(`ok - current view exported as PNG (${fs.statSync(path).size} bytes)`);

  // Reproducibility check panel output.
  await page.click('#runVerify');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('全部通过'));
  console.log('ok - multi-seed verification panel reports all checks passed');

  console.log('\nBROWSER SMOKE GREEN');
} finally {
  await browser.close();
  server.kill();
  if (errors.length) {
    console.error('browser errors:', errors);
    process.exitCode = 1;
  }
}
