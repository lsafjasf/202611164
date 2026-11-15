import path from 'node:path';
import fs from 'node:fs';
import { startChrome, newPageSession, staticServer } from './cdp-client.mjs';
const root = process.cwd();
const server = await staticServer(root);
const chrome = await startChrome('/tmp/chrome-dl/chrome-linux64/chrome', path.join(root, 'artifacts', 'chrome-profile-shot'));
const { page } = await newPageSession(chrome);
await page.send('Page.navigate', { url: server.url });
await page.waitForFunction('window.App && document.querySelectorAll("#result-tbody tr").length === 5');
for (const scenario of ['default', 'boundary', 'error']) {
  await page.evaluate(`App.setScenario(${JSON.stringify(scenario)})`);
  await new Promise((r) => setTimeout(r, 150));
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(root, 'artifacts', 'screenshot-' + scenario + '.png'), Buffer.from(shot.data, 'base64'));
}
const beforeAfter = await page.evaluate(`(() => {
  const before = Palettes.cloneColors(Palettes.SCENARIOS.error.colors);
  const repaired = Palettes.repairColors(before).colors;
  return CanvasView.renderComparison(before, repaired);
})()`);
fs.writeFileSync(path.join(root, 'artifacts', 'comparison.png'), Buffer.from(beforeAfter.split(',')[1], 'base64'));
await page.evaluate('App.setScenario("boundary")');
await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 2400, deviceScaleFactor: 1, mobile: false
});
await new Promise((r) => setTimeout(r, 200));
const tableShot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(path.join(root, 'artifacts', 'screenshot-results.png'), Buffer.from(tableShot.data, 'base64'));
console.log('screenshots saved');
page.close(); chrome.proc.kill(); await server.stop();
