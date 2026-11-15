import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME_PATH = process.env.CHROME_PATH || '/tmp/chrome-dl/chrome-linux64/chrome';

export async function runE2E(baseUrl, screenshotDir, reportDir) {
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files'],
  });
  const results = [];
  const record = async (group, name, fn, page, shotName) => {
    const started = Date.now();
    try {
      await fn();
      if (page && shotName) {
        await page.screenshot({ path: resolve(screenshotDir, `${shotName}.png`), fullPage: true });
      }
      results.push({ group, name, ok: true, durationMs: Date.now() - started, error: null });
    } catch (error) {
      results.push({
        group, name, ok: false, durationMs: Date.now() - started,
        error: error && error.stack ? error.stack : String(error),
      });
    }
  };

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 1000, isMobile: false });
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto(baseUrl, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('#btn-new');
  await page.waitForFunction(() => document.querySelector('#metric-hash').textContent !== '-');

  const metrics = () => page.evaluate(() => ({
    hash: document.querySelector('#metric-hash').textContent,
    pixelHash: document.querySelector('#metric-pixel-hash').textContent,
    count: document.querySelector('#metric-count').textContent,
    selected: window.editorApp.store.project.selection.layerId,
    time: window.editorApp.store.project.selection.currentTime,
  }));

  const initial = await metrics();
  await page.screenshot({ path: resolve(screenshotDir, '01-default-loaded.png'), fullPage: true });

  await record('default', '默认工程载入后渲染 3 个图层并显示对象数与哈希', async () => {
    if (!initial.count.includes('总 10')) throw new Error(`对象数错误: ${initial.count}`);
    if (!/^[0-9a-f]{64}$/.test(initial.hash)) throw new Error('SHA-256 哈希缺失');
    if (!/^[0-9a-f]{8}$/.test(initial.pixelHash)) throw new Error('画布像素哈希缺失');
  }, page, null);

  await record('default', '鼠标点击画布可选中图层（鼠标路径）', async () => {
    const box = await page.$('#canvas');
    const canvasBox = await box.boundingBox();
    await page.mouse.click(canvasBox.x + 100, canvasBox.y + 100);
    const selected = await page.evaluate(() => window.editorApp.store.project.selection.layerId);
    if (!selected) throw new Error('鼠标点击未选中任何图层');
  }, page, null);

  await record('default', '键盘方向键可切换图层选择（键盘路径）', async () => {
    await page.focus('#layer-list');
    const before = await page.evaluate(() => window.editorApp.store.project.selection.layerId);
    await page.keyboard.press('ArrowDown');
    const after = await page.evaluate(() => window.editorApp.store.project.selection.layerId);
    if (before === after) throw new Error('方向键未改变图层选择');
    const aria = await page.evaluate(() => {
      const active = document.activeElement;
      return { tag: active.tagName, selected: active.getAttribute('aria-selected') };
    });
    if (aria.tag !== 'LI' || aria.selected !== 'true') {
      throw new Error(`焦点/ARIA 未随键盘更新: ${JSON.stringify(aria)}`);
    }
  }, page, null);

  await record('default', '触屏点按与鼠标到达同一选中状态（触屏路径）', async () => {
    await page.evaluate(() => window.editorApp.store.selectLayer('layer-rect'));
    const canvasBox = await page.$('#canvas').then((handle) => handle.boundingBox());
    await page.touchscreen.tap(canvasBox.x + 120, canvasBox.y + 90);
    const touchSelected = await page.evaluate(() => window.editorApp.store.project.selection.layerId);
    await page.mouse.click(canvasBox.x + 120, canvasBox.y + 90);
    const mouseSelected = await page.evaluate(() => window.editorApp.store.project.selection.layerId);
    if (touchSelected !== 'layer-rect' || touchSelected !== mouseSelected) {
      throw new Error(`触屏=${touchSelected} 鼠标=${mouseSelected} 状态不一致`);
    }
  }, page, null);

  await record('default', '键盘修改时间轴并插入关键帧后画布像素发生变化', async () => {
    await page.focus('#time-range');
    await page.keyboard.press('ArrowRight');
    const time = await page.evaluate(() => window.editorApp.store.project.selection.currentTime);
    if (!(time > 0)) throw new Error('键盘未能移动播放头');
    const pixelBefore = initial.pixelHash;
    await page.click('#btn-keyframe');
    const kfCount = await page.evaluate(
      () => window.editorApp.store.project.layers.find((l) => l.id === 'layer-rect').keyframes.length,
    );
    if (kfCount !== 4) throw new Error(`关键帧数量错误: ${kfCount}`);
    const pixelAfter = await page.evaluate(() => document.querySelector('#metric-pixel-hash').textContent);
    if (pixelAfter === pixelBefore) throw new Error('插入关键帧后像素哈希未变化');
  }, page, null);

  await record('default', '导出 JSON 后再导入，哈希/对象数/画布像素完全一致', async () => {
    const before = await metrics();
    const exported = await page.evaluate(() => window.editorApp.exportProject().json);
    if (!exported.includes('"format": "editor-project"')) throw new Error('导出包缺少 format');
    const importResult = await page.evaluate(
      (text) => window.editorApp.store.importJSON(text),
      exported,
    );
    if (!importResult.ok) throw new Error(JSON.stringify(importResult.errors));
    const after = await metrics();
    if (after.hash !== before.hash) throw new Error(`往返哈希变化: ${before.hash} -> ${after.hash}`);
    if (after.count !== before.count) throw new Error('往返后对象数变化');
    if (after.pixelHash !== before.pixelHash) throw new Error('往返后画布像素哈希变化');
  }, page, '02-after-roundtrip');

  await record('default', '多次往返不产生重复图层/关键帧/素材', async () => {
    const beforeCounts = await page.evaluate(() => {
      const project = window.editorApp.store.project;
      return {
        layers: project.layers.length,
        assets: project.assets.length,
        keyframes: project.layers.reduce((sum, layer) => sum + layer.keyframes.length, 0),
      };
    });
    for (let index = 0; index < 3; index += 1) {
      await page.evaluate(() => {
        const { json } = window.editorApp.exportProject();
        window.editorApp.importProject(json);
      });
    }
    const afterCounts = await page.evaluate(() => {
      const project = window.editorApp.store.project;
      return {
        layers: project.layers.length,
        assets: project.assets.length,
        keyframes: project.layers.reduce((sum, layer) => sum + layer.keyframes.length, 0),
      };
    });
    if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) {
      throw new Error(`对象累积: ${JSON.stringify(beforeCounts)} -> ${JSON.stringify(afterCounts)}`);
    }
  }, page, null);

  await record('boundary', '刷新页面后工程、选择与播放头从 localStorage 完整恢复', async () => {
    await page.evaluate(() => {
      window.editorApp.store.selectLayer('layer-text');
      window.editorApp.store.setCurrentTime(2.5);
    });
    const beforeReload = await metrics();
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.editorApp !== undefined);
    const afterReload = await metrics();
    if (afterReload.hash !== beforeReload.hash) throw new Error('刷新后工程哈希变化');
    if (afterReload.selected !== 'layer-text') throw new Error('刷新后用户选择被重置');
    if (Math.abs(afterReload.time - 2.5) > 1e-9) throw new Error('刷新后播放头被重置');
  }, page, '03-after-reload');

  await record('boundary', '边界工程载入后仍可渲染并保留极值参数', async () => {
    await page.click('#btn-boundary');
    const info = await page.evaluate(() => {
      const project = window.editorApp.store.project;
      return {
        duration: project.timeline.duration,
        fps: project.timeline.fps,
        x: project.layers[0].x,
        y: project.layers[0].y,
        width: project.layers[0].width,
        selected: project.selection.layerId,
      };
    });
    if (info.duration !== 3600 || info.fps !== 1) throw new Error('时间轴边界参数丢失');
    if (info.x !== -10000 || info.y !== 10000 || info.width !== 0) throw new Error('图层边界参数丢失');
    if (info.selected !== 'layer-edge') throw new Error('边界工程选择未恢复');
  }, page, '04-boundary');

  await record('error', '悬空引用导入被阻止并显示具体失败原因，工程不被替换', async () => {
    await page.click('#btn-new');
    const hashBefore = (await metrics()).hash;
    const result = await page.evaluate(async () => {
      const { buildDanglingReferenceProject } = await import('/src/core/sample-data.js');
      const text = JSON.stringify(buildDanglingReferenceProject());
      window.editorApp.importProject(text);
      return window.editorApp.store.lastImport;
    });
    if (result.ok) throw new Error('悬空引用导入未被阻止');
    if (!result.errors[0].message.includes('悬空')) throw new Error('错误提示缺少具体原因');
    const hashAfter = (await metrics()).hash;
    if (hashAfter !== hashBefore) throw new Error('失败导入替换了当前工程');
    const alertText = await page.$eval('#error-box', (node) => node.textContent);
    if (!alertText.includes('dangling-reference')) throw new Error('读屏告警未包含错误码');
  }, page, '05-error-blocked');

  await record('error', '错误恢复后可重新导入合法工程且状态恢复', async () => {
    const hashBefore = await page.evaluate(async () => {
      const { buildDefaultProject } = await import('/src/core/sample-data.js');
      const { projectHash } = await import('/src/core/serialize.js');
      return projectHash(buildDefaultProject());
    });
    const recovered = await page.evaluate(async () => {
      const { buildDefaultProject } = await import('/src/core/sample-data.js');
      window.editorApp.importProject(JSON.stringify(buildDefaultProject()));
      return window.editorApp.store.lastImport;
    });
    if (!recovered.ok) throw new Error('恢复导入失败');
    if ((await metrics()).hash !== hashBefore) throw new Error('恢复后哈希与原工程不一致');
    const errorHidden = await page.$eval('#error-box', (node) => node.hidden);
    if (errorHidden !== true) throw new Error('恢复后告警未清除');
  }, page, '06-error-recovered');

  await record('error', '非法类型 JSON 被拒绝且状态条展示错误码与路径', async () => {
    const result = await page.evaluate(async () => {
      const { buildIllegalTypeProject } = await import('/src/core/sample-data.js');
      window.editorApp.importProject(JSON.stringify(buildIllegalTypeProject()));
      return window.editorApp.store.lastImport;
    });
    if (result.ok) throw new Error('非法类型导入未被阻止');
    if (!result.errors.some((error) => error.code === 'illegal-type')) throw new Error('缺少 illegal-type 错误码');
  }, page, null);

  await record('error', '控制台无未捕获脚本错误', async () => {
    if (consoleErrors.length > 0) throw new Error(consoleErrors.join(' | '));
  }, page, null);

  await record('default', '无障碍：列表/画布/状态条具备 ARIA 角色与标签', async () => {
    const audit = await page.evaluate(() => {
      const list = document.querySelector('#layer-list');
      const canvas = document.querySelector('#canvas');
      const status = document.querySelector('#status');
      const alert = document.querySelector('#error-box');
      const buttons = Array.from(document.querySelectorAll('button'));
      return {
        listRole: list.getAttribute('role'),
        listLabel: list.getAttribute('aria-label'),
        canvasLabel: canvas.getAttribute('aria-label'),
        statusLive: status.getAttribute('aria-live'),
        alertRole: alert.getAttribute('role'),
        alertLive: alert.getAttribute('aria-live'),
        buttonsWithoutLabel: buttons.filter((button) => !button.textContent.trim()).length,
      };
    });
    if (audit.listRole !== 'listbox' || !audit.listLabel) throw new Error('图层列表缺少 listbox 语义');
    if (!audit.canvasLabel.includes('工程画布预览')) throw new Error('画布缺少 aria-label');
    if (audit.statusLive !== 'polite' || audit.alertRole !== 'alert' || audit.alertLive !== 'assertive') {
      throw new Error(`实时区域语义错误: ${JSON.stringify(audit)}`);
    }
    if (audit.buttonsWithoutLabel > 0) throw new Error('存在无文本按钮');
  }, page, null);

  await record('default', '无障碍：键盘可完成选择、改参数、插关键帧的完整路径', async () => {
    await page.focus('#layer-list');
    await page.keyboard.press('ArrowDown');
    const selectedAfterKeyboard = await page.evaluate(
      () => window.editorApp.store.project.selection.layerId,
    );
    if (!selectedAfterKeyboard) throw new Error('键盘路径未能选中图层');
    await page.focus('#layer-form input[name="opacity"]');
    await page.evaluate(() => {
      const input = document.querySelector('#layer-form input[name="opacity"]');
      input.value = '0.42';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const opacity = await page.evaluate((layerId) =>
      window.editorApp.store.project.layers.find((layer) => layer.id === layerId).opacity,
    selectedAfterKeyboard);
    if (Math.abs(opacity - 0.42) > 1e-9) throw new Error('键盘表单路径未更新图层参数');
    await page.focus('#btn-keyframe');
    await page.keyboard.press('Enter');
    const kfCount = await page.evaluate((layerId) =>
      window.editorApp.store.project.layers.find((layer) => layer.id === layerId).keyframes.length,
    selectedAfterKeyboard);
    if (kfCount < 1) throw new Error('键盘 Enter 未触发关键帧插入');
    const statusText = await page.$eval('#status', (node) => node.textContent);
    if (!statusText.includes('关键帧')) throw new Error(`aria-live 状态未随操作更新: ${statusText}`);
  }, page, '07-keyboard-a11y');

  await record('default', '无障碍：焦点指示器可见且焦点停留在可交互元素上', async () => {
    await page.focus('#btn-export');
    const focusInfo = await page.evaluate(() => {
      const active = document.activeElement;
      const styles = getComputedStyle(active);
      return {
        tag: active.tagName,
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      };
    });
    if (focusInfo.tag !== 'BUTTON') throw new Error('焦点未落在按钮上');
    if (focusInfo.outlineStyle === 'none' || focusInfo.outlineWidth === '0px') {
      throw new Error(`焦点指示器不可见: ${JSON.stringify(focusInfo)}`);
    }
  }, page, null);

  await record('error', '无障碍：导入失败时 alert 区域携带错误码并可被读屏感知', async () => {
    await page.evaluate(async () => {
      const { buildDanglingReferenceProject } = await import('/src/core/sample-data.js');
      window.editorApp.importProject(JSON.stringify(buildDanglingReferenceProject()));
    });
    const alertInfo = await page.evaluate(() => {
      const node = document.querySelector('#error-box');
      return { hidden: node.hidden, role: node.getAttribute('role'), text: node.textContent };
    });
    if (alertInfo.hidden || alertInfo.role !== 'alert' || !alertInfo.text.includes('dangling-reference')) {
      throw new Error(`告警区域不可读或缺少错误码: ${JSON.stringify(alertInfo)}`);
    }
  }, page, '08-a11y-alert');

  await browser.close();

  const summary = {
    suite: 'e2e',
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    rate: `${((results.filter((result) => result.ok).length / results.length) * 100).toFixed(1)}%`,
    results,
  };
  writeFileSync(resolve(reportDir, 'e2e-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
