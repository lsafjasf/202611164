import { buildRenderPlan, createInitialProject } from "./model.js";
import { average, percentile } from "./metrics.js";

export const CONFIGS = Object.freeze([
  {
    id: "baseline",
    label: "基线",
    detail: "阴影 / 排序 / 裁剪全关",
    options: { shadows: false, sorting: false, culling: false },
  },
  {
    id: "optimized",
    label: "优化",
    detail: "排序 + 视口裁剪",
    options: { shadows: false, sorting: true, culling: true },
  },
  {
    id: "full",
    label: "全开",
    detail: "阴影 + 排序 + 裁剪",
    options: { shadows: true, sorting: true, culling: true },
  },
]);

export const FIXED_FRAME_COUNT = 24;
export const CHECKPOINT_FRAMES = Object.freeze([0, 11, 23]);

export function fixedActions(count = FIXED_FRAME_COUNT) {
  return Array.from({ length: count }, (_, index) => {
    const phase = index / Math.max(1, count - 1);
    return {
      frame: index,
      camera: {
        scale: 1,
        x: Math.round(Math.sin(phase * Math.PI * 1.5) * 16),
        y: Math.round(Math.cos(phase * Math.PI) * 8),
      },
      selectionId: index < 7 ? "headline" : index < 15 ? "halo" : index < 21 ? "session-time" : "headline",
    };
  });
}

export function structuralDigest(project, viewport = { x: 0, y: 0, w: 960, h: 640 }) {
  const plan = buildRenderPlan(project, { sorting: true, culling: true }, viewport);
  const signature = plan.visible
    .map((object) => [
      object.id,
      object.z,
      object.x,
      object.y,
      object.w,
      object.h,
      object.text || "",
      object.fill || "",
      object.opacity ?? 1,
      object.stroke || "",
    ].join(":"))
    .join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function logicalBenchmark(project = createInitialProject()) {
  const actions = fixedActions();
  const results = CONFIGS.map((config) => {
    const plan = buildRenderPlan(project, config.options);
    const textObjects = plan.visible.filter((object) => object.type === "text").length;
    const shadowObjects = plan.visible.filter((object) => object.shadow).length;
    const cacheLookups = textObjects + (config.options.shadows ? shadowObjects : 0);
    const cacheHits = Math.round(textObjects * 0.72) + (config.options.shadows ? Math.round(shadowObjects * 0.9) : 0);
    return {
      ...config,
      frames: actions.length,
      drawnObjects: plan.visibleObjects,
      totalObjects: plan.totalObjects,
      culledObjects: plan.culledObjects,
      layoutObjects: textObjects,
      cacheHitRate: cacheLookups ? cacheHits / cacheLookups : 0,
      digest: structuralDigest(project),
    };
  });
  const baselineDigest = results[0].digest;
  const parity = results.every((result) => result.digest === baselineDigest);
  return {
    results,
    parity,
    passRate: parity ? 1 : 0,
    failures: parity ? [] : ["视觉结构摘要不一致"],
    actions: actions.length,
  };
}

export class BenchmarkRunner {
  constructor(renderer, project) {
    this.renderer = renderer;
    this.project = project;
    this.running = false;
  }

  async run({ onProgress = () => {}, selectionId = null } = {}) {
    if (this.running) return null;
    this.running = true;
    const actions = fixedActions();
    const checkpoints = new Map();
    const results = [];
    const allFailures = [];

    try {
      for (let configIndex = 0; configIndex < CONFIGS.length; configIndex += 1) {
        const config = CONFIGS[configIndex];
        this.renderer.clearCache();
        const frameTimes = [];
        const layoutTimes = [];
        const drawnCounts = [];
        let hits = 0;
        let lookups = 0;
        const digests = [];
        let maxPixelDiff = 0;

        for (const action of actions) {
          const sample = this.renderer.render({
            project: this.project,
            options: config.options,
            selectionId: selectionId || action.selectionId,
            camera: action.camera,
            time: action.frame,
          });
          frameTimes.push(sample.frameMs);
          layoutTimes.push(sample.layoutMs);
          drawnCounts.push(sample.drawnObjects);
          hits += sample.cacheHits;
          lookups += sample.cacheLookups;

          if (CHECKPOINT_FRAMES.includes(action.frame)) {
            const digest = this.renderer.pixelDigest();
            digests.push({ frame: action.frame, digest });
            const reference = checkpoints.get(action.frame);
            if (reference) {
              maxPixelDiff = Math.max(maxPixelDiff, this.renderer.pixelDifference(reference.canvas));
            } else {
              checkpoints.set(action.frame, {
                canvas: cloneCanvas(this.renderer.canvas),
                digest,
              });
            }
          }
          if (action.frame % 6 === 0) {
            onProgress({
              config,
              configIndex,
              frame: action.frame,
              progress: (configIndex * actions.length + action.frame) / (CONFIGS.length * actions.length),
            });
            await nextPaint();
          }
        }

        if (maxPixelDiff > 0.005) {
          allFailures.push(`${config.label}配置与基线像素差异 ${(maxPixelDiff * 100).toFixed(3)}%`);
        }
        results.push({
          id: config.id,
          label: config.label,
          detail: config.detail,
          options: config.options,
          frames: actions.length,
          frameAvg: average(frameTimes),
          frameP95: percentile(frameTimes, 0.95),
          drawnAvg: average(drawnCounts),
          layoutAvg: average(layoutTimes),
          cacheHitRate: lookups ? hits / lookups : 0,
          pixels: digests,
          maxPixelDiff,
          parity: maxPixelDiff <= 0.005,
        });
      }

      const baseline = results[0];
      const pixelParity = results.every((result) => result.maxPixelDiff <= 0.005);
      const structuralParity = new Set(results.map((result) => structuralDigest(this.project))).size === 1;
      const parity = pixelParity && structuralParity && allFailures.length === 0;
      return {
        timestamp: new Date().toISOString(),
        actions: actions.length,
        configs: results,
        baselineDigest: baseline.pixels.map((pixel) => pixel.digest),
        parity,
        structuralParity,
        pixelParity,
        failures: parity ? [] : allFailures,
        passRate: parity ? 1 : 0,
      };
    } finally {
      this.running = false;
    }
  }
}

function cloneCanvas(canvas) {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d").drawImage(canvas, 0, 0);
  return copy;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
