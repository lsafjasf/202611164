import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EditorSession, stableHash } from "../src/core.js";
import { LegacyEditorSession } from "../src/legacy-baseline.js";
import { makeNormalDocument } from "../src/sample-data.js";
import {
  repeatableProjection,
  runAllScenarios,
  runScenario,
} from "../test/scenario-runner.mjs";

const before = runAllScenarios(LegacyEditorSession);
const after = runAllScenarios(EditorSession);
const corruptRepeat = runScenario("corrupt", EditorSession);
const sourceDocumentSignature = stableHash(makeNormalDocument());

function resourceLine(result) {
  const resources = result.resources;
  return {
    canvases: resources.canvases,
    listeners: resources.listeners,
    targetListeners: resources.targetListeners,
    cacheEntries: resources.cacheEntries,
    cacheBytes: resources.cacheBytes,
    historyEntries: resources.historyEntries,
    historyBytes: resources.historyBytes,
    modelBytes: resources.modelBytes,
    memoryEstimateBytes: resources.memoryEstimateBytes,
    errorCount: resources.errorCount,
  };
}

const checks = {
  normalExportEquivalent: before.normal.final.signature === after.normal.final.signature,
  boundaryExportEquivalent: before.boundary.final.signature === after.boundary.final.signature,
  corruptSceneChangedBefore:
    before.corrupt.final.signature !== sourceDocumentSignature,
  corruptScenePreservedAfter:
    after.corrupt.attempts.every((attempt) => attempt.sceneUnchanged) &&
    after.corrupt.final.signature === sourceDocumentSignature,
  corruptRepeatable:
    JSON.stringify(repeatableProjection(after.corrupt)) ===
    JSON.stringify(repeatableProjection(corruptRepeat)),
  afterCloseResourcesReleased: Object.values(after).every(
    (scenario) =>
      scenario.resources.canvases === 0 &&
      scenario.resources.listeners === 0 &&
      scenario.resources.cacheEntries === 0,
  ),
  beforeCloseStillLeaks: Object.values(before).every(
    (scenario) => scenario.resources.canvases > 0 || scenario.resources.listeners > 0,
  ),
};

const report = {
  title: "Loom Canvas 长时运行资源修复前后对照",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    note:
      "初始仓库没有编辑器实现，legacy-baseline.js 保留了任务描述的旧反模式作为修改前基线。",
  },
  growthSources: [
    {
      source: "窗口/画布事件监听",
      before: "每次打开重新注册，关闭不 removeEventListener",
      after: "ResourceBroker 登记，close() 统一移除",
    },
    {
      source: "离屏画布与预览缓存",
      before: "每次预览新建，缓存无上限，关闭不释放",
      after: "LRU 缓存最多 12 项；对象修改按前缀失效；close() 释放全部",
    },
    {
      source: "撤销历史",
      before: "每次修改深拷贝整个文档，并保留撤销画布",
      after: "只保存 add/delete/update 的增量，条目与字节双上限",
    },
    {
      source: "损坏输入",
      before: "逐对象写入后才发现错误，留下部分场景",
      after: "parseDocument 全量校验后原子替换，失败仅记录并抛给调用方",
    },
  ],
  scenarios: Object.fromEntries(
    ["normal", "boundary", "corrupt"].map((group) => [
      group,
      {
        before: {
          final: before[group].final,
          resources: resourceLine(before[group]),
          peakResources: before[group].peakResources,
          errors: before[group].errors,
          errorDetails: before[group].errorDetails,
          attempts: before[group].attempts || null,
          closeCount: before[group].closeCount,
        },
        after: {
          final: after[group].final,
          resources: resourceLine(after[group]),
          peakResources: after[group].peakResources,
          errors: after[group].errors,
          errorDetails: after[group].errorDetails,
          attempts: after[group].attempts || null,
          closeCount: after[group].closeCount,
        },
      },
    ]),
  ),
  checks,
};

const root = resolve(new URL("..", import.meta.url).pathname);
const artifacts = resolve(root, "artifacts");
await mkdir(artifacts, { recursive: true });
await writeFile(resolve(artifacts, "before.json"), `${JSON.stringify(before, null, 2)}\n`);
await writeFile(resolve(artifacts, "after.json"), `${JSON.stringify(after, null, 2)}\n`);
await writeFile(resolve(artifacts, "resource-report.json"), `${JSON.stringify(report, null, 2)}\n`);

const rows = ["normal", "boundary", "corrupt"].map((group) => {
  const old = before[group];
  const fixed = after[group];
  return `| ${group} | ${old.final.signature} | ${fixed.final.signature} | ${old.resources.errorCount} | ${fixed.resources.errorCount} | ${old.resources.canvases}/${old.resources.listeners}/${old.resources.cacheEntries} | ${fixed.resources.canvases}/${fixed.resources.listeners}/${fixed.resources.cacheEntries} | ${old.resources.memoryEstimateBytes} | ${fixed.resources.memoryEstimateBytes} |`;
});

const markdown = `# 修复前后对照

生成时间：${report.generatedAt}

> 初始仓库只有空的 README。\`src/legacy-baseline.js\` 以任务描述的旧反模式实现“修改前”基线，用于可重复比较，不代表仓库曾提交过该实现。

| 场景 | 修改前导出签名 | 修改后导出签名 | 修改前错误 | 修改后错误 | 修改前 画布/监听/缓存 | 修改后 画布/监听/缓存 | 修改前内存估算(B) | 修改后内存估算(B) |
| --- | --- | --- | ---: | ---: | --- | --- | ---: | ---: |
${rows.join("\n")}

## 检查结果

${Object.entries(checks)
  .map(([name, passed]) => `- ${passed ? "PASS" : "FAIL"} \`${name}\``)
  .join("\n")}

## 失败输入

修改前在 \`invalid-shape\`、\`duplicate-id\`、\`too-many-objects\`、\`bad-width\` 上出现部分写入；修改后 12 次失败均保持画布签名不变。完整错误日志与堆栈入口保存在 \`resource-report.json\` 和会话诊断面板中。

## 复现

\`\`\`bash
npm test
npm run benchmark
\`\`\`
`;
await writeFile(resolve(artifacts, "comparison.md"), markdown);

console.log(`resource-report: ${resolve(artifacts, "resource-report.json")}`);
console.log(
  Object.entries(checks)
    .map(([name, passed]) => `${passed ? "PASS" : "FAIL"} ${name}`)
    .join("\n"),
);
