'use strict';
const L = require('./logic.js');

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) failures++;
}

const seed = 20261116;
const c1 = L.generateCase(seed);
const c2 = L.generateCase(seed);

// 1. 同 seed 案件完全一致（线索顺序与惩罚规则稳定）
check('same seed -> identical case', JSON.stringify(c1) === JSON.stringify(c2));
check('penalty stable for seed', c1.penalty === c2.penalty && [5, 8, 10].includes(c1.penalty));

// 2. 三个频段各占一个距离档，顺序为合法排列
const ranges = L.BAND_KEYS.map((b) => c1.stations[b].range).sort().join(',');
check('ranges are a permutation of near/mid/far', ranges === 'far,mid,near');
check('order is a permutation of bands', c1.order.slice().sort().join(',') === 'high,low,mid');
check('exactly one false echo band', L.BAND_KEYS.includes(c1.falseEchoBand));
const fe = c1.stations[c1.falseEchoBand];
check('false echo gap differs from true gap', Math.abs(fe.falseEchoGap - fe.echoGap) > 0.3);

// 3. 完全正确的结论 -> 满分，无错误行
const perfect = { dir: {}, dist: {}, order: c1.order.slice() };
L.BAND_KEYS.forEach((b) => { perfect.dir[b] = c1.stations[b].dir; perfect.dist[b] = c1.stations[b].range; });
const okRes = L.evaluate(c1, perfect);
check('perfect guess -> all rows correct', okRes.wrongCount === 0 && okRes.correctCount === okRes.rows.length);
check('perfect guess -> max score', okRes.score === okRes.maxScore);

// 4. 错误结论 -> 指出具体判断维度（方位/距离/顺序各错一处）
const wrong = JSON.parse(JSON.stringify(perfect));
const b0 = L.BAND_KEYS[0];
wrong.dir[b0] = perfect.dir[b0] === 'left' ? 'right' : 'left';
wrong.dist[b0] = perfect.dist[b0] === 'near' ? 'far' : 'near';
wrong.order = [c1.order[1], c1.order[0], c1.order[2]];
const badRes = L.evaluate(c1, wrong);
const wrongRows = badRes.rows.filter((r) => !r.correct);
check('wrong guess -> errors detected', badRes.wrongCount >= 3);
check('dimension named: 方位', wrongRows.some((r) => r.dimension === '方位' && r.hint.includes('方位判断错误')));
check('dimension named: 距离', wrongRows.some((r) => r.dimension === '距离' && r.hint.includes('距离判断错误')));
check('dimension named: 播报顺序', wrongRows.some((r) => r.dimension.startsWith('播报顺序') && r.hint.includes('顺序判断错误')));
check('score penalized by seeded penalty', badRes.score === badRes.correctCount * c1.correctScore - badRes.wrongCount * c1.penalty);

// 5. 错误结论的提示包含真实参数（对应关系可展示）
check('rows carry truth data for settlement table', badRes.rows.every((r) => r.truth && r.data));

// 6. 不同 seed 产生不同案件
const c3 = L.generateCase(seed + 1);
check('different seed -> different case', JSON.stringify(c1) !== JSON.stringify(c3));

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
