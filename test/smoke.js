/*
 * 无浏览器冒烟测试:用最小 DOM 桩加载 index.html 的脚本序列,
 * 模拟点击"正常场景"与"取消",验证 UI 接线与状态回滚。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx2d() {
  return new Proxy({}, {
    get: (t, prop) => {
      if (prop === 'measureText') return () => ({ width: 0 });
      return () => undefined;
    },
    set: () => true
  });
}

function makeEl(id) {
  const listeners = {};
  return {
    id,
    style: {},
    children: [],
    disabled: false,
    hidden: false,
    value: 'strict',
    textContent: '',
    innerHTML: '',
    className: '',
    clientWidth: 800,
    clientHeight: 320,
    width: 0,
    height: 0,
    scrollTop: 0,
    scrollHeight: 0,
    files: [],
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatch: (ev, arg) => { (listeners[ev] || []).forEach((fn) => fn(arg || {})); },
    appendChild(c) { this.children.push(c); },
    append(...cs) { this.children.push(...cs); },
    getContext: () => makeCtx2d()
  };
}

const ids = ['stage', 'metrics', 'errors', 'log', 'recovery',
  'progressFill', 'btnCancel', 'mode', 'btnNormal', 'btnBoundary',
  'btnCorrupted', 'fileInput'];
const els = {};
ids.forEach((id) => { els[id] = makeEl(id); });

const documentStub = {
  getElementById: (id) => els[id] || null,
  createElement: () => makeEl('dyn')
};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  performance,
  document: documentStub,
  devicePixelRatio: 1,
  module: undefined
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['chunkParser.js', 'importer.js', 'scenarios.js',
  'canvasView.js', 'main.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

(async () => {
  // 1. 正常场景导入
  els.btnNormal.dispatch('click');
  await new Promise((r) => setTimeout(r, 3000));
  if (els.btnCancel.disabled !== true) throw new Error('导入结束后取消按钮应禁用');
  const metricsText = els.metrics.children.map((c) => c.textContent).join('|');
  if (!/50000/.test(metricsText)) {
    throw new Error('指标面板应显示 50000 帧,实际: ' + metricsText);
  }
  if (!/严格模式/.test(metricsText)) throw new Error('指标面板应显示当前模式');
  console.log('smoke: 正常场景导入 OK,指标面板含 50000 帧与模式');

  // 2. 取消场景:启动大导入并立即取消
  els.btnNormal.dispatch('click');
  await new Promise((r) => setTimeout(r, 20));
  els.btnCancel.dispatch('click');
  await new Promise((r) => setTimeout(r, 500));
  const logText = els.log.children.map((c) => c.textContent).join('\n');
  if (!/取消/.test(logText)) throw new Error('日志应记录取消事件');
  const recoveryText = els.recovery.textContent;
  if (!/未产生任何部分数据/.test(recoveryText)) {
    throw new Error('取消后应提示未产生部分数据,实际: ' + recoveryText);
  }
  console.log('smoke: 取消回滚 OK,恢复建议已显示');

  // 3. 损坏场景(严格模式)应失败并给出字段级错误与恢复建议
  els.btnCorrupted.dispatch('click');
  await new Promise((r) => setTimeout(r, 500));
  const errText = els.errors.children.map((c) => c.textContent).join('\n');
  if (!/root\.keyframes\[100\]/.test(errText)) {
    throw new Error('应显示字段级错误路径,实际: ' + errText);
  }
  if (!/容错模式/.test(els.recovery.textContent)) {
    throw new Error('应给出切换容错模式的恢复建议');
  }
  console.log('smoke: 损坏场景字段级错误与恢复建议 OK');

  console.log('SMOKE PASS');
  process.exit(0);
})().catch((err) => {
  console.error('SMOKE FAIL:', err.message);
  process.exit(1);
});
