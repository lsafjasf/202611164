// 界面冒烟测试：用最小 DOM 桩加载 app.js，验证初始化与按钮流程不抛异常。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    files: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    children: [],
    appendChild(c) { this.children.push(c); },
    prepend(c) { this.children.unshift(c); },
    click() {},
    getContext: () => ({ clearRect() {}, fillRect() {}, strokeRect() {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 512 }),
    onclick: null,
    onchange: null,
    width: 1024,
    height: 1024,
  };
}

const ids = ['st-mode','st-util','st-repack','st-frames','st-size','st-mem','st-lastms','st-totalms',
  'btn-add','btn-remove','btn-repack','btn-export','file-import','atlas-canvas','frame-list',
  'recovery','recovery-text','errors','error-list','err-count'];
const els = Object.fromEntries(ids.map((id) => [id, makeEl(id)]));

const sandbox = {
  window: {},
  document: {
    getElementById: (id) => els[id] || makeEl(id),
    createElement: () => makeEl('dynamic'),
  },
  console,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob: class {},
  FileReader: class { readAsText() { if (this.onload) this.onload(); } },
  performance,
};
sandbox.window.SpriteAtlasLib = require('../src/packer.js');
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), sandbox);

// 初始化后统计已渲染
if (!els['st-util'].textContent.endsWith('%')) throw new Error('利用率未渲染');
// 添加 8 帧 x2 + 紧凑重排 + 删除流程
els['btn-add'].onclick();
els['btn-add'].onclick();
const framesAfterAdd = els['st-frames'].textContent;
if (framesAfterAdd !== '16') throw new Error('添加帧失败: ' + framesAfterAdd);
if (els['st-mode'].textContent !== '增量') throw new Error('模式应为增量: ' + els['st-mode'].textContent);
els['btn-repack'].onclick();
if (els['st-repack'].textContent !== '1') throw new Error('重排次数应为 1');
if (els['st-mode'].textContent !== '全量重排') throw new Error('模式应为全量重排');
// 未选中删除 -> 错误日志 +1 且恢复建议可见
els['btn-remove'].onclick();
if (els['err-count'].textContent !== '1') throw new Error('错误日志未记录');
if (els['recovery'].classList.contains('hidden')) throw new Error('恢复建议未显示');
console.log('UI 冒烟测试通过: 16 帧, 重排 1 次, 错误日志 1 条, 恢复建议可见');
