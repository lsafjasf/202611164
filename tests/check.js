/* 可复现校验入口：node tests/check.js
 * 覆盖：双 seed 复现、目标可达、关键对象不重叠、场景边界、
 *       局部重算区域哈希、阻断定位、保存/载入布局哈希一致 */
const path = require('path');
const VC = require(path.join(__dirname, '..', 'js', 'core.js'));

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ ' + msg);
    process.exitCode = 1;
    return false;
  }
  console.log('  ✓ ' + msg);
  return true;
}

console.log('== 山谷云带生成器：固定 seed 可复现校验 ==');
const report = VC.runChecks();
report.results.forEach((r) => {
  assert(r.ok, r.name + (r.detail ? '（' + r.detail + '）' : ''));
});

console.log('\n== 双 seed 布局摘要 ==');
report.seeds.forEach((seed) => {
  const layout = VC.generateLayout(seed);
  const validation = VC.validateLayout(layout);
  console.log('  seed ' + seed +
    ' | peaks=' + layout.terrain.peaks.length +
    ' | targets=' + layout.targetCount +
    ' | puffs=' + layout.puffCount +
    ' | terrainHash=' + layout.terrainHash.slice(0, 10) +
    ' | layoutHash=' + layout.layoutHash.slice(0, 10) +
    ' | valid=' + validation.ok);
});

console.log('\n== 显式重新生成一致性 ==');
const s = report.seeds[0];
const first = VC.generateLayout(s, VC.defaultParams());
const regenerated = VC.generateLayout(s, VC.defaultParams());
assert(first.layoutHash === regenerated.layoutHash,
  '同一 seed 显式重新生成后布局哈希不变');

console.log('\n结果：' + (report.ok && process.exitCode !== 1 ? '全部通过' : '存在失败项'));
