/*
 * 修改前(基线) vs 修改后(分块导入器)对比测试。
 * 覆盖正常 / 边界 / 损坏三组场景,记录:
 *   最终结果(对象数量、哈希)、异常日志、资源计数(堆内存、耗时)。
 * 损坏场景运行两次以验证失败可重复。
 * 输出: artifacts/compare-report.md + artifacts/compare-logs.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ProjectImporter } = require('../src/importer.js');
const { baselineImport } = require('../src/baseline.js');
const Scenarios = require('../src/scenarios.js');

function mem() {
  return process.memoryUsage().heapUsed;
}

async function runBaseline(text) {
  const t0 = Date.now();
  const m0 = mem();
  try {
    const r = await baselineImport(text);
    return {
      ok: true,
      count: r.project.keyframes.length,
      hash: r.project.hash,
      elapsedMs: Date.now() - t0,
      memDelta: mem() - m0,
      errorLogs: r.logs.filter((l) => l.level === 'error').length,
      logs: r.logs,
      errors: []
    };
  } catch (err) {
    return {
      ok: false,
      message: err.message,
      elapsedMs: Date.now() - t0,
      memDelta: mem() - m0,
      errorLogs: (err.logs || []).filter((l) => l.level === 'error').length,
      logs: err.logs || [],
      errors: []
    };
  }
}

async function runChunked(text, mode) {
  const logs = [];
  const importer = new ProjectImporter({
    mode,
    onLog: (e) => logs.push(e)
  });
  const t0 = Date.now();
  const m0 = mem();
  try {
    const r = await importer.import(text);
    return {
      ok: true,
      count: r.project.keyframes.length,
      hash: r.project.hash,
      elapsedMs: Date.now() - t0,
      memDelta: mem() - m0,
      slices: r.stats.slices,
      errorLogs: logs.filter((l) => l.level === 'error').length,
      logs,
      errors: r.errors
    };
  } catch (err) {
    return {
      ok: false,
      message: err.message,
      elapsedMs: Date.now() - t0,
      memDelta: mem() - m0,
      slices: err.stats ? err.stats.slices : 0,
      errorLogs: logs.filter((l) => l.level === 'error').length,
      logs,
      errors: err.errors || []
    };
  }
}

function fmtMB(n) {
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

async function main() {
  const cases = [
    { name: '正常场景(5万帧)', text: Scenarios.normalScenario(50000),
      expectOk: true },
    { name: '边界场景-空工程', text: Scenarios.boundaryScenario().empty,
      expectOk: true },
    { name: '边界场景-单帧', text: Scenarios.boundaryScenario().single,
      expectOk: true },
    { name: '边界场景-极值与Unicode',
      text: Scenarios.boundaryScenario().extreme, expectOk: true },
    { name: '损坏场景-字段错误(严格)', expectOk: false,
      text: Scenarios.corruptedScenario().fieldErrors, mode: 'strict' },
    { name: '损坏场景-字段错误(容错恢复)', expectOk: true,
      text: Scenarios.corruptedScenario().fieldErrors, mode: 'tolerant' },
    { name: '损坏场景-截断', expectOk: false,
      text: Scenarios.corruptedScenario().truncated },
    { name: '损坏场景-语法破坏', expectOk: false,
      text: Scenarios.corruptedScenario().syntaxBroken }
  ];

  const report = [];
  const allLogs = {};
  let pass = 0;
  let fail = 0;

  for (const c of cases) {
    const before = await runBaseline(c.text);
    const after = await runChunked(c.text, c.mode || 'strict');
    // 可重复性:失败场景再跑一次,结果必须一致
    let reproducible = 'n/a';
    if (!c.expectOk) {
      const again = await runChunked(c.text, c.mode || 'strict');
      reproducible = (again.ok === after.ok &&
        again.message === after.message &&
        again.errors.length === after.errors.length) ? '是' : '否';
    }
    // 一致性:双方都成功时,对象数量与哈希必须一致
    let consistent = 'n/a';
    if (before.ok && after.ok) {
      consistent = (before.count === after.count &&
        before.hash === after.hash) ? '一致' : '不一致!';
    }
    const expectMet = after.ok === c.expectOk;
    if (expectMet && consistent !== '不一致!' && reproducible !== '否') pass++;
    else fail++;

    report.push({
      case: c.name,
      expectOk: c.expectOk,
      before: {
        ok: before.ok, count: before.count, hash: before.hash,
        message: before.message, elapsedMs: before.elapsedMs,
        memDelta: before.memDelta, errorLogs: before.errorLogs
      },
      after: {
        ok: after.ok, count: after.count, hash: after.hash,
        message: after.message, elapsedMs: after.elapsedMs,
        memDelta: after.memDelta, slices: after.slices,
        errorLogs: after.errorLogs, fieldErrors: after.errors.length
      },
      consistent,
      reproducible
    });
    allLogs[c.name] = {
      before: before.logs,
      after: after.logs,
      fieldErrors: after.errors.slice(0, 50)
    };
  }

  const lines = [];
  lines.push('# 导入器修改前/后对比报告');
  lines.push('');
  lines.push('生成时间: ' + new Date().toISOString());
  lines.push('');
  lines.push('| 场景 | 期望 | 修改前结果 | 修改后结果 | 数量/哈希 | 可重复 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of report) {
    const b = r.before.ok
      ? '成功 ' + r.before.count + ' 帧'
      : '失败: ' + (r.before.message || '').slice(0, 40);
    const a = r.after.ok
      ? '成功 ' + r.after.count + ' 帧'
      : '失败: ' + (r.after.message || '').slice(0, 40);
    lines.push('| ' + r.case + ' | ' + (r.expectOk ? '成功' : '失败') +
      ' | ' + b + ' | ' + a + ' | ' + r.consistent +
      ' | ' + r.reproducible + ' |');
  }
  lines.push('');
  lines.push('## 资源计数(堆内存增量 / 耗时 / 错误日志条数)');
  lines.push('');
  lines.push('| 场景 | 前:内存 | 前:耗时 | 前:错误日志 | 后:内存 | 后:耗时 | 后:切片 | 后:错误日志 | 后:字段错误 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of report) {
    lines.push('| ' + r.case +
      ' | ' + fmtMB(r.before.memDelta) +
      ' | ' + r.before.elapsedMs + 'ms' +
      ' | ' + r.before.errorLogs +
      ' | ' + fmtMB(r.after.memDelta) +
      ' | ' + r.after.elapsedMs + 'ms' +
      ' | ' + (r.after.slices || 0) +
      ' | ' + r.after.errorLogs +
      ' | ' + r.after.fieldErrors + ' |');
  }
  lines.push('');
  lines.push('## 哈希对照(成功场景)');
  lines.push('');
  for (const r of report) {
    if (r.before.ok && r.after.ok) {
      lines.push('- ' + r.case + ': `' + r.after.hash + '` (' +
        r.after.count + ' 帧,前后' + r.consistent + ')');
    }
  }
  lines.push('');
  lines.push('总计: ' + pass + ' 通过, ' + fail + ' 失败。');

  const outDir = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'compare-report.md'),
    lines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'compare-logs.json'),
    JSON.stringify({ report, logs: allLogs }, null, 2), 'utf8');
  console.log(lines.join('\n'));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('对比测试自身失败:', err);
  process.exit(2);
});
