/* 导出能力：CSS 变量、前后对比 PNG、无障碍检查摘要；全部同时写入 IndexedDB。 */
(function () {
  'use strict';

  function timestamp() {
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function buildCss(colors, results) {
    const lines = [
      '/* 界面配色 CSS 变量 · 由配色对比度检查器导出 */',
      '/* 导出时间: ' + new Date().toISOString() + ' */',
      ':root {'
    ];
    window.Palettes.KEYS.forEach(function (key) {
      lines.push('  --color-' + key.id.replace(/[A-Z]/g, function (m) {
        return '-' + m.toLowerCase();
      }) + ': ' + colors[key.id] + ';');
    });
    lines.push('}');
    lines.push('');
    lines.push('/* 对比度检查结果 */');
    results.forEach(function (r) {
      lines.push('/* ' + r.label + ': ' + window.Contrast.formatRatio(r.ratio) +
        ' (要求 >= ' + r.min + ':1) ' + (r.pass ? '达标' : '不达标') + ' */');
    });
    return lines.join('\n');
  }

  function buildSummary(testResult, results, verifiedPaths) {
    const lines = [];
    lines.push('无障碍检查摘要');
    lines.push('生成时间: ' + new Date().toLocaleString('zh-CN'));
    lines.push('');
    lines.push('一、对比度检查结果（WCAG 2.1）');
    results.forEach(function (r) {
      lines.push('- ' + r.label + '：实测 ' + window.Contrast.formatRatio(r.ratio) +
        '，要求 >= ' + r.min + ':1，' + (r.pass ? '达标' : '不达标'));
    });
    lines.push('');
    lines.push('二、已验证的操作路径');
    verifiedPaths.forEach(function (item, index) {
      lines.push((index + 1) + '. ' + item);
    });
    lines.push('');
    if (testResult) {
      lines.push('三、内置测试统计');
      lines.push('- 总数: ' + testResult.total + '，通过: ' + testResult.passed +
        '，失败: ' + testResult.failed);
      lines.push('- 成功率: ' + testResult.successRate + '%');
      testResult.cases.forEach(function (c) {
        lines.push('  [' + c.status + '] ' + c.id + ' ' + c.name + (c.detail ? ' — ' + c.detail : ''));
      });
      lines.push('');
    }
    lines.push('四、失败恢复说明');
    lines.push('- 非法十六进制颜色：输入框拒绝提交并显示错误，Esc 还原上一个有效值。');
    lines.push('- 不达标色板：使用“一键修复”迭代调整前景色，直到所有检查项达标。');
    lines.push('- 刷新或重新载入：当前色板、场景、基线、焦点位置与导出记录均从本地存储恢复。');
    return lines.join('\n');
  }

  function recordExport(kind, filename, mime, content, meta) {
    const id = kind + '-' + timestamp() + '-' + Math.random().toString(36).slice(2, 8);
    const record = {
      id: id,
      kind: kind,
      filename: filename,
      mime: mime,
      content: content,
      meta: meta || {},
      createdAt: Date.now()
    };
    return window.StoreLayer.addExport(record).then(function () { return record; });
  }

  function exportCss(colors) {
    const results = window.Palettes.evaluate(colors);
    const text = buildCss(colors, results);
    const filename = 'palette-variables-' + timestamp() + '.css';
    const blob = new Blob([text], { type: 'text/css;charset=utf-8' });
    return recordExport('css', filename, 'text/css', text, {
      failing: results.filter(function (r) { return !r.pass; }).length
    }).then(function (record) {
      downloadBlob(blob, filename);
      return record;
    });
  }

  function exportPng(beforeColors, afterColors) {
    const dataUrl = window.CanvasView.renderComparison(beforeColors, afterColors);
    const filename = 'palette-before-after-' + timestamp() + '.png';
    return recordExport('png', filename, 'image/png', dataUrl, {
      beforePass: window.Palettes.evaluate(beforeColors).filter(function (r) { return r.pass; }).length,
      afterPass: window.Palettes.evaluate(afterColors).filter(function (r) { return r.pass; }).length
    }).then(function (record) {
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return record;
    });
  }

  function exportSummary(testResult, colors, verifiedPaths) {
    const results = window.Palettes.evaluate(colors);
    const text = buildSummary(testResult, results, verifiedPaths || []);
    const filename = 'accessibility-summary-' + timestamp() + '.txt';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    return recordExport('summary', filename, 'text/plain', text, {
      total: testResult ? testResult.total : 0
    }).then(function (record) {
      downloadBlob(blob, filename);
      return record;
    });
  }

  window.ExportLib = {
    buildCss: buildCss,
    buildSummary: buildSummary,
    exportCss: exportCss,
    exportPng: exportPng,
    exportSummary: exportSummary,
    timestamp: timestamp
  };
})();
