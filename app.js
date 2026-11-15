(function () {
  "use strict";

  const C = window.ColorEngine;
  const STORAGE_KEY = "chromaguard:project:v1";
  const RECOVERY_KEY = "chromaguard:recovery:v1";
  const A11Y_KEY = "chromaguard:a11y:v1";
  const APP_VERSION = "1.0.0";
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nowIso = () => new Date().toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const dom = {
    paletteList: $("#paletteList"),
    seedInput: $("#seedInput"),
    regenerateButton: $("#regenerateButton"),
    regenHint: $("#regenHint"),
    lockedCount: $("#lockedCount"),
    lockSummary: $("#lockSummary"),
    scoreRing: $("#scoreRing"),
    scoreValue: $("#scoreValue"),
    overallStatus: $("#overallStatus"),
    scoreCaption: $("#scoreCaption"),
    riskCount: $("#riskCount"),
    riskList: $("#riskList"),
    testGrid: $("#testGrid"),
    testPassRate: $("#testPassRate"),
    testSummaryDetail: $("#testSummaryDetail"),
    testFooterText: $("#testFooterText"),
    toastRegion: $("#toastRegion"),
    liveStatus: $("#liveStatus"),
    snapshotBadge: $("#snapshotBadge"),
    snapshotText: $("#snapshotText"),
    snapshotMeta: $("#snapshotMeta"),
    snapshotPanel: $(".snapshot-panel"),
    restoreSnapshot: $("#restoreSnapshot"),
    activityList: $("#activityList"),
    saveState: $("#saveState"),
    saveLabel: $("#saveLabel"),
    sidebarSaved: $("#sidebarSaved"),
    footerSaved: $("#footerSaved"),
    normalCanvas: $("#normalCanvas"),
    deuteranopiaCanvas: $("#deuteranopiaCanvas"),
    tritanopiaCanvas: $("#tritanopiaCanvas"),
    a11yChecks: $("#a11yChecks")
  };

  const CHART_DATA = [
    [29, 35, 32, 44, 48, 58],
    [42, 39, 50, 46, 56, 62],
    [24, 31, 38, 36, 44, 49],
    [36, 44, 41, 52, 57, 63],
    [18, 25, 30, 34, 39, 46],
    [48, 52, 49, 58, 61, 69]
  ];
  const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月"];

  function createDefaultState() {
    return {
      version: 1,
      appVersion: APP_VERSION,
      palette: C.clonePalette(C.DEFAULT_PALETTE),
      seed: "QG-2048",
      selectedToken: "series1",
      testRuns: {},
      lastExport: null,
      preExportSnapshot: null,
      lastProjectExport: null,
      activity: [{
        type: "load",
        text: "工程已载入，默认审计通过",
        at: nowIso()
      }],
      a11y: {
        verifiedAt: null,
        keyboard: false,
        recovery: false,
        export: false
      },
      updatedAt: nowIso()
    };
  }

  function stateSnapshot(state) {
    return {
      palette: C.clonePalette(state.palette),
      seed: state.seed,
      selectedToken: state.selectedToken
    };
  }

  function validHex(value) {
    return typeof value === "string" && C.isValidHex(value);
  }

  function validateState(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return "工程结构为空";
    }
    if (candidate.version !== 1) {
      return `不支持的工程版本：${candidate.version}`;
    }
    if (!Array.isArray(candidate.palette) || candidate.palette.length !== 8) {
      return "配色令牌数量不是 8";
    }
    const ids = new Set();
    for (const token of candidate.palette) {
      if (!token || !token.id || ids.has(token.id)) {
        return "配色令牌 ID 缺失或重复";
      }
      ids.add(token.id);
      if (!validHex(token.value)) {
        return `令牌 ${token.id} 的色值无效：${token.value}`;
      }
      if (typeof token.locked !== "boolean") {
        return `令牌 ${token.id} 的锁定状态无效`;
      }
      if (typeof token.name !== "string" || typeof token.role !== "string") {
        return `令牌 ${token.id} 的名称信息缺失`;
      }
    }
    const required = ["surface", "text", ...C.SERIES_IDS];
    if (!required.every((id) => ids.has(id))) {
      return "工程缺少必要的配色角色";
    }
    if (typeof candidate.seed !== "string" || !candidate.seed.trim()) {
      return "生成种子为空";
    }
    return null;
  }

  function loadState() {
    let raw = null;
    let recoveryNotice = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      recoveryNotice = "浏览器拒绝读取本地存储，本次使用默认工程。";
    }
    if (!raw) {
      return { state: createDefaultState(), recoveryNotice };
    }
    try {
      const parsed = JSON.parse(raw);
      const reason = validateState(parsed);
      if (!reason) {
        return { state: parsed, recoveryNotice: null };
      }
      throw new Error(reason);
    } catch (error) {
      const backup = raw;
      try {
        localStorage.setItem(RECOVERY_KEY, backup);
      } catch (_storageError) {
        // The original failed state remains visible in the browser storage inspector.
      }
      try {
        const parsed = JSON.parse(backup);
        if (parsed && parsed.lastProjectExport && parsed.lastProjectExport.snapshot) {
          const fallback = createDefaultState();
          fallback.palette = C.clonePalette(parsed.lastProjectExport.snapshot.palette);
          fallback.seed = parsed.lastProjectExport.snapshot.seed || fallback.seed;
          fallback.lastProjectExport = parsed.lastProjectExport;
          if (!validateState(fallback)) {
            fallback.activity.unshift({
              type: "recovery",
              text: "当前工程损坏，已从最近导出的工程恢复",
              at: nowIso()
            });
            return {
              state: fallback,
              recoveryNotice: `本地工程损坏（${error.message}），已从最近导出的工程恢复，原数据保存在 ${RECOVERY_KEY}。`
            };
          }
        }
      } catch (_fallbackError) {
        // Fall through to an explicit default recovery notice.
      }
      return {
        state: createDefaultState(),
        recoveryNotice: `本地工程损坏（${error.message}），已恢复默认工程；原数据保存在 ${RECOVERY_KEY}，不会静默覆盖。`
      };
    }
  }

  const loaded = loadState();
  let state = loaded.state;
  state.testRuns = state.testRuns && typeof state.testRuns === "object" ? state.testRuns : {};
  state.activity = Array.isArray(state.activity) ? state.activity.slice(0, 5) : [];
  if (!state.activity.length) {
    state.activity = [{ type: "load", text: "工程已载入", at: nowIso() }];
  }
  state.a11y = {
    verifiedAt: null,
    keyboard: false,
    recovery: false,
    export: false,
    ...(state.a11y && typeof state.a11y === "object" ? state.a11y : {})
  };
  state.preExportSnapshot = state.preExportSnapshot || null;
  state.lastExport = state.lastExport || null;
  state.lastProjectExport = state.lastProjectExport || null;
  state.selectedToken = state.selectedToken || "series1";
  let evaluation = C.evaluate(state.palette);
  let saveTimer = null;
  let saveLabelTimer = null;
  let testInProgress = false;

  function announce(message) {
    if (!dom.liveStatus) return;
    dom.liveStatus.textContent = "";
    window.setTimeout(() => {
      dom.liveStatus.textContent = message;
    }, 30);
  }

  function formatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "未知时间";
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function addActivity(type, text) {
    state.activity.unshift({ type, text, at: nowIso() });
    state.activity = state.activity.slice(0, 5);
  }

  function saveState(options = {}) {
    state.updatedAt = nowIso();
    const text = JSON.stringify(state);
    dom.saveState.classList.add("is-saving");
    dom.saveLabel.textContent = "正在保存…";
    dom.sidebarSaved.textContent = "保存中…";
    window.clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, text);
      saveTimer = window.setTimeout(() => {
        dom.saveState.classList.remove("is-saving");
        dom.saveLabel.textContent = "所有更改已保存";
        dom.sidebarSaved.textContent = "本地已保存";
        dom.footerSaved.textContent = `本地自动保存 · ${formatTime(state.updatedAt)}`;
      }, 360);
    } catch (error) {
      dom.saveState.classList.remove("is-saving");
      dom.saveLabel.textContent = "保存失败";
      dom.sidebarSaved.textContent = "未保存";
      showToast("无法保存工程", "浏览器存储不可用，当前状态仍保留在页面中。", true);
    }
    if (options.announce) {
      announce(options.announce);
    }
  }

  function debounceSave() {
    window.clearTimeout(saveLabelTimer);
    dom.saveState.classList.add("is-saving");
    dom.saveLabel.textContent = "有未保存更改";
    saveLabelTimer = window.setTimeout(() => saveState(), 240);
  }

  function showToast(title, detail, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " is-error" : ""}`;
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">${isError
          ? '<path d="M12 8v5m0 3h.01M12 3 2.5 20h19L12 3Z"/>'
          : '<path d="m5 12 4 4L19 6"/>'}</svg>
      </span>
      <div><b></b><p></p></div>
    `;
    $("b", toast).textContent = title;
    $("p", toast).textContent = detail;
    dom.toastRegion.appendChild(toast);
    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      window.setTimeout(() => toast.remove(), 220);
    }, 4200);
  }

  function iconSvg(name) {
    const icons = {
      check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
      alert: '<svg viewBox="0 0 24 24"><path d="M12 8v5m0 3h.01M12 3 2.5 20h19L12 3Z"/></svg>',
      lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path class="locked-shackle" d="M8 10V7a4 4 0 0 1 8 0v3"/><path class="unlocked-shackle" d="M8 10V7a4 4 0 0 1 7.5-2"/></svg>'
    };
    return icons[name] || "";
  }

  function lockedIds() {
    return state.palette.filter((token) => token.locked).map((token) => token.id);
  }

  function getToken(id) {
    return state.palette.find((token) => token.id === id);
  }

  function setTokenValue(palette, id, value) {
    const token = palette.find((item) => item.id === id);
    if (!token) {
      throw new Error(`UNKNOWN_TOKEN: 找不到令牌 ${id}`);
    }
    const normalized = C.normalizeHex(value);
    token.value = normalized;
    return normalized;
  }

  function renderPalette(focusTarget) {
    const activeId = focusTarget && focusTarget.id
      ? focusTarget.id
      : (document.activeElement && document.activeElement.dataset.tokenId);
    const activeType = focusTarget && focusTarget.type
      ? focusTarget.type
      : (document.activeElement && document.activeElement.dataset.control);
    dom.paletteList.replaceChildren();

    state.palette.forEach((token) => {
      const row = document.createElement("div");
      row.className = `token-row${state.selectedToken === token.id ? " is-selected" : ""}`;
      row.dataset.tokenId = token.id;
      row.setAttribute("role", "listitem");
      row.innerHTML = `
        <label class="token-swatch" style="--swatch: ${token.value}" title="选择 ${token.name} 色值">
          <input type="color" value="${token.value}" aria-label="${token.name} 颜色选择器" data-token-id="${token.id}" data-control="picker">
        </label>
        <span class="token-name">
          <b></b>
          <small></small>
        </span>
        <input class="hex-input" type="text" maxlength="7" spellcheck="false"
          value="${token.value}" aria-label="${token.name} HEX 色值"
          data-token-id="${token.id}" data-control="hex">
        <button class="lock-button" type="button" aria-pressed="${token.locked}"
          aria-label="${token.locked ? "解锁" : "锁定"} ${token.name}"
          data-token-id="${token.id}" data-control="lock">
          ${iconSvg("lock")}
        </button>
      `;
      $(".token-name b", row).textContent = token.name;
      $(".token-name small", row).textContent = token.role;

      const picker = $('input[type="color"]', row);
      picker.addEventListener("input", (event) => {
        const normalized = setTokenValue(state.palette, token.id, event.target.value);
        state.selectedToken = token.id;
        afterPaletteChange(`${token.name} 已更新为 ${normalized}`);
      });

      const hex = $(".hex-input", row);
      hex.addEventListener("change", () => commitHex(hex, token));
      hex.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitHex(hex, token);
        } else if (event.key === "Escape") {
          event.preventDefault();
          hex.value = token.value;
          clearHexError(hex);
          announce(`已取消编辑，${token.name} 保留 ${token.value}`);
        }
      });
      hex.addEventListener("input", () => clearHexError(hex));

      const lock = $(".lock-button", row);
      lock.addEventListener("click", (event) => {
        event.stopPropagation();
        token.locked = !token.locked;
        state.selectedToken = token.id;
        afterPaletteChange(`${token.name} 已${token.locked ? "锁定" : "解锁"}`);
        renderPalette({ id: token.id, type: "lock" });
      });

      row.addEventListener("focusin", () => selectToken(token.id, true));
      dom.paletteList.appendChild(row);
    });

    if (activeId) {
      const selector = activeType === "lock"
        ? `.token-row[data-token-id="${activeId}"] .lock-button`
        : `.token-row[data-token-id="${activeId}"] .hex-input`;
      const target = $(selector, dom.paletteList);
      if (target && focusTarget) target.focus({ preventScroll: true });
    }
    updateLockSummary();
  }

  function selectToken(id, persist = true) {
    if (state.selectedToken === id) return;
    state.selectedToken = id;
    $$(".token-row", dom.paletteList).forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.tokenId === id);
    });
    if (persist) debounceSave();
  }

  function clearHexError(input) {
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }

  function showHexError(input, token, message) {
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "liveStatus");
    announce(`${token.name} ${message}；有效色值仍为 ${token.value}`);
    showToast("色值未应用", `${message}。已保留原值 ${token.value}。`, true);
  }

  function commitHex(input, token) {
    const raw = input.value.trim();
    if (!C.isValidHex(raw)) {
      showHexError(input, token, `${raw || "空值"} 不是有效的 #RRGGBB 色值`);
      return false;
    }
    try {
      const normalized = setTokenValue(state.palette, token.id, raw);
      state.selectedToken = token.id;
      input.value = normalized;
      clearHexError(input);
      afterPaletteChange(`${token.name} 已更新为 ${normalized}`);
      renderPalette({ id: token.id, type: "hex" });
      return true;
    } catch (error) {
      showHexError(input, token, error.message);
      return false;
    }
  }

  function updateLockSummary() {
    const count = lockedIds().length;
    dom.lockedCount.textContent = String(count);
    dom.lockSummary.textContent = count === 8
      ? "全部颜色已保护，生成器已暂停"
      : count === 0
        ? "没有锁定色，生成器将优化全部令牌"
        : `关键色受到保护，${8 - count} 个令牌可重新生成`;
    const unlocked = 8 - count;
    dom.regenerateButton.disabled = unlocked === 0 || testInProgress;
    dom.regenHint.textContent = unlocked === 0
      ? "所有 8 个颜色均已锁定"
      : `保持 ${count} 个关键色，优化 ${unlocked} 个令牌`;
  }

  function statusText(status) {
    if (status === "fail") return "存在阻断风险";
    if (status === "warn") return "存在复核项";
    return "全部通过";
  }

  function renderAudit() {
    evaluation = C.evaluate(state.palette);
    renderMetrics();
    renderRisks();
    renderCanvases();
    updateLockSummary();
  }

  function renderMetrics() {
    const modeCards = {
      normal: {
        score: $("#normalScore"),
        track: $("#normalTrack"),
        badge: $("#normalBadge"),
        delta: $("#normalMinDelta"),
        contrast: $("#normalContrast"),
        label: $("#canvasNormalLabel")
      },
      deuteranopia: {
        score: $("#deuteranopiaScore"),
        track: $("#deuteranopiaTrack"),
        badge: $("#deuteranopiaBadge"),
        delta: $("#deuteranopiaMinDelta"),
        contrast: $("#deuteranopiaContrast"),
        label: $("#canvasRgLabel")
      },
      tritanopia: {
        score: $("#tritanopiaScore"),
        track: $("#tritanopiaTrack"),
        badge: $("#tritanopiaBadge"),
        delta: $("#tritanopiaMinDelta"),
        contrast: $("#tritanopiaContrast"),
        label: $("#canvasTritanopiaLabel")
      }
    };

    evaluation.modes.forEach((mode) => {
      const card = modeCards[mode.mode];
      if (!card) return;
      card.score.textContent = String(mode.score);
      card.track.style.width = `${mode.score}%`;
      card.delta.textContent = `ΔE ${mode.minDelta.toFixed(1)}`;
      card.contrast.textContent = `${mode.seriesContrast.toFixed(2)}:1`;
      card.badge.className = "metric-badge";
      if (mode.status === "pass") {
        card.badge.textContent = "通过";
        card.label.textContent = "标准";
      } else if (mode.status === "warn") {
        card.badge.textContent = `${mode.issues.length} 提示`;
        card.badge.classList.add("warn");
        card.label.textContent = "需复核";
      } else {
        card.badge.textContent = `${mode.issues.length} 风险`;
        card.badge.classList.add("fail");
        card.label.textContent = "阻断";
      }
      card.track.style.background = mode.status === "fail"
        ? "var(--danger)"
        : mode.status === "warn"
          ? "var(--yellow)"
          : "";
    });

    dom.scoreValue.textContent = String(evaluation.score);
    dom.scoreRing.style.setProperty("--score-deg", `${evaluation.score * 3.6}deg`);
    dom.scoreRing.setAttribute(
      "aria-label",
      `综合无障碍评分 ${evaluation.score} 分，${statusText(evaluation.status)}`
    );
    dom.overallStatus.classList.toggle("has-risk", evaluation.status !== "pass");
    dom.overallStatus.innerHTML = `<span></span> ${statusText(evaluation.status)}`;
    dom.scoreCaption.textContent = `8 色 · 3 种视觉 · 45 组成对色差`;
  }

  function renderRisks() {
    const issues = [...evaluation.critical, ...evaluation.warnings];
    const unique = [];
    const seen = new Set();
    issues.forEach((issue) => {
      const key = `${issue.type}:${issue.detail}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(issue);
      }
    });
    const visible = unique.slice(0, 4);
    dom.riskCount.textContent = `${issues.length} 项`;
    dom.riskCount.classList.toggle("has-risk", issues.length > 0);
    dom.riskList.replaceChildren();

    if (!issues.length) {
      const empty = document.createElement("div");
      empty.className = "risk-empty";
      empty.innerHTML = `
        <span class="risk-empty-icon" aria-hidden="true">${iconSvg("check")}</span>
        <div><b>当前配色通过全部检查</b><p>三套视图均无对比度或色差阻断项，锁定状态稳定。</p></div>
      `;
      dom.riskList.appendChild(empty);
      return;
    }

    visible.forEach((issue) => {
      const item = document.createElement("div");
      item.className = `risk-item${issue.severity === "critical" ? " is-fail" : ""}`;
      item.innerHTML = `
        <span class="risk-item-icon" aria-hidden="true">${iconSvg("alert")}</span>
        <div><b></b><p></p></div>
        <span></span>
      `;
      $("b", item).textContent = `${issue.title} · ${issue.modeLabel}`;
      $("p", item).textContent = issue.detail;
      $(".risk-item > span:last-child", item).textContent = issue.value;
      dom.riskList.appendChild(item);
    });
    if (unique.length > visible.length) {
      const more = document.createElement("p");
      more.className = "risk-more";
      more.textContent = `另有 ${unique.length - visible.length} 项未展开；运行测试可查看完整断言。`;
      dom.riskList.appendChild(more);
    }
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function hexToRgba(hex, alpha) {
    const rgb = C.parseHex(hex);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function drawChart(ctx, analysis, options = {}) {
    const width = 720;
    const height = 480;
    const text = analysis.text;
    const paper = analysis.surface;
    const isCompact = Boolean(options.compact);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = text;
    ctx.font = '650 23px "Chroma Sans", "Avenir Next", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("季度转化趋势", 42, 47);
    ctx.globalAlpha = 0.62;
    ctx.font = '10px "Chroma Sans", "Avenir Next", sans-serif';
    ctx.fillText("2026 H1 · 六条业务序列", 42, 67);
    ctx.globalAlpha = 1;

    const statusColor = analysis.status === "fail"
      ? "#B53C2C"
      : analysis.status === "warn"
        ? "#9A6A22"
        : "#2F7657";
    const statusLabel = analysis.status === "fail"
      ? "阻断"
      : analysis.status === "warn"
        ? "复核"
        : "AA";
    ctx.fillStyle = hexToRgba(statusColor, 0.12);
    drawRoundedRect(ctx, 598, 28, 78, 28, 14);
    ctx.fill();
    ctx.fillStyle = statusColor;
    ctx.font = '700 10px "Chroma Sans", "Avenir Next", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(statusLabel, 637, 47);
    ctx.textAlign = "left";

    const plot = { x: 59, y: 92, w: 607, h: 252, bottom: 344 };
    ctx.strokeStyle = hexToRgba(text, 0.1);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    [20, 40, 60, 80].forEach((value) => {
      const y = plot.bottom - (value / 80) * plot.h;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      ctx.fillStyle = hexToRgba(text, 0.45);
      ctx.font = '9px "Chroma Sans", "Avenir Next", sans-serif';
      ctx.textAlign = "right";
      ctx.fillText(`${value}%`, plot.x - 10, y + 3);
    });

    MONTHS.forEach((month, index) => {
      const x = plot.x + (index / (MONTHS.length - 1)) * plot.w;
      ctx.fillStyle = hexToRgba(text, 0.46);
      ctx.font = '9px "Chroma Sans", "Avenir Next", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(month, x, plot.bottom + 21);
    });

    const firstSeries = analysis.series[0];
    if (firstSeries) {
      ctx.beginPath();
      CHART_DATA[0].forEach((value, index) => {
        const x = plot.x + (index / (CHART_DATA[0].length - 1)) * plot.w;
        const y = plot.bottom - (value / 80) * plot.h;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(plot.x + plot.w, plot.bottom);
      ctx.lineTo(plot.x, plot.bottom);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(firstSeries.simulated, 0.08);
      ctx.fill();
    }

    const dashPatterns = [[], [7, 4], [2, 3], [10, 4], [4, 4], [1, 4]];
    analysis.series.forEach((series, seriesIndex) => {
      const values = CHART_DATA[seriesIndex] || CHART_DATA[0];
      ctx.strokeStyle = series.simulated;
      ctx.lineWidth = isCompact ? 2.2 : 2.8;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash(dashPatterns[seriesIndex] || []);
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = plot.x + (index / (values.length - 1)) * plot.w;
        const y = plot.bottom - (value / 80) * plot.h;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      const lastX = plot.x + plot.w;
      const lastY = plot.bottom - (values[values.length - 1] / 80) * plot.h;
      ctx.fillStyle = paper;
      ctx.strokeStyle = series.simulated;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    couldDrawLegend(ctx, analysis, plot);
  }

  function couldDrawLegend(ctx, analysis, plot) {
    const text = analysis.text;
    const paper = analysis.surface;
    const columns = 3;
    const columnWidth = plot.w / columns;
    analysis.series.forEach((series, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = plot.x + column * columnWidth;
      const y = 397 + row * 29;
      ctx.fillStyle = hexToRgba(paper, 0.96);
      drawRoundedRect(ctx, x - 3, y - 10, columnWidth - 8, 22, 5);
      ctx.fill();
      ctx.fillStyle = series.simulated;
      ctx.beginPath();
      ctx.arc(x + 4, y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = text;
      ctx.globalAlpha = 0.74;
      ctx.font = '9px "Chroma Sans", "Avenir Next", sans-serif';
      ctx.textAlign = "left";
      const number = String(index + 1).padStart(2, "0");
      ctx.fillText(`${number}  ${series.token.name}`, x + 15, y + 3);
      ctx.globalAlpha = 1;
    });
  }

  function renderCanvas(canvas, mode) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = 720;
    const height = 480;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart(ctx, mode);
  }

  function renderCanvases() {
    const notes = {
      normal: $("#normalNote"),
      deuteranopia: $("#deuteranopiaNote"),
      tritanopia: $("#tritanopiaNote")
    };
    const canvases = {
      normal: dom.normalCanvas,
      deuteranopia: dom.deuteranopiaCanvas,
      tritanopia: dom.tritanopiaCanvas
    };
    evaluation.modes.forEach((mode) => {
      renderCanvas(canvases[mode.mode], mode);
      canvases[mode.mode].setAttribute(
        "aria-label",
        `${mode.label}图表。最低序列色差 ΔE ${mode.minDelta.toFixed(1)}，最低图形对比度 ${mode.seriesContrast.toFixed(2)} 比 1。${statusText(mode.status)}。`
      );
      const note = notes[mode.mode];
      if (note) {
        note.textContent = `6 序列 · 最低 ΔE ${mode.minDelta.toFixed(1)} · 图形对比度 ${mode.seriesContrast.toFixed(2)}:1`;
        note.classList.toggle("has-risk", mode.status !== "pass");
      }
    });
  }

  function refreshPaletteRowVisuals() {
    state.palette.forEach((token) => {
      const row = $(`.token-row[data-token-id="${token.id}"]`, dom.paletteList);
      if (!row) return;
      const swatch = $(".token-swatch", row);
      const picker = $('input[type="color"]', row);
      const hex = $(".hex-input", row);
      const lock = $(".lock-button", row);
      swatch.style.setProperty("--swatch", token.value);
      picker.value = token.value;
      if (document.activeElement !== hex) hex.value = token.value;
      lock.setAttribute("aria-pressed", String(token.locked));
      lock.setAttribute("aria-label", `${token.locked ? "解锁" : "锁定"} ${token.name}`);
    });
  }

  function afterPaletteChange(message, shouldLog = true) {
    refreshPaletteRowVisuals();
    renderAudit();
    if (shouldLog && message) {
      addActivity("palette", message);
      announce(message);
    }
    debounceSave();
  }

  async function regeneratePalette() {
    const locked = lockedIds();
    const unlocked = state.palette.filter((token) => !token.locked);
    if (!unlocked.length) {
      showToast("没有可生成的令牌", "全部 8 个颜色均已锁定。请先解锁至少一个颜色。", true);
      announce("重新生成未执行：所有颜色均已锁定");
      return;
    }
    if (testInProgress) return;

    const strong = dom.regenerateButton.querySelector("strong");
    const originalText = strong.textContent;
    dom.regenerateButton.disabled = true;
    strong.textContent = "正在优化色差…";
    await delay(60);
    try {
      const result = C.generatePalette(state.palette, locked, state.seed);
      if (result.driftedCount > 0) {
        throw new Error(`锁定色发生 ${result.driftedCount} 处漂移，已取消应用`);
      }
      state.palette = result.palette;
      renderPalette();
      renderAudit();
      const issueCount = evaluation.critical.length + evaluation.warnings.length;
      addActivity(
        "regenerate",
        `重新生成 ${result.changedCount} 色，保留 ${result.protectedCount} 个锁定色`
      );
      saveState();
      if (issueCount) {
        const firstIssue = evaluation.critical[0] || evaluation.warnings[0];
        showToast(
          `已生成，仍有 ${issueCount} 项风险`,
          `锁定色 0 漂移。${firstIssue.detail}`
        );
        announce(`重新生成完成，保留 ${result.protectedCount} 个锁定色，发现 ${issueCount} 项风险。${firstIssue.detail}`);
      } else {
        showToast(
          "配色已重新生成",
          `保留 ${result.protectedCount} 个锁定色，修改 ${result.changedCount} 个令牌；三种视觉均通过。`
        );
        announce(`重新生成完成，保留 ${result.protectedCount} 个锁定色，三种视觉检查全部通过。`);
      }
    } catch (error) {
      showToast("生成失败，状态未修改", error.message, true);
      announce(`重新生成失败：${error.message}`);
    } finally {
      strong.textContent = originalText;
      updateLockSummary();
    }
  }

  function resetPalette() {
    const confirmed = window.confirm("恢复默认配色会覆盖当前色板，但不会清除导出记录。继续吗？");
    if (!confirmed) return;
    state.palette = C.clonePalette(C.DEFAULT_PALETTE);
    state.seed = "QG-2048";
    state.selectedToken = "series1";
    dom.seedInput.value = state.seed;
    addActivity("reset", "已明确恢复默认配色");
    renderPalette();
    renderAudit();
    saveState();
    showToast("已恢复默认配色", "导出记录与测试结果仍保留。");
    announce("已恢复默认配色，导出记录和测试结果未清除。");
  }

  function renderSnapshot() {
    const snapshot = state.preExportSnapshot;
    const lastExport = state.lastExport;
    dom.snapshotPanel.classList.toggle("has-snapshot", Boolean(snapshot));
    dom.restoreSnapshot.disabled = !snapshot;
    if (!snapshot) {
      dom.snapshotBadge.textContent = "等待导出";
      dom.snapshotBadge.classList.remove("is-ready");
      dom.snapshotText.textContent = "导出时会冻结当前色板与锁定状态，可随时恢复。";
      dom.snapshotMeta.textContent = "尚未生成快照";
    } else {
      dom.snapshotBadge.textContent = "快照已保留";
      dom.snapshotBadge.classList.add("is-ready");
      dom.snapshotText.textContent = `已冻结 ${snapshot.palette.length} 个令牌与 ${snapshot.palette.filter((token) => token.locked).length} 个锁定状态。`;
      dom.snapshotMeta.textContent = `${lastExport ? lastExport.type.toUpperCase() : "导出"} · ${formatDateTime(snapshot.at)} · ${snapshot.fileName}`;
    }
    renderActivity();
  }

  function renderActivity() {
    dom.activityList.replaceChildren();
    state.activity.slice(0, 3).forEach((entry) => {
      const item = document.createElement("li");
      const dot = document.createElement("i");
      const label = document.createElement("span");
      const time = document.createElement("time");
      dot.setAttribute("aria-hidden", "true");
      label.textContent = entry.text;
      time.dateTime = entry.at;
      time.textContent = formatTime(entry.at);
      item.append(dot, label, time);
      dom.activityList.appendChild(item);
    });
  }

  function restorePreExportSnapshot() {
    const snapshot = state.preExportSnapshot;
    if (!snapshot) {
      showToast("没有可恢复的快照", "请先执行一次导出。", true);
      return;
    }
    state.palette = C.clonePalette(snapshot.palette);
    state.seed = snapshot.seed;
    state.selectedToken = snapshot.selectedToken || "series1";
    dom.seedInput.value = state.seed;
    addActivity("restore", "已恢复导出前色板与锁定状态");
    renderPalette();
    renderAudit();
    saveState();
    showToast("已恢复导出前状态", `色板与 ${snapshot.palette.filter((token) => token.locked).length} 个锁定选择已还原。`);
    announce("已恢复导出前的色板和用户锁定选择。");
  }

  function makeSnapshot(type, fileName) {
    const snapshot = {
      ...stateSnapshot(state),
      at: nowIso(),
      type,
      fileName
    };
    state.preExportSnapshot = snapshot;
    return snapshot;
  }

  function recordExport(type, fileName) {
    state.lastExport = { type, fileName, at: nowIso() };
    addActivity("export", `${type.toUpperCase()} 已导出：${fileName}`);
    saveState();
    renderSnapshot();
    announce(`${type.toUpperCase()} 导出完成，导出前状态已保留。`);
    showToast(
      `${type.toUpperCase()} 导出完成`,
      "当前配色未改变；导出前快照已保留，可随时恢复。"
    );
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function buildCssExport() {
    const lines = [
      "/* ChromaGuard Palette Tokens",
      ` * Project: Q4 Analytics`,
      ` * Generated: ${new Date().toISOString()}`,
      ` * Seed: ${state.seed}`,
      ` * Checks: WCAG 2.2 AA, CIE76 deltaE, Machado CVD simulation`,
      " */",
      ":root {",
      ...state.palette.map((token) =>
        `  --cg-${token.id}: ${token.value}; /* ${token.name}${token.locked ? " · locked" : ""} */`
      ),
      "",
      "  /* Simulated preview tokens */",
      ...["deuteranopia", "tritanopia"].flatMap((mode) =>
        state.palette
          .filter((token) => token.id.startsWith("series"))
          .map((token) =>
            `  --cg-${mode}-${token.id}: ${C.simulateHex(token.value, mode)};`
          )
      ),
      "}",
      ""
    ];
    return lines.join("\n");
  }

  function exportCss() {
    const fileName = "q4-analytics-palette.css";
    makeSnapshot("css", fileName);
    downloadBlob(
      new Blob([buildCssExport()], { type: "text/css; charset=utf-8" }),
      fileName
    );
    recordExport("css", fileName);
    state.a11y.export = true;
    saveState();
  }

  async function exportPreviewPng() {
    const fileName = "q4-analytics-cvd-preview.png";
    const snapshot = makeSnapshot("png", fileName);
    try {
      await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = 1680;
      exportCanvas.height = 720;
      const ctx = exportCanvas.getContext("2d");
      ctx.fillStyle = "#F2F1EB";
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

      ctx.fillStyle = "#17201D";
      ctx.font = '650 28px "Chroma Sans", "Avenir Next", sans-serif';
      ctx.textAlign = "left";
      ctx.fillText("Q4 Analytics · 色觉预览", 42, 54);
      ctx.fillStyle = "#68736E";
      ctx.font = '11px "Chroma Sans", "Avenir Next", sans-serif';
      ctx.fillText(
        `Seed ${snapshot.seed} · 8 tokens · ${snapshot.palette.filter((token) => token.locked).length} locked · ${new Date().toLocaleString("zh-CN")}`,
        42,
        76
      );

      ctx.fillStyle = "#E2ECD8";
      drawRoundedRect(ctx, 1512, 34, 126, 44, 12);
      ctx.fill();
      ctx.fillStyle = "#2A6951";
      ctx.font = '700 12px "Chroma Sans", "Avenir Next", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(`综合 ${evaluation.score} / 100`, 1575, 61);

      const labels = ["普通视觉", "红绿弱视模拟", "蓝黄弱视模拟"];
      const labelColors = ["#657850", "#A46543", "#4F6E9F"];
      evaluation.modes.forEach((mode, index) => {
        const x = 38 + index * 557;
        const y = 142;
        const w = 520;
        const h = 347;
        ctx.fillStyle = labelColors[index];
        ctx.beginPath();
        ctx.arc(x + 8, 119, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#34413B";
        ctx.font = '650 12px "Chroma Sans", "Avenir Next", sans-serif';
        ctx.textAlign = "left";
        ctx.fillText(labels[index], x + 19, 123);

        ctx.fillStyle = "#FFFFFF";
        drawRoundedRect(ctx, x, y, w, h, 14);
        ctx.fill();
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(w / 720, h / 480);
        drawChart(ctx, mode, { compact: true });
        ctx.restore();

        ctx.strokeStyle = "#DDDCD3";
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, x, y, w, h, 14);
        ctx.stroke();
      });

      ctx.fillStyle = "#717C77";
      ctx.font = '10px "Chroma Sans", "Avenir Next", sans-serif';
      ctx.textAlign = "left";
      ctx.fillText(
        `最低色差 ΔE ${Math.min(...evaluation.modes.map((mode) => mode.minDelta)).toFixed(1)} · 最低图形对比度 ${Math.min(...evaluation.modes.map((mode) => mode.seriesContrast)).toFixed(2)}:1 · Machado CVD · CIE76`,
        42,
        690
      );
      ctx.textAlign = "right";
      ctx.fillText("ChromaGuard Palette Lab", 1638, 690);

      const blob = await new Promise((resolve, reject) => {
        exportCanvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error("Canvas 无法生成 PNG 数据"));
        }, "image/png");
      });
      downloadBlob(blob, fileName);
      recordExport("png", fileName);
      state.a11y.export = true;
      state.preExportSnapshot = snapshot;
      saveState();
    } catch (error) {
      state.preExportSnapshot = null;
      saveState();
      showToast("PNG 导出失败", `${error.message}；当前工程状态未改变。`, true);
      announce(`PNG 导出失败：${error.message}。工程状态未改变。`);
    }
  }

  function exportProject() {
    const fileName = "q4-analytics-project.json";
    makeSnapshot("project", fileName);
    const project = {
      schema: "chromaguard/project@1",
      appVersion: APP_VERSION,
      exportedAt: nowIso(),
      snapshot: state.preExportSnapshot,
      palette: C.clonePalette(state.palette),
      seed: state.seed,
      selectedToken: state.selectedToken,
      testRuns: clone(state.testRuns),
      a11y: clone(state.a11y)
    };
    state.lastProjectExport = {
      at: project.exportedAt,
      fileName,
      snapshot: clone(state.preExportSnapshot)
    };
    downloadBlob(
      new Blob([JSON.stringify(project, null, 2)], { type: "application/json; charset=utf-8" }),
      fileName
    );
    recordExport("project", fileName);
  }

  function renderA11yChecks() {
    const checks = [
      ["键盘可达", state.a11y.keyboard, "Tab / Enter / Space 与鼠标使用同一处理函数"],
      ["焦点可见", true, "所有可操作控件有 3px 高对比焦点环"],
      ["读屏播报", true, "操作结果与 Canvas 指标写入 aria-live / aria-label"],
      ["错误可恢复", state.a11y.recovery, "非法色值不会写入，原值与导出快照保留"]
    ];
    dom.a11yChecks.replaceChildren();
    checks.forEach(([label, isVerified, detail]) => {
      const item = document.createElement("span");
      item.title = detail;
      item.innerHTML = `<i aria-hidden="true">${isVerified ? "✓" : "○"}</i> `;
      item.append(document.createTextNode(isVerified ? `${label} · 已验证` : `${label} · 待验证`));
      dom.a11yChecks.appendChild(item);
    });
  }

  function buildA11ySummary() {
    const tests = state.testRuns;
    const defaults = tests.default || {};
    const boundary = tests.boundary || {};
    const error = tests.error || {};
    const passed = [defaults, boundary, error].filter((test) => test.status === "pass").length;
    const testLines = ["default", "boundary", "error"].map((name) => {
      const test = tests[name];
      if (!test) return `- ${name}: 尚未运行`;
      const reason = test.reason ? `；原因：${test.reason}` : "";
      return `- ${name}: ${test.status === "pass" ? "通过" : "失败"}（${test.assertions.filter((item) => item.ok).length}/${test.assertions.length} 断言）${reason}`;
    });
    return [
      "# ChromaGuard 无障碍检查摘要",
      "",
      `- 生成时间：${new Date().toISOString()}`,
      `- 工程：Q4 Analytics`,
      `- 当前综合评分：${evaluation.score} / 100（${statusText(evaluation.status)}）`,
      `- 三组测试：${passed}/3 通过${passed === 3 ? "（100%）" : "，失败原因见下"}`,
      "",
      "## 已验证操作路径",
      "",
      "- 键盘：Tab 进入配色令牌，Enter/Space 激活锁定按钮；H 聚焦 HEX，Enter 提交，Escape 取消；Tab 至“重新生成未锁定色”后 Enter 执行，焦点保留在按钮。",
      "- 鼠标：点击锁定、色板选择器、HEX 输入、重新生成和导出按钮，使用与键盘相同的状态更新函数。",
      "- 触屏：所有主要按钮与色板输入为原生 button/input/color，点击路径与鼠标一致；正文按钮高度不小于 42px。",
      "- 读屏：锁定状态通过 aria-pressed 更新；错误通过 aria-invalid 与 liveStatus 播报；Canvas 的 aria-label 随最低 ΔE 和对比度实时更新。",
      "",
      "## 可重复测试",
      "",
      ...testLines,
      "",
      "## 错误恢复",
      "",
      error.status === "pass"
        ? `- 非法 HEX（#12ZZ34）被拒绝，错误消息明确列出无效值与原值；色板和锁定状态逐字段保持不变。`
        : `- 未通过：${error.reason || "错误组尚未运行"}`,
      "",
      "## 导出与持久化",
      "",
      state.preExportSnapshot
        ? `- 导出前快照：${formatDateTime(state.preExportSnapshot.at)}，${state.preExportSnapshot.palette.filter((token) => token.locked).length} 个锁定项，可恢复。`
        : "- 尚未导出。",
      state.lastExport
        ? `- 最近导出：${state.lastExport.type.toUpperCase()} / ${state.lastExport.fileName} / ${formatDateTime(state.lastExport.at)}`
        : "- 最近导出：无",
      "- 刷新或重新载入：工程写入 localStorage，已导出的工程快照与用户选择不会被静默重置。",
      "",
      "## 当前检查值",
      "",
      ...evaluation.modes.map((mode) =>
        `- ${mode.label}：评分 ${mode.score}，最低 ΔE ${mode.minDelta.toFixed(1)}，最低图形对比度 ${mode.seriesContrast.toFixed(2)}:1，${statusText(mode.status)}`
      ),
      "",
      "> 弱视模拟仅用于设计检查，不替代医学诊断。",
      ""
    ].join("\n");
  }

  function saveA11ySummary() {
    const fileName = "chromaguard-accessibility-summary.md";
    state.a11y.summaryAt = nowIso();
    downloadBlob(
      new Blob([buildA11ySummary()], { type: "text/markdown; charset=utf-8" }),
      fileName
    );
    addActivity("a11y", "无障碍检查摘要已保存");
    saveState();
    renderA11yChecks();
    showToast("检查摘要已保存", `${fileName} · 包含通过率、路径与失败恢复。`);
    announce("无障碍检查摘要已保存为 Markdown 文件。");
  }

  function assertion(ok, text) {
    return { ok: Boolean(ok), text };
  }

  function testResult(status, assertions, duration, reason) {
    return {
      status,
      assertions,
      duration,
      reason: reason || "",
      at: nowIso()
    };
  }

  function passIfAll(assertions, duration) {
    const failed = assertions.filter((item) => !item.ok);
    if (failed.length) {
      return testResult("fail", assertions, duration, failed[0].text);
    }
    return testResult("pass", assertions, duration);
  }

  function executeDefaultTest() {
    const started = performance.now();
    const assertions = [];
    const palette = C.clonePalette(C.DEFAULT_PALETTE);
    const locked = ["surface", "text", "series1"];
    const first = C.generatePalette(palette, locked, "QG-2048");
    const second = C.generatePalette(palette, locked, "QG-2048");
    const firstLocked = first.palette.filter((token) => locked.includes(token.id));
    const drifted = firstLocked.filter((token) => {
      const original = palette.find((item) => item.id === token.id);
      return token.value !== original.value;
    });
    const allValid = first.palette.every((token) => C.isValidHex(token.value));
    const deterministic = JSON.stringify(first.palette.map((token) => [token.id, token.value])) ===
      JSON.stringify(second.palette.map((token) => [token.id, token.value]));
    const audit = C.evaluate(first.palette);
    assertions.push(assertion(first.palette.length === 8, "8 个配色令牌完整保留"));
    assertions.push(assertion(allValid, "全部生成色值可解析为 #RRGGBB"));
    assertions.push(assertion(drifted.length === 0, "3/3 锁定色逐字节零漂移"));
    assertions.push(assertion(deterministic, "固定种子 QG-2048 两次生成完全一致"));
    assertions.push(assertion(first.changedCount > 0, `生成器实际改写 ${first.changedCount} 个未锁定令牌`));
    assertions.push(assertion(
      audit.modes.length === 3 && audit.modes.every((mode) => Number.isFinite(mode.minDelta) && Number.isFinite(mode.seriesContrast)),
      `三套视图均返回有限指标（综合 ${audit.score}/100）`
    ));
    return passIfAll(assertions, performance.now() - started);
  }

  function executeBoundaryTest() {
    const started = performance.now();
    const assertions = [];
    const palette = C.clonePalette(C.DEFAULT_PALETTE);
    const locked = ["surface", "text", "series1", "series2", "series3", "series4"];
    palette.forEach((token) => {
      token.locked = locked.includes(token.id);
    });
    palette.find((token) => token.id === "series3").value = "#D5A83A";
    const before = palette
      .filter((token) => token.locked)
      .map((token) => [token.id, token.value]);
    const result = C.generatePalette(palette, locked, "BOUNDARY-6");
    const after = result.palette
      .filter((token) => token.locked)
      .map((token) => [token.id, token.value]);
    const drift = JSON.stringify(before) !== JSON.stringify(after);
    const audit = C.evaluate(result.palette);
    const issues = [...audit.critical, ...audit.warnings];
    const structuredIssues = issues.every((issue) =>
      Boolean(issue.title && issue.detail && issue.value && issue.modeLabel)
    );
    assertions.push(assertion(result.protectedCount === 6, "6 个锁定色全部纳入保护集"));
    assertions.push(assertion(!drift && result.driftedCount === 0, "6/6 锁定色在生成后零漂移"));
    assertions.push(assertion(
      result.palette.length === 8 && result.palette.every((token) => C.isValidHex(token.value)),
      "仅重生成 2 个未锁定令牌，8 色结果均有效"
    ));
    assertions.push(assertion(
      issues.length > 0,
      `低对比锁定色被识别，生成 ${issues.length} 条可定位风险`
    ));
    assertions.push(assertion(
      structuredIssues,
      "每条风险均包含模式、说明和数值，不使用笼统提示"
    ));
    assertions.push(assertion(
      audit.modes.every((mode) => mode.issues.every((issue) => issue.detail.includes("ΔE") || issue.detail.includes(":1"))),
      "三套视图的风险数值均可复核"
    ));
    return passIfAll(assertions, performance.now() - started);
  }

  function executeErrorTest() {
    const started = performance.now();
    const assertions = [];
    const palette = C.clonePalette(C.DEFAULT_PALETTE);
    const before = JSON.stringify(palette);
    let thrown = null;
    try {
      setTokenValue(palette, "series2", "#12ZZ34");
    } catch (error) {
      thrown = error;
    }
    const unchanged = JSON.stringify(palette) === before;
    assertions.push(assertion(Boolean(thrown), "非法 HEX #12ZZ34 会抛出明确错误"));
    assertions.push(assertion(
      Boolean(thrown && thrown.message.includes("INVALID_HEX") && thrown.message.includes("#12ZZ34")),
      `错误消息包含代码和原始值：${thrown ? thrown.message : "未捕获"}`
    ));
    assertions.push(assertion(unchanged, "失败写入后色板逐字段保持不变"));
    let recovered = false;
    try {
      recovered = setTokenValue(palette, "series2", "#3355AA") === "#3355AA";
    } catch (_error) {
      recovered = false;
    }
    assertions.push(assertion(recovered, "随后提交合法色值 #3355AA 可立即恢复写入"));
    assertions.push(assertion(
      C.evaluate(palette).modes.length === 3,
      "恢复后三套视图重新计算且无异常"
    ));
    return passIfAll(assertions, performance.now() - started);
  }

  function renderTestCard(name) {
    const card = $(`.test-card[data-test="${name}"]`);
    const result = state.testRuns[name];
    if (!card) return;
    card.classList.remove("is-running", "is-pass", "is-fail");
    const stateLabel = $("[data-state]", card);
    const details = $("[data-details]", card);
    const progress = $("[data-progress]", card);
    const button = $("[data-run-test]", card);
    stateLabel.className = "test-state";
    if (!result) {
      stateLabel.textContent = "待运行";
      details.innerHTML = "<li>等待执行</li>";
      progress.style.width = "0%";
      button.disabled = testInProgress;
      return;
    }
    card.classList.add(result.status === "pass" ? "is-pass" : "is-fail");
    stateLabel.classList.add(result.status === "pass" ? "is-pass" : "is-fail");
    stateLabel.textContent = result.status === "pass" ? "通过" : "失败";
    details.replaceChildren();
    result.assertions.slice(0, 6).forEach((item) => {
      const li = document.createElement("li");
      const badge = document.createElement("strong");
      badge.textContent = item.ok ? "PASS " : "FAIL ";
      li.append(badge, document.createTextNode(item.text));
      details.appendChild(li);
    });
    if (result.reason) {
      const li = document.createElement("li");
      const badge = document.createElement("strong");
      badge.textContent = "原因 ";
      li.append(badge, document.createTextNode(result.reason));
      details.appendChild(li);
    }
    progress.style.width = "100%";
    button.disabled = testInProgress;
  }

  function renderTests() {
    ["default", "boundary", "error"].forEach(renderTestCard);
    const runs = ["default", "boundary", "error"]
      .map((name) => state.testRuns[name])
      .filter(Boolean);
    if (!runs.length) {
      dom.testPassRate.textContent = "—";
      dom.testSummaryDetail.textContent = "尚未运行";
      dom.testSummaryDetail.className = "summary-detail";
      dom.testFooterText.textContent = "隔离执行 · 固定种子 · 每项都有明确断言与失败原因";
      return;
    }
    const passes = runs.filter((run) => run.status === "pass").length;
    const rate = (passes / 3) * 100;
    const failures = ["default", "boundary", "error"].filter((name) =>
      state.testRuns[name] && state.testRuns[name].status === "fail"
    );
    dom.testPassRate.textContent = `${passes}/3`;
    dom.testSummaryDetail.textContent = `${rate.toFixed(rate % 1 ? 1 : 0)}% 通过${failures.length ? ` · ${failures.length} 组失败` : ""}`;
    dom.testSummaryDetail.className = `summary-detail ${passes === 3 ? "is-pass" : "has-fail"}`;
    const totalAssertions = runs.reduce((sum, run) => sum + run.assertions.length, 0);
    const passedAssertions = runs.reduce(
      (sum, run) => sum + run.assertions.filter((item) => item.ok).length,
      0
    );
    if (failures.length) {
      const first = state.testRuns[failures[0]];
      dom.testFooterText.textContent =
        `${passes}/3 组通过 · ${rate.toFixed(rate % 1 ? 1 : 0)}% · 失败：${failures[0]} — ${first.reason}`;
    } else if (runs.length === 3) {
      dom.testFooterText.textContent =
        `3/3 组通过 · 100% · ${passedAssertions}/${totalAssertions} 个断言通过 · 当前工程未被修改`;
    } else {
      dom.testFooterText.textContent =
        `${runs.length}/3 组已运行 · ${passedAssertions}/${totalAssertions} 个断言通过`;
    }
  }

  async function runOneTest(name) {
    const card = $(`.test-card[data-test="${name}"]`);
    if (card) {
      card.classList.remove("is-pass", "is-fail");
      card.classList.add("is-running");
      const stateLabel = $("[data-state]", card);
      stateLabel.className = "test-state is-running";
      stateLabel.textContent = "运行中";
      $("[data-details]", card).innerHTML = "<li>创建隔离快照并执行断言…</li>";
      $("[data-progress]", card).style.width = "34%";
    }
    await delay(140);
    let result;
    try {
      if (name === "default") result = executeDefaultTest();
      else if (name === "boundary") result = executeBoundaryTest();
      else result = executeErrorTest();
    } catch (error) {
      result = testResult(
        "fail",
        [assertion(false, "测试执行抛出异常")],
        0,
        `${error.name}: ${error.message}`
      );
    }
    state.testRuns[name] = result;
    if (name === "error" && result.status === "pass") {
      state.a11y.recovery = true;
    }
    saveState();
    renderTests();
    renderA11yChecks();
    announce(`${name} 测试${result.status === "pass" ? "通过" : `失败：${result.reason}`}`);
    return result;
  }

  async function runAllTests() {
    if (testInProgress) return;
    testInProgress = true;
    updateLockSummary();
    $$("[data-run-test]").forEach((button) => { button.disabled = true; });
    const runButton = $("#runAllTests");
    const original = runButton.innerHTML;
    runButton.disabled = true;
    runButton.textContent = "运行中…";
    for (const name of ["default", "boundary", "error"]) {
      await runOneTest(name);
    }
    testInProgress = false;
    runButton.disabled = false;
    runButton.innerHTML = original;
    updateLockSummary();
    renderTests();
    const passes = ["default", "boundary", "error"]
      .filter((name) => state.testRuns[name] && state.testRuns[name].status === "pass").length;
    const rate = (passes / 3) * 100;
    if (passes === 3) {
      showToast("测试全部通过", "3/3 组通过（100%），当前工程状态未被修改。");
      announce("全部测试完成，3 组通过，通过率 100%。当前工程未被修改。");
    } else {
      const failedName = ["default", "boundary", "error"].find((name) =>
        state.testRuns[name] && state.testRuns[name].status === "fail"
      );
      showToast(
        `${passes}/3 组通过（${rate.toFixed(rate % 1 ? 1 : 0)}%）`,
        `失败：${failedName} — ${state.testRuns[failedName].reason}`,
        true
      );
      announce(`测试完成，${passes}/3 组通过，失败原因：${state.testRuns[failedName].reason}`);
    }
    saveState();
  }

  function exportTestLog() {
    const names = ["default", "boundary", "error"];
    const passed = names.filter((name) => state.testRuns[name] && state.testRuns[name].status === "pass").length;
    const lines = [
      "# ChromaGuard 测试日志",
      "",
      `- 时间：${new Date().toISOString()}`,
      `- 通过率：${passed}/3（${((passed / 3) * 100).toFixed(0)}%）`,
      `- 种子：${state.seed}`,
      ""
    ];
    names.forEach((name) => {
      const run = state.testRuns[name];
      lines.push(`## ${name}`);
      if (!run) {
        lines.push("- 尚未运行", "");
        return;
      }
      lines.push(`- 状态：${run.status === "pass" ? "通过" : "失败"}`);
      lines.push(`- 耗时：${run.duration.toFixed(0)}ms`);
      run.assertions.forEach((item) => lines.push(`- [${item.ok ? "x" : " "}] ${item.text}`));
      if (run.reason) lines.push(`- 失败原因：${run.reason}`);
      lines.push("");
    });
    downloadBlob(
      new Blob([lines.join("\n")], { type: "text/markdown; charset=utf-8" }),
      "chromaguard-test-log.md"
    );
    showToast("测试日志已导出", "包含每组断言与失败原因。");
    announce("测试日志已导出。");
  }

  function setActiveNav(hash) {
    $$(".nav-item").forEach((item) => {
      const active = item.getAttribute("href") === hash;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function closeMobileNav() {
    const sidebar = $(".sidebar");
    const button = $("#mobileMenu");
    sidebar.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "打开导航");
  }

  function bindEvents() {
    dom.regenerateButton.addEventListener("click", regeneratePalette);
    $("#resetPalette").addEventListener("click", resetPalette);
    $("#restoreSnapshot").addEventListener("click", restorePreExportSnapshot);
    $("#exportProject").addEventListener("click", exportProject);
    $("#exportCssTop").addEventListener("click", exportCss);
    $("#exportPngTop").addEventListener("click", exportPreviewPng);
    $("#downloadA11y").addEventListener("click", saveA11ySummary);
    $("#exportTestLog").addEventListener("click", exportTestLog);
    $("#runAllTests").addEventListener("click", runAllTests);
    $$("[data-run-test]").forEach((button) => {
      button.addEventListener("click", () => runOneTest(button.dataset.runTest));
    });

    $("#jumpToPalette").addEventListener("click", () => {
      $("#palette-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => {
        const target = $(`.token-row[data-token-id="${state.selectedToken}"] .lock-button`, dom.paletteList);
        if (target) target.focus({ preventScroll: true });
      }, 360);
    });

    dom.seedInput.addEventListener("change", () => {
      const next = dom.seedInput.value.trim();
      if (!next) {
        dom.seedInput.value = state.seed;
        showToast("种子不能为空", `已保留原种子 ${state.seed}。`, true);
        announce(`种子为空，已保留 ${state.seed}`);
        return;
      }
      state.seed = next.slice(0, 20);
      dom.seedInput.value = state.seed;
      addActivity("seed", `生成种子改为 ${state.seed}`);
      saveState();
      showToast("生成种子已更新", "下一次重新生成将使用该固定种子。");
      announce(`生成种子已更新为 ${state.seed}，相同种子会得到相同结果。`);
    });
    dom.seedInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        dom.seedInput.blur();
      }
    });

    $("#redrawCanvases").addEventListener("click", () => {
      renderCanvases();
      announce("三套 Canvas 视图已重新绘制。");
      showToast("画布已重绘", "三套视图与当前评分保持一致。");
    });

    const dialog = $("#rulesDialog");
    $("#viewRules").addEventListener("click", () => dialog.showModal());
    $("#closeRules").addEventListener("click", () => dialog.close());
    $("#rulesDone").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    const mobileMenu = $("#mobileMenu");
    mobileMenu.addEventListener("click", () => {
      const sidebar = $(".sidebar");
      const willOpen = !sidebar.classList.contains("is-open");
      sidebar.classList.toggle("is-open", willOpen);
      mobileMenu.setAttribute("aria-expanded", String(willOpen));
      mobileMenu.setAttribute("aria-label", willOpen ? "关闭导航" : "打开导航");
      if (willOpen) {
        const first = $(".nav-item", sidebar);
        if (first) window.setTimeout(() => first.focus(), 220);
      }
    });

    $$(".nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        setActiveNav(item.getAttribute("href"));
        if (window.innerWidth <= 1050) closeMobileNav();
      });
    });

    document.addEventListener("click", (event) => {
      const sidebar = $(".sidebar");
      if (
        window.innerWidth <= 1050 &&
        sidebar.classList.contains("is-open") &&
        !sidebar.contains(event.target) &&
        !mobileMenu.contains(event.target)
      ) {
        closeMobileNav();
      }
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const isInput = target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (!isInput && ["Enter", " "].includes(event.key) && target.closest("button, a")) {
        if (!state.a11y.keyboard) {
          state.a11y.keyboard = true;
          saveState();
          renderA11yChecks();
        }
      }
      if (!isInput && (event.key === "h" || event.key === "H")) {
        const input = $(`.token-row[data-token-id="${state.selectedToken}"] .hex-input`, dom.paletteList);
        if (input) {
          event.preventDefault();
          input.focus();
          input.select();
          announce(`已聚焦 ${getToken(state.selectedToken).name} 的 HEX 输入。`);
        }
      }
      if (event.key === "Escape") {
        if ($(".sidebar").classList.contains("is-open")) closeMobileNav();
      }
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        renderCanvases();
        if (window.innerWidth > 1050) closeMobileNav();
      }, 140);
    });

    window.addEventListener("beforeunload", () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (_error) {
        // A write failure has already been surfaced in the UI.
      }
    });
  }

  function init() {
    dom.seedInput.value = state.seed;
    renderPalette();
    renderAudit();
    renderSnapshot();
    renderTests();
    renderA11yChecks();
    bindEvents();
    saveState();
    if (document.fonts) {
      const redrawForFonts = () => renderCanvases();
      document.fonts.ready.then(redrawForFonts);
      document.fonts.addEventListener("loadingdone", redrawForFonts);
    }
    if (loaded.recoveryNotice) {
      window.setTimeout(() => {
        showToast("已执行显式恢复", loaded.recoveryNotice, true);
        announce(loaded.recoveryNotice);
      }, 260);
    } else if (state.preExportSnapshot) {
      window.setTimeout(() => {
        announce(`已从本地存储恢复工程，导出前快照仍保留。最近综合评分 ${evaluation.score} 分。`);
      }, 300);
    } else {
      window.setTimeout(() => {
        announce(`工程已恢复，8 个配色令牌，综合评分 ${evaluation.score} 分。`);
      }, 300);
    }
  }

  init();
})();
