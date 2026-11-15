import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIGS, logicalBenchmark, structuralDigest } from "../src/benchmark.js";
import { createInitialProject } from "../src/model.js";

const root = new URL("../", import.meta.url).pathname;
const artifacts = join(root, "artifacts");
await mkdir(artifacts, { recursive: true });

const project = createInitialProject();
const report = logicalBenchmark(project);
const output = {
  schema: "framelab.static-benchmark.v1",
  generatedAt: new Date().toISOString(),
  note: "确定性预检：验证三配置计划、绘制数量和结构摘要；实时帧时由浏览器验证写入 benchmark-report.json。",
  structuralDigest: structuralDigest(project),
  actions: report.actions,
  parity: report.parity,
  passRate: report.passRate,
  configurations: report.results.map((result) => ({
    id: result.id,
    label: result.label,
    detail: result.detail,
    options: CONFIGS.find((config) => config.id === result.id).options,
    drawnObjects: result.drawnObjects,
    totalObjects: result.totalObjects,
    culledObjects: result.culledObjects,
    cacheHitRate: Number(result.cacheHitRate.toFixed(4)),
    digest: result.digest,
  })),
};

await writeFile(join(artifacts, "benchmark-static.json"), JSON.stringify(output, null, 2));
const lines = [
  "# FrameLab 三配置预检",
  "",
  `- 结构摘要：${output.structuralDigest}`,
  `- 固定动作：${output.actions} 帧 × 3 配置`,
  `- 结论：${output.parity ? "画面结构一致" : "摘要不一致"}（${(output.passRate * 100).toFixed(0)}%）`,
  "",
  "| 配置 | 实现路径 | 绘制对象 | 裁剪 | 缓存命中率 | 结构摘要 |",
  "| --- | --- | --- | --- | --- | --- |",
  ...output.configurations.map(
    (config) =>
      `| ${config.label} | ${config.detail} | ${config.drawnObjects}/${config.totalObjects} | ${config.culledObjects} | ${(config.cacheHitRate * 100).toFixed(1)}% | ${config.digest} |`,
  ),
];
await writeFile(join(artifacts, "benchmark-static.md"), lines.join("\n"));
console.log(JSON.stringify({ parity: output.parity, configurations: output.configurations.length, report: "artifacts/benchmark-static.md" }));
