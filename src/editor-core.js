/* 编辑器核心逻辑：状态、命令、撤销、校验、指标与错误恢复。
 * 同时可在浏览器（window.EditorCore）与 Node（module.exports）中运行。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EditorCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LIMITS = {
    maxShapes: 500,
    maxLabelLength: 120,
    minCoord: -10000,
    maxCoord: 10000,
    minSize: 1,
    maxSize: 5000,
    maxUndoDepth: 100
  };

  var SHAPE_TYPES = ["rect", "ellipse"];

  function now() {
    if (typeof performance !== "undefined" && performance.now) {
      return performance.now();
    }
    return Date.now();
  }

  function createMetrics() {
    return {
      opCounts: {},
      errorLog: [],
      lastOpMs: 0,
      totalOpMs: 0,
      recoveries: 0
    };
  }

  function logError(metrics, code, message, recovered) {
    metrics.errorLog.push({
      at: new Date().toISOString(),
      code: code,
      message: message,
      recovered: !!recovered
    });
  }

  function bumpOp(metrics, name) {
    metrics.opCounts[name] = (metrics.opCounts[name] || 0) + 1;
  }

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  /* 校验并规范化单个图形；返回 { shape } 或 { error }。 */
  function validateShape(raw, id) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { error: "图形条目不是对象: " + Object.prototype.toString.call(raw) };
    }
    if (SHAPE_TYPES.indexOf(raw.type) === -1) {
      return { error: "未知图形类型: " + String(raw.type) };
    }
    var nums = ["x", "y", "w", "h"];
    for (var i = 0; i < nums.length; i++) {
      if (!isFiniteNumber(raw[nums[i]])) {
        return { error: "字段 " + nums[i] + " 不是有限数值: " + String(raw[nums[i]]) };
      }
    }
    var label = raw.label;
    if (label === undefined || label === null) {
      label = "";
    }
    if (typeof label !== "string") {
      return { error: "label 不是字符串: " + typeof label };
    }
    return {
      shape: {
        id: id,
        type: raw.type,
        x: clamp(raw.x, LIMITS.minCoord, LIMITS.maxCoord),
        y: clamp(raw.y, LIMITS.minCoord, LIMITS.maxCoord),
        w: clamp(raw.w, LIMITS.minSize, LIMITS.maxSize),
        h: clamp(raw.h, LIMITS.minSize, LIMITS.maxSize),
        label: label.slice(0, LIMITS.maxLabelLength)
      }
    };
  }

  function snapshot(state) {
    return JSON.stringify({ shapes: state.shapes, selectedId: state.selectedId });
  }

  function createEditor(options) {
    options = options || {};
    /* recovery=false 模拟修复前行为：不校验、不恢复，异常直接抛出。 */
    var recovery = options.recovery !== false;

    var state = {
      shapes: [],
      selectedId: null,
      mode: "select",
      nextId: 1,
      undoStack: [],
      redoStack: [],
      lastGoodSnapshot: snapshot({ shapes: [], selectedId: null }),
      recoverySuggestion: ""
    };
    var metrics = createMetrics();

    function pushUndo() {
      state.undoStack.push(snapshot(state));
      if (state.undoStack.length > LIMITS.maxUndoDepth) {
        state.undoStack.shift();
      }
      state.redoStack.length = 0;
    }

    function resourceCounts() {
      return {
        shapes: state.shapes.length,
        undoDepth: state.undoStack.length,
        redoDepth: state.redoStack.length,
        errorCount: metrics.errorLog.length
      };
    }

    function timed(name, fn) {
      var t0 = now();
      try {
        return fn();
      } finally {
        var dt = now() - t0;
        metrics.lastOpMs = dt;
        metrics.totalOpMs += dt;
        bumpOp(metrics, name);
      }
    }

    function findShape(id) {
      for (var i = 0; i < state.shapes.length; i++) {
        if (state.shapes[i].id === id) return state.shapes[i];
      }
      return null;
    }

    function addShape(raw) {
      return timed("addShape", function () {
        if (state.shapes.length >= LIMITS.maxShapes) {
          var msg = "图形数量达到上限 " + LIMITS.maxShapes;
          if (!recovery) throw new Error(msg);
          logError(metrics, "LIMIT_SHAPES", msg, true);
          state.recoverySuggestion = "已达到图形上限，请删除部分图形后再添加。";
          return { ok: false, error: msg };
        }
        var id = state.nextId++;
        var checked = validateShape(raw, id);
        if (checked.error) {
          if (!recovery) throw new Error("校验失败: " + checked.error);
          logError(metrics, "INVALID_SHAPE", checked.error, true);
          state.recoverySuggestion = "输入被拒绝，请检查图形类型与坐标数值。";
          return { ok: false, error: checked.error };
        }
        pushUndo();
        state.shapes.push(checked.shape);
        state.selectedId = id;
        state.lastGoodSnapshot = snapshot(state);
        return { ok: true, shape: checked.shape };
      });
    }

    function updateShape(id, patch) {
      return timed("updateShape", function () {
        var target = findShape(id);
        if (!target) {
          var msg = "未找到图形 id=" + id;
          if (!recovery) throw new Error(msg);
          logError(metrics, "NOT_FOUND", msg, true);
          state.recoverySuggestion = "目标图形不存在，可能已被删除。";
          return { ok: false, error: msg };
        }
        var merged = {};
        for (var k in target) merged[k] = target[k];
        for (var p in patch) merged[p] = patch[p];
        var checked = validateShape(merged, id);
        if (checked.error) {
          if (!recovery) throw new Error("校验失败: " + checked.error);
          logError(metrics, "INVALID_UPDATE", checked.error, true);
          state.recoverySuggestion = "修改被拒绝，已保留原值。";
          return { ok: false, error: checked.error };
        }
        pushUndo();
        var idx = state.shapes.indexOf(target);
        state.shapes[idx] = checked.shape;
        state.lastGoodSnapshot = snapshot(state);
        return { ok: true, shape: checked.shape };
      });
    }

    function deleteShape(id) {
      return timed("deleteShape", function () {
        var target = findShape(id);
        if (!target) return { ok: false, error: "未找到图形 id=" + id };
        pushUndo();
        state.shapes.splice(state.shapes.indexOf(target), 1);
        if (state.selectedId === id) state.selectedId = null;
        state.lastGoodSnapshot = snapshot(state);
        return { ok: true };
      });
    }

    function undo() {
      return timed("undo", function () {
        if (!state.undoStack.length) return { ok: false, error: "没有可撤销的操作" };
        state.redoStack.push(snapshot(state));
        var prev = JSON.parse(state.undoStack.pop());
        state.shapes = prev.shapes;
        state.selectedId = prev.selectedId;
        state.lastGoodSnapshot = snapshot(state);
        return { ok: true };
      });
    }

    function redo() {
      return timed("redo", function () {
        if (!state.redoStack.length) return { ok: false, error: "没有可重做的操作" };
        state.undoStack.push(snapshot(state));
        var next = JSON.parse(state.redoStack.pop());
        state.shapes = next.shapes;
        state.selectedId = next.selectedId;
        state.lastGoodSnapshot = snapshot(state);
        return { ok: true };
      });
    }

    /* 导入外部状态（损坏输入场景入口）。 */
    function importState(payload) {
      return timed("importState", function () {
        var list = payload && payload.shapes;
        if (!Array.isArray(list)) {
          var msg0 = "导入数据缺少 shapes 数组";
          if (!recovery) throw new Error(msg0);
          logError(metrics, "IMPORT_FORMAT", msg0, true);
          state.recoverySuggestion = "导入文件格式不正确，已保留当前画布。";
          return { ok: false, error: msg0 };
        }
        var accepted = [];
        var rejected = 0;
        for (var i = 0; i < list.length; i++) {
          var checked = validateShape(list[i], state.nextId + i);
          if (checked.error) {
            if (!recovery) {
              /* 修复前：部分数据已被接受时抛错，状态被污染且调用方只能看到异常。 */
              state.shapes = state.shapes.concat(accepted);
              throw new Error("导入失败: " + checked.error);
            }
            rejected++;
            logError(metrics, "IMPORT_ENTRY", "第 " + i + " 项: " + checked.error, true);
            continue;
          }
          accepted.push(checked.shape);
        }
        if (!recovery) {
          state.shapes = state.shapes.concat(accepted);
          state.nextId += list.length;
          return { ok: true, imported: accepted.length, rejected: 0 };
        }
        pushUndo();
        state.shapes = state.shapes.concat(accepted);
        state.nextId += list.length;
        state.lastGoodSnapshot = snapshot(state);
        if (rejected > 0) {
          metrics.recoveries++;
          state.recoverySuggestion =
            "已跳过 " + rejected + " 条损坏数据，导入 " + accepted.length +
            " 条有效图形；可用撤销回退本次导入。";
        }
        return { ok: true, imported: accepted.length, rejected: rejected };
      });
    }

    function exportJSON() {
      return timed("exportJSON", function () {
        return JSON.stringify({
          version: 1,
          shapes: state.shapes.map(function (s) {
            return { type: s.type, x: s.x, y: s.y, w: s.w, h: s.h, label: s.label };
          })
        });
      });
    }

    return {
      state: state,
      metrics: metrics,
      limits: LIMITS,
      recovery: recovery,
      addShape: addShape,
      updateShape: updateShape,
      deleteShape: deleteShape,
      undo: undo,
      redo: redo,
      importState: importState,
      exportJSON: exportJSON,
      resourceCounts: resourceCounts,
      setMode: function (m) { state.mode = m; },
      select: function (id) { state.selectedId = id; }
    };
  }

  return { createEditor: createEditor, LIMITS: LIMITS };
});
