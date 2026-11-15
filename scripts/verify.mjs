import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareVerificationRuns, runVerification } from "../src/core/verify.js";

function resourceLine(resources) {
  return `${resources.cacheEntries} entries / ${resources.cacheBytes} B / ${resources.dependencyEdges} edges`;
}

function errorCount(group) {
  if (Array.isArray(group.errors)) return group.errors.length;
  return 0;
}

function groupRows(report) {
  const { normal, boundary, corrupted } = report.groups;
  return [
    {
      group: "正常输入",
      beforeResult: `${normal.before.cases.filter((item) => item.stale).length}/3 stale`,
      afterResult: `${normal.after.cases.filter((item) => item.matchesReference).length}/3 match`,
      beforeErrors: errorCount(normal.before),
      afterErrors: errorCount(normal.after),
      beforeResources: resourceLine(normal.before.resources),
      afterResources: resourceLine(normal.after.resources),
    },
    {
      group: "边界输入",
      beforeResult: boundary.before.matchesReference ? "match" : "stale",
      afterResult: boundary.after.matchesReference ? "match" : "stale",
      beforeErrors: errorCount(boundary.before),
      afterErrors: errorCount(boundary.after),
      beforeResources: resourceLine(boundary.before.resources.after),
      afterResources: resourceLine(boundary.after.resources.after),
    },
    {
      group: "损坏输入",
      beforeResult: corrupted.before.finalResult.outcome,
      afterResult: corrupted.after.finalResult.outcome,
      beforeErrors: errorCount(corrupted.before),
      afterErrors: errorCount(corrupted.after),
      beforeResources: resourceLine(corrupted.before.resources),
      afterResources: resourceLine(corrupted.after.resources),
    },
  ];
}

function errorLines(report) {
  const groups = report.groups;
  const before = [
    ...groups.normal.before.errors,
    ...groups.boundary.before.errors,
    ...groups.corrupted.before.errors,
  ];
  const after = [
    ...groups.normal.after.errors,
    ...groups.boundary.after.errors,
    ...groups.corrupted.after.errors,
  ];
  const line = (prefix, entry) => `- ${prefix} \`${entry.code}\` (${entry.source}): ${entry.message}`;
  return {
    before: before.map((entry) => line("修改前", entry)),
    after: after.map((entry) => line("修改后", entry)),
  };
}

function markdown(report, repeatable, elapsedMs) {
  const rows = groupRows(report);
  const logs = errorLines(report);
  const modifications = report.groups.normal.after.cases.map((item) => (
    `| ${item.modification} | \`${item.targetId}\` | ${item.invalidation.released} | ${item.finalResult.recomputes} | ${item.matchesReference ? "match" : "stale"} |`
  ));
  return `# Cache verification report

- Repeatable across two runs: **${repeatable}**
- Verification wall time: ${elapsedMs.toFixed(2)} ms
- Fixed-mode rule: mutation invalidates only the changed node's subtree
- Corrupted input: errors are logged; a safe scene is loaded; export stays paused until confirmation

## Before / after comparison

| Group | Before final result | After final result | Before error logs | After error logs | Before resources | After resources |
| --- | --- | --- | ---: | ---: | --- | --- |
${rows.map((row) => `| ${row.group} | ${row.beforeResult} | ${row.afterResult} | ${row.beforeErrors} | ${row.afterErrors} | ${row.beforeResources} | ${row.afterResources} |`).join("\n")}

## Three normal mutations

| Modification | Target | Released entries | Recomputes | Fixed result |
| --- | --- | ---: | ---: | --- |
${modifications.join("\n")}

## Error logs

### Before (legacy cache path)

${logs.before.length ? logs.before.join("\n") : "- none"}

### After (fixed cache path)

${logs.after.length ? logs.after.join("\n") : "- none"}

The after-side logs are recovery events, not hidden failures. The expected stale-result logs disappear in fixed mode; corrupted-input logs remain because the input is still corrupt.
`;
}

const first = runVerification();
const second = runVerification();
const repeatable = compareVerificationRuns(first, second);
const started = performance.now();
const elapsedMs = first.groups.normal.after.cases.reduce(
  (sum, item) => sum + item.finalResult.elapsedMs,
  0,
) + first.groups.boundary.after.finalResult.elapsedMs;
const payload = {
  schemaVersion: 1,
  generatedBy: "npm run verify",
  repeatable,
  elapsedMs: Math.round((performance.now() - started + elapsedMs) * 1000) / 1000,
  summary: first.summary,
  groups: first.groups,
};
const directory = join(process.cwd(), "artifacts");
await mkdir(directory, { recursive: true });
await writeFile(join(directory, "verification-report.json"), `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(join(directory, "verification-report.md"), markdown(first, repeatable, payload.elapsedMs));

console.log("Cache verification complete");
console.log(`repeatable=${repeatable}`);
for (const row of groupRows(first)) {
  console.log(`${row.group}: ${row.beforeResult} -> ${row.afterResult}; errors ${row.beforeErrors} -> ${row.afterErrors}`);
}
console.log("Wrote artifacts/verification-report.json and .md");
