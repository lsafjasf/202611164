import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';
import { runE2E } from './e2e/e2e.test.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = resolve(root, 'reports');
const screenshotDir = resolve(reportDir, 'screenshots');
mkdirSync(screenshotDir, { recursive: true });

const { server, url } = await startServer(root);
try {
  const summary = await runE2E(url, screenshotDir, reportDir);
  const groups = ['default', 'boundary', 'error'];
  for (const group of groups) {
    const items = summary.results.filter((result) => result.group === group);
    const passed = items.filter((result) => result.ok).length;
    console.log(`\n[${group}] ${passed}/${items.length} 通过（成功率 ${((passed / items.length) * 100).toFixed(1)}%）`);
    for (const result of items) {
      console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name} (${result.durationMs}ms)`);
      if (!result.ok) console.log(`        失败原因: ${result.error.split('\n')[0]}`);
    }
  }
  console.log(`\n合计: ${summary.passed}/${summary.total} 通过，成功率 ${summary.rate}`);

  const unitPath = resolve(reportDir, 'unit-report.json');
  let unit = null;
  try {
    unit = JSON.parse(readFileSync(unitPath, 'utf8'));
  } catch {
    console.log('提示: 未找到 unit-report.json，请先运行 npm run test:unit');
  }
  const aggregate = {
    generatedAt: new Date().toISOString(),
    unit: unit ? { total: unit.total, passed: unit.passed, failed: unit.failed, rate: unit.rate } : null,
    e2e: { total: summary.total, passed: summary.passed, failed: summary.failed, rate: summary.rate },
  };
  const all = [aggregate.unit, aggregate.e2e].filter(Boolean);
  aggregate.overall = {
    total: all.reduce((sum, item) => sum + item.total, 0),
    passed: all.reduce((sum, item) => sum + item.passed, 0),
    failed: all.reduce((sum, item) => sum + item.failed, 0),
  };
  aggregate.overall.rate =
    `${((aggregate.overall.passed / aggregate.overall.total) * 100).toFixed(1)}%`;
  writeFileSync(resolve(reportDir, 'summary.json'), `${JSON.stringify(aggregate, null, 2)}\n`);
  console.log(`总体: ${aggregate.overall.passed}/${aggregate.overall.total} 通过，成功率 ${aggregate.overall.rate}`);
  process.exit(summary.failed === 0 ? 0 : 1);
} finally {
  await new Promise((closeResolve) => server.close(closeResolve));
}
