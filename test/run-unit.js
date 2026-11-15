import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unitTests } from './unit/core.test.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function run() {
  const results = [];
  for (const test of unitTests) {
    const started = Date.now();
    try {
      await test.run();
      results.push({ ...test, ok: true, durationMs: Date.now() - started, error: null });
    } catch (error) {
      results.push({
        ...test,
        ok: false,
        durationMs: Date.now() - started,
        error: error && error.stack ? error.stack : String(error),
      });
    }
  }
  return results;
}

function printResults(results) {
  const groups = ['default', 'boundary', 'error'];
  for (const group of groups) {
    const groupResults = results.filter((result) => result.group === group);
    const passed = groupResults.filter((result) => result.ok).length;
    const rate = ((passed / groupResults.length) * 100).toFixed(1);
    console.log(`\n[${group}] ${passed}/${groupResults.length} 通过（成功率 ${rate}%）`);
    for (const result of groupResults) {
      console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name} (${result.durationMs}ms)`);
      if (!result.ok) console.log(`        失败原因: ${result.error.split('\n')[0]}`);
    }
  }
  const total = results.length;
  const passed = results.filter((result) => result.ok).length;
  const rate = `${((passed / total) * 100).toFixed(1)}%`;
  console.log(`\n合计: ${passed}/${total} 通过，成功率 ${rate}`);
  return { total, passed, failed: total - passed, rate };
}

run().then((results) => {
  const summary = printResults(results);
  const report = {
    suite: 'unit',
    generatedAt: new Date().toISOString(),
    ...summary,
    results: results.map(({ group, name, ok, durationMs, error }) => ({
      group, name, ok, durationMs, error,
    })),
  };
  mkdirSync(resolve(root, 'reports'), { recursive: true });
  writeFileSync(resolve(root, 'reports/unit-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.exit(summary.failed === 0 ? 0 : 1);
});
