import { EditorSession, stableHash } from "../src/core.js";
import { LegacyEditorSession } from "../src/legacy-baseline.js";
import {
  corruptPayloads,
  makeBoundaryDocument,
  makeEmptyBoundaryDocument,
  makeNormalDocument,
} from "./fixtures.mjs";

export class StubCanvas {
  constructor(width = 1, height = 1) {
    this.width = width;
    this.height = height;
  }
}

class CountingTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  get count() {
    let total = 0;
    for (const handlers of this.listeners.values()) total += handlers.size;
    return total;
  }
}

const HANDLERS = {
  pointerdown() {},
  pointermove() {},
  pointerup() {},
  keydown() {},
  resize() {},
};

function makeCanvasFactory() {
  return (width, height) => new StubCanvas(width, height);
}

export function makeSession(Implementation = EditorSession, initialDocument) {
  const target = new CountingTarget();
  const session = new Implementation({
    initialDocument,
    stageCanvas: new StubCanvas(1, 1),
    createCanvas: makeCanvasFactory(),
  });
  return { session, target };
}

function openAndBind(session, target) {
  session.open();
  const uniqueHandlers = Object.fromEntries(
    Object.entries(HANDLERS).map(([type, handler]) => [
      type,
      (...args) => handler(...args),
    ]),
  );
  session.bindInput(target, uniqueHandlers);
}

function summary(session, target) {
  const memory = session.memorySnapshot();
  return {
    sessionState: memory.sessionState,
    activeObjects: memory.activeObjects,
    selectedObjects: memory.selectedObjects,
    canvases: memory.canvases,
    canvasBytes: memory.canvasBytes,
    listeners: memory.listeners,
    targetListeners: target.count,
    cacheEntries: memory.cacheEntries,
    cacheBytes: memory.cacheBytes,
    cacheHitRate: memory.cacheHitRate,
    historyEntries: memory.historyEntries,
    historyBytes: memory.historyBytes,
    modelBytes: memory.modelBytes,
    memoryEstimateBytes: memory.memoryEstimateBytes,
    errorCount: memory.errorCount,
  };
}

function finalResult(session) {
  const document = session.exportDocument();
  return {
    signature: session.exportSignature(),
    documentHash: stableHash(document),
    objectCount: document.objects.length,
    width: document.width,
    height: document.height,
    objectIdsHash: stableHash(document.objects.map((shape) => shape.id)),
  };
}

function safeImport(session, payload) {
  const before = session.exportSignature();
  try {
    session.importDocument(payload.value);
    return {
      ok: true,
      name: payload.name,
      before,
      after: session.exportSignature(),
      sceneUnchanged: before === session.exportSignature(),
    };
  } catch (error) {
    return {
      ok: false,
      name: payload.name,
      before,
      after: session.exportSignature(),
      sceneUnchanged: before === session.exportSignature(),
      code: error.code || "UNEXPECTED",
      message: error.message,
      resources: session.memorySnapshot(),
    };
  }
}

function closeOut(session, target, closeReports, peak) {
  const report = session.close();
  closeReports.push(report);
  const after = summary(session, target);
  if (after.memoryEstimateBytes > peak.memoryEstimateBytes) Object.assign(peak, after);
  return after;
}

function runNormal(Implementation) {
  const { session, target } = makeSession(Implementation);
  const closeReports = [];
  const peak = { memoryEstimateBytes: 0 };
  openAndBind(session, target);
  session.importDocument(makeNormalDocument());

  for (let index = 0; index < 12; index += 1) {
    session.addShape({
      id: `session-${index + 1}`,
      type: index % 2 === 0 ? "rect" : "ellipse",
      x: 60 + index * 37,
      y: 90 + (index % 4) * 52,
      width: 90 + (index % 5) * 12,
      height: 54 + (index % 3) * 9,
      color: index % 2 === 0 ? "#60a5fa" : "#f59e0b",
    });
  }
  for (let index = 0; index < 24; index += 1) {
    session.updateObject(`normal-${String((index % 24) + 1).padStart(2, "0")}`, {
      x: 40 + index * 11,
      opacity: 0.6 + (index % 5) * 0.08,
    });
  }
  session.model.select(["normal-01", "normal-02", "session-1"]);
  session.translateSelection(7, -5);
  session.model.select(["normal-03"]);
  session.deleteSelected();
  session.undo();
  session.redo();

  for (let cycle = 0; cycle < 20; cycle += 1) {
    session.close();
    openAndBind(session, target);
    for (const shape of session.model.objects.slice(0, 9)) {
      session.getPreview(shape, () => {});
    }
    session.addShape({
      id: `cycle-${cycle + 1}`,
      type: "rect",
      x: 20 + cycle * 18,
      y: 660,
      width: 70,
      height: 34,
      color: "#a78bfa",
    });
    session.close();
    closeReports.push(session.lastCloseReport);
    const current = summary(session, target);
    if (current.memoryEstimateBytes > peak.memoryEstimateBytes) Object.assign(peak, current);
  }
  const after = summary(session, target);
  return {
    group: "normal",
    implementation: Implementation === EditorSession ? "after" : "before",
    final: finalResult(session),
    resources: after,
    peakResources: peak,
    closeCount: closeReports.length + 1,
    firstClose: closeReports[0] || null,
    lastClose: closeReports.at(-1) || null,
    errors: session.errors.sanitized(),
    errorDetails: session.errors.list(),
    lastOperationName: session.lastOperationName,
  };
}

