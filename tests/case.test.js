import test from "node:test";
import assert from "node:assert/strict";
import {
  MATERIALS,
  generateCase,
  gradeSubmission
} from "../js/case.js";

const SEED = "NIGHT-001";
const CASE = generateCase(SEED);
const TRUTH = CASE.sources.map((source) => source.materialId);

function materialOutsideTruth() {
  return MATERIALS.find((material) => !TRUTH.includes(material.id)).id;
}

test("同 seed 固定生成相同线索顺序和惩罚规则", () => {
  const first = generateCase(SEED);
  const second = generateCase(SEED);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.sources.map((source) => source.materialId),
    second.sources.map((source) => source.materialId)
  );
  assert.deepEqual(
    first.sources.map((source) => source.time),
    second.sources.map((source) => source.time)
  );
  assert.deepEqual(first.penalty, second.penalty);
  assert.equal(new Set(first.sources.map((source) => source.materialId)).size, 3);
});

test("正确结论通过：三个材质与时间顺序全部吻合", () => {
  const result = gradeSubmission(CASE, TRUTH);

  assert.equal(result.valid, true);
  assert.equal(result.success, true);
  assert.equal(result.dimension, "all");
  assert.equal(result.score, 100);
  assert.equal(result.rows.length, 3);
  result.rows.forEach((row, index) => {
    assert.equal(row.guess, TRUTH[index]);
    assert.equal(row.actual, TRUTH[index]);
    assert.equal(row.materialCorrect, true);
    assert.ok(row.sourceId.startsWith("S-"));
    assert.ok(row.time > 0);
    assert.ok(row.frequency > 0);
  });
});

test("错误材质结论被识别为材质维度，并展示对应声源、时间和频段", () => {
  const guesses = [...TRUTH];
  guesses[1] = materialOutsideTruth();
  const result = gradeSubmission(CASE, guesses);

  assert.equal(result.valid, true);
  assert.equal(result.success, false);
  assert.equal(result.dimension, "material");
  assert.match(result.message, /材质判断错误/);
  assert.match(result.message, /第 2 声/);
  assert.equal(result.score, 100 - CASE.penalty.material);
  assert.equal(result.rows[1].materialCorrect, false);
  assert.equal(result.rows[1].actual, TRUTH[1]);
  assert.equal(result.rows[1].sourceId, CASE.sources[1].id);
  assert.equal(result.rows[1].time, CASE.sources[1].time);
  assert.ok(result.rows[1].band.length > 0);
});

test("错误顺序结论被识别为顺序维度，不误报材质集合", () => {
  const guesses = [TRUTH[1], TRUTH[0], TRUTH[2]];
  const result = gradeSubmission(CASE, guesses);

  assert.equal(result.valid, true);
  assert.equal(result.success, false);
  assert.equal(result.dimension, "order");
  assert.match(result.message, /顺序判断错误/);
  assert.match(result.message, /时间槽错位/);
  assert.ok(result.score < 100);
  assert.equal(result.breakdown[0].status, "pass");
  assert.equal(result.breakdown[1].status, "fail");
});

test("不完整与重复提交不会揭示或误判成功", () => {
  const incomplete = gradeSubmission(CASE, [TRUTH[0], "", ""]);
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.dimension, "form");
  assert.equal(incomplete.rows.length, 0);

  const duplicate = gradeSubmission(CASE, [TRUTH[0], TRUTH[0], TRUTH[2]]);
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.dimension, "material");
  assert.match(duplicate.message, /不同地面材质/);
  assert.equal(duplicate.rows.length, 0);
});

test("不同 seed 有权重不同的惩罚规则，但案件内部保持一致", () => {
  const cases = Array.from({ length: 24 }, (_, index) => generateCase(`PENALTY-${index}`));
  const signatures = new Set(cases.map((item) => `${item.penalty.material}/${item.penalty.sequence}`));

  assert.ok(signatures.size > 1);
  for (const item of cases) {
    const again = generateCase(item.seed);
    assert.deepEqual(item.penalty, again.penalty);
    assert.deepEqual(
      item.sources.map((source) => [source.materialId, source.time]),
      again.sources.map((source) => [source.materialId, source.time])
    );
  }
});
