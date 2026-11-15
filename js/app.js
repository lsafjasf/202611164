/*
 * 主控：状态机 + 确定性信号调度 + 调查/返航/结算流程。
 * 线索来自 LHCase.buildSchedule 生成的冻结时刻表：
 * 暂停只冻结时钟，重播/重开重新遍历同一份时刻表，事件顺序与抖动完全一致。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('sea');
  var scene = new LHScene(canvas);
  var horn = new LHFoghorn();

  var st = null; // 当前案件运行态
  var rafId = null;
  var harbor = { x: 90, y: 470 };

  function freshRun(seed) {
    var c = LHCase.createCase(seed);
    var sched = LHCase.buildSchedule(c);
    return {
      caseData: c,
      sched: sched,
      phase: 'investigating', // investigating | sailing | success | failed | paused
      paused: false,
      anchorPerf: 0,          // performance.now 基线
      pausedAtMs: 0,
      clockMs: 0,
      flashIdx: 0,
      hornIdx: 0,
      hornAtByRound: {},
      delayLogged: {},
      activeFlashUntil: -1,
      activeHornUntil: -1,
      lastHornFreq: null,
      attempt: 0,
      boat: { x: harbor.x, y: harbor.y, heading: 0 },
      sail: null,
      reachedCount: -1,
      crashed: false
    };
  }

  function startCase() {
    var seed = $('seedInput').value.trim() || 'DEFAULT';
    if (st && st.phase === 'sailing') return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    st = freshRun(seed);
    horn.ensure();
    st.anchorPerf = performance.now();
    $('verdict').classList.add('hidden');
    $('logStrip').innerHTML = '';
    $('formMsg').textContent = '';
    $('btnPause').disabled = false;
    $('btnReplay').disabled = false;
    $('btnRestart').disabled = false;
    $('btnSubmit').disabled = false;
    $('btnStart').textContent = '新案件';
    $('btnPause').textContent = '暂停';
    setBadge('调查阶段 · 播放中');
    loop();
  }

  // 重播：重新遍历同一份冻结时刻表，不重新生成，因此线索内容不变。
  function replaySignals() {
    if (!st || st.phase === 'sailing') return;
    st.flashIdx = 0;
    st.hornIdx = 0;
    st.hornAtByRound = {};
    st.delayLogged = {};
    st.clockMs = 0;
    st.paused = false;
    st.activeFlashUntil = -1;
    st.activeHornUntil = -1;
    st.anchorPerf = performance.now();
    horn.ensure();
    $('logStrip').innerHTML = '';
    $('delayMeasure').textContent = '等待第 1 轮信号…';
    $('formMsg').textContent = '重播使用同一冻结时刻表，闪光/雾笛顺序与抖动不变。';
    $('btnPause').textContent = '暂停';
    setBadge('调查阶段 · 重播中');
    if (!rafId) loop();
  }

  function togglePause() {
    if (!st || st.phase !== 'investigating') return;
    if (!st.paused) {
      st.paused = true;
      st.pausedAtMs = st.clockMs;
      horn.suspend();
      setBadge('已暂停（时钟冻结，线索不变）');
      $('btnPause').textContent = '继续';
    } else {
      st.paused = false;
      st.anchorPerf = performance.now() - st.pausedAtMs;
      horn.resume();
      setBadge('调查阶段 · 播放中');
      $('btnPause').textContent = '暂停';
      if (!rafId) loop();
    }
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!st) return;
    var now = performance.now();
    if (!st.paused) {
      st.clockMs = now - st.anchorPerf;
    }
    fireEvents(!st.paused);
    var m = horn.measure();
    if (m != null && st.clockMs <= st.activeHornUntil) st.lastHornFreq = m;
    updateHud(m);
    updateBoat(now);
    scene.render({
      t: now,
      flashOn: st.clockMs <= st.activeFlashUntil,
      hornOn: st.clockMs <= st.activeHornUntil,
      targets: st.caseData.route,
      route: st.caseData.route,
      showReefs: st.phase === 'success' || st.phase === 'failed'
        || !!(st.sail && st.sail.revealReefs),
      boat: st.boat,
      reachedCount: st.reachedCount,
      crashed: st.crashed
    });
  }

  function fireEvents(audioRunning) {
    var sched = st.sched;
    while (st.hornIdx < sched.horns.length && sched.horns[st.hornIdx].at <= st.clockMs) {
      var h = sched.horns[st.hornIdx];
      // 仅在音频时钟运行时发声；暂停期间事件不触发，恢复后按当前音频时钟立即发声。
      if (audioRunning) horn.blare(horn.now() + 0.02, h.freq);
      st.activeHornUntil = h.at + 900;
      st.lastHornFreq = null;
      st.hornAtByRound[h.round] = h.at;
      logHorn(h);
      st.hornIdx++;
    }
    while (st.flashIdx < sched.flashes.length && sched.flashes[st.flashIdx].at <= st.clockMs) {
      var f = sched.flashes[st.flashIdx];
      st.activeFlashUntil = f.at + f.dur;
      if (st.hornAtByRound[f.round] != null && !st.delayLogged[f.round]) {
        st.delayLogged[f.round] = true;
        logDelay(f.round, f.at - st.hornAtByRound[f.round]);
      }
      logFlash(f);
      st.flashIdx++;
    }
  }

  function logDelay(round, ms) {
    var el = $('delayMeasure');
    var prev = el.dataset.values ? el.dataset.values.split(',').map(Number) : [];
    prev[round] = ms;
    el.dataset.values = prev.join(',');
    var parts = prev.map(function (v, i) {
      return v == null ? '' : '第' + (i + 1) + '轮 ' + v + 'ms';
    }).filter(Boolean);
    el.textContent = parts.join('；');
  }

  function setBadge(text) { $('phaseBadge').textContent = text; }

  function logFlash(f) {
    var div = document.createElement('div');
    div.className = 'log-item log-flash';
    div.innerHTML = '<span class="tag">闪光</span> t=' + Math.round(f.at)
      + 'ms · ' + (f.type === '.' ? '短闪(点) ' + f.dur + 'ms' : '长闪(划) ' + f.dur + 'ms')
      + ' · 第' + (f.round + 1) + '轮';
    pushLog(div);
  }

  function logHorn(h) {
    var div = document.createElement('div');
    div.className = 'log-item log-horn';
    div.innerHTML = '<span class="tag">雾笛</span> t=' + Math.round(h.at)
      + 'ms · 第' + (h.round + 1) + '轮（基频请读下方实测表）';
    div.dataset.round = h.round;
    div.dataset.hornAt = h.at;
    pushLog(div);
  }

  function pushLog(div) {
    var box = $('logStrip');
    var empty = box.querySelector('.log-empty');
    if (empty) box.removeChild(empty);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function updateHud(measured) {
    $('hudClock').textContent = Math.max(0, Math.round(st.clockMs)) + ' ms';
    var round = Math.min(3, st.hornIdx);
    $('hudRound').textContent = round + ' / 3';
    if (measured != null && st.clockMs <= st.activeHornUntil) {
      $('hudFreq').textContent = measured + ' Hz（实测）';
    } else if (st.lastHornFreq != null) {
      $('hudFreq').textContent = st.lastHornFreq + ' Hz（上次实测）';
    }
    $('hudAttempt').textContent = st.attempt + ' / ' + LHCase.MAX_ATTEMPTS;
  }

  function readAnswer() {
    return {
      route: [$('r0').value, $('r1').value, $('r2').value],
      delayId: $('delaySel').value,
      windId: $('windSel').value === '' ? '' : parseInt($('windSel').value, 10)
    };
  }

  function submitAnswer(ev) {
    ev.preventDefault();
    if (!st || st.phase !== 'investigating') return;
    var msg = $('formMsg');
    var ans = readAnswer();
    if (ans.route.some(function (v) { return v === ''; }) || !ans.delayId || ans.windId === '') {
      msg.className = 'form-msg err';
      msg.textContent = '请完整填写三位路线数字、延迟档位和风级后再提交。';
      return;
    }
    st.attempt += 1;
    var verdict = LHCase.buildVerdict(ans, st.caseData, st.sched, st.attempt);
    if (verdict.result.allOk) {
      msg.className = 'form-msg ok';
      msg.textContent = '结论确认，开始按路线引导小船出港。';
      beginSail(true, ans, verdict);
    } else {
      triggerReturn(ans, verdict);
    }
  }

  // 错误确认 → 返航：揭示礁石、播放碰撞/返航动画，再给出按维度的错误提示。
  function triggerReturn(ans, verdict) {
    st.phase = 'sailing';
    st.sail = {
      ok: false,
      revealReefs: true,
      startPerf: performance.now(),
      from: { x: st.boat.x, y: st.boat.y },
      target: scene.buoys[st.caseData.route[0]],
      crashedAt: null,
      ans: ans,
      verdict: verdict
    };
    setBadge('错误确认 · 触发返航（第 ' + st.attempt + ' 次）');
  }

  // 正确结论 → 沿三个浮标航行，强风产生横向漂移但不触礁。
  function beginSail(ok, ans, verdict) {
    st.phase = 'sailing';
    st.sail = {
      ok: true,
      revealReefs: true,
      leg: 0,
      legStart: performance.now(),
      from: { x: st.boat.x, y: st.boat.y },
      ans: ans,
      verdict: verdict
    };
    st.reachedCount = -1;
    setBadge('结论正确 · 引导出港');
  }

  function updateBoat(now) {
    if (!st.sail) {
      // 调查阶段：船停在港湾，仅旗帜/雾效暗示风，不显示风级数值。
      return;
    }
    var sail = st.sail;
    var wind = LHCase.WIND_LEVELS[st.caseData.windIndex];
    if (!sail.ok) {
      var p = Math.min(1, (now - sail.startPerf) / 1600);
      var target = sail.target;
      st.boat.x = sail.from.x + (target.x - sail.from.x) * p;
      st.boat.y = sail.from.y + (target.y - sail.from.y) * p
        + Math.sin(p * Math.PI) * (wind.driftPxS * 1.2);
      st.boat.heading = -0.18;
      if (p >= 1 && sail.crashedAt == null) {
        sail.crashedAt = now;
        st.crashed = true;
      }
      if (sail.crashedAt != null && now - sail.crashedAt > 1200) {
        finishWrong(sail.ans, sail.verdict);
      }
      return;
    }

    var legDur = 1500;
    var lp = Math.min(1, (now - sail.legStart) / legDur);
    var dest = scene.buoys[st.caseData.route[sail.leg]];
    st.boat.x = sail.from.x + (dest.x - sail.from.x) * lp;
    st.boat.y = sail.from.y + (dest.y - sail.from.y) * lp
      + Math.sin(lp * Math.PI) * wind.driftPxS * 0.35;
    st.boat.heading = Math.atan2(dest.y - sail.from.y, dest.x - sail.from.x);
    if (lp >= 1) {
      st.reachedCount = sail.leg;
      sail.leg += 1;
      sail.legStart = now;
      sail.from = { x: dest.x, y: dest.y };
      if (sail.leg >= 3) finishSuccess(sail.verdict);
    }
  }

  function finishWrong(ans, verdict) {
    st.sail = null;
    st.crashed = false;
    st.boat = { x: harbor.x, y: harbor.y, heading: 0 };
    if (st.attempt >= LHCase.MAX_ATTEMPTS) {
      st.phase = 'failed';
      setBadge('案件失败 · 已强制返航');
      $('btnSubmit').disabled = true;
    } else {
      st.phase = 'investigating';
      setBadge('调查阶段 · 已返航，可重新测量后提交');
    }
    renderVerdict(ans, verdict, false);
  }

  function finishSuccess(verdict) {
    st.sail = null;
    st.phase = 'success';
    setBadge('成功出港 · 结算');
    renderVerdict(readAnswer(), verdict, true);
  }

  function renderVerdict(ans, verdict, success) {
    var box = $('verdict');
    box.classList.remove('hidden');
    $('verdictSummary').innerHTML = success
      ? '<p class="pass">第 ' + st.attempt + ' 次提交确认正确，得分 ' + verdict.score
        + '。下方并列展示每个判断与其真实参数依据。</p>'
      : '<p class="fail">第 ' + st.attempt + ' 次提交存在错误，小船已返航。'
        + (st.phase === 'failed' ? '已达 ' + LHCase.MAX_ATTEMPTS + ' 次上限，案件失败。'
          : '本次得分 ' + verdict.score + '，可继续调查后重新提交。') + '</p>';
    var body = $('verdictBody');
    body.innerHTML = '';
    verdict.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + row.dimension + '<br><span class="hint">来源：' + row.source
        + '</span></td><td>' + row.clue + '</td><td>' + row.given + '</td><td>'
        + row.truth + '</td><td class="' + (row.ok ? 'pass' : 'fail') + '">'
        + (row.ok ? '正确' : '错误') + '</td>';
      body.appendChild(tr);
    });
    var hints = $('verdictHints');
    hints.innerHTML = '';
    if (!success) {
      verdict.result.hints.forEach(function (text) {
        var p = document.createElement('p');
        p.textContent = text;
        hints.appendChild(p);
      });
    }
  }

  function bind() {
    $('btnStart').addEventListener('click', startCase);
    $('btnPause').addEventListener('click', togglePause);
    $('btnReplay').addEventListener('click', replaySignals);
    $('btnRestart').addEventListener('click', function () {
      startCase();
    });
    $('answerForm').addEventListener('submit', submitAnswer);
  }

  bind();
  window.LHApp = {
    startCase: startCase,
    replaySignals: replaySignals,
    togglePause: togglePause,
    _state: function () { return st; }
  };
})();
