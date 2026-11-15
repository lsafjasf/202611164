/* 三组场景对比测试：正常输入 / 边界输入 / 损坏输入。
 * 每个场景分别在 recovery=false（修复前）与 recovery=true（修复后）下运行，
 * 对比最终结果、错误日志与资源计数。失败场景可重复（运行两次断言一致）。
 * 运行：node test/scenarios.js */
"use strict";

var EditorCore = require("../src/editor-core.js");

var failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error("  ✗ 断言失败: " + msg);
  } else {
    console.log("  ✓ " + msg);
  }
}

function report(name, editor, extra) {
  var rc = editor.resourceCounts();
  console.log("  [" + name + "] 最终图形数=" + rc.shapes +
    " 撤销深度=" + rc.undoDepth + " 重做深度=" + rc.redoDepth +
    " 错误日志条数=" + rc.errorCount +
    " 累计操作耗时=" + editor.metrics.totalOpMs.toFixed(2) + "ms" +
    (extra ? " " + extra : ""));
  editor.metrics.errorLog.forEach(function (e) {
    console.log("    日志 " + e.code + " (recovered=" + e.recovered + "): " + e.message);
  });
  return rc;
}

/* ---------- 场景 A：正常输入（含一次实际的编辑与撤销） ---------- */
function scenarioNormal(recovery) {
  var ed = EditorCore.createEditor({ recovery: recovery });
  ed.addShape({ type: "rect", x: 10, y: 10, w: 100, h: 80, label: "底框" });
  ed.addShape({ type: "ellipse", x: 150, y: 40, w: 90, h: 90, label: "圆" });
  var edit = ed.updateShape(1, { label: "标题框" });
  var undone = ed.undo();
  var redone = ed.redo();
  return { ed: ed, edit: edit, undone: undone, redone: redone };
}

function runNormal() {
  console.log("\n== 场景 A：正常输入 ==");
  var before = scenarioNormal(false);
  var after = scenarioNormal(true);

  assert(before.edit.ok && before.undone.ok && before.redone.ok, "修复前：编辑+撤销+重做均成功");
  assert(after.edit.ok && after.undone.ok && after.redone.ok, "修复后：编辑+撤销+重做均成功");

  var shapeAfterUndo = null;
  var ed2 = EditorCore.createEditor({ recovery: true });
  ed2.addShape({ type: "rect", x: 0, y: 0, w: 10, h: 10, label: "原始" });
  ed2.updateShape(1, { label: "已修改" });
  ed2.undo();
  shapeAfterUndo = ed2.state.shapes[0].label;
  assert(shapeAfterUndo === "原始", "撤销后标签恢复为修改前的值（实际完成一次编辑与撤销）");

  var rcB = report("修复前", before.ed);
  var rcA = report("修复后", after.ed);
  assert(rcB.errorCount === 0 && rcA.errorCount === 0, "正常输入下两侧错误日志均为 0");
  assert(before.ed.exportJSON() === after.ed.exportJSON(),
    "修复前后导出内容完全一致（未改变已有导出语义）");
  assert(rcA.shapes === 2 && rcA.undoDepth === 3, "修复后资源计数正确（2 图形 / 3 步撤销）");
}

/* ---------- 场景 B：边界输入 ---------- */
function scenarioBoundary(recovery) {
  var ed = EditorCore.createEditor({ recovery: recovery });
  var results = {};
  results.minCoord = ed.addShape({ type: "rect", x: -10000, y: 10000, w: 1, h: 1, label: "" });
  results.longLabel = ed.addShape({
    type: "rect", x: 0, y: 0, w: 10, h: 10, label: "长".repeat(200)
  });
  results.tinySize = ed.addShape({ type: "ellipse", x: 5, y: 5, w: 0, h: -3, label: "" });
  results.nanCoord = safeCall(function () {
    return ed.addShape({ type: "rect", x: NaN, y: 0, w: 10, h: 10, label: "" });
  });
  results.unknownType = safeCall(function () {
    return ed.addShape({ type: "circle", x: 0, y: 0, w: 10, h: 10, label: "" });
  });
  return { ed: ed, results: results };
}