function runBoundary(Implementation) {
  const { session, target } = makeSession(Implementation);
  const closeReports = [];
  const peak = { memoryEstimateBytes: 0 };
  openAndBind(session, target);
  session.importDocument(makeEmptyBoundaryDocument());
  session.importDocument(makeBoundaryDocument());
  for (let index = 0; index < 130; index += 1) {
    session.updateObject("text-max-length", { x: index });
  }
  for (let index = 0; index < 10; index += 1) session.undo();
  for (let index = 0; index < 10; index += 1) session.redo();

  for (let cycle = 0; cycle < 30; cycle += 1) {
    session.close();
    openAndBind(session, target);
    for (const shape of session.model.objects) session.getPreview(shape, () => {});
    session.close();
    closeReports.push(session.lastCloseReport);
    const current = summary(session, target);
    if (current.memoryEstimateBytes > peak.memoryEstimateBytes) Object.assign(peak, current);
  }
  return {
    group: "boundary",
    implementation: Implementation === EditorSession ? "after" : "before",
    final: finalResult(session),
    resources: summary(session, target),
    peakResources: peak,
    closeCount: closeReports.length + 1,
    firstClose: closeReports[0] || null,
    lastClose: closeReports.at(-1) || null,
    errors: session.errors.sanitized(),
    errorDetails: session.errors.list(),
  };
}

function runCorrupt(Implementation) {
  const { session, target } = makeSession(Implementation, makeNormalDocument());
  const closeReports = [];
  const attempts = [];
  const peak = { memoryEstimateBytes: 0 };
  for (let round = 0; round < 2; round += 1) {
    openAndBind(session, target);
    for (const payload of corruptPayloads) attempts.push(safeImport(session, payload));
    session.close();
    closeReports.push(session.lastCloseReport);
    const current = summary(session, target);
    if (current.memoryEstimateBytes > peak.memoryEstimateBytes) Object.assign(peak, current);
  }
  return {
    group: "corrupt",
    implementation: Implementation === EditorSession ? "after" : "before",
    final: finalResult(session),
    resources: summary(session, target),
    peakResources: peak,
    closeCount: closeReports.length,
    firstClose: closeReports[0] || null,
    lastClose: closeReports.at(-1) || null,
    attempts: attempts.map((attempt) => ({
      name: attempt.name,
      ok: attempt.ok,
      code: attempt.code || null,
      message: attempt.message || null,
      sceneUnchanged: attempt.sceneUnchanged,
    })),
    errors: session.errors.sanitized(),
    errorDetails: session.errors.list(),
  };
}

export function runScenario(group, Implementation = EditorSession) {
  if (group === "normal") return runNormal(Implementation);
  if (group === "boundary") return runBoundary(Implementation);
  if (group === "corrupt") return runCorrupt(Implementation);
  throw new Error(`未知场景: ${group}`);
}

export function repeatableProjection(result) {
  return {
    final: result.final,
    resources: result.resources,
    attempts: result.attempts,
    errors: result.errors,
    closeCount: result.closeCount,
  };
}

export function runAllScenarios(Implementation = EditorSession) {
  return Object.fromEntries(
    ["normal", "boundary", "corrupt"].map((group) => [group, runScenario(group, Implementation)]),
  );
}

export { LegacyEditorSession };
