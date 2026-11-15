import { SceneLoader, clone, findNode, hashValue, validateScene } from "./model.js";
import { CacheEngine, exportScene } from "./engine.js";
import {
  CORRUPTED_INPUTS,
  VIEWPORT,
  applyModification,
  buildBoundaryScene,
  buildNormalScene,
  sceneExportChecksum,
} from "./scenarios.js";

const MODIFICATIONS = ["size", "font", "hidden"];

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function errorRecord(error, source, sequence) {
  return {
    sequence,
    code: error.code ?? (error instanceof SyntaxError ? "PARSE_ERROR" : "RUNTIME_ERROR"),
    name: error.name ?? "Error",
    message: error.message,
    path: error.path ?? null,
    source,
  };
}

function resultSummary(result) {
  return {
    checksum: result.checksum,
    commands: result.commands.length,
    visited: result.visited,
    visible: result.visible,
    elapsedMs: round(result.metrics.elapsedMs),
    hitRate: round(result.metrics.hitRate, 4),
    hits: result.metrics.hits,
    misses: result.metrics.misses,
    recomputes: result.metrics.recomputes,
    layoutRecomputes: result.metrics.layoutRecomputes,
    renderRecomputes: result.metrics.renderRecomputes,
  };
}

function runModification(mode, modification, sceneFactory = buildNormalScene) {
  const scene = clone(sceneFactory());
  validateScene(scene);
  const engine = new CacheEngine({ mode });
  const initial = engine.render(scene, { viewport: VIEWPORT });
  const beforeResources = engine.resources();
  engine.resetStats();
  const target = applyModification(scene, modification);
  const invalidation = engine.invalidateSubtree(target);
  const modified = engine.render(scene, { viewport: VIEWPORT });
  const referenceEngine = new CacheEngine({ mode: "fixed" });
  const reference = referenceEngine.render(scene, { viewport: VIEWPORT, bypassCache: true });
  const errors = [];
  const matchesReference = modified.checksum === reference.checksum;
  if (!matchesReference) {
    errors.push({
      sequence: 1,
      code: "STALE_CACHE_RESULT",
      name: "CacheConsistencyError",
      message: `${modification} mutation produced ${modified.checksum}; expected ${reference.checksum}`,
      path: target.id,
      source: "cache-verifier",
    });
  }
  return {
    modification,
    targetId: target.id,
    finalResult: resultSummary(modified),
    reference: resultSummary(reference),
    matchesReference,
    stale: !matchesReference,
    exportStable: sceneExportChecksum(scene) === hashValue(JSON.parse(exportScene(scene))),
    invalidation,
    resources: {
      before: beforeResources,
      after: engine.resources(),
    },
    errors,
  };
}

function runNormal(mode) {
  const cases = MODIFICATIONS.map((modification) => runModification(mode, modification));
  return {
    mode,
    cases,
    finalResult: {
      checksum: hashValue(cases.map((item) => item.finalResult.checksum)),
      allMatchReference: cases.every((item) => item.matchesReference),
    },
    errors: cases.flatMap((item) => item.errors),
    resources: cases.reduce((total, item) => ({
      cacheEntries: total.cacheEntries + item.resources.after.cacheEntries,
      cacheBytes: total.cacheBytes + item.resources.after.cacheBytes,
      dependencyEdges: total.dependencyEdges + item.resources.after.dependencyEdges,
    }), { cacheEntries: 0, cacheBytes: 0, dependencyEdges: 0 }),
  };
}

function runBoundary(mode) {
  const scene = buildBoundaryScene();
  validateScene(scene);
  const engine = new CacheEngine({ mode });
  const initial = engine.render(scene, { viewport: VIEWPORT });
  const beforeResources = engine.resources();
  engine.resetStats();
  const frame = findNode(scene.root, "edge-frame");
  frame.width = "99%";
  frame.font = { size: 65, weight: 700 };
  const text = findNode(scene.root, "edge-text");
  text.visible = false;
  const invalidation = engine.invalidateSubtree(frame);
  const modified = engine.render(scene, { viewport: VIEWPORT });
  const reference = new CacheEngine({ mode: "fixed" })
    .render(scene, { viewport: VIEWPORT, bypassCache: true });
  return {
    mode,
    nodes: initial.visited,
    finalResult: resultSummary(modified),
    initialChecksum: initial.checksum,
    matchesReference: modified.checksum === reference.checksum,
    invalidation,
    resources: { before: beforeResources, after: engine.resources() },
    errors: modified.checksum === reference.checksum ? [] : [{
      sequence: 1,
      code: "BOUNDARY_STALE_RESULT",
      name: "CacheConsistencyError",
      message: "Boundary mutation did not match uncached reference",
      path: frame.id,
      source: "boundary-verifier",
    }],
  };
}

