// DOM smoke test with jsdom (canvas 2D context is stubbed).
// Run: node test/smoke-dom.js
const fs = require('fs');
const path = require('path');
let JSDOM;
try {
  ({ JSDOM } = require('/tmp/node_modules/jsdom'));
} catch (err) {
  try {
    ({ JSDOM } = require('jsdom'));
  } catch (err2) {
    console.error('jsdom not installed; run: npm i jsdom');
    process.exit(0);
  }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/'
});
const { window } = dom;

const ctxStub = new Proxy({}, {
  get: function (t, prop) {
    if (prop === 'canvas') return null;
    return typeof prop === 'string' ? function () {} : undefined;
  },
  set: function () { return true; }
});
window.HTMLCanvasElement.prototype.getContext = function () { return ctxStub; };

window.eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'engine.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8'));

const doc = window.document;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  console.log('ok - ' + msg);
}

setTimeout(function () {
  const summary = doc.getElementById('summary').textContent;
  assert(/Seed/.test(summary), 'summary shows seed section');
  assert(/布局哈希/.test(summary), 'summary shows layout hash');
  assert(/树 \d+ · 灌木 \d+ · 草 \d+/.test(summary), 'summary shows target counts');
  assert(/风向/.test(summary), 'summary shows rule summary');

  const status0 = doc.getElementById('status').textContent;
  assert(/布局哈希 [0-9a-f]{8}/.test(status0), 'status shows 8-char hash on load');

  doc.getElementById('selftestBtn').click();
  const st = doc.getElementById('status').textContent;
  assert(/内置自检通过（16 项 \/ 2 个 seed）/.test(st), 'in-page self-test passes 16 checks');
  assert(!/FAIL/.test(st), 'no self-test failures');

  doc.querySelector('[data-season="winter"]').click();
  assert(/仅外观变化/.test(doc.getElementById('status').textContent),
    'season switch reports appearance-only change');

  doc.getElementById('saveBtn').click();
  const saved = window.localStorage.getItem('veg-generator-save-v1');
  assert(saved && JSON.parse(saved).hash, 'save persists params with hash');
  doc.getElementById('loadBtn').click();
  assert(/载入成功/.test(doc.getElementById('status').textContent),
    'load rebuilds identical hash');

  doc.querySelector('[data-seed="20261116"]').click();
  assert(/seed 20261116/.test(doc.getElementById('status').textContent),
    'second seed regenerates explicitly');

  doc.getElementById('grassDensity').value = '0.1';
  doc.getElementById('applyParams').click();
  assert(/重算范围：vegetation/.test(doc.getElementById('status').textContent),
    'density edit triggers vegetation-only recompute');

  var engineWorld = window.VegEngine.createWorld({ seed: 1337 });
  var windRes = window.VegEngine.updateParams(engineWorld, { windDirDeg: 90 });
  assert(windRes.rebuilt === 'appearance',
    'wind edit triggers appearance-only recompute');

  console.log('\nDOM smoke test passed.');
}, 50);
