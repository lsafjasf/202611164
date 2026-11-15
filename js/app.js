/* UI 控制器：调查阶段严格隔离真实参数，提交后才生成结算对照。 */
(function () {
  "use strict";
  const E = window.CaseEngine;
  const V = window.Visuals;
  const FFT_SIZE = 2048;

  const state = {
    caseData: null,
    audio: null,
    phase: "idle",
    positionIndex: 0,
    elapsedMs: 0,
    startedAt: 0,
    timerHandle: null,
    rafHandle: null,
    recordings: { A: null, B: null },
    activeRecSlot: null,
    answers: {},
    spectrumMode: "live",
    submitted: false
  };

  const $ = function (id) { return document.getElementById(id); };

  function setPhase(phase, label) {
    state.phase = phase;
    $("phaseBadge").textContent = label;
  }

  function tickTimer() {
    const total = state.elapsedMs + (performance.now() - state.startedAt);
    $("timer").textContent = E.fmtTime(total / 1000);
  }

  function startTimer() {
    state.startedAt = performance.now();
    state.timerHandle = setInterval(tickTimer, 250);
  }

  function freezeTimer() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
    state.elapsedMs += performance.now() - state.startedAt;
  }

  function investigationSeconds() {
    const extra = state.timerHandle ? performance.now() - state.startedAt : 0;
    return (state.elapsedMs + extra) / 1000;
  }

  function renderPositions() {
    const grid = $("positionGrid");
    grid.innerHTML = "";
    E.POSITIONS.forEach(function (pos, i) {
      const btn = document.createElement("button");
      btn.className = "position-btn" + (i === state.positionIndex ? " selected" : "");
      btn.textContent = pos.label;
      btn.addEventListener("click", function () {
        state.positionIndex = i;
        if (state.audio) state.audio.applyPosition(i);
        renderPositions();
      });
      grid.appendChild(btn);
    });
  }

  function renderDeductionForm() {
    const root = $("deductionForm");
    root.innerHTML = "";
    state.answers = {};
    E.PASSAGES.forEach(function (name, pi) {
      state.answers[pi] = {};
      const card = document.createElement("div");
      card.className = "deduct-card";
      let html = "<h3>" + name + "</h3>";
      E.DIMENSIONS.forEach(function (dim) {
        html += "<label>" + dim.label + "<select data-p='" + pi + "' data-k='" + dim.key + "'>";
        html += "<option value=''>— 请选择 —</option>";
        dim.options.forEach(function (opt) {
          html += "<option value='" + opt.id + "'>" + opt.label + "</option>";
        });
        html += "</select></label>";
      });
      card.innerHTML = html;
      root.appendChild(card);
    });
    root.querySelectorAll("select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        state.answers[sel.dataset.p][sel.dataset.k] = sel.value;
      });
    });
  }

  function drawLiveSpectrum() {
    if (state.spectrumMode !== "live" || !state.audio || !state.audio.analyser) {
      state.rafHandle = requestAnimationFrame(drawLiveSpectrum);
      return;
    }
    const mag = state.audio.getSpectrum(FFT_SIZE);
    V.drawSpectrum($("spectrumCanvas"), mag, state.audio.ctx.sampleRate, FFT_SIZE);
    state.rafHandle = requestAnimationFrame(drawLiveSpectrum);
  }

  function setControlsForPhase() {
    const running = state.phase === "running";
    $("btnStart").disabled = running;
    $("btnStart").textContent = state.phase === "paused" ? "继续调查" : "开始调查";
    $("btnPause").disabled = !running;
    $("btnReopen").disabled = state.phase === "idle";
    $("btnSubmit").disabled = state.phase === "idle" || state.submitted;
    ["btnRecA", "btnRecB"].forEach(function (id) {
      if (!running && state.activeRecSlot) $(id).disabled = true;
      else $(id).disabled = !running || state.submitted;
    });
    $("btnRecA").textContent = state.activeRecSlot === "A" ? "停止 A" : "录制 A";
    $("btnRecB").textContent = state.activeRecSlot === "B" ? "停止 B" : "录制 B";
  }

  function loadCase(seed, isReopen) {
    state.caseData = E.generateCase(seed);
    if (state.audio) { state.audio.destroy(); state.audio = null; }
    state.audio = new window.AudioEngine(state.caseData);
    state.phase = "idle";
    state.elapsedMs = 0;
    state.recordings = { A: null, B: null };
    state.activeRecSlot = null;
    state.answers = {};
    state.submitted = false;
    state.spectrumMode = "live";
    state.positionIndex = 0;
    $("seedInput").value = state.caseData.seed;
    $("penaltyRuleLabel").textContent = state.caseData.penaltySeconds;
    $("maxRecLabel").textContent = state.caseData.maxRecordSeconds;
    $("timer").textContent = "00:00";
    $("settlementPanel").classList.add("hidden");
    ["A", "B"].forEach(function (slot) {
      $("trackMeta" + slot).textContent = "未录制";
      const cv = $("trackCanvas" + slot);
      cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
      $("btnPlay" + slot).disabled = true;
    });
    $("btnCompare").disabled = true;
    renderPositions();
    renderDeductionForm();
    setPhase("idle", isReopen ? "已重开·待开始" : "待开始");
    setControlsForPhase();
  }

  window.APP_STATE = state;
  window.APP = {
    loadCase: loadCase,
    setControlsForPhase: setControlsForPhase,
    startTimer: startTimer,
    freezeTimer: freezeTimer,
    investigationSeconds: investigationSeconds
  };

  function beginRecording(slot) {
    if (state.activeRecSlot) return;
    state.audio.startRecording("窗口 " + slot);
    state.activeRecSlot = slot;
    setControlsForPhase();
    $("trackMeta" + slot).textContent = "录制中…";
  }

  function finishRecording(slot) {
    const rec = state.audio.stopRecording();
    state.activeRecSlot = null;
    if (!rec) { setControlsForPhase(); return; }
    state.recordings[slot] = rec;
    $("trackMeta" + slot).textContent =
      rec.positionLabel + "｜" + E.fmtTime(rec.start) + "–" + E.fmtTime(rec.stop);
    V.drawWaveform($("trackCanvas" + slot), rec.buffer.getChannelData(0));
    $("btnPlay" + slot).disabled = false;
    $("btnCompare").disabled = !(state.recordings.A && state.recordings.B);
    setControlsForPhase();
  }

  function playRecording(slot) {
    const rec = state.recordings[slot];
    if (!rec) return;
    state.spectrumMode = "playback";
    const mag = V.magnitudeSpectrum(rec.buffer.getChannelData(0), FFT_SIZE);
    V.drawSpectrum($("spectrumCanvas"), mag, rec.buffer.sampleRate, FFT_SIZE);
    state.audio.playBuffer(rec.buffer, function () {
      state.spectrumMode = "live";
    });
  }

  function submitConclusions() {
    if (state.submitted) return;
    state.submitted = true;
    if (state.phase === "running") {
      state.audio.pause();
      freezeTimer();
      setPhase("paused", "已暂停");
    }
    const grade = E.gradeSubmission(state.caseData, state.answers);
    const windowMeta = ["A", "B"].map(function (s) {
      const r = state.recordings[s];
      return r ? { label: "窗口 " + s, start: r.start } : null;
    }).filter(Boolean);
    const evidence = E.buildEvidenceRows(state.caseData, grade, windowMeta);
    renderSettlement(grade, evidence);
    setControlsForPhase();
  }

  function renderSettlement(grade, evidence) {
    const panel = $("settlementPanel");
    panel.classList.remove("hidden");
    const totalSec = investigationSeconds() + grade.penaltySeconds;
    $("settlementSummary").innerHTML =
      "<span>判断正确 <b>" + grade.correctCount + "/" + grade.total + "</b></span>" +
      "<span>错误维度 <b>" + grade.wrongCount + "</b> 条</span>" +
      "<span>错误惩罚 <b>+" + grade.penaltySeconds + "s</b></span>" +
      "<span>结算总耗时 <b>" + E.fmtTime(totalSec) + "</b></span>";
    const hints = E.wrongHints(grade);
    $("settlementHints").innerHTML = hints.length
      ? hints.map(function (h) { return "<p class='hint-wrong'>" + h + "</p>"; }).join("")
      : "<p class='hint-ok'>全部判断正确：三条通道的声源、墙面与门洞均已确认。</p>";
    const tbody = $("evidenceTable").querySelector("tbody");
    tbody.innerHTML = evidence.map(function (r) {
      return "<tr class='" + (r.correct ? "ok" : "bad") + "'>" +
        "<td>" + r.passage + "</td><td>" + r.dimension + "</td>" +
        "<td>" + r.chosen + "</td><td>" + r.truth + "</td>" +
        "<td>" + r.sourceLabel + "</td>" +
        "<td>" + r.timeInfo + "<br><small>" + r.windowInfo + "</small></td>" +
        "<td>" + r.band + "</td>" +
        "<td>" + (r.correct ? "✓ 正确" : "✗ 错误") + "</td></tr>";
    }).join("");
  }

  function bindEvents() {
    $("btnStart").addEventListener("click", function () {
      if (state.phase === "paused") {
        state.audio.start();
        startTimer();
        setPhase("running", "调查中");
        setControlsForPhase();
        return;
      }
      state.audio.start();
      startTimer();
      setPhase("running", "调查中");
      setControlsForPhase();
    });
    $("btnPause").addEventListener("click", function () {
      state.audio.pause();
      freezeTimer();
      setPhase("paused", "已暂停");
      setControlsForPhase();
    });
    $("btnReopen").addEventListener("click", function () {
      if (state.timerHandle) freezeTimer();
      loadCase(state.caseData.seed, true);
    });
    $("btnNewCase").addEventListener("click", function () {
      if (state.timerHandle) freezeTimer();
      loadCase("case-" + Math.floor(Math.random() * 1e9), false);
    });
    $("btnSubmit").addEventListener("click", submitConclusions);
    $("btnRecA").addEventListener("click", function () {
      state.activeRecSlot === "A" ? finishRecording("A") : beginRecording("A");
    });
    $("btnRecB").addEventListener("click", function () {
      state.activeRecSlot === "B" ? finishRecording("B") : beginRecording("B");
    });
    $("btnPlayA").addEventListener("click", function () { playRecording("A"); });
    $("btnPlayB").addEventListener("click", function () { playRecording("B"); });
    $("btnCompare").addEventListener("click", function () {
      const a = state.recordings.A, b = state.recordings.B;
      if (!a || !b) return;
      playRecording("A");
      setTimeout(function () { playRecording("B"); }, (a.buffer.duration + 0.4) * 1000);
    });
    $("seedInput").addEventListener("change", function () {
      if (this.value.trim()) loadCase(this.value.trim(), false);
    });
  }

  loadCase("case-20261116", false);
  bindEvents();
  requestAnimationFrame(drawLiveSpectrum);
})();
