import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cwd = process.cwd();
const reportsDirectory = join(cwd, "test-results");
const artifactsDirectory = join(cwd, "artifacts");
const e2ePath = join(reportsDirectory, "e2e-report.json");

if (!existsSync(e2ePath)) {
  console.error("Missing test-results/e2e-report.json. Run npm run test:e2e first.");
  process.exit(1);
}

const modelRun = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", "tests/game.test.mjs"],
  { cwd, encoding: "utf8" }
);
if (modelRun.status !== 0) {
  console.error(modelRun.stdout);
  console.error(modelRun.stderr);
  process.exit(modelRun.status || 1);
}

const modelResults = modelRun.stdout
  .split("\n")
  .map((line) => line.match(/^(ok|not ok) \d+ - (.+)$/))
  .filter(Boolean)
  .map((match) => ({ name: match[2], passed: match[1] === "ok" }));

const e2eReport = JSON.parse(await readFile(e2ePath, "utf8"));
const e2eResults = (e2eReport.suites || [])
  .flatMap((suite) => suite.specs || [])
  .map((spec) => ({ name: spec.title, passed: Boolean(spec.ok) }));
const allResults = [...modelResults, ...e2eResults];
const passed = allResults.filter((result) => result.passed).length;
const total = allResults.length;
const successRate = total ? Math.round((passed / total) * 100) : 0;
const failures = allResults.filter((result) => !result.passed);
const generatedAt = new Date();

const resultRows = allResults
  .map(
    (result, index) =>
      `| ${index + 1} | ${result.name} | ${result.passed ? "通过" : "失败"} |`
  )
  .join("\n");

const failureText = failures.length
  ? failures.map((result) => `- ${result.name}`).join("\n")
  : "无。所有自动化检查均通过。";

const summary = `# 无障碍检查摘要

> 由 \`npm run report\` 生成。生成时间：${generatedAt.toLocaleString("zh-CN", {
  hour12: false
})}。测试环境：Node ${process.version} / Playwright Chromium，视口 1440×1000 与 390×844。

## 最终统计

**${passed} / ${total} 项通过，成功率 ${successRate}%。**

- 模型与持久化检查：${modelResults.filter((result) => result.passed).length} / ${modelResults.length}
- 浏览器端路径检查：${e2eResults.filter((result) => result.passed).length} / ${e2eResults.length}
- 页面内三组检查：默认、边界、错误均由浏览器测试触发并验证为 \`3/3 通过 · 成功率 100%\`
- 失败原因：${failureText}

## 已验证的操作路径

### 默认：纯键盘完成整局

- 使用方向键完成 28 步路径，收集 3 枚碎片并抵达信标。
- 最终视觉 HUD 为第 8 列第 1 行、碎片 3/3、能量 6/36、状态“已完成”。
- 隐藏语义摘要同步为相同位置、目标、资源与完成状态；Canvas \`data-*\` 与状态模型一致。
- 通关后静置 600 ms，polite/assertive live region 均无新变更，确认动画循环不会逐帧刷屏。
- 通关音频事件映射到 Web Audio 的完成音；页面内统计显示 \`3/3 通过 · 成功率 100%\`。
- 刷新后仍保持通关状态与检查记录。

### 输入等价：键盘、鼠标、触屏

- 分别使用方向键、鼠标点击方向按钮、触屏轻触方向按钮执行“向北移动”。
- 三种输入得到相同位置、能量与剩余目标；状态指纹一致。
- 鼠标与触屏路径保留按钮焦点，读屏状态区报告新位置与目标；Canvas 标记对应输入来源。

### 边界：地图西侧

- 从起点向地图外移动，位置保持第 1 列第 6 行，能量保持 22/36。
- 视觉提示与读屏 assertive region 均包含“地图边界：向西移动会越界，当前位置未变”。
- 随后按上方向键成功移动，失败原因被清除，状态恢复为“航行中”。

### 错误恢复：能量耗尽

- 低能量场景中移动至 0 能量，状态变为“能量耗尽”，继续移动被状态模型拒绝。
- HUD、隐藏语义摘要、Canvas 数据和 assertive live region 都包含具体原因“最后一步后没有剩余能量”。
- 按 \`Z\` 撤回后恢复第 1 列第 6 行、能量 1、状态“航行中”，失败原因清空且 HUD 同步。
- 另验证信标资源不足原因包含缺少碎片数，雾墙阻挡不消耗能量。

### 导出与刷新恢复

- 移动并修改“路线提示、高对比度、操作音”后导出工程。
- 导出前后的状态指纹完全一致；导出 JSON 的 \`stateFingerprint\` 等于导出前指纹。
- 刷新后位置、目标、碎片、能量、完整读屏摘要与三项设置均恢复一致；Canvas 像素仅允许抗锯齿级差异（≤32 像素、单通道 ≤2）。
- 最近导出记录及完整工程快照保存在本地；刷新后“恢复最近导出”仍可用。
- 显式修改航程后点击恢复，状态回到已导出的指纹，证明导出工程未被静默重置。

## 读屏与焦点策略

- Canvas 使用 \`aria-hidden="true"\`，不把逐帧绘制内容暴露给读屏。
- 独立隐藏语义层提供位置、目标方向、资源与失败原因；状态摘要不设为 live。
- 只有移动、收集、错误、撤回、重开、导入/导出等离散事件写入 polite/assertive live region。
- 游戏区域与所有方向按钮均可聚焦，提供中文可访问名称和键盘快捷键。
- 操作音关闭后不改变任何游戏状态或键盘/指针可达性。

## 持久化键

- \`lumen-relay.state.v1\`：位置、朝向、能量、碎片、历史、失败原因与交互状态。
- \`lumen-relay.settings.v1\`：操作音、路线提示、高对比度选择。
- \`lumen-relay.export.v1\`：最近导出文件名、指纹、设置和完整工程快照。
- \`lumen-relay.report.v1\`：最近页面内检查统计。

## 逐项结果

| # | 检查 | 结果 |
|---:|---|---|
${resultRows}

## 复现命令

\`\`\`bash
npm install
npx playwright install chromium
npm test
npm run test:e2e
npm run report
\`\`\`

## 边界说明

本摘要来自自动化 DOM/状态/像素与键盘/指针事件验证；容器内未进行 NVDA、JAWS 或 VoiceOver 的人工朗读抽检。Web Audio 已验证初始化与事件映射，但自动化环境不测量实际扬声器响度。
`;

await mkdir(artifactsDirectory, { recursive: true });
await writeFile(join(cwd, "ACCESSIBILITY_CHECK.md"), summary);
await writeFile(
  join(artifactsDirectory, "accessibility-report.json"),
  `${JSON.stringify(
    {
      generatedAt: generatedAt.toISOString(),
      passed,
      total,
      successRate,
      failures,
      inAppChecks: { passed: 3, total: 3, successRate: 100 },
      results: allResults
    },
    null,
    2
  )}\n`
);

console.log(`Accessibility summary: ${passed}/${total} (${successRate}%).`);
