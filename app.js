(function () {
  'use strict';
  const L = window.GameLogic;

  // ---------- 全局状态 ----------
  let caseData = null;
  let audio = null;          // { ctx, master, directBus, echoBus, falseBus, taps }
  let schedTimer = null;
  let nextLoopTime = {};     // band -> 下一次循环调度时刻（ctx 时间）
  let liveNodes = [];        // 已调度、可停止的源节点
  let running = false;
  let paused = false;
  let submitted = false;
  let silenceLeft = 2;
  let silencing = false;

  const $ = (id) => document.getElementById(id);

  // ---------- 音频引擎 ----------
  function initAudio() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    const directBus = ctx.createGain();
    const echoBus = ctx.createGain();
    const falseBus = ctx.createGain();
    directBus.connect(master);
    echoBus.connect(master);
    falseBus.connect(master);
    // 每个频段一条带通分路，驱动时间线（线索由实时音频产生）
    const taps = {};
    L.BAND_KEYS.forEach((band) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = L.BANDS[band].freq * 1.4;
      bp.Q.value = 2.5;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      master.connect(bp);
      bp.connect(an);
      taps[band] = an;
    });
    return { ctx, master, directBus, echoBus, falseBus, taps };
  }

  // ---------- 推断表单 ----------
  function buildGuessForm() {
    const wrap = $('bandGuesses');
    wrap.innerHTML = '';
    L.BAND_KEYS.forEach((band) => {
      const card = document.createElement('div');
      card.className = 'band-card';
      card.style.borderLeftColor = L.BANDS[band].color;
      card.innerHTML =
        `<h3>${L.BANDS[band].label}</h3>` +
        `<label>方位 <select id="dir-${band}"><option value="">—</option>` +
        L.DIR_KEYS.map((k) => `<option value="${k}">${L.DIR_LABELS[k]}</option>`).join('') +
        `</select></label>` +
        `<label>距离 <select id="dist-${band}"><option value="">—</option>` +
        L.RANGE_KEYS.map((k) => `<option value="${k}">${L.RANGES[k].label}</option>`).join('') +
        `</select></label>`;
      wrap.appendChild(card);
    });
    for (let i = 0; i < 3; i++) {
      const sel = $('order' + i);
      sel.innerHTML = '<option value="">—</option>' +
        L.BAND_KEYS.map((b) => `<option value="${b}">${L.BANDS[b].label}</option>`).join('');
    }
  }

  function collectGuesses() {
    const guesses = { dir: {}, dist: {}, order: [] };
    for (const band of L.BAND_KEYS) {
      guesses.dir[band] = $('dir-' + band).value;
      guesses.dist[band] = $('dist-' + band).value;
      if (!guesses.dir[band] || !guesses.dist[band]) return null;
    }
    for (let i = 0; i < 3; i++) {
      const v = $('order' + i).value;
      if (!v) return null;
      guesses.order.push(v);
    }
    if (new Set(guesses.order).size !== 3) return 'dup';
    return guesses;
  }

  // ---------- 提交与结算 ----------
  function submit() {
    if (submitted) return;
    if (!running) { setStatus('请先按「开始」监听线索，再提交结论。'); return; }
    const guesses = collectGuesses();
    if (guesses === null) { setStatus('请完成全部方位、距离与顺序选择后再提交。'); return; }
    if (guesses === 'dup') { setStatus('播报顺序中三个频段必须各出现一次。'); return; }
    submitted = true;
    stopAllSound();
    ['startBtn', 'pauseBtn', 'replayBtn', 'silenceBtn', 'submitBtn'].forEach((id) => { $(id).disabled = true; });
    const result = L.evaluate(caseData, guesses);
    renderSettlement(result, guesses);
    setStatus('已提交：真实地图与逐维度对照如下。');
  }

  function renderSettlement(result, guesses) {
    const sec = $('settlement');
    sec.classList.remove('hidden');
    $('scoreLine').innerHTML =
      `得分 <strong>${result.score}</strong> / ${result.maxScore}　` +
      `对 ${result.correctCount} 项 · 错 ${result.wrongCount} 项　` +
      `<span class="muted">（每对 +${caseData.correctScore}，每错 -${result.penalty}，惩罚规则由 seed 决定且同 seed 恒定）</span>`;
    const tbody = $('resultTable').querySelector('tbody');
    tbody.innerHTML = '';
    result.rows.forEach((row) => {
      const tr = document.createElement('tr');
      const cls = row.correct ? 'ok' : 'bad';
      tr.innerHTML =
        `<td>${row.dimension}</td>` +
        `<td><span class="dot" style="background:${L.BANDS[row.band].color}"></span>${L.BANDS[row.band].label}</td>` +
        `<td>${row.guess}</td>` +
        `<td>${row.truth}</td>` +
        `<td class="${cls}">${row.correct ? '✓ 正确' : '✗ 错误'}</td>` +
        `<td>${row.data}</td>` +
        `<td>${row.correct ? '—' : row.hint}</td>`;
      tbody.appendChild(tr);
    });
    drawMap(guesses);
    if (typeof sec.scrollIntoView === 'function') sec.scrollIntoView({ behavior: 'smooth' });
  }

  // ---------- 真实地图 ----------
  function drawMap(guesses) {
    const c = $('map');
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    const sx = (x) => W / 2 + (x / 14) * (W / 2 - 30);
    const sy = (y) => H - 40 - (y / 14) * (H - 70);
    g.fillStyle = '#0b0f14';
    g.fillRect(0, 0, W, H);
    // 山谷崖壁（顶部弧线）
    g.strokeStyle = '#3a4a5c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 30);
    g.quadraticCurveTo(W / 2, 6, W, 30);
    g.stroke();
    g.fillStyle = '#5b6b7d';
    g.font = '12px sans-serif';
    g.fillText('北崖壁（反射面）', W / 2 - 45, 22);
    // 距离分档参考环
    [[5, '近/中 5'], [8.5, '中/远 8.5']].forEach(([r, label]) => {
      g.strokeStyle = '#1d2733';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(sx(0), sy(0), (r / 14) * (H - 70), Math.PI, 2 * Math.PI);
      g.stroke();
      g.fillStyle = '#44536a';
      g.fillText(label, sx(0) + 6, sy(r) + 12);
    });
    // 玩家
    g.fillStyle = '#e8e0c8';
    g.beginPath();
    g.moveTo(sx(0), sy(0) - 8);
    g.lineTo(sx(0) - 7, sy(0) + 6);
    g.lineTo(sx(0) + 7, sy(0) + 6);
    g.closePath();
    g.fill();
    g.fillText('你', sx(0) + 10, sy(0) + 4);
    // 真实声源
    L.BAND_KEYS.forEach((band) => {
      const s = caseData.stations[band];
      g.fillStyle = L.BANDS[band].color;
      g.beginPath();
      g.arc(sx(s.x), sy(s.y), 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#dfe6ee';
      g.fillText(`${L.BANDS[band].label}·第${s.orderIndex + 1}棒`, sx(s.x) + 11, sy(s.y) + 4);
    });
    // 玩家估计（方位×距离档 -> 空心标记）
    const dirAngle = { left: 150, center: 90, right: 30 };
    const rangeMid = { near: 3.25, mid: 6.75, far: 10.5 };
    L.BAND_KEYS.forEach((band) => {
      const ang = (dirAngle[guesses.dir[band]] || 90) * Math.PI / 180;
      const r = rangeMid[guesses.dist[band]] || 6.75;
      const gx = r * Math.cos(ang), gy = r * Math.sin(ang);
      g.strokeStyle = L.BANDS[band].color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx(gx), sy(gy), 8, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#8fa3b8';
      g.fillText('你的估计', sx(gx) + 11, sy(gy) + 4);
    });
  }

  // ---------- 案件生命周期 ----------
  function loadCase(seed) {
    stopAllSound();
    caseData = L.generateCase(seed >>> 0);
    running = false;
    paused = false;
    submitted = false;
    silenceLeft = 2;
    silencing = false;
    $('caseInfo').textContent =
      `案件 #${caseData.seed} ｜ 答对 +${caseData.correctScore} ｜ 答错 -${caseData.penalty}（同 seed 恒定）`;
    $('penaltyInfo').textContent =
      `本局规则：每对 +${caseData.correctScore}，每错 -${caseData.penalty}；提交前不揭示任何真实参数。`;
    $('startBtn').disabled = false;
    $('pauseBtn').disabled = true;
    $('replayBtn').disabled = true;
    $('silenceBtn').disabled = true;
    $('silenceBtn').textContent = '消音窗口（剩 2）';
    $('submitBtn').disabled = false;
    $('settlement').classList.add('hidden');
    buildGuessForm();
    clearTimeline();
    setStatus('案件已就绪：按「开始」发声。调查阶段不会显示任何答案。');
  }

  function restartSameSeed() {
    const seed = parseInt($('seedInput').value, 10);
    loadCase(Number.isFinite(seed) ? seed : 1);
  }

  function randomSeed() {
    $('seedInput').value = Math.floor(Math.random() * 1e9);
    restartSameSeed();
  }

  // ---------- 初始化 ----------
  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    $('startBtn').addEventListener('click', startCase);
    $('pauseBtn').addEventListener('click', togglePause);
    $('replayBtn').addEventListener('click', replay);
    $('silenceBtn').addEventListener('click', silenceWindow);
    $('submitBtn').addEventListener('click', submit);
    $('restartBtn').addEventListener('click', restartSameSeed);
    $('newSeedBtn').addEventListener('click', randomSeed);
    $('seedInput').addEventListener('change', restartSameSeed);
    restartSameSeed();
    requestAnimationFrame(drawTimelineFrame);
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('DOMContentLoaded', init);
  }

  function scheduleMotif(band, when) {
    const s = caseData.stations[band];
    const ctx = audio.ctx;
    const peak = 0.5 / (1 + s.dist * 0.3);
    const pan = Math.max(-1, Math.min(1, s.x / 10));
    s.motif.forEach((ratio, n) => {
      const t = when + n * 0.22;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = L.BANDS[band].freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      osc.connect(g);
      g.connect(panner);
      panner.connect(audio.directBus);
      // 真回波：延迟 echoGap，低通染色，独立于直达声总线
      const dEcho = ctx.createDelay(4);
      dEcho.delayTime.value = s.echoGap;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      const gEcho = ctx.createGain();
      gEcho.gain.value = 0.38;
      g.connect(dEcho); dEcho.connect(lp); lp.connect(gEcho); gEcho.connect(audio.echoBus);
      // 假回波：延迟不符合几何规则，挂在 falseBus（消音窗口会一并压住）
      if (band === caseData.falseEchoBand) {
        const dFalse = ctx.createDelay(5);
        dFalse.delayTime.value = s.falseEchoGap;
        const gFalse = ctx.createGain();
        gFalse.gain.value = 0.3;
        g.connect(dFalse); dFalse.connect(gFalse); gFalse.connect(audio.falseBus);
      }
      osc.start(t);
      osc.stop(t + 0.25);
      liveNodes.push(osc);
    });
  }

  function schedulerTick() {
    if (!audio || submitted) return;
    const horizon = audio.ctx.currentTime + 0.6;
    L.BAND_KEYS.forEach((band) => {
      while (nextLoopTime[band] < horizon) {
        scheduleMotif(band, nextLoopTime[band]);
        nextLoopTime[band] += L.LOOP_SECONDS;
      }
    });
    // 清理已结束的节点引用
    const now = audio.ctx.currentTime;
    if (liveNodes.length > 600) liveNodes.splice(0, liveNodes.length - 600);
    void now;
  }

  function stopAllSound() {
    if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
    liveNodes.forEach((n) => { try { n.stop(); } catch (e) { /* 已停止 */ } });
    liveNodes = [];
    if (audio) {
      audio.directBus.gain.cancelScheduledValues(0);
      audio.falseBus.gain.cancelScheduledValues(0);
      audio.directBus.gain.value = 0;
      audio.falseBus.gain.value = 0;
      audio.echoBus.gain.cancelScheduledValues(0);
      audio.echoBus.gain.value = 0;
    }
  }

  function startScheduling() {
    const t0 = audio.ctx.currentTime + 0.4;
    L.BAND_KEYS.forEach((band) => {
      const s = caseData.stations[band];
      nextLoopTime[band] = t0 + s.orderIndex * L.ORDER_STAGGER + s.directDelay;
    });
    audio.directBus.gain.value = 1;
    audio.falseBus.gain.value = 1;
    audio.echoBus.gain.value = 1;
    schedulerTick();
    schedTimer = setInterval(schedulerTick, 90);
  }

  // ---------- 传输控制 ----------
  function setStatus(msg) { $('status').textContent = msg; }

  function startCase() {
    if (!audio) audio = initAudio();
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    stopAllSound();
    startScheduling();
    running = true;
    paused = false;
    timelineStart = audio.ctx.currentTime;
    lastColTime = null;
    clearTimeline();
    $('startBtn').disabled = true;
    $('pauseBtn').disabled = false;
    $('pauseBtn').textContent = '暂停';
    $('replayBtn').disabled = false;
    $('silenceBtn').disabled = false;
    setStatus('监听中：三个频段同时循环播放，注意到达时刻、回波时差与声像。');
  }

  function togglePause() {
    if (!running || submitted) return;
    if (!paused) {
      audio.ctx.suspend();
      paused = true;
      $('pauseBtn').textContent = '继续';
      setStatus('已暂停：调度冻结，线索内容不变。');
    } else {
      audio.ctx.resume();
      paused = false;
      $('pauseBtn').textContent = '暂停';
      setStatus('继续监听中。');
    }
  }

  function replay() {
    if (!running || submitted) return;
    if (paused) togglePause();
    stopAllSound();
    startScheduling(); // 相同 caseData：重播不改变任何线索参数
    timelineStart = audio.ctx.currentTime;
    lastColTime = null;
    clearTimeline();
    setStatus('已重播：参数与顺序完全一致的同一案件。');
  }

  function silenceWindow() {
    if (!running || paused || submitted || silencing || silenceLeft <= 0) return;
    silenceLeft--;
    silencing = true;
    const t = audio.ctx.currentTime;
    const d = audio.directBus.gain;
    const f = audio.falseBus.gain;
    d.cancelScheduledValues(t); f.cancelScheduledValues(t);
    d.setValueAtTime(d.value, t); f.setValueAtTime(f.value, t);
    d.linearRampToValueAtTime(0, t + 0.15);
    f.linearRampToValueAtTime(0, t + 0.15);
    d.linearRampToValueAtTime(1, t + 2.6);
    f.linearRampToValueAtTime(1, t + 2.6);
    $('silenceBtn').textContent = `消音窗口（剩 ${silenceLeft}）`;
    setStatus('消音窗口开启 2.5s：直达声与假回波被压住，只剩真回波。');
    setTimeout(() => {
      silencing = false;
      if (silenceLeft <= 0) $('silenceBtn').disabled = true;
      if (!submitted) setStatus('监听中。');
    }, 2700);
  }

  // ---------- 时间线（实时声纹，程序生成） ----------
  const PX_PER_SEC = 160;
  let timelineStart = 0;
  let lastColTime = null;
  const tlCanvas = () => $('timeline');

  function clearTimeline() {
    const c = tlCanvas();
    const g = c.getContext('2d');
    g.fillStyle = '#0b0f14';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#5b6b7d';
    g.font = '13px sans-serif';
    g.fillText('等待音频…按「开始」后此处滚动显示三个频段的实时声强', 20, c.height / 2);
  }

  function rmsOf(analyser) {
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  function drawTimelineFrame() {
    requestAnimationFrame(drawTimelineFrame);
    if (!running || paused || !audio) return;
    const c = tlCanvas();
    const g = c.getContext('2d');
    const now = audio.ctx.currentTime - timelineStart;
    if (lastColTime === null) lastColTime = now;
    let dt = now - lastColTime;
    if (dt <= 0) return;
    let px = dt * PX_PER_SEC;
    if (px < 1) return;
    px = Math.round(px);
    lastColTime = now;
    // 左移已有图像
    g.drawImage(c, -px, 0);
    const x0 = c.width - px;
    g.fillStyle = '#0b0f14';
    g.fillRect(x0, 0, px, c.height);
    // 0.5s 竖格线
    const prevTick = Math.floor((now - dt) / 0.5);
    const curTick = Math.floor(now / 0.5);
    if (curTick !== prevTick) {
      g.fillStyle = '#24303d';
      g.fillRect(c.width - 1, 0, 1, c.height);
      if (curTick % 4 === 0) {
        g.fillStyle = '#5b6b7d';
        g.font = '10px sans-serif';
        g.fillText((curTick * 0.5).toFixed(0) + 's', c.width - 22, 12);
      }
    }
    // 三个频段的实时声强条
    const stripH = c.height / 3;
    L.BAND_KEYS.forEach((band, i) => {
      const rms = Math.min(1, rmsOf(audio.taps[band]) * 2.2);
      const h = Math.max(1, rms * (stripH - 8));
      g.fillStyle = L.BANDS[band].color;
      g.fillRect(x0, (i + 1) * stripH - 4 - h, px, h);
    });
  }
})();