function runCorruptedBefore() {
  const errors = [];
  let sequence = 0;
  for (const item of CORRUPTED_INPUTS) {
    try {
      const parsed = JSON.parse(item.input);
      validateScene(parsed);
      throw new Error(`Fixture ${item.name} unexpectedly passed validation`);
    } catch (error) {
      sequence += 1;
      errors.push(errorRecord(error, `before:${item.name}`, sequence));
    }
  }
  return {
    mode: "legacy",
    finalResult: { outcome: "rejected", checksum: null, recovered: false },
    errors,
    resources: { cacheEntries: 0, cacheBytes: 0, dependencyEdges: 0 },
  };
}

function runCorruptedAfter() {
  const fallback = buildNormalScene();
  const logs = [];
  const logger = { error: (...args) => logs.push(args) };
  const loader = new SceneLoader(fallback, logger);
  const cases = [];
  for (const item of CORRUPTED_INPUTS) {
    const loaded = loader.load(item.input);
    validateScene(loaded.scene);
    const engine = new CacheEngine({ mode: "fixed" });
    const rendered = engine.render(loaded.scene, { viewport: VIEWPORT });
    const resources = engine.resources();
    cases.push({
      name: item.name,
      recovered: loaded.recovered,
      checksum: rendered.checksum,
      resources,
      error: loaded.errors[0],
    });
  }
  return {
    mode: "fixed",
    finalResult: {
      outcome: "recovered-with-safe-scene",
      checksum: hashValue(cases.map((item) => item.checksum)),
      recovered: cases.every((item) => item.recovered),
      exportEnabled: false,
    },
    cases,
    errors: cases.map((item) => ({
      sequence: item.error.id,
      code: item.error.code,
      name: "SceneValidationError",
      message: item.error.message,
      path: null,
      source: "scene-loader",
    })),
    logCount: logs.length,
    resources: {
      cacheEntries: cases.reduce((sum, item) => sum + item.resources.cacheEntries, 0),
      cacheBytes: cases.reduce((sum, item) => sum + item.resources.cacheBytes, 0),
      dependencyEdges: cases.reduce((sum, item) => sum + item.resources.dependencyEdges, 0),
    },
  };
}

export function runVerification() {
  const normal = { before: runNormal("legacy"), after: runNormal("fixed") };
  const boundary = { before: runBoundary("legacy"), after: runBoundary("fixed") };
  const corrupted = { before: runCorruptedBefore(), after: runCorruptedAfter() };
  return {
    schemaVersion: 1,
    viewport: VIEWPORT,
    groups: { normal, boundary, corrupted },
    summary: {
      normalBeforeStale: normal.before.cases.filter((item) => item.stale).length,
      normalAfterMatching: normal.after.cases.filter((item) => item.matchesReference).length,
      boundaryBeforeMatches: boundary.before.matchesReference,
      boundaryAfterMatches: boundary.after.matchesReference,
      corruptedBeforeRecovered: corrupted.before.finalResult.recovered,
      corruptedAfterRecovered: corrupted.after.finalResult.recovered,
      beforeErrorCount: normal.before.errors.length + boundary.before.errors.length + corrupted.before.errors.length,
      afterErrorCount: normal.after.errors.length + boundary.after.errors.length + corrupted.after.errors.length,
    },
  };
}

export function compareVerificationRuns(first, second) {
  const stripVolatile = (value) => {
    if (Array.isArray(value)) return value.map(stripVolatile);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "elapsedMs" && key !== "at")
        .map(([key, child]) => [key, stripVolatile(child)]),
    );
  };
  const stable = (report) => stripVolatile({ groups: report.groups, summary: report.summary });
  return hashValue(stable(first)) === hashValue(stable(second));
}
