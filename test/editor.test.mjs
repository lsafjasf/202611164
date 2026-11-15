import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EditorSession, LIMITS, stableHash } from "../src/core.js";
import { LegacyEditorSession } from "../src/legacy-baseline.js";
import { makeNormalDocument } from "../src/sample-data.js";
import {
  makeSession,
  repeatableProjection,
  runScenario,
} from "./scenario-runner.mjs";

test("正常场景在修改前后导出相同，关闭后修复版资源归零", () => {
  const after = runScenario("normal", EditorSession);
  const before = runScenario("normal", LegacyEditorSession);

  assert.equal(after.final.signature, before.final.signature);
  assert.equal(after.final.documentHash, before.final.documentHash);
  assert.deepEqual(after.final, before.final);
  assert.equal(after.resources.canvases, 0);
  assert.equal(after.resources.listeners, 0);
  assert.equal(after.resources.targetListeners, 0);
  assert.equal(after.resources.cacheEntries, 0);
  assert.ok(before.resources.canvases > 0);
  assert.ok(before.resources.listeners > 0);
  assert.ok(before.resources.targetListeners > 0);
  assert.ok(before.resources.cacheEntries > 0);
  assert.ok(after.resources.memoryEstimateBytes < before.resources.memoryEstimateBytes / 100);
  assert.ok(after.resources.historyEntries <= LIMITS.historyEntries);
  assert.ok(after.resources.historyBytes < before.resources.historyBytes);
});

test("边界场景保持导出等价，增量撤销受上限约束", () => {
  const after = runScenario("boundary", EditorSession);
  const before = runScenario("boundary", LegacyEditorSession);

  assert.equal(after.final.signature, before.final.signature);
  assert.equal(after.final.objectCount, 3);
  assert.equal(after.resources.canvases, 0);
  assert.equal(after.resources.listeners, 0);
  assert.equal(after.resources.cacheEntries, 0);
  assert.ok(after.resources.historyEntries <= LIMITS.historyEntries);
  assert.ok(after.resources.historyBytes < before.resources.historyBytes);
  assert.ok(before.resources.memoryEstimateBytes > after.resources.memoryEstimateBytes * 100);
});

test("损坏输入原子拒绝、日志可重复且修复版画布不变", () => {
  const first = runScenario("corrupt", EditorSession);
  const second = runScenario("corrupt", EditorSession);
  const before = runScenario("corrupt", LegacyEditorSession);

  assert.deepEqual(repeatableProjection(first), repeatableProjection(second));
  assert.equal(first.errors.length, 12);
  assert.equal(first.attempts.length, 12);
  assert.ok(first.attempts.every((attempt) => attempt.ok === false));
  assert.ok(first.attempts.every((attempt) => attempt.sceneUnchanged === true));
  assert.ok(first.attempts.some((attempt) => attempt.code === "INVALID_JSON"));
  assert.ok(first.attempts.some((attempt) => attempt.code === "TOO_MANY_OBJECTS"));
  assert.equal(first.resources.canvases, 0);
  assert.equal(first.resources.listeners, 0);
  assert.equal(first.resources.cacheEntries, 0);
  assert.equal(first.resources.errorCount, 12);
  assert.notEqual(first.final.signature, before.final.signature);
  assert.ok(before.attempts.some((attempt) => attempt.sceneUnchanged === false));
  assert.ok(before.resources.canvases > 0);
});

test("撤销记录只保留增量，关闭重开后仍可撤销", () => {
  const { session } = makeSession(EditorSession, makeNormalDocument());
  session.open();
  session.addShape({
    id: "undo-probe",
    type: "rect",
    x: 10,
    y: 10,
    width: 100,
    height: 50,
    color: "#6ee7b7",
  });
  session.updateObject("undo-probe", { x: 42, opacity: 0.5 });
  session.addShape({
    id: "undo-second",
    type: "ellipse",
    x: 50,
    y: 60,
    width: 80,
    height: 40,
    color: "#60a5fa",
  });
  session.model.select(["undo-probe"]);
  session.deleteSelected();
  const finalSignature = session.exportSignature();

  session.undo();
  assert.ok(session.model.find("undo-probe"));
  session.undo();
  assert.equal(session.model.find("undo-second"), undefined);
  session.undo();
  assert.equal(session.model.find("undo-probe").x, 10);
  session.undo();
  assert.equal(session.model.find("undo-probe"), undefined);
  for (let index = 0; index < 4; index += 1) session.redo();
  assert.equal(session.exportSignature(), finalSignature);

  const history = session.history.snapshot();
  assert.ok(history.bytes < session.model.estimatedBytes() * history.entries);
  const report = session.close();
  assert.equal(report.after.canvases, 0);
  assert.equal(report.after.listeners, 0);
  assert.ok(report.after.historyEntries > 0);
  session.open();
  session.undo();
  assert.ok(session.model.find("undo-probe"));
  const metrics = session.memorySnapshot();
  assert.ok(metrics.canvases >= 1);
  assert.ok(metrics.lastOperationMs >= 0);
  session.close();
});

