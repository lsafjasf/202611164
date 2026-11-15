import { test, expect } from '@playwright/test';
const url = '/';

test.describe('金属齿音乐盒 E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(url);
    await page.waitForSelector('#report .case');
    await page.evaluate(() => localStorage.clear());
  });

  test('自检面板全部通过', async ({ page }) => {
    const fails = await page.locator('#report .case.fail').count();
    expect(fails).toBe(0);
    const passes = await page.locator('#report .case.pass').count();
    expect(passes).toBeGreaterThanOrEqual(8);
  });

  test('播放→暂停→恢复节拍位置不漂移，停止后节点全部释放', async ({ page }) => {
    await page.click('#btnPlay');
    await page.waitForTimeout(600);
    const playing = await page.evaluate(() => window.__transport.virtualTime);
    expect(playing).toBeGreaterThan(0.3);
    await page.click('#btnPause');
    const frozenAt = await page.evaluate(() => window.__transport.virtualTime);
    await page.waitForTimeout(400);
    const beatPaused1 = await page.evaluate(() => window.__transport.virtualTime);
    await page.waitForTimeout(300);
    const beatPaused2 = await page.evaluate(() => window.__transport.virtualTime);
    expect(beatPaused1).toBe(beatPaused2); // 暂停时虚拟时间冻结

    await page.click('#btnPlay');
    await page.waitForTimeout(500);
    const resumed = await page.evaluate(() => window.__transport.virtualTime);
    expect(resumed).toBeGreaterThan(frozenAt); // 恢复后继续推进，无跳变
    await page.click('#btnStop');
    await page.waitForTimeout(200);
    const released = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { voices: window.__engine.liveVoiceCount, t: window.__transport.virtualTime };
    });
    expect(released.voices).toBe(0);
    expect(released.t).toBeLessThan(0.01);
  });

  test('调整速度与 BPM 后仍能播放且无报错', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.click('#btnPlay');
    await page.locator('#rngSpeed').evaluate((el) => { el.value = 2.5; el.dispatchEvent(new Event('input')); });
    await page.locator('#rngBpm').evaluate((el) => { el.value = 160; el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(700);
    await page.click('#btnPause');
    expect(errors).toEqual([]);
  });

  test('导出 WAV：时长与工程导出时长一致', async ({ page }) => {
    const info = await page.evaluate(async () => {
      const engine = window.__engine;
      engine.rebuildEvents();
      const { wav, duration } = await engine.renderOffline();
      return { size: wav.size, duration };
    });
    expect(info.size).toBeGreaterThan(1000);
    const stats = await page.evaluate(() => window.__stats());
    expect(Math.abs(info.duration - stats.exportDuration)).toBeLessThan(1e-9);
  });

  test('保存并刷新后：音符数量、节拍位置、导出时长一致且从头加载', async ({ page }) => {
    const before = await page.evaluate(() => window.__stats());
    await page.click('#btnReloadCheck');
    await page.waitForLoadState('load');
    await page.waitForSelector('#report .case');
    const after = await page.evaluate(() => window.__stats());
    expect(after.noteCount).toBe(before.noteCount);
    expect(after.exportDuration).toBe(before.exportDuration);
    expect(after.gains).toEqual(before.gains);
    const t0 = await page.evaluate(() => window.__transport.virtualTime);
    expect(t0).toBeLessThan(0.001);
    const banner = await page.locator('#report').innerText();
    expect(banner).toContain('页面重载完成');
    expect(banner).toContain('完全一致');
  });

  test('点击谱面可增删音符并持久化', async ({ page }) => {
    const before = await page.evaluate(() => window.__stats().noteCount);
    const box = await page.locator('#score').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + 30);
    const afterAdd = await page.evaluate(() => window.__stats().noteCount);
    expect(afterAdd).toBe(before + 1);
    await page.reload();
    await page.waitForSelector('#report .case');
    const afterReload = await page.evaluate(() => window.__stats().noteCount);
    expect(afterReload).toBe(afterAdd);
  });

  test('停止后所有 Web Audio 节点释放，循环回绕后继续发声', async ({ page }) => {
    await page.click('#btnPlay');
    await page.waitForTimeout(800);
    const created = await page.evaluate(() => window.__engine.nodeCount);
    expect(created).toBeGreaterThan(0);
    await page.click('#btnStop');
    await page.waitForTimeout(300);
    const afterStop = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 250));
      return { voices: window.__engine.liveVoiceCount, closed: window.__engine.closedCount, created: window.__engine.nodeCount };
    });
    expect(afterStop.voices).toBe(0);
    expect(afterStop.closed).toBe(afterStop.created);

    // 循环：把速度调到 3× 并快进到接近结尾，验证回绕后游标重置且能继续调度
    await page.evaluate(() => { window.__transport._virtual = window.__transport.duration - 0.3; });
    await page.click('#btnPlay');
    await page.waitForTimeout(900);
    const wrapped = await page.evaluate(() => ({
      t: window.__transport.virtualTime,
      cursor: window.__engine.cursor,
      running: window.__transport.running,
    }));
    expect(wrapped.running).toBe(true);
    expect(wrapped.t).toBeLessThan(2); // 已回绕到开头附近
    expect(wrapped.cursor).toBeLessThan(3);
  });
});
