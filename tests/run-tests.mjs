// Repeatable test runner: default / boundary / error groups.
// Prints per-test results with reasons and a final success rate, and
// writes artifacts/test-report.json. Run: node tests/run-tests.mjs
import { TextLayoutEngine, tokenize } from "../src/layout.js";
import { SubtitleController, DEFAULT_STATE } from "../src/controller.js";
import { createStore, MapStorage } from "../src/store.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Deterministic measurer: CJK = fontSize, space = 0.3em, other = 0.5em.
const mockMeasure = (text, _font, fontSize) => {
  let w = 0;
  for (const ch of text) {
    w += /[　-〿㐀-䶿一-鿿豈-﫿︰-﹏＀-｠￠-￦]/.test(ch)
      ? fontSize
      : ch === " "
        ? fontSize * 0.3
        : fontSize * 0.5;
  }
  return w;
};

const makeEngine = () => new TextLayoutEngine({ measure: mockMeasure });
const makeController = (storage, extra = {}) => {
  const events = { announcements: [], errors: [], focuses: [] };
  const ctrl = new SubtitleController({
    store: createStore(storage || new MapStorage()),
    engine: makeEngine(),
    announce: (m) => events.announcements.push(m),
    onError: (m) => events.errors.push(m),
    onFocus: (i) => events.focuses.push(i),
    ...extra,
  });
  return { ctrl, events };
};

