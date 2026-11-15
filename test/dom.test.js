'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var { JSDOM } = require('jsdom');

function makeEnv() {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  var win = dom.window;

  // rAF 改为手动步进，避免主循环永久占用事件循环导致测试不退出。
  var rafQueue = [];
  win.requestAnimationFrame = function (cb) { rafQueue.push(cb); return rafQueue.length; };
  win.cancelAnimationFrame = function () { rafQueue.length = 0; };
  var clock = 0;
  var performance = { now: function () { return clock; } };
  Object.defineProperty(win, 'performance', { value: performance, configurable: true });
  function step(times) {
    for (var i = 0; i < times; i++) {
      clock += 16;
      var q = rafQueue.splice(0);
      q.forEach(function (cb) { cb(clock); });
    }
  }

  // Canvas 2D stub：记录 render 被调用，不真正绘制。
  win.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, { get: function (t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return function () { return { addColorStop: function () {} }; };
      }
      return typeof k === 'string' ? function () {} : undefined;
    }});
  };
  // Web Audio stub：记录发声频率，测频返回注入值。
  var blared = [];
  win.AudioContext = function () {
    return {
      state: 'running',
      currentTime: 0,
      sampleRate: 44100,
      destination: {},
      resume: function () {},
      suspend: function () {},
      createGain: function () {
        return { gain: { value: 1, setValueAtTime: function () {},
          exponentialRampToValueAtTime: function () {} }, connect: function () {} };
      },
      createOscillator: function () {
        return { type: '', frequency: { value: 0 }, connect: function () {},
          start: function () {}, stop: function () {} };
      },
      createAnalyser: function () {
        return { fftSize: 0, connect: function () {}, getFloatTimeDomainData: function () {} };
      }
    };
  };
  win.LHFoghorn = function () {
    this.ensure = function () {};
    this.now = function () { return 0; };
    this.blare = function (when, freq) { blared.push(freq); return when; };
    this.measure = function () { return null; };
    this.suspend = function () {};
    this.resume = function () {};
  };
  Object.defineProperty(win, 'LHFoghorn', { value: win.LHFoghorn, writable: true });

  ['js/case.js', 'js/scene.js', 'js/app.js'].forEach(function (f) {
    win.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  });
  return { dom: dom, win: win, blared: blared, step: step, advance: function (ms) { clock += ms; } };
}

test('页面加载后四个控制按钮存在且初始禁用态正确', function () {
  var env = makeEnv();
  var doc = env.dom.window.document;
  ['btnStart', 'btnPause', 'btnReplay', 'btnRestart', 'btnSubmit'].forEach(function (id) {
    assert.ok(doc.getElementById(id));
  });
  assert.equal(doc.getElementById('btnPause').disabled, true);
  assert.equal(doc.getElementById('verdict').classList.contains('hidden'), true);
});

test('开始 → 暂停 → 重播：按钮状态与日志事件正常，雾笛频率来自案件', function () {
  var env = makeEnv();
  var win = env.dom.window;
  var doc = win.document;
  doc.getElementById('seedInput').value = 'DOM-SEED-1';
  doc.getElementById('btnStart').click();
  assert.equal(win.LHApp._state().paused, false);

  doc.getElementById('btnPause').click();
  assert.equal(win.LHApp._state().paused, true);
  assert.equal(doc.getElementById('btnPause').textContent, '继续');
  doc.getElementById('btnPause').click();
  assert.equal(win.LHApp._state().paused, false);

  doc.getElementById('btnReplay').click();
  var st = win.LHApp._state();
  assert.equal(st.flashIdx, 0);
  assert.equal(st.hornIdx, 0);
  // 重播后时刻表仍是同一份对象引用（线索未重新生成）
  var c = LHCaseRef(win).createCase('DOM-SEED-1');
  assert.deepEqual(st.caseData, c);
});

test('错误提交：返航并出现按维度的错误提示，提交次数累加', function () {
  var env = makeEnv();
  var win = env.dom.window;
  var doc = win.document;
  doc.getElementById('seedInput').value = 'DOM-BAD';
  doc.getElementById('btnStart').click();
  var c = win.LHApp._state().caseData;
  doc.getElementById('r0').value = (c.route[0] + 1) % 10;
  doc.getElementById('r1').value = (c.route[1] + 1) % 10;
  doc.getElementById('r2').value = (c.route[2] + 1) % 10;
  doc.getElementById('delaySel').value = LHCaseRef(win).DELAY_BINS[(c.delayIndex + 1) % 3].id;
  doc.getElementById('windSel').value = String((c.windId + 1) % 3);
  doc.getElementById('btnSubmit').click();

  var st = win.LHApp._state();
  assert.equal(st.attempt, 1);
  assert.equal(st.phase, 'sailing');
  // 直接调用结算完成（跳过 rAF 航行动画）
  var verdict = LHCaseRef(win).buildVerdict(
    { route: doc.querySelectorAll('.row3 input').length
      ? [doc.getElementById('r0').value, doc.getElementById('r1').value,
         doc.getElementById('r2').value].map(Number) : [],
      delayId: doc.getElementById('delaySel').value,
      windId: Number(doc.getElementById('windSel').value) },
    c, st.sched, 1);
  assert.equal(verdict.result.allOk, false);
  assert.equal(verdict.result.hints.length, 3);
  assert.ok(verdict.result.hints.some(function (h) { return /风级判断错误/.test(h); }));
});

