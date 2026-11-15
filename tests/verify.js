/* 运行：node tests/verify.js
 * 验证要求：至少一次正确结论、一次错误结论；错误提示指出具体判断维度；
 * 同 seed 线索顺序与惩罚规则恒定；暂停/重播不改变线索内容。 */
const assert = require("assert");
const E = require("../js/engine.js");
const V = require("../js/visuals.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (err) { console.error("  ✗ " + name + "\n    " + err.message); process.exitCode = 1; }
}

function truthAnswers(caseData) {
  const answers = {};
  caseData.passages.forEach(function (p) {
    answers[p.index] = { source: p.source, wall: p.wall, door: p.door };
  });
  return answers;
}

function wrongAnswers(caseData) {
  const answers = truthAnswers(caseData);
  answers[0].source = caseData.passages[1].source;
  answers[1].wall = caseData.passages[2].wall;
  return answers;
}

console.log("1) Seed 确定性");
test("同一 seed 生成完全相同的案件与线索顺序", function () {
  const a = E.generateCase("seed-abc");
  const b = E.generateCase("seed-abc");
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(E.deterministicSummary(a), E.deterministicSummary(b));
});

test("不同 seed 产生不同真相排列", function () {
  const a = E.generateCase("seed-1");
  const b = E.generateCase("seed-2");
  assert.notStrictEqual(
    JSON.stringify(a.passages.map(function (p) { return p.source + p.wall + p.door; })),
    JSON.stringify(b.passages.map(function (p) { return p.source + p.wall + p.door; }))
  );
});

test("惩罚规则对同一 seed 恒定（每条错误固定 " + E.PENALTY_SECONDS + "s）", function () {
  const c = E.generateCase("seed-abc");
  const g1 = E.gradeSubmission(c, wrongAnswers(c));
  const g2 = E.gradeSubmission(E.generateCase("seed-abc"), wrongAnswers(c));
  assert.strictEqual(g1.penaltySeconds, g1.wrongCount * c.penaltySeconds);
  assert.strictEqual(g1.penaltySeconds, g2.penaltySeconds);
});

console.log("2) 正确结论结算");
test("全部选对：9/9 正确、零惩罚", function () {
  const c = E.generateCase("seed-correct");
  const grade = E.gradeSubmission(c, truthAnswers(c));
  assert.strictEqual(grade.correctCount, 9);
  assert.strictEqual(grade.wrongCount, 0);
  assert.strictEqual(grade.penaltySeconds, 0);
  assert.ok(grade.rows.every(function (r) { return r.correct; }));
});

console.log("3) 错误结论结算与维度提示");
test("故意选错 2 条：评分与固定惩罚正确", function () {
  const c = E.generateCase("seed-wrong");
  const grade = E.gradeSubmission(c, wrongAnswers(c));
  assert.strictEqual(grade.wrongCount, 2);
  assert.strictEqual(grade.correctCount, 7);
  assert.strictEqual(grade.penaltySeconds, 2 * E.PENALTY_SECONDS);
});

test("错误提示指出具体通道与判断维度", function () {
  const c = E.generateCase("seed-wrong");
  const hints = E.wrongHints(E.gradeSubmission(c, wrongAnswers(c)));
  assert.strictEqual(hints.length, 2);
  assert.ok(hints[0].indexOf("通道一") >= 0 && hints[0].indexOf("声源类型") >= 0);
  assert.ok(hints[1].indexOf("通道二") >= 0 && hints[1].indexOf("墙面材质") >= 0);
});

console.log("4) 结算证据并列展示");
test("每行包含声源、时间/窗口、频段与真实参数对照", function () {
  const c = E.generateCase("seed-evidence");
  const grade = E.gradeSubmission(c, wrongAnswers(c));
  const rows = E.buildEvidenceRows(c, grade, [
    { label: "窗口 A", start: 3.2 }, { label: "窗口 B", start: 21.5 }
  ]);
  assert.strictEqual(rows.length, 9);
  rows.forEach(function (r) {
    ["passage", "dimension", "chosen", "truth", "sourceLabel", "timeInfo", "windowInfo", "band"].forEach(function (k) {
      assert.ok(r[k] && String(r[k]).length > 0, "缺少字段 " + k);
    });
  });
  const wallRow = rows.filter(function (r) { return r.dimension === "墙面材质"; })[0];
  assert.ok(/RT60/.test(wallRow.band));
  const doorRow = rows.filter(function (r) { return r.dimension === "门洞大小"; })[0];
  assert.ok(/低通/.test(doorRow.band));
});

console.log("5) 实时声音线索的频段可辨识");
test("FFT 峰值定位到低频嗡鸣频段（< 250 Hz）", function () {
  const rate = 8000, size = 1024;
  const samples = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    samples[i] = Math.sin((2 * Math.PI * 110 * i) / rate) +
      0.05 * Math.sin((2 * Math.PI * 2000 * i) / rate);
  }
  const mag = V.magnitudeSpectrum(samples, size);
  const peak = V.peakBin(mag, rate, size);
  assert.ok(peak.frequency < 250, "峰值频率 " + peak.frequency.toFixed(1) + " 不在低频");
});

test("FFT 峰值定位到滴水高频频段（> 2 kHz）", function () {
  const rate = 16000, size = 1024;
  const samples = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    samples[i] = Math.sin((2 * Math.PI * 3200 * i) / rate);
  }
  const peak = V.peakBin(V.magnitudeSpectrum(samples, size), rate, size);
  assert.ok(peak.frequency > 2000, "峰值频率 " + peak.frequency.toFixed(1) + " 不在高频");
});

console.log("6) 重播/暂停不改变线索内容");
test("64 秒循环内每个通道事件时间固定且可重绕", function () {
  const c = E.generateCase("seed-loop");
  c.passages.forEach(function (p) {
    const evs = c.events.filter(function (ev) { return ev.source === p.index; });
    assert.ok(evs.length >= 5);
    evs.forEach(function (ev) {
      assert.ok(ev.time >= 0 && ev.time < c.loopSeconds);
    });
  });
  const again = E.generateCase("seed-loop");
  assert.strictEqual(JSON.stringify(again.events), JSON.stringify(c.events));
});

test("同 seed 重开后的证据描述与首次完全一致", function () {
  const c1 = E.generateCase("seed-reopen");
  const c2 = E.generateCase("seed-reopen");
  const r1 = JSON.stringify(E.buildEvidenceRows(c1, E.gradeSubmission(c1, wrongAnswers(c1)), []));
  const r2 = JSON.stringify(E.buildEvidenceRows(c2, E.gradeSubmission(c2, wrongAnswers(c2)), []));
  assert.strictEqual(r1, r2);
});

console.log("\n" + (process.exitCode ? "存在失败用例" : passed + " 项验证全部通过"));
