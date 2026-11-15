import { clamp, clampText } from "./model.js";

export const MODULE_LABELS = Object.freeze({
  image: "图像处理",
  audio: "音频合成",
  export: "导出"
});

export function createMetrics(now = new Date().toISOString()) {
  return {
    version: 1,
    updatedAt: now,
    total: { success: 0, failure: 0 },
    modules: {
      image: { success: 0, failure: 0 },
      audio: { success: 0, failure: 0 },
      export: { success: 0, failure: 0 }
    },
    failures: []
  };
}

export function sanitizeMetrics(raw, now = new Date().toISOString()) {
  const base = createMetrics(now);
  if (!raw || typeof raw !== "object") return base;
  const metrics = createMetrics(typeof raw.updatedAt === "string" ? raw.updatedAt : now);
  for (const module of Object.keys(MODULE_LABELS)) {
    metrics.modules[module].success = clamp(raw.modules?.[module]?.success, 0, 999999, 0);
    metrics.modules[module].failure = clamp(raw.modules?.[module]?.failure, 0, 999999, 0);
  }
  metrics.total.success = clamp(raw.total?.success, 0, 999999, 0);
  metrics.total.failure = clamp(raw.total?.failure, 0, 999999, 0);
  metrics.failures = Array.isArray(raw.failures)
    ? raw.failures
        .filter((item) => item && MODULE_LABELS[item.module])
        .slice(0, 8)
        .map((item) => ({
          module: item.module,
          moduleLabel: MODULE_LABELS[item.module],
          message: clampText(item.message, 240, "未知错误"),
          advice: clampText(item.advice, 240, ""),
          at: typeof item.at === "string" ? item.at : now
        }))
    : [];
  return metrics;
}

export function recordMetric(metrics, module, ok, detail = {}) {
  if (!MODULE_LABELS[module]) throw new Error(`未知模块：${module}`);
  const next = typeof structuredClone === "function"
    ? structuredClone(metrics)
    : JSON.parse(JSON.stringify(metrics));
  const at = detail.at || new Date().toISOString();
  next.updatedAt = at;
  next.total[ok ? "success" : "failure"] += 1;
  next.modules[module][ok ? "success" : "failure"] += 1;
  if (!ok) {
    next.failures = [
      {
        module,
        moduleLabel: MODULE_LABELS[module],
        message: clampText(detail.message, 240, "未知错误"),
        advice: clampText(detail.advice, 240, ""),
        at
      },
      ...next.failures
    ].slice(0, 8);
  }
  return next;
}

export function metricTotal(entry) {
  return entry.success + entry.failure;
}

export function rateOf(entry) {
  const total = metricTotal(entry);
  return total === 0 ? null : entry.success / total;
}

export function overallRate(metrics) {
  return rateOf(metrics.total);
}

export function formatRate(rate) {
  if (rate === null || rate === undefined) return "—";
  const percent = rate * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

export function formatMetric(entry) {
  const total = metricTotal(entry);
  return `${entry.success} / ${total}`;
}

export function lastFailure(metrics) {
  return metrics.failures[0] || null;
}
