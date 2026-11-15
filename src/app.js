/* UI 交互层：画布渲染、弹窗焦点管理、键盘快捷键、状态栏指标。 */
(function () {
  "use strict";

  var editor = EditorCore.createEditor({ recovery: true });
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var statusMode = document.getElementById("status-mode");
  var statusTiming = document.getElementById("status-timing");
  var statusResources = document.getElementById("status-resources");
  var statusSuggestion = document.getElementById("status-suggestion");

  var backdrop = document.getElementById("modal-backdrop");
  var dialog = document.getElementById("props-dialog");
  var appMain = document.getElementById("app-main");
  var propsForm = document.getElementById("props-form");
  var propLabel = document.getElementById("prop-label");
  var propX = document.getElementById("prop-x");
  var propY = document.getElementById("prop-y");

  var modalTrigger = null; /* 打开弹窗的元素，关闭后焦点归还 */
  var GRID = 20;

  var MODE_NAMES = { select: "选择", rect: "矩形", ellipse: "椭圆" };

  function isEditableTarget(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function render() {
    var t0 = performance.now();
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      editor.state.shapes.forEach(function (s) {
        ctx.beginPath();
        if (s.type === "rect") {
          ctx.rect(s.x, s.y, s.w, s.h);
        } else {
          ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
        }
        ctx.fillStyle = s.id === editor.state.selectedId ? "#0b5fff" : "#7aa5ff";
        ctx.fill();
        if (s.label) {
          ctx.fillStyle = "#fff";
          ctx.font = "12px sans-serif";
          ctx.fillText(s.label, s.x + 4, s.y + 14);
        }
      });
    } catch (err) {
      /* 渲染失败不吞掉异常：记录到指标并展示恢复建议，画布保持上一帧。 */
      editor.metrics.errorLog.push({
        at: new Date().toISOString(),
        code: "RENDER",
        message: String(err && err.message || err),
        recovered: true
      });
      editor.state.recoverySuggestion = "渲染出现问题，已保留上一帧；可尝试撤销最近操作。";
    }
    updateStatus(performance.now() - t0);
  }

  function updateStatus(renderMs) {
    var rc = editor.resourceCounts();
    var domNodes = document.getElementsByTagName("*").length;
    statusMode.textContent = "模式：" + (MODE_NAMES[editor.state.mode] || editor.state.mode);
    statusTiming.textContent =
      "耗时：操作 " + editor.metrics.lastOpMs.toFixed(1) + " ms / 渲染 " + renderMs.toFixed(1) + " ms";
    statusResources.textContent =
      "资源：图形 " + rc.shapes + " / 撤销 " + rc.undoDepth +
      " / 错误 " + rc.errorCount + " / DOM 节点 " + domNodes;
    if (editor.state.recoverySuggestion) {
      statusSuggestion.textContent = "恢复建议：" + editor.state.recoverySuggestion;
      statusSuggestion.hidden = false;
    } else {
      statusSuggestion.hidden = true;
    }
  }

  function setMode(mode) {
    editor.setMode(mode);
    document.querySelectorAll(".tool-panel [data-mode]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
    });
    render();
  }

  function addShapeOfCurrentMode() {
    var mode = editor.state.mode;
    if (mode === "select") return;
    var n = editor.state.shapes.length;
    var result = editor.addShape({
      type: mode,
      x: 40 + (n * GRID) % 400,
      y: 40 + (n * GRID) % 300,
      w: 80,
      h: 60,
      label: ""
    });
    if (result.ok) editor.state.recoverySuggestion = "";
    render();
  }

  function selectedShape() {
    var id = editor.state.selectedId;
    for (var i = 0; i < editor.state.shapes.length; i++) {
      if (editor.state.shapes[i].id === id) return editor.state.shapes[i];
    }
    return null;
  }

  /* ---- 弹窗：焦点进入、Tab 陷阱、Esc 关闭、焦点归还 ---- */

  function focusableInDialog() {
    return Array.prototype.slice.call(
      dialog.querySelectorAll("input, button, select, textarea, [tabindex]")
    ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  function openModal(trigger) {
    var shape = selectedShape();
    if (!shape) {
      editor.state.recoverySuggestion = "请先在画布上选中一个图形，再打开属性。";
      render();
      return;
    }
    modalTrigger = trigger || document.activeElement;
    propLabel.value = shape.label;
    propX.value = shape.x;
    propY.value = shape.y;
    backdrop.hidden = false;
    appMain.setAttribute("inert", "");
    appMain.setAttribute("aria-hidden", "true");
    propLabel.focus();
  }

  function closeModal() {
    backdrop.hidden = true;
    appMain.removeAttribute("inert");
    appMain.removeAttribute("aria-hidden");
    if (modalTrigger && document.contains(modalTrigger)) {
      modalTrigger.focus();
    } else {
      canvas.focus();
    }
    modalTrigger = null;
  }

  dialog.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key !== "Tab") return;
    var items = focusableInDialog();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  propsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var shape = selectedShape();
    if (!shape) { closeModal(); return; }
    var result = editor.updateShape(shape.id, {
      label: propLabel.value,
      x: Number(propX.value),
      y: Number(propY.value)
    });
    if (result.ok) editor.state.recoverySuggestion = "";
    closeModal();
    render();
  });

  document.getElementById("prop-cancel").addEventListener("click", closeModal);

  /* ---- 画布键盘快捷键：输入框聚焦时整体跳过 ---- */

  document.addEventListener("keydown", function (e) {
    if (!backdrop.hidden) return; /* 弹窗打开时画布快捷键停用 */
    if (isEditableTarget(e.target)) return;

    var key = e.key;
    if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "Z")) {
      e.preventDefault();
      editor.undo();
      render();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (key === "y" || key === "Y")) {
      e.preventDefault();
      editor.redo();
      render();
      return;
    }

    var shape = selectedShape();
    var move = { ArrowUp: [0, -GRID], ArrowDown: [0, GRID], ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0] }[key];
    if (move && shape) {
      e.preventDefault();
      editor.updateShape(shape.id, { x: shape.x + move[0], y: shape.y + move[1] });
      render();
      return;
    }

    switch (key) {
      case "v": case "V": setMode("select"); break;
      case "r": case "R": setMode("rect"); break;
      case "e": case "E": setMode("ellipse"); break;
      case "Enter":
        if (document.activeElement === canvas && shape) {
          e.preventDefault();
          openModal(canvas);
        }
        break;
      case "Delete": case "Backspace":
        if (shape) {
          e.preventDefault();
          editor.deleteShape(shape.id);
          render();
        }
        break;
      case "n": case "N":
        addShapeOfCurrentMode();
        break;
    }
  });

  canvas.addEventListener("mousedown", function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var shapes = editor.state.shapes;
    for (var i = shapes.length - 1; i >= 0; i--) {
      var s = shapes[i];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) {
        editor.select(s.id);
        render();
        return;
      }
    }
    editor.select(null);
    render();
  });

  /* ---- 工具面板按钮 ---- */

  document.querySelectorAll(".tool-panel [data-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () { setMode(btn.dataset.mode); });
  });
  document.getElementById("action-delete").addEventListener("click", function () {
    var s = selectedShape();
    if (s) { editor.deleteShape(s.id); render(); }
  });
  document.getElementById("action-undo").addEventListener("click", function () {
    editor.undo(); render();
  });
  document.getElementById("action-redo").addEventListener("click", function () {
    editor.redo(); render();
  });
  document.getElementById("action-props").addEventListener("click", function (e) {
    openModal(e.currentTarget);
  });
  document.getElementById("action-export").addEventListener("click", function () {
    var json = editor.exportJSON();
    var blob = new Blob([json], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "canvas-export.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* 暴露给自动化测试与调试 */
  window.__editorApp = { editor: editor, render: render, openModal: openModal, closeModal: closeModal };

  render();
})();
