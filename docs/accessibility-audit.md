# 无障碍检查摘要

生成时间随 `npm test` 重新验证；所有检查项由 `test/e2e/e2e.test.js` 自动化执行，
结果见 `reports/e2e-report.json`，失败时报告包含具体断言原因而非笼统提示。

## 已验证的操作路径

| 功能状态 | 鼠标路径 | 键盘路径 | 触屏路径 | 读屏/焦点表现 |
| --- | --- | --- | --- | --- |
| 选中图层 | 画布 `pointerdown` 命中图层 | 图层列表聚焦后 `↑/↓/←/→`、`Home/End`；画布聚焦后 `Tab/↑/↓` | 画布 `touchstart`（Pointer Events 统一） | 列表项 `role="option"` + `aria-selected`，焦点跟随选项（roving tabindex） |
| 修改图层参数 | 表单控件点击编辑 | Tab 进入输入框、键入后 `change` 提交 | 控件触控编辑 | 每个输入框带 `aria-label`，状态条 `aria-live="polite"` 播报变更 |
| 移动播放头 | 拖动 range 滑块 | 聚焦滑块后方向键微调 | 触控拖动滑块 | `aria-label="播放头时间（秒）"`，时间文本同步更新 |
| 插入关键帧 | 点击按钮 | 聚焦按钮后 `Enter` | 触控按钮 | 成功后 polite 状态条播报关键帧 id 与时间 |
| 导出工程 | 点击“导出 JSON” | 键盘聚焦后 `Enter` | 触控按钮 | 状态条播报导出结果与导出前快照保留情况 |
| 导入工程 | 文件选择器选 JSON | 键盘触发按钮+文件选择 | 触控按钮 | 见下方失败恢复 |
| 撤销/重做 | 工具栏按钮 | `Ctrl+Z` / `Ctrl+Y`（macOS 为 `⌘`） | 触控按钮 | 按钮带 `aria-keyshortcuts` |

## 语义与焦点

- 图层列表：`role="listbox"`，子项 `role="option"` 与 `aria-selected`；列表容器可聚焦。
- 画布：`role="img"` 且 `aria-label` 动态包含图层数、当前选中图层 id 与播放头时间。
- 状态区：`role="status"` + `aria-live="polite"` 用于普通操作反馈。
- 错误区：`role="alert"` + `aria-live="assertive"`，导入失败立即播报。
- 焦点样式：`:focus-visible` 提供 3px 蓝色轮廓，E2E 断言计算样式非 `none`。
- 所有按钮均含可见中文文本，无空标签控件。

## 失败恢复验证

1. 悬空素材引用（`dangling-reference`）：导入被阻止，alert 展示错误码、JSON 路径与中文原因，
   当前工程哈希保持不变，选择不被重置。
2. 非法图层类型/缓动（`illegal-type`）：结构化错误列出每个非法字段路径。
3. 重复对象 id（`duplicate-id`）：拒绝导入并指出冲突位置。
4. JSON 语法错误（`json-parse`）：返回结构化错误，工程不被替换。
5. 任一失败后再次导入合法工程：`lastImport.ok=true`，告警区隐藏，工程恢复为预期哈希。

## 刷新/重载保持

- 工程通过 `localStorage` 自动持久化（key: `editor-project-v1`），刷新后图层、关键帧、
  时间轴、素材参数、选中图层与播放头时间全部恢复，E2E 断言刷新前后 SHA-256 一致。
- 导出动作不修改工程（`preExportSnapshot` 保留导出前状态）；失败导入不会写入或清空持久化数据。
- 持久化数据损坏时回退到空白工程，不抛异常、不白屏。
