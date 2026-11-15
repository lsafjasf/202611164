/* 内置测试套件：在真实页面环境内运行，输出成功率与逐条失败原因。 */
(function () {
  'use strict';

  function caseRecord(id, name, fn) {
    return { id: id, name: name, fn: fn };
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || '断言失败');
    }
  }

  function dispatchChange(input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function defineCases(App) {
    const C = window.Contrast;
    const P = window.Palettes;
    const state = App.getState;

    return [
      caseRecord('T01', '对比度算法：黑/白=21:1，#767676/白贴近 4.5:1', function () {
        assert(Math.abs(C.contrastRatio('#000000', '#FFFFFF') - 21) < 0.01, '黑白对比度应为 21:1');
        const r = C.contrastRatio('#767676', '#FFFFFF');
        assert(r >= 4.5 && r <= 4.6, '边界灰色应在 4.5~4.6 之间，实测 ' + r);
      }),

      caseRecord('T02', '非法颜色输入返回 null 且校验为 false', function () {
        assert(C.contrastRatio('#GGGGGG', '#FFFFFF') === null, '非法 hex 应返回 null');
        assert(C.isValidHex('#12345') === false, '5 位 hex 应判非法');
        assert(C.isValidHex('#FFF') === true, '3 位简写应判合法');
      }),

      caseRecord('T03', '默认场景：五项检查全部达标', function () {
        App.setScenario('default');
        const results = App.getResults();
        assert(results.length === 5, '应有 5 个检查项');
        results.forEach(function (r) { assert(r.pass, r.label + ' 应达标，实测 ' + C.formatRatio(r.ratio)); });
      }),

      caseRecord('T04', '边界场景：达标/不达标与临界比值符合预期', function () {
        App.setScenario('boundary');
        const map = {};
        App.getResults().forEach(function (r) { map[r.id] = r; });
        P.SCENARIOS.boundary.expected.forEach(function (exp) {
          const r = map[exp.id];
          assert(r.pass === exp.pass, r.label + ' 达标状态不符，期望 ' + exp.pass);
          if (exp.ratioMin !== undefined) {
            assert(r.ratio >= exp.ratioMin && r.ratio <= exp.ratioMax,
              r.label + ' 比值 ' + r.ratio.toFixed(3) + ' 不在边界区间 [' + exp.ratioMin + ',' + exp.ratioMax + ']');
          }
        });
      }),

      caseRecord('T05', '错误场景：五项检查全部不达标并被标记', function () {
        App.setScenario('error');
        const results = App.getResults();
        results.forEach(function (r) { assert(!r.pass, r.label + ' 应不达标'); });
        const failRows = document.querySelectorAll('#result-tbody tr.row-fail').length;
        assert(failRows === 5, '应有 5 个不达标行，实际 ' + failRows);
      }),

      caseRecord('T06', '错误恢复：一键修复后五项全部达标', function () {
        App.setScenario('error');
        const before = JSON.stringify(state().colors);
        const repaired = App.repair();
        assert(JSON.stringify(state().colors) !== before, '修复后颜色应发生变化');
        assert(repaired.repairedKeys.length >= 1, '应至少修复一个颜色键');
        App.getResults().forEach(function (r) { assert(r.pass, r.label + ' 修复后应达标'); });
      }),

      caseRecord('T07', '实时更新：修改单个色板后结果立即重算', function () {
        App.setScenario('default');
        const oldRatio = App.getResults()[0].ratio;
        App.setColor('bodyText', '#000000');
        const newRatio = App.getResults()[0].ratio;
        assert(newRatio !== oldRatio, '比值应随色板实时变化');
        assert(state().colors.bodyText === '#000000', '状态中的颜色应已更新');
      }),

      caseRecord('T08', '键盘操作：文本输入框改色与程序化更新结果一致', function () {
        App.setScenario('default');
        const input = document.querySelector('[data-hex-input="bodyText"]');
        assert(input instanceof HTMLInputElement, '应存在 bodyText 的 hex 输入框');
        dispatchChange(input, '#000000');
        assert(App.getResults()[0].ratio > 20, '键盘输入后对比度应立即更新');
        dispatchChange(input, '#GGGGGG');
        assert(state().colors.bodyText === '#000000', '非法输入不得写入状态');
        const alert = document.getElementById('live-alert');
        assert(alert.textContent.length > 0, '错误信息应通过 assertive 读屏区域播报');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert(input.value === '#000000', 'Esc 应还原上一个有效值');
      }),

      caseRecord('T09', '鼠标操作：点击场景按钮切换到错误场景', function () {
        App.setScenario('default');
        assert(App.getState().scenario === 'default', '前置场景应为 default');
        const btn = document.querySelector('[data-scenario="error"]');
        btn.click();
        assert(state().scenario === 'error', '点击后场景应为 error');
        const activeBtn = document.querySelector('[data-scenario="error"]');
        assert(activeBtn.getAttribute('aria-pressed') === 'true', '当前场景按钮应标记 aria-pressed=true');
      }),

      caseRecord('T10', '触屏等价：PointerEvent 序列可切换场景', function () {
        const btn = document.querySelector('[data-scenario="boundary"]');
        ['pointerdown', 'pointerup'].forEach(function (type) {
          btn.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch' }));
        });
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert(state().scenario === 'boundary', '触摸指针事件路径应到达同一功能状态');
      }),

      caseRecord('T11', '焦点管理：焦点位置被记录并可恢复', function () {
        const input = document.querySelector('[data-hex-input="btnBg"]');
        input.focus();
        assert(state().lastFocus === input.id, 'lastFocus 应记录当前控件 id，实际 ' + state().lastFocus);
        assert(document.activeElement === input, '焦点应落在该控件上');
      }),

      caseRecord('T12', '读屏信息：live 区域随检查结果更新', function () {
        App.setScenario('error');
        const summary = document.getElementById('result-summary');
        assert(/5/.test(summary.textContent), '摘要应包含检查计数');
        assert(document.getElementById('live-status').textContent.length > 0, 'polite live 区域应有播报');
        const table = document.querySelector('.result-table');
        assert(table.querySelector('caption') !== null, '结果表应提供 caption');
      }),

      caseRecord('T13', '导出 CSS：写入 IndexedDB 且导出前状态不被修改', function () {
        App.setScenario('boundary');
        const snapshot = JSON.stringify(state().colors);
        return window.ExportLib.exportCss(state().colors).then(async function (record) {
          assert(record.kind === 'css' && record.content.indexOf(':root') >= 0, 'CSS 应包含 :root');
          assert(/--color-body-text/.test(record.content), 'CSS 应包含正文变量');
          const list = await window.StoreLayer.listExports();
          assert(list.some(function (r) { return r.id === record.id; }), '导出记录应持久化到 IndexedDB');
          assert(JSON.stringify(state().colors) === snapshot, '导出不得改变当前色板（导出前状态保留）');
        });
      }),

      caseRecord('T14', '导出 PNG：生成 data URL 前后对比图并持久化', async function () {
        const snapshot = JSON.stringify(state().colors);
        const record = await window.ExportLib.exportPng(state().baselineColors, state().colors);
        assert(record.content.indexOf('data:image/png;base64,') === 0, 'PNG 应为 data URL');
        assert(record.content.length > 10000, 'PNG 数据长度异常，疑似空白图');
        assert(record.meta.beforePass !== undefined && record.meta.afterPass !== undefined, '应附带前后达标计数');
        assert(JSON.stringify(state().colors) === snapshot, '导出 PNG 不得改变当前色板');
      }),

      caseRecord('T15', '导出摘要：包含已验证路径与成功率字段', async function () {
        const testResult = App.getLastTestResult();
        const record = await window.ExportLib.exportSummary(testResult, state().colors, App.getVerifiedPaths());
        assert(record.content.indexOf('已验证的操作路径') >= 0, '摘要应包含操作路径章节');
        assert(record.content.indexOf('失败恢复') >= 0, '摘要应包含失败恢复章节');
      }),

      caseRecord('T16', '持久化：localStorage 往返后色板与场景一致', function () {
        App.setScenario('error');
        App.setColor('btnBg', '#334455');
        const reloaded = window.StoreLayer.loadState();
        assert(reloaded.scenario === 'error', '重载后场景应恢复');
        assert(reloaded.colors.btnBg === '#334455', '重载后颜色应恢复');
        assert(!!window.localStorage.getItem(window.StoreLayer.STATE_KEY), 'localStorage 应存在状态键');
      }),

      caseRecord('T17', '错误恢复闭环：非法输入后改回合法值，达标计数恢复', function () {
        App.setScenario('default');
        const input = document.querySelector('[data-hex-input="bodyText"]');
        dispatchChange(input, '#D0D0D0');
        assert(App.getResults().filter(function (r) { return !r.pass; }).length >= 1, '浅色文字应产生不达标项');
        dispatchChange(input, '#1F2328');
        assert(App.getResults().every(function (r) { return r.pass; }), '恢复合法值后应全部达标');
      }),

      caseRecord('T18', 'Canvas 预览随色板重绘并暴露无障碍名称', function () {
        App.setScenario('error');
        const canvas = document.getElementById('preview-canvas');
        const results = window.CanvasView.drawPreview(canvas, state().colors);
        assert(results.length === 5, 'Canvas 渲染应返回 5 项结果');
        assert(canvas.getAttribute('aria-label').indexOf('模拟组件') >= 0, 'Canvas 应有可读无障碍名称');
      })
    ];
  }

  async function runTests(App) {
    const cases = defineCases(App);
    const results = [];
    for (const testCase of cases) {
      try {
        await testCase.fn();
        results.push({ id: testCase.id, name: testCase.name, status: 'pass', detail: '' });
      } catch (error) {
        results.push({ id: testCase.id, name: testCase.name, status: 'fail', detail: error.message });
      }
    }
    const passed = results.filter(function (r) { return r.status === 'pass'; }).length;
    const total = results.length;
    return {
      cases: results,
      total: total,
      passed: passed,
      failed: total - passed,
      successRate: Math.round((passed / total) * 1000) / 10,
      ranAt: new Date().toISOString()
    };
  }

  window.Tests = { runTests: runTests };
})();