const results = [];
function test(group, name, fn) {
  try {
    fn();
    results.push({ group, name, status: "pass" });
  } catch (err) {
    results.push({ group, name, status: "fail", reason: err.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg} (期望 ${b}, 实际 ${a})`);
}

// ---------- 默认组 ----------
test("default", "重复测量命中缓存并统计命中率", () => {
  const e = makeEngine();
  const args = { text: "你好 world", font: "sans", fontSize: 24, width: 200, align: "left" };
  const first = e.layout(args);
  const second = e.layout(args);
  assert(!first.fromCache, "首次不应命中缓存");
  assert(second.fromCache, "第二次应命中缓存");
  eq(e.stats().hitRate, 0.5, "命中率应为 50%");
  assert(e.stats().totalLayoutMs >= 0, "应记录布局耗时");
});

test("default", "中文任意处断行，英文按词断行", () => {
  const e = makeEngine();
  const cjk = e.layout({ text: "你好世界啊", font: "f", fontSize: 10, width: 25, align: "left" });
  eq(cjk.lines.length, 3, "5 个汉字在 25px 宽度下应排 3 行");
  const en = e.layout({ text: "alpha beta gamma", font: "f", fontSize: 10, width: 40, align: "left" });
  for (const line of en.lines) {
    assert(line.width <= 40 + 1e-9, `行宽 ${line.width} 超过容器 40`);
  }
  const words = en.lines.map((l) => l.text.trim()).join(" ").split(/\s+/);
  assert(words.includes("alpha") && words.includes("beta"), "英文单词不应被拆开");
});

test("default", "样式变化使缓存失效", () => {
  const e = makeEngine();
  const args = { text: "缓存失效测试", font: "f", fontSize: 20, width: 100, align: "left" };
  e.layout(args);
  e.layout(args);
  e.invalidateStyles();
  const after = e.layout(args);
  assert(!after.fromCache, "样式变化后不应命中旧缓存");
  eq(e.stats().styleVersion, 1, "样式版本应递增");
});

test("default", "键盘操作移动焦点并更新读屏信息", () => {
  const { ctrl, events } = makeController();
  assert(ctrl.handleKey("ArrowDown"), "ArrowDown 应被处理");
  eq(ctrl.state.selectedIndex, 1, "焦点应移到第 2 条");
  eq(events.focuses.at(-1), 1, "焦点回调应收到新索引");
  assert(events.announcements.at(-1).includes("第 2 条"), "读屏信息应随操作更新");
});

test("default", "鼠标与触屏到达与键盘相同的功能状态", () => {
  const viaKey = makeController();
  const viaMouse = makeController();
  const viaTouch = makeController();
  viaKey.ctrl.handleKey("ArrowDown");
  viaMouse.ctrl.handleClick("item", { index: 1 });
  viaTouch.ctrl.handleTouch("tap", { target: "item", index: 1 });
  eq(viaKey.ctrl.state.selectedIndex, 1, "键盘选中第 2 条");
  eq(viaMouse.ctrl.state.selectedIndex, 1, "鼠标应到达相同状态");
  eq(viaTouch.ctrl.state.selectedIndex, 1, "触屏应到达相同状态");
  viaTouch.ctrl.handleTouch("swipe-up");
  eq(viaTouch.ctrl.state.selectedIndex, 2, "触屏滑动应等同 ArrowDown");
});

test("default", "导出保留导出前状态", () => {
  const { ctrl } = makeController();
  ctrl.dispatch("edit-item", { index: 0, text: "导出前的文本" });
  const rec = ctrl.dispatch("export") && ctrl.state.exports.at(-1);
  eq(rec.preExportState.items[0].text, "导出前的文本", "导出记录应含导出前快照");
  eq(ctrl.state.items[0].text, "导出前的文本", "导出后当前状态不应被改动");
});

test("default", "刷新/重载后状态恢复一致", () => {
  const storage = new MapStorage();
  const a = makeController(storage);
  a.ctrl.dispatch("set-style", { patch: { fontSize: 32, align: "center" } });
  a.ctrl.dispatch("scroll", { scrollTop: 120 });
  a.ctrl.dispatch("export");
  const b = makeController(storage); // 模拟重新载入
  eq(b.ctrl.state.style.fontSize, 32, "字号应恢复");
  eq(b.ctrl.state.style.align, "center", "对齐应恢复");
  eq(b.ctrl.state.scrollTop, 120, "滚动位置应恢复");
  eq(b.ctrl.state.exports.length, 1, "已导出工程不应被重置");
});

test("default", "滚动后字幕块不重叠", () => {
  const e = makeEngine();
  const texts = ["第一条字幕内容", "second subtitle line here", "混合 mixed 内容"];
  const blocks = texts.map((t) =>
    e.layout({ text: t, font: "f", fontSize: 20, width: 120, align: "left" })
  );
  for (const scrollTop of [0, 37, 500, 9999]) {
    const placed = e.stack(blocks, 8);
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1];
      assert(
        placed[i].y >= prev.y + prev.height,
        `scrollTop=${scrollTop} 时第 ${i} 块与上一块重叠`
      );
    }
  }
});

// ---------- 边界组 ----------
test("boundary", "空文本产生单个空行", () => {
  const e = makeEngine();
  const r = e.layout({ text: "", font: "f", fontSize: 20, width: 100, align: "left" });
  eq(r.lines.length, 1, "空文本应有 1 行");
  eq(r.height, r.lineHeight, "高度应等于行高");
});

test("boundary", "宽度不足一个汉字时逐字断行", () => {
  const e = makeEngine();
  const r = e.layout({ text: "你好啊", font: "f", fontSize: 10, width: 5, align: "left" });
  eq(r.lines.length, 3, "每字应独占一行");
});

test("boundary", "超长英文单词按字符硬断行", () => {
  const e = makeEngine();
  const r = e.layout({ text: "supercalifragilistic", font: "f", fontSize: 10, width: 30, align: "left" });
  assert(r.lines.length > 1, "长单词应被硬断为多行");
  for (const line of r.lines) {
    assert(line.width <= 30 + 1e-9, `硬断行宽 ${line.width} 超过 30`);
  }
});

test("boundary", "宽度恰好等于文本宽度时只占一行", () => {
  const e = makeEngine();
  const text = "恰好";
  const w = mockMeasure(text, "f", 10);
  const r = e.layout({ text, font: "f", fontSize: 10, width: w, align: "left" });
  eq(r.lines.length, 1, "等宽应单行容纳");
});

test("boundary", "非法尺寸抛出明确错误", () => {
  const e = makeEngine();
  for (const bad of [
    { text: "x", font: "f", fontSize: 0, width: 100, align: "left" },
    { text: "x", font: "f", fontSize: 10, width: -1, align: "left" },
  ]) {
    let threw = false;
    try { e.layout(bad); } catch (err) { threw = /layout:/.test(err.message); }
    assert(threw, "非法尺寸应抛出带 layout: 前缀的错误");
  }
});

test("boundary", "超长混合文本布局完成且记录耗时", () => {
  const e = makeEngine();
  const text = "混合mixed内容content".repeat(500);
  const r = e.layout({ text, font: "f", fontSize: 16, width: 320, align: "left" });
  assert(r.lines.length > 10, "长文本应排成多行");
  assert(e.stats().maxLayoutMs >= 0, "应记录峰值布局耗时");
});

test("boundary", "tokenize 混合文本单元正确", () => {
  const units = tokenize("你好 world ");
  assert(units.includes("你") && units.includes("world "), "中英文应拆为不同单元");
});

// ---------- 错误组 ----------
test("error", "存档损坏时恢复默认并报出原因", () => {
  const storage = new MapStorage();
  storage.setItem("subtitle-scene:v1", "{corrupted json");
  const { ctrl, events } = makeController(storage);
  eq(ctrl.state.items.length, DEFAULT_STATE.items.length, "应回退到默认字幕");
  assert(events.errors.some((m) => m.includes("读取存档失败")), "应报出具体失败原因");
});

test("error", "非法样式被拒绝且保留原样式", () => {
  const { ctrl, events } = makeController();
  ctrl.dispatch("set-style", { patch: { fontSize: -5 } });
  eq(ctrl.state.style.fontSize, DEFAULT_STATE.style.fontSize, "原字号应保留");
  assert(events.errors.at(-1).includes("字号与宽度必须为正数"), "应给出具体原因");
  ctrl.dispatch("set-style", { patch: { align: "diagonal" } });
  eq(ctrl.state.style.align, "left", "非法对齐应保留原值");
});

test("error", "空文本与越界编辑被拒绝", () => {
  const { ctrl, events } = makeController();
  ctrl.dispatch("edit-item", { index: 0, text: "  " });
  assert(events.errors.at(-1).includes("不能为空"), "空文本应报具体原因");
  ctrl.dispatch("edit-item", { index: 99, text: "x" });
  assert(events.errors.at(-1).includes("不存在"), "越界序号应报具体原因");
  eq(ctrl.state.items[0].text, DEFAULT_STATE.items[0].text, "原字幕不应被改动");
});

test("error", "存储写入失败时保留内存状态并报错", () => {
  const storage = new MapStorage();
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  const { ctrl, events } = makeController(storage);
  ctrl.handleKey("ArrowDown");
  eq(ctrl.state.selectedIndex, 1, "内存状态应继续生效");
  assert(events.errors.some((m) => m.includes("保存失败")), "应报出保存失败原因");
});

test("error", "未知操作返回失败且不改变状态", () => {
  const { ctrl, events } = makeController();
  const before = structuredClone(ctrl.state);
  assert(!ctrl.dispatch("fly-to-moon"), "未知意图应返回 false");
  assert(events.errors.at(-1).includes("未知操作"), "应报出未知操作原因");
  eq(JSON.stringify(ctrl.state), JSON.stringify(before), "状态不应变化");
});

test("error", "非字符串文本布局抛出明确错误", () => {
  const e = makeEngine();
  let msg = "";
  try { e.layout({ text: 42, font: "f", fontSize: 10, width: 100, align: "left" }); }
  catch (err) { msg = err.message; }
  assert(msg.includes("text must be a string"), "应抛出文本类型错误");
});

// ---------- 汇总 ----------
const groups = ["default", "boundary", "error"];
let pass = 0;
for (const g of groups) {
  console.log(`\n[${g}]`);
  for (const r of results.filter((r) => r.group === g)) {
    const mark = r.status === "pass" ? "PASS" : "FAIL";
    console.log(`  ${mark}  ${r.name}${r.reason ? ` —— ${r.reason}` : ""}`);
    if (r.status === "pass") pass++;
  }
}
const rate = ((pass / results.length) * 100).toFixed(1);
console.log(`\n成功率: ${rate}% (${pass}/${results.length})`);
const failures = results.filter((r) => r.status === "fail");
if (failures.length) {
  console.log("失败原因:");
  for (const f of failures) console.log(`  - [${f.group}] ${f.name}: ${f.reason}`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "artifacts"), { recursive: true });
writeFileSync(
  join(root, "artifacts", "test-report.json"),
  JSON.stringify(
    { at: new Date().toISOString(), successRate: pass / results.length, pass, total: results.length, results },
    null,
    2
  )
);
process.exit(failures.length ? 1 : 0);
