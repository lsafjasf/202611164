# 跨设备画布修复报告

## 结论

当前实现已通过 16 项单元测试和 5 项浏览器场景测试。鼠标、触控板与触屏均可在同一画布工作：触屏单指平移、双指居中缩放、长按命中选择，触摸和捏合期间没有新增笔画；画布滚轮不会带动页面，画布外滚轮仍可正常滚动；旋转后使用实时边界重新换算指针坐标，点击命中保持准确。

仓库初始提交只有一份占位 README，没有可运行的旧 UI 或手势代码。因此“修改前”使用 `tests/fixtures/legacy-canvas.html` 作为受控旧版夹具，仅复现同类常见缺陷，用于同输入、同设备、同脚本的前后对照；它不是对历史提交代码的冒充。正式应用不引用该夹具。

## 正常输入

| 项目 | 修改前（旧版夹具） | 修改后（正式应用） |
|---|---|---|
| 单指平移 | 视图不变，`{x:0,y:0,scale:1}` | `panEvents=1`，视图随手指移动 |
| 双指缩放 | 无缩放 | `zoomEvents=1`，缩放增大，图形数不变 |
| 长按选择 | 无长按状态机 | `selected=seed-orbit`，`longPressEvents=1` |
| 触摸误绘 | 单指和双指各新增 1 个笔画，最终 4 个图形 | `drawEvents=0`，始终为 2 个图形 |
| 页面滚动隔离 | 画布内滚轮使页面滚动 `300px` | 画布内滚动 `0px`，画布外仍可滚动 |

桌面正常场景还验证了鼠标绘制 1 个笔画、触控板平移与 Ctrl 缩放不新增图形、准星可见、JSON/PNG 导出。最终为 3 个图形、25 个点、12 个监听器；最近渲染 `0.2ms`、平均 `0.41ms`、P95 `2.7ms`；异常 0 条。JSON 导出含 3 个图形，PNG 为 `1780×948`，不含诊断叠层。

证据：`before/before-normal-touch.json`、`runs/after-normal-desktop.json`、`runs/after-normal-touch.json`、`exports/after-normal.json`、`exports/after-normal.png`。

## 边界输入

| 项目 | 修改前（旧版夹具） | 修改后（正式应用） |
|---|---|---|
| 缩放边界 | 无缩放状态机 | 30 次放大与 40 次缩小均被夹取到 `400%` / `25%` |
| 旋转后点击 | Canvas 位图被拉伸，视觉目标点击后 `selected=null` | 移动端横竖屏切换后 `selected=seed-orbit` |
| 旋转资源 | 3 图形 / 14 点 / 4 监听器；位图 `789,264B` | 桌面 3 图形 / 15 点 / 12 监听器；位图 `1,364,176B` |
| 异常 | 0 条（错误行为未被观测） | 0 条，旋转后仍无异常 |

移动端旋转后，Canvas 矩形从 `384×436.26` 变为 `561×637.16`，点击仍命中示例图形。桌面旋转后缩放为 `51.35%`，点击仍命中 `seed-orbit`。渲染路径保持按需 requestAnimationFrame，没有常驻动画循环。

证据：`before/before-boundary-touch.json`、`runs/after-boundary-desktop.json`、`runs/after-boundary-touch.json`。

## 损坏输入

预置同一段非法 JSON，并连续重载两次：

| 项目 | 修改前（旧版夹具） | 修改后（正式应用） |
|---|---|---|
| 最终结果 | 解析异常，0 图形 / 0 点 | 隔离原文，载入示例画布，2 图形 / 12 点 |
| 异常日志 | `JSON_PARSE_FAILED` + `UNCAUGHT SyntaxError` | `JSON_INVALID`，横幅提示“检测到 1 项问题” |
| 资源数量 | 4 监听器，位图 `1,839,528B` | 12 监听器，位图 `1,687,440B`，存储 `455B` |
| 可重复性 | 两次均崩溃 | 两次日志、图形、点数、监听器、位图完全一致 |

恢复并未伪装成成功：异常横幅持续可见，原始异常进入日志，损坏原文写入隔离键，只有用户确认或显式恢复示例后才关闭横幅。单元测试另覆盖非法坐标、重复 ID、缺失 ID、超出点数、超大原文、存储读取失败与配额写入失败。

证据：`before/before-corrupt-touch.json`、`runs/after-corrupt-desktop.json`、`screenshots/before-corrupt-touch.png`、`screenshots/after-corrupt-desktop.png`。

## 复现命令

```bash
npm install
npx playwright install chromium
npm start
# 另一个终端：
npm test
npm run test:e2e
npm run evidence:before
```

`npm run test:e2e` 会重新生成 `runs/` 与 `screenshots/` 中的正式应用证据；`evidence:before` 只读取旧版夹具，并重新生成 `before/` 对照证据。损坏场景通过 `page.addInitScript` 在应用启动前注入非法数据，避免页面卸载时的自动保存覆盖测试输入。

## 语义与资源说明

正式应用保留绘制、选择、移动三种工具，以及 JSON/PNG 导出。PNG 只渲染背景与笔画；准星、网格、选择框和诊断界面不会进入导出。性能路径没有删除功能，只把绘制改为按需帧渲染，并用本地中文字体子集保证离线显示。

监听器数量从旧版夹具的 4 增至正式应用的 12，属于统一指针、滚轮隔离、上下文恢复、尺寸变化与生命周期管理的预期资源，不是泄漏；正式应用通过 `AbortController` 和 `ResizeObserver.disconnect()` 统一释放。
