/* 主应用：状态、渲染、事件、持久化与测试入口。 */
(function () {
  'use strict';

  const state = window.StoreLayer.loadState();
  const verifiedPaths = [];
  const $ = function (sel) { return document.querySelector(sel); };

  function announce(regionId, message) {
    const node = document.getElementById(regionId);
    node.textContent = message;
  }

  function persist() {
    window.StoreLayer.saveState(state);
  }

  function getState() {
    return state;
  }

  function getResults() {
    return window.Palettes.evaluate(state.colors);
  }

  function getLastTestResult() {
    return state.lastTestResult;
  }

  function getVerifiedPaths() {
    return verifiedPaths;
  }

  function trackPath(description) {
    if (verifiedPaths.indexOf(description) === -1) {
      verifiedPaths.push(description);
    }
  }

  function setScenario(id, options) {
    const scenario = window.Palettes.SCENARIOS[id];
    if (!scenario) {
      return false;
    }
    state.scenario = id;
    state.colors = window.Palettes.cloneColors(scenario.colors);
    persist();
    renderAll();
    if (!options || options.silent !== true) {
      announce('live-status', '已切换到' + scenario.name);
    }
    return true;
  }

  function setColor(key, hex, options) {
    const normalized = String(hex).toUpperCase();
    if (!window.Contrast.isValidHex(normalized)) {
      return false;
    }
    state.colors[key] = normalized;
    persist();
    renderResults();
    renderCanvas();
    if (!options || options.silent !== true) {
      announce('live-status', '色板已更新，对比度结果已重新计算');
    }
    return true;
  }

  function repair() {
    const outcome = window.Palettes.repairColors(state.colors);
    state.colors = outcome.colors;
    persist();
    renderAll();
    announce('live-alert', '修复完成，已调整：' +
      (outcome.repairedKeys.join('、') || '无需调整'));
    trackPath('错误恢复：错误色板经“一键修复”使全部检查项达标');
    return outcome;
  }

  function renderScenarioButtons() {
    const host = $('#scenario-buttons');
    host.innerHTML = '';
    Object.keys(window.Palettes.SCENARIOS).forEach(function (id) {
      const scenario = window.Palettes.SCENARIOS[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn scenario-btn' + (state.scenario === id ? ' is-active' : '');
      btn.textContent = scenario.name;
      btn.setAttribute('data-scenario', id);
      btn.setAttribute('aria-pressed', String(state.scenario === id));
      host.appendChild(btn);
    });
    $('#scenario-desc').textContent = window.Palettes.SCENARIOS[state.scenario].description;
  }

  function renderSwatches() {
    const host = $('#swatch-controls');
    host.innerHTML = '';
    window.Palettes.KEYS.forEach(function (key) {
      const wrap = document.createElement('div');
      wrap.className = 'swatch-item';
      const label = document.createElement('label');
      label.className = 'swatch-label';
      label.setAttribute('for', 'hex-' + key.id);
      label.textContent = key.label;

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.className = 'color-picker';
      picker.value = state.colors[key.id];
      picker.setAttribute('aria-label', key.label + '取色器');
      picker.setAttribute('data-color-picker', key.id);

      const text = document.createElement('input');
      text.type = 'text';
      text.className = 'hex-input';
      text.id = 'hex-' + key.id;
      text.value = state.colors[key.id];
      text.maxLength = 7;
      text.spellcheck = false;
      text.setAttribute('aria-describedby', 'hex-error-' + key.id);
      text.setAttribute('data-hex-input', key.id);

      const error = document.createElement('span');
      error.className = 'field-error';
      error.id = 'hex-error-' + key.id;
      error.setAttribute('role', 'status');

      wrap.append(label, picker, text, error);
      host.appendChild(wrap);
    });
  }

  function renderResults() {
    const tbody = $('#result-tbody');
    tbody.innerHTML = '';
    const results = getResults();
    let failCount = 0;
    results.forEach(function (r) {
      if (!r.pass) { failCount += 1; }
      const tr = document.createElement('tr');
      tr.className = r.pass ? 'row-pass' : 'row-fail';
      const cells = [
        r.label,
        r.fg + '（' + r.fgKey + '）',
        r.bg + '（' + r.bgKey + '）',
        window.Contrast.formatRatio(r.ratio),
        '≥ ' + r.min + ':1',
        r.pass ? '达标' : '不达标'
      ];
      cells.forEach(function (value, index) {
        const td = document.createElement('td');
        td.textContent = value;
        if (index === cells.length - 1) {
          td.className = r.pass ? 'status-pass' : 'status-fail';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    $('#result-summary').textContent =
      '共 ' + results.length + ' 项检查：' + (results.length - failCount) +
      ' 项达标，' + failCount + ' 项不达标。' +
      (failCount ? '请调整色板或使用一键修复。' : '全部满足 WCAG 2.1 要求。');
    announce('live-status', '检查结果已更新，' + failCount + ' 项不达标');
  }

  function renderCanvas() {
    const canvas = $('#preview-canvas');
    window.CanvasView.drawPreview(canvas, state.colors);
  }

  function renderAll() {
    renderScenarioButtons();
    renderSwatches();
    renderResults();
    renderCanvas();
  }

  window.App = {
    getState: getState,
    getResults: getResults,
    getLastTestResult: getLastTestResult,
    getVerifiedPaths: getVerifiedPaths,
    setScenario: setScenario,
    setColor: setColor,
    repair: repair,
    renderAll: renderAll,
    renderResults: renderResults,
    renderCanvas: renderCanvas,
    trackPath: trackPath,
    persist: persist
  };

  function renderExportRecords() {
    const list = $('#export-records');
    list.innerHTML = '';
    window.StoreLayer.listExports().then(function (records) {
      if (!records.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = '暂无导出记录。';
        list.appendChild(li);
        return;
      }
      records.forEach(function (record) {
        const li = document.createElement('li');
        const kindLabel = { css: 'CSS 变量', png: '对比 PNG', summary: '检查摘要' }[record.kind] || record.kind;
        const name = document.createElement('span');
        name.textContent = kindLabel + ' · ' + record.filename + ' · ' +
          new Date(record.createdAt).toLocaleString('zh-CN');
        const dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'btn btn-mini';
        dl.textContent = '重新下载';
        dl.addEventListener('click', function () {
          if (record.kind === 'png') {
            const a = document.createElement('a');
            a.href = record.content;
            a.download = record.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
          } else {
            const blob = new Blob([record.content], { type: record.mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = record.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          }
          trackPath('导出记录：从 IndexedDB 重新下载 ' + record.filename);
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-mini btn-ghost';
        del.textContent = '删除';
        del.addEventListener('click', function () {
          window.StoreLayer.deleteExport(record.id).then(renderExportRecords);
        });
        li.append(name, dl, del);
        list.appendChild(li);
      });
    });
  }

  function renderTestStats(result) {
    const stats = $('#test-stats');
    if (!result) {
      stats.textContent = '尚未运行测试。';
      return;
    }
    stats.innerHTML = '';
    const head = document.createElement('p');
    head.className = result.failed === 0 ? 'stats-ok' : 'stats-fail';
    head.textContent = '成功率 ' + result.successRate + '%（通过 ' + result.passed +
      ' / 共 ' + result.total + '，失败 ' + result.failed + '）';
    stats.appendChild(head);
    if (result.failed > 0) {
      const detail = document.createElement('p');
      detail.textContent = '失败原因：' + result.cases.filter(function (c) {
        return c.status === 'fail';
      }).map(function (c) { return c.id + ' ' + c.name + '（' + c.detail + '）'; }).join('；');
      stats.appendChild(detail);
    }
    const tbody = $('#test-tbody');
    tbody.innerHTML = '';
    result.cases.forEach(function (c) {
      const tr = document.createElement('tr');
      tr.className = c.status === 'pass' ? 'row-pass' : 'row-fail';
      [c.id, c.name, c.status === 'pass' ? '通过' : '失败', c.detail].forEach(function (v) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function bindEvents() {
    $('#scenario-buttons').addEventListener('click', function (event) {
      const btn = event.target.closest('[data-scenario]');
      if (!btn) { return; }
      setScenario(btn.getAttribute('data-scenario'));
      trackPath('鼠标/触屏：点击场景按钮切换色板（' + btn.textContent.trim() + '）');
    });

    function handleHexLive(event) {
      const input = event.target.closest('[data-hex-input]');
      if (!input) { return; }
      const key = input.getAttribute('data-hex-input');
      const errorNode = document.getElementById('hex-error-' + key);
      if (!window.Contrast.isValidHex(input.value)) {
        errorNode.textContent = '非法十六进制颜色，需形如 #RRGGBB';
        input.classList.add('invalid');
        if (!input.dataset.invalidAnnounced) {
          announce('live-alert', '颜色 ' + input.value + ' 非法，提交时将还原上一个有效值');
          input.dataset.invalidAnnounced = '1';
        }
        return;
      }
      errorNode.textContent = '';
      input.classList.remove('invalid');
      delete input.dataset.invalidAnnounced;
    }

    function handleHexCommit(event) {
      const input = event.target.closest('[data-hex-input]');
      if (!input) { return; }
      const key = input.getAttribute('data-hex-input');
      const errorNode = document.getElementById('hex-error-' + key);
      if (!window.Contrast.isValidHex(input.value)) {
        announce('live-alert', '颜色 ' + input.value + ' 非法，已保留上一个有效值');
        input.value = state.colors[key];
        errorNode.textContent = '';
        input.classList.remove('invalid');
        delete input.dataset.invalidAnnounced;
        return;
      }
      const previous = state.colors[key];
      setColor(key, input.value);
      trackPath('键盘：在文本框输入十六进制色值更新 ' + key + '（' + previous + ' → ' + input.value + '）');
    }

    $('#swatch-controls').addEventListener('input', function (event) {
      if (event.target.closest('[data-hex-input]')) {
        handleHexLive(event);
      } else if (event.target.closest('[data-color-picker]')) {
        const picker = event.target.closest('[data-color-picker]');
        const key = picker.getAttribute('data-color-picker');
        setColor(key, picker.value);
        const text = document.querySelector('[data-hex-input="' + key + '"]');
        if (text) { text.value = state.colors[key]; }
        trackPath('鼠标/触屏：原生取色器调整 ' + key);
      }
    });

    $('#swatch-controls').addEventListener('change', function (event) {
      if (event.target.closest('[data-hex-input]')) {
        handleHexCommit(event);
      }
    });

    $('#swatch-controls').addEventListener('blur', function (event) {
      if (event.target.closest('[data-hex-input]')) {
        handleHexCommit(event);
      }
    }, true);

    $('#swatch-controls').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && event.target.closest('[data-hex-input]')) {
        handleHexCommit(event);
      }
    });

    $('#swatch-controls').addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') { return; }
      const input = event.target.closest('[data-hex-input]');
      if (!input) { return; }
      const key = input.getAttribute('data-hex-input');
      input.value = state.colors[key];
      document.getElementById('hex-error-' + key).textContent = '';
      input.classList.remove('invalid');
      delete input.dataset.invalidAnnounced;
      announce('live-status', '已按 Esc 还原为 ' + input.value);
      trackPath('键盘：Esc 取消非法颜色输入并还原有效值');
    });

    $('#btn-repair').addEventListener('click', repair);

    $('#btn-baseline').addEventListener('click', function () {
      state.baselineColors = window.Palettes.cloneColors(state.colors);
      persist();
      announce('live-alert', '当前色板已保存为对比基线，刷新后仍然保留');
      trackPath('基线：手动保存对比基线用于前后对比 PNG');
    });

    $('#btn-reset').addEventListener('click', function () {
      setScenario('default');
      trackPath('恢复：重置为默认色板');
    });

    $('#btn-export-css').addEventListener('click', function () {
      const snapshot = JSON.stringify(state.colors);
      window.ExportLib.exportCss(state.colors).then(function (record) {
        assertExportState(snapshot, record);
        renderExportRecords();
      });
    });

    $('#btn-export-png').addEventListener('click', function () {
      const snapshot = JSON.stringify(state.colors);
      window.ExportLib.exportPng(state.baselineColors, state.colors).then(function (record) {
        assertExportState(snapshot, record);
        renderExportRecords();
      });
    });

    $('#btn-export-summary').addEventListener('click', function () {
      window.ExportLib.exportSummary(state.lastTestResult, state.colors, verifiedPaths).then(function (record) {
        renderExportRecords();
        announce('live-status', '检查摘要已导出：' + record.filename);
      });
    });

    $('#btn-run-tests').addEventListener('click', runAndRenderTests);

    document.addEventListener('focusin', function (event) {
      if (event.target.id) {
        state.lastFocus = event.target.id;
        persist();
      }
    });
  }

  function assertExportState(snapshot, record) {
    if (JSON.stringify(state.colors) !== snapshot) {
      announce('live-alert', '错误：导出过程改动了当前色板');
      throw new Error('导出破坏了导出前状态');
    }
    announce('live-status', '已导出 ' + record.filename + '，当前色板与选择保持不变');
    trackPath('导出：生成并持久化 ' + record.filename + '（导出前状态未变）');
  }

  function runAndRenderTests() {
    return window.Tests.runTests(window.App).then(function (result) {
      state.lastTestResult = result;
      persist();
      renderTestStats(result);
      renderExportRecords();
      announce('live-alert', '测试完成：成功率 ' + result.successRate + '%，失败 ' + result.failed + ' 项');
      return result;
    });
  }

  function restoreFocus() {
    if (!state.lastFocus) { return; }
    const node = document.getElementById(state.lastFocus);
    if (node && typeof node.focus === 'function') {
      node.focus({ preventScroll: false });
    }
  }

  function init() {
    renderAll();
    bindEvents();
    renderExportRecords();
    renderTestStats(state.lastTestResult);
    restoreFocus();
    announce('live-status', '已从本地存储恢复场景与色板：' +
      window.Palettes.SCENARIOS[state.scenario].name);
    window.App.runTests = runAndRenderTests;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
