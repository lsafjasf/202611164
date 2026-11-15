// jsdom 冒烟测试：验证 UI 接线、提交流程、结算渲染（音频与 canvas 用桩替代）
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = '/home/hj/userfeedback/uid777';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

// canvas 2D 桩：吸收所有绘图调用
window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, {
    get: (t, prop) => (prop === 'canvas' ? null : () => {}),
    set: () => true,
  });
};
// AudioContext 桩
function param() {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
}
function node() {
  return { connect() {}, disconnect() {}, start() {}, stop() {},
    gain: param(), pan: param(), frequency: param(), Q: param(), delayTime: param(),
    fftSize: 0, getByteTimeDomainData(arr) { arr.fill(128); } };
}
window.AudioContext = function () {
  return {
    currentTime: 0, state: 'running', destination: {},
    resume() {}, suspend() {},
    createGain: node, createOscillator: node, createStereoPanner: node,
    createBiquadFilter: node, createAnalyser: node, createDelay: node,
  };
};
window.requestAnimationFrame = () => 0;

(async () => {
let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}

window.eval(fs.readFileSync(path.join(root, 'logic.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

const $ = (id) => window.document.getElementById(id);
const L = window.GameLogic;

check('case loaded on init', $('caseInfo').textContent.includes('案件 #'));
check('penalty rule shown pre-submit', $('penaltyInfo').textContent.includes('-'));
check('settlement hidden during investigation', $('settlement').classList.contains('hidden'));
check('guess form built for 3 bands', L.BAND_KEYS.every((b) => $('dir-' + b) && $('dist-' + b)));

// 开始 -> 暂停 -> 继续 -> 重播 -> 两次消音窗口
$('startBtn').click();
check('start disables start button', $('startBtn').disabled === true);
$('pauseBtn').click();
check('pause toggles label', $('pauseBtn').textContent === '继续');
$('pauseBtn').click();
$('replayBtn').click();
$('silenceBtn').click();
check('silence window count decrements', $('silenceBtn').textContent.includes('剩 1'));
// 窗口生效期间不可重叠开启，等 2.8s 后再用第二次
await new Promise((r) => setTimeout(r, 2900));
$('silenceBtn').click();
check('second silence window allowed', $('silenceBtn').textContent.includes('剩 0'));

// 未填完时提交被拒绝
$('submitBtn').click();
check('incomplete submit rejected', $('settlement').classList.contains('hidden'));

// 填入完全正确的结论（调查阶段答案不可见，这里直接读逻辑层模拟理想玩家）
const seed = parseInt($('seedInput').value, 10);
const kase = L.generateCase(seed);
L.BAND_KEYS.forEach((b) => {
  $('dir-' + b).value = kase.stations[b].dir;
  $('dist-' + b).value = kase.stations[b].range;
});
kase.order.forEach((b, i) => { $('order' + i).value = b; });
$('submitBtn').click();
check('settlement shown after submit', !$('settlement').classList.contains('hidden'));
const rows = window.document.querySelectorAll('#resultTable tbody tr');
check('settlement lists every judgment row', rows.length === 9);
check('perfect guess -> all rows marked correct',
  window.document.querySelectorAll('#resultTable td.ok').length === 9);
check('score line shows max score', $('scoreLine').textContent.includes('/ 90'));

// 同 seed 重开：案件信息一致，表单重置，可再次完整走流程
$('restartBtn').click();
check('restart keeps same case id', $('caseInfo').textContent.includes('案件 #' + seed));
check('restart hides settlement', $('settlement').classList.contains('hidden'));
check('restart resets silence windows', $('silenceBtn').textContent.includes('剩 2'));
$('startBtn').click();
L.BAND_KEYS.forEach((b) => {
  $('dir-' + b).value = kase.stations[b].dir === 'left' ? 'right' : 'left';
  $('dist-' + b).value = kase.stations[b].range === 'near' ? 'far' : 'near';
});
$('order0').value = kase.order[1];
$('order1').value = kase.order[0];
$('order2').value = kase.order[2];
$('submitBtn').click();
const wrongCells = window.document.querySelectorAll('#resultTable td.bad').length;
check('wrong guess -> error rows flagged', wrongCells >= 5);
const hints = [...window.document.querySelectorAll('#resultTable td')].map((td) => td.textContent).join(' ');
check('error hints name dimensions',
  hints.includes('方位判断错误') && hints.includes('距离判断错误') && hints.includes('顺序判断错误'));
check('false-echo hint appears for decoy band', hints.includes('假回波'));

console.log(failures === 0 ? '\nSMOKE OK' : `\n${failures} SMOKE FAILURE(S)`);
process.exit(failures ? 1 : 0);
})();