test("预览缓存有界、按对象失效并在关闭时释放", () => {
  const { session, target } = makeSession(EditorSession, makeNormalDocument());
  session.open();
  session.bindInput(target, { pointerdown() {} });
  for (const shape of session.model.objects) session.getPreview(shape, () => {});
  const filled = session.memorySnapshot();
  assert.equal(filled.cacheEntries, LIMITS.cacheEntries);
  assert.ok(filled.canvases <= LIMITS.cacheEntries + 2);

  for (const shape of [...session.model.objects].reverse()) session.getPreview(shape, () => {});
  assert.ok(session.memorySnapshot().cacheHits > 0);

  session.getPreview(session.model.find("normal-01"), () => {});
  const beforeUpdate = session.memorySnapshot().cacheEntries;
  session.updateObject("normal-01", { x: 333 });
  assert.equal(session.memorySnapshot().cacheEntries, beforeUpdate - 1);

  const report = session.close();
  assert.equal(report.after.cacheEntries, 0);
  assert.equal(report.after.canvases, 0);
  assert.equal(report.after.listeners, 0);
  assert.equal(target.count, 0);
});

test("严格校验在写入前失败并记录堆栈", () => {
  const document = makeNormalDocument();
  const { session } = makeSession(EditorSession, document);
  session.open();
  const before = session.exportSignature();
  assert.throws(
    () => session.importDocument('{"version":1,"objects":['),
    (error) => error.code === "INVALID_JSON",
  );
  assert.throws(
    () =>
      session.importDocument({
        version: 1,
        width: 100,
        height: 100,
        objects: [
          { id: "same", type: "rect", x: 0, y: 0, width: 1, height: 1, color: "#ffffff" },
          { id: "same", type: "rect", x: 2, y: 0, width: 1, height: 1, color: "#ffffff" },
        ],
      }),
    (error) => error.code === "DUPLICATE_ID",
  );
  assert.equal(session.exportSignature(), before);
  const errors = session.errors.list();
  assert.equal(errors.length, 2);
  assert.ok(errors.every((entry) => typeof entry.stack === "string"));
  assert.deepEqual(
    errors.map((entry) => [entry.operation, entry.code]),
    [
      ["import", "INVALID_JSON"],
      ["import", "DUPLICATE_ID"],
    ],
  );
  session.close();
});

test("低细节模式不改变导出内容", () => {
  const { session } = makeSession(EditorSession, makeNormalDocument());
  session.open();
  const full = session.exportDocument();
  session.setMode("reduced");
  const reduced = session.exportDocument();
  session.setMode("recovery");
  const recovery = session.exportDocument();
  assert.deepEqual(reduced, full);
  assert.deepEqual(recovery, full);
  assert.equal(stableHash(reduced), stableHash(full));
  assert.equal(stableHash(recovery), stableHash(full));
  session.close();
});

test("界面包含模式、耗时、资源与恢复建议的可视指标", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="modeBadge"/);
  assert.match(html, /id="elapsed"/);
  assert.match(html, /id="activeObjects"/);
  assert.match(html, /id="cacheEntries"/);
  assert.match(html, /id="memoryEstimate"/);
  assert.match(html, /恢复建议/);
  assert.match(html, /运行 20 轮打开\/关闭测试/);
  assert.match(html, /正常输入/);
  assert.match(html, /边界输入/);
  assert.match(html, /损坏输入/);
});