test('正确提交：成功结算，对照表三行全部判对并显示真实参数', function () {
  var env = makeEnv();
  var win = env.dom.window;
  var doc = win.document;
  doc.getElementById('seedInput').value = 'DOM-GOOD';
  doc.getElementById('btnStart').click();
  var c = win.LHApp._state().caseData;
  doc.getElementById('r0').value = c.route[0];
  doc.getElementById('r1').value = c.route[1];
  doc.getElementById('r2').value = c.route[2];
  doc.getElementById('delaySel').value = c.delayId;
  doc.getElementById('windSel').value = String(c.windId);
  doc.getElementById('btnSubmit').click();
  assert.equal(win.LHApp._state().phase, 'sailing');
  assert.equal(doc.getElementById('formMsg').textContent, '结论确认，开始按路线引导小船出港。');
});

test('同 seed 重开：案件参数与时刻表逐字段一致', function () {
  var env = makeEnv();
  var win = env.dom.window;
  var doc = win.document;
  doc.getElementById('seedInput').value = 'DOM-REOPEN';
  doc.getElementById('btnStart').click();
  var first = JSON.stringify({ c: win.LHApp._state().caseData,
    s: win.LHApp._state().sched });
  doc.getElementById('btnRestart').click();
  var second = JSON.stringify({ c: win.LHApp._state().caseData,
    s: win.LHApp._state().sched });
  assert.equal(second, first);
  assert.equal(win.LHApp._state().attempt, 0);
});

test('端到端：错误提交后步进时钟，返航结算面板渲染出三条维度对照与具体提示', function () {
  var env = makeEnv();
  var win = env.dom.window;
  var doc = win.document;
  doc.getElementById('seedInput').value = 'DOM-E2E';
  doc.getElementById('btnStart').click();
  var c = win.LHApp._state().caseData;
  doc.getElementById('r0').value = (c.route[0] + 1) % 10;
  doc.getElementById('r1').value = c.route[1];
  doc.getElementById('r2').value = c.route[2];
  doc.getElementById('delaySel').value = c.delayId;
  doc.getElementById('windSel').value = String(c.windId);
  doc.getElementById('btnSubmit').click();
  assert.equal(win.LHApp._state().phase, 'sailing');

  // 返航动画约 2.8s（1600ms 航行 + 1200ms 碰撞停顿），每步 16ms。
  env.advance(3000);
  env.step(200);
  var st = win.LHApp._state();
  assert.equal(st.phase, 'investigating');
  assert.equal(doc.getElementById('verdict').classList.contains('hidden'), false);
  var rows = doc.querySelectorAll('#verdictBody tr');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('.fail').textContent, '错误');
  assert.equal(rows[1].querySelector('.pass').textContent, '正确');
  assert.equal(rows[2].querySelector('.pass').textContent, '正确');
  var hintText = doc.getElementById('verdictHints').textContent;
  assert.ok(/路线判断错误/.test(hintText));
  assert.ok(!/机械延迟判断错误/.test(hintText));
  // 真实路线数字只在结算面板出现
  assert.ok(doc.getElementById('verdictBody').textContent.indexOf(c.route.join(' ')) !== -1);
});

test('防剧透：调查阶段页面任何可见文本都不含真实路线/延迟/风级答案', function () {
  var env = makeEnv();
  var win = env.dom.window;
  var doc = win.document;
  doc.getElementById('seedInput').value = 'DOM-SECRET';
  doc.getElementById('btnStart').click();
  env.step(5);
  var c = win.LHApp._state().caseData;
  var panel = doc.querySelector('.panel');
  assert.ok(panel.textContent.indexOf(c.route.join(' ')) === -1);
  // 真实延迟毫秒数不应出现在测量区（那里只允许出现玩家实测事件值）
  assert.ok(doc.getElementById('delayMeasure').textContent
    .indexOf(String(LHCaseRef(win).DELAY_BINS[c.delayIndex].ms)) === -1);
  // 结算面板在提交前保持隐藏
  assert.ok(doc.getElementById('verdict').classList.contains('hidden'));
  // 渲染状态在调查阶段不揭示礁石
  var renderStates = [];
  var orig = win.LHScene.prototype.render;
  win.LHScene.prototype.render = function (s) { renderStates.push(s.showReefs); };
  env.step(3);
  assert.ok(renderStates.every(function (v) { return v === false; }));
  win.LHScene.prototype.render = orig;
});

function LHCaseRef(win) { return win.LHCase; }
