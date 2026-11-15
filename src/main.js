/* 页面主逻辑:状态机 + 指标面板 + 日志 + 恢复建议 */
(function () {
  'use strict';

  const canvas = document.getElementById('stage');
  const metricsEl = document.getElementById('metrics');
  const errorsEl = document.getElementById('errors');
  const logEl = document.getElementById('log');
  const recoveryEl = document.getElementById('recovery');
  const progressFill = document.getElementById('progressFill');
  const btnCancel = document.getElementById('btnCancel');
  const modeSelect = document.getElementById('mode');

  // currentProject 只在导入成功时原子替换;取消/失败不留半成品
  let currentProject = null;
  let activeImporter = null;

  function fmtBytes(n) {
    if (n == null) return '不可用';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs < 1024) return sign + abs + ' B';
    if (abs < 1024 * 1024) return sign + (abs / 1024).toFixed(1) + ' KB';
    return sign + (abs / 1024 / 1024).toFixed(2) + ' MB';
  }

  function setMetrics(map) {
    metricsEl.innerHTML = '';
    for (const [k, v] of Object.entries(map)) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      metricsEl.append(dt, dd);
    }
  }

  function showStats(stats, project) {
    setMetrics({
      '当前模式': stats.mode === 'tolerant' ? '容错模式' : '严格模式',
      '耗时': stats.elapsedMs.toFixed(1) + ' ms',
      '输入大小': fmtBytes(stats.inputBytes),
      '解析切片数': String(stats.slices),
      '对象数量': project ? String(project.keyframes.length)
        : String(stats.acceptedKeyframes || 0),
      'SHA-256': project ? project.hash : '(未提交)',
      '吞吐': (stats.keyframesPerSec || 0) + ' 帧/秒',
      '字段错误数': String(stats.errorCount || 0),
      '堆内存增量': fmtBytes(stats.memoryDeltaBytes)
    });
  }

  function appendLog(entry) {
    const div = document.createElement('div');
    div.className = entry.level;
    div.textContent = '[' + entry.t.slice(11, 23) + '] ' + entry.message;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function showErrors(errors) {
    errorsEl.innerHTML = '';
    const max = 200;
    errors.slice(0, max).forEach((e) => {
      const li = document.createElement('li');
      li.textContent = e.path + (e.field ? ' · 字段 ' + e.field : '') +
        ' · ' + e.message;
      errorsEl.appendChild(li);
    });
    if (errors.length > max) {
      const li = document.createElement('li');
      li.textContent = '… 其余 ' + (errors.length - max) + ' 条从略';
      errorsEl.appendChild(li);
    }
  }

  function showRecovery(text) {
    recoveryEl.style.display = text ? 'block' : 'none';
    recoveryEl.textContent = text ? '恢复建议: ' + text : '';
  }

  function refreshCanvas(message) {
    if (currentProject) CanvasView.renderEditor(canvas, currentProject);
    else CanvasView.renderIdle(canvas, message);
  }

  async function runImport(text, label) {
    if (activeImporter) return;
    const mode = modeSelect.value;
    const importer = new ProjectImport.ProjectImporter({
      mode,
      onProgress: (info) => {
        progressFill.style.width = Math.round(info.progress * 100) + '%';
        CanvasView.renderProgress(canvas, info);
      },
      onLog: appendLog
    });
    activeImporter = importer;
    btnCancel.disabled = false;
    errorsEl.innerHTML = '';
    showRecovery('');
    appendLog({ t: new Date().toISOString(), level: 'info',
      message: '开始导入: ' + label });
    try {
      const { project, stats, errors } = await importer.import(text);
      currentProject = project; // 原子提交
      showStats(stats, project);
      showErrors(errors);
      CanvasView.renderEditor(canvas, project);
      if (errors.length > 0) {
        showRecovery('容错模式已跳过 ' + errors.length +
          ' 个字段错误;请修复源文件后用严格模式复核,或重新导出干净工程。');
      }
    } catch (err) {
      const stats = err.stats || { mode, elapsedMs: 0 };
      showStats(stats, null);
      if (err.name === 'CancelledError') {
        refreshCanvas('导入已取消,已回滚到之前的状态');
        showRecovery('导入被取消,未产生任何部分数据;可重新发起导入。');
      } else {
        refreshCanvas('导入失败,已保留之前的工程');
        showErrors(err.errors || []);
        if ((err.errors || []).length > 0) {
          showRecovery('发现 ' + err.errors.length +
            ' 个字段错误;可切换到容错模式跳过损坏条目,或修复源文件后重试。');
        } else {
          showRecovery('输入不是合法 JSON(可能被截断或含非法字符);' +
            '请检查文件完整性后重试。');
        }
      }
    } finally {
      activeImporter = null;
      btnCancel.disabled = true;
      progressFill.style.width = '0';
    }
  }

  document.getElementById('btnNormal').addEventListener('click', () => {
    runImport(Scenarios.normalScenario(50000), '正常场景(5万帧)');
  });
  document.getElementById('btnBoundary').addEventListener('click', () => {
    runImport(Scenarios.boundaryScenario().extreme, '边界场景(极值/Unicode)');
  });
  document.getElementById('btnCorrupted').addEventListener('click', () => {
    runImport(Scenarios.corruptedScenario().fieldErrors,
      '损坏场景(字段错误)');
  });
  document.getElementById('fileInput').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => runImport(String(reader.result), file.name);
    reader.onerror = () => appendLog({ t: new Date().toISOString(),
      level: 'error', message: '文件读取失败: ' + file.name });
    reader.readAsText(file);
    ev.target.value = '';
  });
  btnCancel.addEventListener('click', () => {
    if (activeImporter) activeImporter.cancel();
  });

  CanvasView.renderIdle(canvas, '尚未加载工程');
  setMetrics({ '当前模式': '严格模式', '状态': '空闲' });
})();
