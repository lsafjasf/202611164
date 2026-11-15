export class RollingMetrics {
  constructor(capacity = 90) {
    this.capacity = capacity;
    this.samples = [];
    this.frames = 0;
    this.totalCacheHits = 0;
    this.totalCacheLookups = 0;
  }

  record(sample) {
    this.frames += 1;
    this.samples.push({ ...sample, at: performance.now() });
    if (this.samples.length > this.capacity) this.samples.shift();
    this.totalCacheHits += sample.cacheHits || 0;
    this.totalCacheLookups += sample.cacheLookups || 0;
  }

  values(key) {
    return this.samples.map((sample) => Number(sample[key]) || 0);
  }

  percentile(values, ratio) {
    if (!values.length) return 0;
    const ordered = [...values].sort((left, right) => left - right);
    const index = Math.min(ordered.length - 1, Math.floor(ordered.length * ratio));
    return ordered[index];
  }

  snapshot() {
    const frames = this.values("frameMs");
    const latest = this.samples.at(-1) || {};
    const average = frames.length
      ? frames.slice(-30).reduce((sum, value) => sum + value, 0) / Math.min(frames.length, 30)
      : 0;
    return {
      frameMs: average,
      frameP95: this.percentile(frames, 0.95),
      drawnObjects: latest.drawnObjects || 0,
      totalObjects: latest.totalObjects || 0,
      layoutMs: latest.layoutMs || 0,
      drawCalls: latest.drawCalls || 0,
      cacheHits: latest.cacheHits || 0,
      cacheLookups: latest.cacheLookups || 0,
      cacheHitRate: latest.cacheLookups ? latest.cacheHits / latest.cacheLookups : 0,
      totalCacheHitRate: this.totalCacheLookups ? this.totalCacheHits / this.totalCacheLookups : 0,
      totalCacheHits: this.totalCacheHits,
      totalCacheLookups: this.totalCacheLookups,
      frames: this.frames,
      frameSeries: frames,
    };
  }

  reset() {
    this.samples = [];
    this.frames = 0;
    this.totalCacheHits = 0;
    this.totalCacheLookups = 0;
  }
}

export function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function percentile(values, ratio) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}
