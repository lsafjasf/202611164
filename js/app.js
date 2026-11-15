(function () {
  "use strict";

  const Engine = window.EchoEngine;
  const audio = new window.EchoAudio();
  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const dom = {
    intro: byId("intro-screen"),
    game: byId("game-screen"),
    result: byId("result-screen"),
    headerStatus: byId("header-status"),
    headerSeed: byId("header-seed"),
    liveDot: document.querySelector(".live-dot"),
    soundToggle: byId("sound-toggle"),
    pauseBtn: byId("pause-btn"),
    openSubmit: byId("open-submit"),
    seedInput: byId("seed-input"),
    randomSeed: byId("random-seed"),
    startBtn: byId("start-btn"),
    stageIndex: byId("stage-index"),
    stageKind: byId("stage-kind"),
    stageTitle: byId("stage-title"),
    stageDescription: byId("stage-description"),
    audioStatus: byId("audio-status"),
    probeStatus: byId("probe-status"),
    signalLabel: document.querySelector(".signal-label"),
    probeBtn: byId("probe-btn"),
    probeCopyTitle: document.querySelector(".probe-copy b"),
    probeCopySmall: document.querySelector(".probe-copy small"),
    echoMessage: byId("echo-message"),
    replayBtn: byId("replay-btn"),
    decisionPanel: byId("decision-panel"),
    decisionKicker: byId("decision-kicker"),
    decisionHint: byId("decision-hint"),
    lengthOptions: byId("length-options"),
    directionOptions: byId("direction-options"),
    advanceBtn: byId("advance-btn"),
    fieldNote: byId("field-note-text"),
    progressItems: Array.from(document.querySelectorAll("[data-progress]")),
    gameInstrument: document.querySelector(".game-instrument"),
    canvasFootLeft: byId("canvas-foot-left"),
    pauseOverlay: byId("pause-overlay"),
    resumeBtn: byId("resume-btn"),
    submitModal: byId("submit-modal"),
    conclusionForm: byId("conclusion-form"),
    closeSubmit: byId("close-submit"),
    cancelSubmit: byId("cancel-submit"),
    lengthRadios: byId("length-radios"),
    junctionRadios: [
      byId("junction-1-radios"),
      byId("junction-2-radios"),
      byId("junction-3-radios")
    ],
    toast: byId("toast"),
    srLive: byId("sr-live"),
    resultCaseId: byId("result-case-id"),
    resultSeedLabel: byId("result-seed-label"),
    resultTitle: byId("result-title"),
    verdictKicker: byId("verdict-kicker"),
    resultSummary: byId("result-summary"),
    resultCorrect: byId("result-correct"),
    resultOxygen: byId("result-oxygen"),
    resultTurns: byId("result-turns"),
    scoreDial: byId("score-dial"),
    scoreValue: byId("score-value"),
    resultBody: byId("result-body"),
    errorCallout: byId("error-callout"),
    errorDetail: byId("error-detail"),
    resultCaveat: byId("result-caveat"),
    restartSeed: byId("restart-seed"),
    newCase: byId("new-case"),
    backCover: byId("back-cover"),
    resultInstrument: document.querySelector(".result-instrument")
  };

  const canvases = {
    intro: new window.EchoCanvas(byId("intro-canvas")),
    game: new window.EchoCanvas(byId("game-canvas")),
    result: new window.EchoCanvas(byId("result-canvas"))
  };

  const state = {
    session: null,
    screen: "intro",
    paused: false,
    probeBusy: false,
    probeTimer: 0,
    probeToken: 0,
    lastProbe: null,
    result: null,
    toastTimer: 0,
    lastFocused: null,
    submitting: false
  };

  function randomSeed() {
    const values = new Uint32Array(1);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(values);
      return String(100000 + (values[0] % 900000));
    }
    return String(100000 + Math.floor(Math.random() * 900000));
  }

  function currentSnapshot() {
    return state.session ? state.session.snapshot() : null;
  }

  function showToast(message, danger) {
    window.clearTimeout(state.toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.toggle("is-danger", Boolean(danger));
    dom.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(function () {
      dom.toast.classList.remove("is-visible");
    }, 3400);
  }

  function announce(message) {
    dom.srLive.textContent = "";
    window.setTimeout(function () {
      dom.srLive.textContent = message;
    }, 30);
  }

  function setScreen(name) {
    state.screen = name;
    dom.intro.hidden = name !== "intro";
    dom.game.hidden = name !== "game";
    dom.result.hidden = name !== "result";
    const inGame = name === "game";
    dom.pauseBtn.hidden = !inGame;
    dom.openSubmit.hidden = !inGame;
    if (name === "intro") {
      dom.pauseBtn.hidden = true;
      dom.openSubmit.hidden = true;
    }
  }

  function updateUrl(seed) {
    try {
      const url = new URL(window.location.href);
      if (seed) url.searchParams.set("seed", seed);
      else url.searchParams.delete("seed");
      window.history.replaceState({}, "", url);
    } catch (error) {
      // URL state is optional when the page is opened from file://.
    }
  }

  function syncSoundButton() {
    dom.soundToggle.textContent = audio.muted ? "声场 关" : "声场 开";
    dom.soundToggle.setAttribute("aria-pressed", audio.muted ? "true" : "false");
    dom.soundToggle.setAttribute("aria-label", audio.muted ? "恢复声场" : "关闭声场");
  }

  function updateCanvases(snapshot) {
    const data = snapshot || {
      oxygen: 100,
      logs: [],
      seed: dom.seedInput.value.trim() || "—"
    };
    Object.keys(canvases).forEach(function (key) {
      canvases[key].setState(data);
    });
    dom.gameInstrument.classList.toggle("is-low", data.oxygen <= 34);
    dom.resultInstrument.classList.toggle("is-low", data.oxygen <= 34);
  }

  function currentProbe(snapshot) {
    if (!snapshot || !snapshot.probes.length) return null;
    if (snapshot.stage === "main") {
      return snapshot.probes.find(function (probe) { return probe.type === "main"; }) || null;
    }
    if (snapshot.stage === "junction") {
      return snapshot.probes.find(function (probe) {
        return probe.type === "junction" && probe.junctionIndex === snapshot.currentJunction;
      }) || null;
    }
    return null;
  }

  function renderProgress(stage, currentJunction) {
    let active = 0;
    if (stage === "junction") active = currentJunction + 1;
    if (stage === "conclude") active = 4;
    dom.progressItems.forEach(function (item, index) {
      item.classList.toggle("is-done", index < active);
      item.classList.toggle("is-current", index === active && stage !== "conclude");
    });
  }

  function buildLengthChoices(selected, disabled) {
    dom.lengthOptions.innerHTML = Engine.LENGTH_OPTIONS.map(function (option) {
      return "<button class=\"length-choice" +
        (selected === option.key ? " is-selected" : "") +
        "\" type=\"button\" data-length=\"" + option.key + "\"" +
        (disabled ? " disabled" : "") + ">" +
        "<b>" + option.label + "</b><small>" + option.range + "</small></button>";
    }).join("");
  }

  function buildDirectionChoices(disabled) {
    dom.directionOptions.innerHTML = Engine.BEARINGS.map(function (bearing) {
      return "<button class=\"direction-choice\" type=\"button\" data-direction=\"" +
        bearing.key + "\" data-code=\"" + bearing.short.toUpperCase() + "\"" +
        (disabled ? " disabled" : "") + ">" +
        "<b>" + bearing.label + "</b><small>BEARING / " + bearing.short + "</small>" +
        "<i class=\"direction-line\" aria-hidden=\"true\"></i></button>";
    }).join("");
  }

  function renderGame() {
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    const probe = currentProbe(snapshot);
    const isMain = snapshot.stage === "main";
    const isJunction = snapshot.stage === "junction";
    const isConclude = snapshot.stage === "conclude";
    const stageNumber = isMain ? 1 : isJunction ? snapshot.currentJunction + 2 : 4;
    const title = isMain
      ? "主巷测距"
      : isJunction
        ? Engine.JUNCTION_LABELS[snapshot.currentJunction]
        : "核对记录";
    const kind = isMain ? "SOUNDING" : isJunction ? "TURN " + String(stageNumber - 1).padStart(2, "0") : "SEAL";
    const description = isMain
      ? "先敲击岩壁。主回响的时差与频带会留在右侧记录表上。"
      : isJunction
        ? "同一次敲击会带回三条方位各异的反射。比较最晚、最低频的支巷尾响，再决定转向。"
        : "三处转向均已记录。核对右侧原始回响后提交推断，真实参数只会在结算时出现。";

    dom.stageIndex.textContent = "阶段 " + String(stageNumber).padStart(2, "0") + " / 04";
    dom.stageKind.textContent = kind;
    dom.stageTitle.textContent = title;
    dom.stageDescription.textContent = description;
    renderProgress(snapshot.stage, snapshot.currentJunction);

    dom.headerSeed.textContent = snapshot.seed;
    dom.headerStatus.textContent = state.paused
      ? "已暂停"
      : snapshot.oxygen <= 0
        ? "氧气耗尽"
        : isConclude
          ? "记录封存"
          : "调查中";
    dom.liveDot.classList.toggle("is-paused", state.paused || isConclude);
    dom.audioStatus.textContent = state.paused ? "声场冻结" : isConclude ? "声场归档" : "声场活跃";
    dom.signalLabel.classList.toggle("is-paused", state.paused || isConclude);
    dom.pauseBtn.textContent = state.paused ? "已暂停" : "暂停";

    const cannotProbe = Boolean(probe) || isConclude || snapshot.oxygen <= 0 || state.probeBusy || state.paused;
    dom.probeBtn.disabled = Boolean(cannotProbe);
    if (isConclude) {
      dom.probeCopyTitle.textContent = "三处转向已记录";
      dom.probeCopySmall.textContent = "RECORD LOCKED / SUBMIT TO VERIFY";
    } else if (probe) {
      dom.probeCopyTitle.textContent = "本段回响已记录";
      dom.probeCopySmall.textContent = "REPLAY WITHOUT CHANGING THE CLUE";
    } else {
      dom.probeCopyTitle.textContent = "敲击岩壁";
      dom.probeCopySmall.textContent = "WEB AUDIO / LIVE SYNTHESIS";
    }
    dom.probeStatus.textContent = probe
      ? probe.id + " 已记录 / " + probe.clues.length + " 条"
      : "尚未敲击";

    if (!probe) {
      dom.echoMessage.textContent = isConclude
        ? "三处岔口的回响均已记录。核对右侧记录表，提交推断。"
        : "黑暗里还没有回响。";
      dom.echoMessage.classList.remove("is-live");
    } else if (isMain) {
      const clue = probe.clues[0];
      dom.echoMessage.textContent = "主回响 " + clue.delayMs.toFixed(1) + " ms · " +
        Math.round(clue.bandHz) + " Hz · " + clue.strengthLabel + "。原始声学量已誊录至 " + probe.id + "。";
      dom.echoMessage.classList.add("is-live");
    } else {
      const delays = probe.clues.map(function (clue) { return clue.delayMs; });
      dom.echoMessage.textContent = "检测到 3 条方位回响，最早 " + Math.min.apply(null, delays).toFixed(1) +
        " ms，最晚 " + Math.max.apply(null, delays).toFixed(1) + " ms。请对照右侧频带与方位。";
      dom.echoMessage.classList.add("is-live");
    }
    dom.replayBtn.hidden = !probe || isConclude;
    dom.replayBtn.disabled = state.probeBusy || state.paused;

    dom.decisionPanel.hidden = !((isMain || isJunction) && probe);
    if (isMain && probe) {
      dom.decisionKicker.textContent = "测距判断";
      dom.decisionHint.textContent = "先记录长度，再深入岔口";
      dom.lengthOptions.hidden = false;
      dom.directionOptions.hidden = true;
      buildLengthChoices(snapshot.lengthGuess, state.probeBusy || state.paused);
      dom.advanceBtn.hidden = false;
      dom.advanceBtn.disabled = !snapshot.lengthGuess || state.probeBusy || state.paused;
      dom.advanceBtn.innerHTML = "进入一号岔口 <span aria-hidden=\"true\">↓</span>";
    } else if (isJunction && probe) {
      dom.decisionKicker.textContent = "转向判断 / " + Engine.JUNCTION_LABELS[snapshot.currentJunction];
      dom.decisionHint.textContent = "选择将立即消耗或保留氧气";
      dom.lengthOptions.hidden = true;
      dom.directionOptions.hidden = false;
      buildDirectionChoices(state.probeBusy || state.paused);
      dom.advanceBtn.hidden = true;
    }

    dom.fieldNote.textContent = isMain
      ? "长时差、低频率、方位明确的回响通常来自更深的空腔；短促高频声只说明近处岩壁。机械底噪会遮住弱回响。"
      : isJunction
        ? "一次敲击包含近壁反射与支巷尾响。湿度越低，尾响越清晰；远处机械声会在部分频段形成掩蔽。"
        : "P01 对应主巷测距，P02–P04 对应三个岔口。记录的时差、方位、频带未经推断或修正。";
    dom.openSubmit.disabled = !snapshot.canSubmit || state.paused;
    dom.canvasFootLeft.textContent = snapshot.oxygen <= 0
      ? "OXYGEN EXHAUSTED"
      : isConclude
        ? "RECORD SEALED"
        : "RECORDER ACTIVE";

    updateCanvases(snapshot);
  }

  async function startCase(seedInput) {
    const seed = Engine.normalizeSeed(seedInput || randomSeed());
    state.probeToken += 1;
    window.clearTimeout(state.probeTimer);
    state.paused = false;
    state.probeBusy = false;
    state.lastProbe = null;
    state.result = null;
    state.submitting = false;
    document.body.classList.remove("is-paused", "is-probing");
    dom.pauseOverlay.hidden = true;
    closeSubmitModal(true);
    audio.stop();
    state.session = new Engine.Investigation(seed);
    dom.seedInput.value = seed;
    dom.headerSeed.textContent = seed;
    dom.headerStatus.textContent = "调查中";
    setScreen("game");
    updateUrl(seed);
    updateCanvases(state.session.snapshot());
    renderGame();
    window.scrollTo({ top: 0, behavior: "auto" });
    announce("案件 " + seed + " 已开始。请敲击岩壁获取第一段回响。");
    try {
      await audio.begin(state.session._case);
      syncSoundButton();
    } catch (error) {
      showToast("Web Audio 未能启动，请确认浏览器允许声音；记录表仍可使用。", true);
    }
  }

  function beginProbe() {
    if (!state.session || state.screen !== "game" || state.paused || state.probeBusy) return;
    const snapshot = currentSnapshot();
    if (!snapshot || snapshot.stage === "conclude" || snapshot.oxygen <= 0) return;
    if (currentProbe(snapshot)) return;

    let probe;
    try {
      probe = state.session.probe();
    } catch (error) {
      showToast(error.message, true);
      return;
    }
    state.lastProbe = probe;
    state.probeBusy = true;
    document.body.classList.add("is-probing");
    dom.probeBtn.classList.add("is-pulsing");
    window.setTimeout(function () {
      dom.probeBtn.classList.remove("is-pulsing");
    }, 720);
    renderGame();

    const maxDelay = Math.max.apply(null, probe.clues.map(function (clue) { return clue.delayMs; }));
    const token = ++state.probeToken;
    window.clearTimeout(state.probeTimer);
    state.probeTimer = window.setTimeout(function () {
      if (token !== state.probeToken) return;
      state.probeBusy = false;
      document.body.classList.remove("is-probing");
      renderGame();
    }, Math.max(1450, maxDelay + 900));

    const clueSummary = probe.clues.map(function (clue) {
      return clue.bearing + " " + clue.delayMs.toFixed(1) + " 毫秒， " +
        Math.round(clue.bandHz) + " 赫兹， " + clue.strengthLabel;
    }).join("；");
    announce(probe.id + " 已记录。 " + clueSummary + "。请对照记录表作出判断。");
    audio.playProbe(probe).catch(function () {
      showToast("声场播放失败，但原始回响已写入记录表。", true);
    });
  }

  function replayProbe() {
    const snapshot = currentSnapshot();
    const probe = currentProbe(snapshot);
    if (!probe || state.paused || state.probeBusy) return;
    state.probeBusy = true;
    renderGame();
    const maxDelay = Math.max.apply(null, probe.clues.map(function (clue) { return clue.delayMs; }));
    const token = ++state.probeToken;
    window.clearTimeout(state.probeTimer);
    state.probeTimer = window.setTimeout(function () {
      if (token !== state.probeToken) return;
      state.probeBusy = false;
      renderGame();
    }, Math.max(1300, maxDelay + 800));
    announce("重听 " + probe.id + "。线索内容与首次记录一致。");
    audio.replay(probe).catch(function () {
      showToast("重听失败，记录内容未改变。", true);
    });
  }

  function chooseLength(key) {
    if (!state.session || state.probeBusy || state.paused) return;
    try {
      state.session.setLengthGuess(key);
      renderGame();
      const option = Engine.lengthByKey(key);
      announce("已记录主巷判断：" + option.label + "。可继续深入。");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function descend() {
    if (!state.session || state.probeBusy || state.paused) return;
    try {
      state.session.descendToJunctions();
      state.probeBusy = false;
      renderGame();
      announce("已进入一号岔口。请敲击岩壁判断支巷方向。");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function chooseDirection(key) {
    if (!state.session || state.probeBusy || state.paused) return;
    const before = currentSnapshot();
    let after;
    try {
      after = state.session.chooseDirection(key);
    } catch (error) {
      showToast(error.message, true);
      return;
    }
    state.probeBusy = false;
    renderGame();
    const spent = before.oxygen - after.oxygen;
    if (after.oxygen <= 0) {
      showToast("气瓶见底。三处转向已记录，只能核对记录并提交推断。", true);
      announce("氧气耗尽。所有转向已封存，必须提交推断。");
    } else if (spent > 0) {
      showToast("呼吸阻力上升，气瓶消耗。氧气 -" + Math.round(spent) + "%。");
      announce("转向已记录。气瓶压力下降。");
    } else {
      showToast("转向已记录。前方支巷的回响正在形成。");
      announce("转向已记录。请准备下一段探测。");
    }
  }

  async function setPaused(paused) {
    if (!state.session || state.screen !== "game") return;
    if (state.paused === paused) return;
    state.paused = paused;
    document.body.classList.toggle("is-paused", paused);
    dom.pauseOverlay.hidden = !paused;
    document.body.classList.remove("is-probing");
    dom.probeBtn.classList.remove("is-pulsing");
    if (paused) {
      await audio.pause();
    } else {
      await audio.resume();
      announce("调查继续。线索与记录未改变。");
    }
    renderGame();
    if (paused) {
      dom.resumeBtn.focus();
    } else {
      dom.pauseBtn.focus();
    }
  }

  function radioMarkup(name, options, selected) {
    return options.map(function (option, index) {
      const checked = option.value === selected;
      return "<span class=\"choice-radio\">" +
        "<input type=\"radio\" id=\"" + name + "-" + index + "\" name=\"" + name + "\" value=\"" +
        escapeHtml(option.value) + "\"" + (checked ? " checked" : "") + ">" +
        "<label for=\"" + name + "-" + index + "\">" +
        "<span>" + escapeHtml(option.label) + "</span>" +
        "<small>" + escapeHtml(option.detail) + "</small></label></span>";
    }).join("");
  }

  function openSubmitModal() {
    const snapshot = currentSnapshot();
    if (!snapshot || !snapshot.canSubmit || state.paused || state.screen !== "game") return;
    const lengthOptions = Engine.LENGTH_OPTIONS.map(function (option) {
      return { value: option.key, label: option.label, detail: option.range };
    });
    const directionOptions = Engine.BEARINGS.map(function (bearing) {
      return { value: bearing.key, label: bearing.label, detail: "BEARING / " + bearing.short };
    });
    dom.lengthRadios.innerHTML = radioMarkup("length", lengthOptions, snapshot.lengthGuess);
    dom.junctionRadios.forEach(function (container, index) {
      const name = "junction-" + (index + 1);
      const selected = snapshot.directionGuesses[index] || "straight";
      container.innerHTML = radioMarkup(name, directionOptions, selected);
    });
    state.lastFocused = document.activeElement;
    window.clearTimeout(state.toastTimer);
    dom.toast.classList.remove("is-visible");
    dom.game.setAttribute("inert", "");
    dom.submitModal.hidden = false;
    dom.closeSubmit.focus();
    announce("封存推断。提交前不会显示真实参数。");
  }

  function closeSubmitModal(silent) {
    if (dom.submitModal.hidden) return;
    dom.submitModal.hidden = true;
    dom.game.removeAttribute("inert");
    state.submitting = false;
    if (!silent && state.lastFocused && typeof state.lastFocused.focus === "function") {
      state.lastFocused.focus();
    }
  }

  function submitConclusion(event) {
    event.preventDefault();
    if (!state.session) return;
    if (state.submitting) return;
    const form = new FormData(dom.conclusionForm);
    const length = form.get("length");
    const directions = [
      form.get("junction-1"),
      form.get("junction-2"),
      form.get("junction-3")
    ];
    if (!length || directions.some(function (direction) { return !direction; })) {
      showToast("每个判断维度都需要选择一个结论。", true);
      return;
    }
    state.submitting = true;
    let result;
    try {
      result = Engine.evaluateConclusion(state.session, { length, directions });
    } catch (error) {
      state.submitting = false;
      showToast(error.message, true);
      return;
    }
    const snapshot = state.session.snapshot();
    state.result = result;
    state.paused = false;
    window.clearTimeout(state.toastTimer);
    dom.toast.classList.remove("is-visible");
    document.body.classList.remove("is-paused", "is-probing");
    dom.pauseOverlay.hidden = true;
    audio.stop();
    updateCanvases(snapshot);
    renderResult(result);
    closeSubmitModal(true);
    setScreen("result");
    window.scrollTo({ top: 0, behavior: "auto" });
    announce(result.verdict + "。四个判断维度中 " + result.correctCount + " 项吻合。" + result.mismatchSummary);
  }

  function resultSummary(result) {
    if (result.allCorrect) {
      return "四组回响证据均与真实巷道参数吻合。你没有把机械噪声当成方向，也没有让湿岩吞掉尾响。";
    }
    if (result.oxygenExhausted) {
      return "气瓶在第三次错误转向后耗尽。" + result.correctCount + " 个判断维度吻合，但仍有 " +
        result.mismatchedDimensions.length + " 项偏差；记录表保留了你当时依据的原始声学量。";
    }
    return "四个判断维度中有 " + result.correctCount + " 项吻合。" +
      result.mismatchedDimensions.length + " 项证据链没有闭合，具体偏差已在下方按维度标出。";
  }

  function renderResult(result) {
    const caseCode = "BLD-" + Engine.hashSeed(result.seed).toString(16).toUpperCase().padStart(8, "0").slice(-6);
    dom.resultCaseId.textContent = caseCode;
    dom.resultSeedLabel.textContent = "SEED " + result.seed;
    dom.resultTitle.textContent = result.verdict;
    dom.resultTitle.className = result.allCorrect ? "" : result.correctCount === 0 ? "is-failed" : "is-partial";
    dom.verdictKicker.textContent = result.allCorrect ? "四维证据链闭合" : result.oxygenExhausted ? "氧气耗尽 / 强制结案" : "证据链存在偏差";
    dom.resultSummary.textContent = resultSummary(result);
    dom.resultCorrect.textContent = result.correctCount + " / " + result.total;
    dom.resultOxygen.textContent = Math.round(result.oxygen) + "%";
    dom.resultTurns.textContent = result.wrongTurns + " / " + result.turnsTaken;
    dom.scoreValue.textContent = String(result.correctCount);
    const angle = Math.round((result.correctCount / result.total) * 360);
    dom.scoreDial.style.background = "conic-gradient(" +
      (result.allCorrect ? "var(--amber)" : result.correctCount ? "var(--amber-deep)" : "var(--danger)") +
      " 0deg " + angle + "deg, rgba(232, 173, 87, 0.08) " + angle + "deg 360deg)";

    dom.resultBody.innerHTML = result.rows.map(function (row) {
      return "<tr class=\"" + (row.matched ? "" : "is-mismatch") + "\">" +
        "<td class=\"dimension-cell\"><strong>" + escapeHtml(row.dimension) + "</strong><small>" +
        escapeHtml(row.detail) + "</small></td>" +
        "<td class=\"guess-cell\">" + escapeHtml(row.guess) + "</td>" +
        "<td class=\"truth-cell\">" + escapeHtml(row.truth) + "</td>" +
        "<td class=\"evidence-cell\"><strong>" + escapeHtml(row.evidence.source) + "</strong><span>" +
        escapeHtml(row.evidence.time) + " · " + escapeHtml(row.evidence.band) + " · " +
        escapeHtml(row.evidence.bearing) + " · " + escapeHtml(row.evidence.strength) + "</span></td>" +
        "<td><span class=\"match-badge" + (row.matched ? "" : " is-mismatch") + "\">" +
        (row.matched ? "吻合" : "偏差") + "</span></td></tr>";
    }).join("");

    const mismatches = result.rows.filter(function (row) { return !row.matched; });
    dom.errorCallout.hidden = result.allCorrect;
    if (mismatches.length) {
      dom.errorDetail.innerHTML = mismatches.map(function (row) {
        return "<span>判断维度：<b>" + escapeHtml(row.dimension) + "</b>。你的判断为“" +
          escapeHtml(row.guess) + "”，真实参数为“" + escapeHtml(row.truth) + "”。对应证据：" +
          escapeHtml(row.evidence.source) + " · " + escapeHtml(row.evidence.time) + " · " +
          escapeHtml(row.evidence.band) + " · " + escapeHtml(row.evidence.bearing) + "。</span>";
      }).join("<br>");
    }
    dom.resultCaveat.textContent = result.allCorrect
      ? "核验基于提交前已封存的 P01–P04 回响；真实参数仅在本次提交后展开。"
      : result.mismatchSummary + "。错误提示按判断维度拆分，并并列保留对应声源、时差与频带。";
    if (state.session) updateCanvases(state.session.snapshot());
  }

  function updateIntroCanvas() {
    canvases.intro.setState({
      oxygen: 100,
      logs: [],
      seed: Engine.normalizeSeed(dom.seedInput.value || "—")
    });
  }

  function showCover() {
    state.probeToken += 1;
    window.clearTimeout(state.probeTimer);
    audio.stop();
    state.session = null;
    state.result = null;
    state.paused = false;
    state.probeBusy = false;
    document.body.classList.remove("is-paused", "is-probing");
    dom.pauseOverlay.hidden = true;
    closeSubmitModal(true);
    setScreen("intro");
    dom.headerStatus.textContent = "待命";
    dom.headerSeed.textContent = "—";
    dom.liveDot.classList.remove("is-paused");
    updateUrl(null);
    updateIntroCanvas();
    dom.seedInput.focus();
  }

  function bindEvents() {
    dom.startBtn.addEventListener("click", async function () {
      if (dom.startBtn.disabled) return;
      dom.startBtn.disabled = true;
      try {
        await startCase(dom.seedInput.value);
      } finally {
        dom.startBtn.disabled = false;
      }
    });

    dom.randomSeed.addEventListener("click", function () {
      dom.seedInput.value = randomSeed();
      updateIntroCanvas();
      dom.seedInput.focus();
    });

    dom.seedInput.addEventListener("input", function () {
      const seed = Engine.normalizeSeed(dom.seedInput.value);
      dom.seedInput.value = dom.seedInput.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 18);
      if (!dom.seedInput.value.trim()) {
        canvases.intro.setState({ oxygen: 100, logs: [], seed: seed });
      } else {
        updateIntroCanvas();
      }
    });

    dom.soundToggle.addEventListener("click", async function () {
      audio.setMuted(!audio.muted);
      syncSoundButton();
      if (!audio.muted) {
        try {
          await audio.ensure();
          if (state.paused) await audio.pause();
        } catch (error) {
          showToast("浏览器未允许启动音频。", true);
        }
      }
      if (audio.muted) announce("声场已关闭。记录表仍会更新。");
      else announce("声场已恢复。");
    });

    dom.pauseBtn.addEventListener("click", function () {
      setPaused(true);
    });
    dom.resumeBtn.addEventListener("click", function () {
      setPaused(false);
    });

    dom.probeBtn.addEventListener("click", beginProbe);
    dom.replayBtn.addEventListener("click", replayProbe);
    dom.advanceBtn.addEventListener("click", descend);
    dom.openSubmit.addEventListener("click", openSubmitModal);

    dom.lengthOptions.addEventListener("click", function (event) {
      const button = event.target.closest("[data-length]");
      if (button) chooseLength(button.getAttribute("data-length"));
    });
    dom.directionOptions.addEventListener("click", function (event) {
      const button = event.target.closest("[data-direction]");
      if (button) chooseDirection(button.getAttribute("data-direction"));
    });

    dom.closeSubmit.addEventListener("click", function () { closeSubmitModal(false); });
    dom.cancelSubmit.addEventListener("click", function () { closeSubmitModal(false); });
    dom.submitModal.querySelector("[data-close-submit]").addEventListener("click", function () {
      closeSubmitModal(false);
    });
    dom.conclusionForm.addEventListener("submit", submitConclusion);

    dom.restartSeed.addEventListener("click", function () {
      const seed = state.result && state.result.seed;
      if (seed) startCase(seed);
    });
    dom.newCase.addEventListener("click", function () {
      startCase(randomSeed());
    });
    dom.backCover.addEventListener("click", showCover);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (!dom.submitModal.hidden) {
          closeSubmitModal(false);
          return;
        }
        if (state.paused) setPaused(false);
        return;
      }
      if (event.code !== "Space" || event.repeat) return;
      const tag = event.target && event.target.tagName;
      if (["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(tag)) return;
      if (state.screen !== "game" || state.paused || !dom.submitModal.hidden) return;
      event.preventDefault();
      beginProbe();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state.screen === "game" && !state.paused && dom.submitModal.hidden) {
        setPaused(true);
      }
    });
  }

  function init() {
    const querySeed = new URLSearchParams(window.location.search).get("seed");
    dom.seedInput.value = querySeed ? Engine.normalizeSeed(querySeed) : randomSeed();
    dom.headerSeed.textContent = "—";
    dom.headerStatus.textContent = "待命";
    syncSoundButton();
    updateIntroCanvas();
    bindEvents();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        Object.keys(canvases).forEach(function (key) {
          canvases[key].resize();
        });
      });
    }
  }

  init();
})();