function safeCall(fn) {
  try {
    return { value: fn() };
  } catch (err) {
    return { thrown: String(err.message || err) };
  }
}

function runBoundary() {
  console.log("\n== 场景 B：边界输入 ==");
  var before = scenarioBoundary(false);
  var after = scenarioBoundary(true);

  assert(before.results.minCoord.ok && after.results.minCoord.ok, "两侧：极值坐标可正常添加");
  assert(after.ed.state.shapes[1].label.length === 120, "修复后：超长标签被截断到 120 字符");
  assert(after.ed.state.shapes[2].w === 1 && after.ed.state.shapes[2].h === 1,
    "修复后：非正尺寸被钳制到最小值 1");
  assert(!!before.results.nanCoord.thrown, "修复前：NaN 坐标直接抛异常（可重复的失败）");
  assert(after.results.nanCoord.value && after.results.nanCoord.value.ok === false,
    "修复后：NaN 坐标被拒绝并记录日志，不抛异常");
  assert(after.results.unknownType.value && after.results.unknownType.value.ok === false,
    "修复后：未知图形类型被拒绝");

  var rcB = report("修复前", before.ed);
  var rcA = report("修复后", after.ed);
  assert(rcB.errorCount === 0, "修复前：异常未被记录（错误日志为 0，问题不可观测）");
  assert(rcA.errorCount === 2, "修复后：2 条非法输入被记录且已恢复");
  assert(rcA.shapes === 3, "修复后：仅 3 个合法图形进入画布");
}

/* ---------- 场景 C：损坏输入（失败必须可重复） ---------- */
function corruptedPayload() {
  return {
    shapes: [
      { type: "rect", x: 1, y: 2, w: 10, h: 10, label: "好数据" },
      null,
      { type: "rect", x: "abc", y: 0, w: 10, h: 10, label: "" },
      { type: "blob", x: 0, y: 0, w: 10, h: 10, label: "" },
      { type: "ellipse", x: 5, y: 5, w: 20, h: 20, label: 42 }
    ]
  };
}

function scenarioCorrupted(recovery) {
  var ed = EditorCore.createEditor({ recovery: recovery });
  ed.addShape({ type: "rect", x: 0, y: 0, w: 50, h: 50, label: "已有" });
  var outcome = safeCall(function () { return ed.importState(corruptedPayload()); });
  return { ed: ed, outcome: outcome };
}

function runCorrupted() {
  console.log("\n== 场景 C：损坏输入 ==");
  var before1 = scenarioCorrupted(false);
  var before2 = scenarioCorrupted(false);
  var after = scenarioCorrupted(true);

  assert(!!before1.outcome.thrown, "修复前：损坏导入抛出异常");
  assert(before1.outcome.thrown === before2.outcome.thrown,
    "修复前：失败可重复（两次运行异常信息一致）");
  assert(before1.ed.state.shapes.length === 2,
    "修复前：异常导致部分数据残留（状态被污染）");

  assert(after.outcome.value && after.outcome.value.ok === true, "修复后：导入正常返回");
  assert(after.outcome.value.imported === 1 && after.outcome.value.rejected === 4,
    "修复后：1 条有效数据被接受，4 条损坏数据被跳过");
  assert(after.ed.state.shapes.length === 2, "修复后：画布仅包含已有图形 + 1 条有效导入");
  assert(after.ed.state.recoverySuggestion.indexOf("跳过 4 条") !== -1,
    "修复后：向用户展示恢复建议");

  var undoResult = after.ed.undo();
  assert(undoResult.ok && after.ed.state.shapes.length === 1,
    "修复后：可撤销本次导入，回到导入前状态");

  var rcB = report("修复前", before1.ed);
  var rcA = report("修复后", after.ed);
  assert(rcB.errorCount === 0, "修复前：异常未记录（不可观测）");
  assert(rcA.errorCount === 4, "修复后：4 条损坏数据全部记入错误日志（未隐藏异常）");
}

runNormal();
runBoundary();
runCorrupted();

console.log("\n========================================");
if (failures > 0) {
  console.error("共 " + failures + " 项断言失败");
  process.exit(1);
} else {
  console.log("全部断言通过");
}
