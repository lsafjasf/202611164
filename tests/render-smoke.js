/* Node 端渲染冒烟：用 node-canvas 执行 render.js，验证完整绘制链路并输出 PNG */
const path = require('path');
const fs = require('fs');
const { createCanvas } = require('canvas');

const VC = require(path.join(__dirname, '..', 'js', 'core.js'));
const canvas = createCanvas(VC.WORLD_W, VC.WORLD_H);
const ctx = canvas.getContext('2d');

global.self = global;
global.ValleyCloud = VC;
global.document = undefined;
require(path.join(__dirname, '..', 'js', 'render.js'));
const VR = global.ValleyRender;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
  } catch (err) {
    failures++;
    console.error('  ✗ ' + name + ' — ' + err.message);
  }
}

console.log('== render.js 冒烟测试 ==');
const layout = VC.generateLayout(20261116);
check('默认布局完整渲染（山脊+云团+阴影+风迹）', () => {
  VR.renderFrame(ctx, layout, { showTargets: true, showRegions: true, phase: 1.2 });
});

check('风向切换后渲染（轮廓与阴影同布局）', () => {
  ['E', 'W', 'S', 'N'].forEach((dir) => {
    const l = VC.generateLayout(987654321, { windDir: dir });
    VR.renderFrame(ctx, l, { phase: 0.5 });
  });
});

check('阻断场景渲染（红叉与阻断圈）', () => {
  const wall = [];
  for (let y = 40; y <= 560; y += 70) {
    wall.push({ id: 'wall-' + y, kind: 'custom', x: 480, y, r: 46 });
  }
  const blocked = VC.generateLayout(20261116, VC.defaultParams(), wall);
  if (blocked.route.ok) throw new Error('预期应阻断但路径可达');
  VR.renderFrame(ctx, blocked, { animate: false });
});

check('导出非空 PNG', () => {
  const buf = canvas.toBuffer('image/png');
  if (!buf || buf.length < 1000) throw new Error('PNG 数据异常，长度=' + (buf && buf.length));
  const out = path.join(__dirname, '..', 'artifacts', 'smoke-seed20261116.png');
  fs.writeFileSync(out, buf);
  console.log('    写出 ' + out + '（' + buf.length + ' 字节）');
});

process.exit(failures ? 1 : 0);
