import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  buildRenderPlan,
  intersects,
  layerBounds,
} from "./model.js";
import { TextLayoutCache } from "./layout.js";

const PAD = 56;

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius || 0, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fnv1a(bytes, stride = 1) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += stride) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.layoutCache = new TextLayoutCache();
    this.shadowCache = new Map();
    this.callCount = 0;
    this.fault = null;
    this.frame = 0;
    this.resize(1);
  }

  resize(dpr = window.devicePixelRatio || 1) {
    this.dpr = Math.max(1, Math.min(3, dpr));
    const width = Math.round(CANVAS_WIDTH * this.dpr);
    const height = Math.round(CANVAS_HEIGHT * this.dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.shadowCache.clear();
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
  }

  injectFault(kind = "layout-cache") {
    this.fault = kind;
  }

  clearCache() {
    this.layoutCache.clear();
    this.shadowCache.clear();
  }

  cacheStats() {
    return {
      layout: this.layoutCache.stats(),
      shadows: this.shadowCache.size,
    };
  }

  measure(ctx, layer, text) {
    ctx.font = `${layer.fontWeight || 400} ${layer.fontSize}px ${layer.font}`;
    const spacing = (layer.letterSpacing || 0) * Math.max(0, text.length - 1);
    return ctx.measureText(text).width + spacing;
  }

  drawShape(ctx, layer, local = false) {
    const x = local ? PAD : layer.x;
    const y = local ? PAD : layer.y;
    this.callCount += 1;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;

    if (layer.type === "rect") {
      if (layer.stripes) {
        const gap = layer.w / 17;
        for (let index = 0; index < 17; index += 1) {
          const width = index % 3 === 0 ? 2.4 : 0.9;
          ctx.fillStyle = layer.fill;
          ctx.fillRect(x + index * gap, y, width, layer.h);
          this.callCount += 1;
        }
      } else {
        roundRect(ctx, x, y, layer.w, layer.h, layer.radius);
        ctx.fillStyle = layer.fill;
        ctx.fill();
      }
    } else if (layer.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(x + layer.w / 2, y + layer.h / 2, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
      if (layer.gradient) {
        const gradient = ctx.createRadialGradient(
          x + layer.w * 0.35,
          y + layer.h * 0.3,
          4,
          x + layer.w / 2,
          y + layer.h / 2,
          layer.w * 0.64,
        );
        gradient.addColorStop(0, layer.gradient[0]);
        gradient.addColorStop(1, layer.gradient[1]);
        ctx.fillStyle = gradient;
        this.callCount += 1;
      } else {
        ctx.fillStyle = layer.fill;
      }
      if (layer.fill !== "transparent") ctx.fill();
      if (layer.stroke) {
        ctx.strokeStyle = layer.stroke;
        ctx.lineWidth = layer.lineWidth || 1;
        ctx.stroke();
        this.callCount += 1;
      }
    } else if (layer.type === "text") {
      const layout = this.layoutCache.get(layer, (text) => this.measure(ctx, layer, text));
      ctx.fillStyle = layer.fill;
      ctx.textBaseline = "top";
      ctx.font = `${layer.fontWeight || 400} ${layer.fontSize}px ${layer.font}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${layer.letterSpacing || 0}px`;
      layout.lines.forEach((line, index) => {
        ctx.fillText(line, x, y + index * (layer.lineHeight || layer.fontSize * 1.1));
        this.callCount += 1;
      });
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    }
    ctx.restore();
  }

  shadowKey(layer) {
    const shadow = layer.shadow || {};
    return [
      layer.id,
      layer.type,
      layer.w,
      layer.h,
      layer.radius || 0,
      layer.fill,
      layer.gradient?.join(",") || "",
      layer.stripes || false,
      shadow.blur,
      shadow.offsetX,
      shadow.offsetY,
      shadow.color,
      this.dpr,
    ].join("|");
  }

  getShadowSprite(layer) {
    const key = this.shadowKey(layer);
    const blur = (layer.shadow?.blur || 0) * 1.25;
    const padding = Math.ceil(PAD + blur);
    const cached = this.shadowCache.get(key);
    if (cached) {
      this.shadowCache.delete(key);
      this.shadowCache.set(key, cached);
      return { sprite: cached, hit: true, padding };
    }
    const scale = this.dpr;
    const sprite = document.createElement("canvas");
    sprite.width = Math.ceil((layer.w + padding * 2) * scale);
    sprite.height = Math.ceil((layer.h + padding * 2) * scale);
    const context = sprite.getContext("2d", { alpha: true });
    context.scale(scale, scale);
    context.shadowBlur = layer.shadow?.blur || 0;
    context.shadowOffsetX = layer.shadow?.offsetX || 0;
    context.shadowOffsetY = layer.shadow?.offsetY || 0;
    context.shadowColor = layer.shadow?.color || "transparent";
    const clone = { ...layer, x: padding, y: padding };
    this.drawShape(context, clone);
    while (this.shadowCache.size > 48) {
      this.shadowCache.delete(this.shadowCache.keys().next().value);
    }
    this.shadowCache.set(key, sprite);
    return { sprite, hit: false, padding };
  }

  drawObject(ctx, layer, options, counters) {
    if (layer.shadow && options.shadows) {
      const result = this.getShadowSprite(layer);
      counters.cacheLookups += 1;
      if (result.hit) counters.cacheHits += 1;
      const padding = result.padding;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        result.sprite,
        layer.x - padding,
        layer.y - padding,
        result.sprite.width / this.dpr,
        result.sprite.height / this.dpr,
      );
      ctx.restore();
      this.callCount += 1;
      return;
    }

    ctx.save();
    if (layer.shadow && !options.shadows) {
      ctx.shadowBlur = layer.shadow.blur || 0;
      ctx.shadowOffsetX = layer.shadow.offsetX || 0;
      ctx.shadowOffsetY = layer.shadow.offsetY || 0;
      ctx.shadowColor = layer.shadow.color || "transparent";
    }
    this.drawShape(ctx, layer);
    ctx.restore();
  }

  cameraViewport(camera = {}) {
    const scale = camera.scale || 1;
    const centerX = CANVAS_WIDTH / 2;
    const centerY = CANVAS_HEIGHT / 2;
    const worldCenterX = centerX - (camera.x || 0);
    const worldCenterY = centerY - (camera.y || 0);
    return {
      x: worldCenterX - centerX / scale,
      y: worldCenterY - centerY / scale,
      w: CANVAS_WIDTH / scale,
      h: CANVAS_HEIGHT / scale,
    };
  }

  render({ project, options, selectionId = null, camera = {}, time = 0 }) {
    if (this.fault === "layout-cache") {
      this.fault = null;
      throw new Error("模拟布局缓存损坏：缓存条目缺少 widths 字段");
    }
    if (this.fault === "shadow-cache") {
      this.fault = null;
      throw new Error("模拟阴影纹理损坏：离屏画布尺寸为 0");
    }

    const started = performance.now();
    this.frame += 1;
    this.callCount = 0;
    const counters = { cacheHits: 0, cacheLookups: 0 };
    const ctx = this.ctx;
    const scale = camera.scale || 1;
    const viewport = this.cameraViewport(camera);
    const plan = buildRenderPlan(project, options, viewport);
    const layoutStarted = performance.now();
    const textObjects = plan.visible.filter((object) => object.type === "text");
    for (const object of textObjects) {
      this.layoutCache.get(object, (text) => this.measure(ctx, object, text));
      counters.cacheLookups += 1;
    }
    const layoutMs = performance.now() - layoutStarted;
    const layoutHits = this.layoutCache.hits;
    const layoutMisses = this.layoutCache.misses;
    counters.cacheHits += Math.min(textObjects.length, layoutHits);

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#efe7d8";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.scale(scale, scale);
    ctx.translate(-CANVAS_WIDTH / 2 + (camera.x || 0), -CANVAS_HEIGHT / 2 + (camera.y || 0));

    for (const object of plan.visible) {
      this.drawObject(ctx, object, options, counters);
    }

    if (selectionId) {
      const selected = project.layers.find((layer) => layer.id === selectionId);
      if (selected) this.drawSelection(ctx, selected);
    }
    ctx.restore();

    const frameMs = performance.now() - started;
    return {
      frameMs,
      layoutMs,
      drawnObjects: plan.visibleObjects,
      totalObjects: plan.totalObjects,
      culledObjects: plan.culledObjects,
      cacheHits: counters.cacheHits,
      cacheLookups: counters.cacheLookups,
      layoutHits: layoutCacheDelta(layoutHits, layoutMisses, textObjects.length),
      drawCalls: this.callCount,
      plan,
      time,
    };
  }

  drawSelection(ctx, layer) {
    ctx.save();
    ctx.strokeStyle = "#ff6b3d";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    if (layer.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(layer.x + layer.w / 2, layer.y + layer.h / 2, layer.w / 2 + 4, layer.h / 2 + 4, 0, 0, Math.PI * 2);
    } else {
      ctx.strokeRect(layer.x - 4, layer.y - 4, layer.w + 8, layer.h + 8);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ff6b3d";
    for (const [x, y] of [
      [layer.x - 4, layer.y - 4],
      [layer.x + layer.w + 4, layer.y - 4],
      [layer.x - 4, layer.y + layer.h + 4],
      [layer.x + layer.w + 4, layer.y + layer.h + 4],
    ]) {
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      this.callCount += 1;
    }
    ctx.restore();
  }

  pixelDigest() {
    const data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    return fnv1a(data, 11);
  }

  pixelDifference(otherCanvas) {
    const a = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    const context = otherCanvas.getContext("2d", { willReadFrequently: true });
    const b = context.getImageData(0, 0, otherCanvas.width, otherCanvas.height).data;
    const length = Math.min(a.length, b.length);
    let changed = 0;
    for (let index = 0; index < length; index += 4) {
      const delta =
        Math.abs(a[index] - b[index]) +
        Math.abs(a[index + 1] - b[index + 1]) +
        Math.abs(a[index + 2] - b[index + 2]) +
        Math.abs(a[index + 3] - b[index + 3]);
      if (delta > 4) changed += 1;
    }
    return changed / Math.max(1, length / 4);
  }
}

function layoutCacheDelta(hits, misses, textObjects) {
  if (!textObjects) return 0;
  return {
    hits,
    misses,
    samples: textObjects,
  };
}

export function visibleBoundsFromPlan(plan) {
  return plan.visible
    .filter((object) => object.id.startsWith("decor-") === false)
    .map((object) => ({ id: object.id, ...layerBounds(object), intersects: intersects(layerBounds(object), {
      x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT,
    }) }));
}
