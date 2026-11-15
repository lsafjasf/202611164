// 精灵图集增量打包核心。同时兼容 Node 与浏览器（UMD 风格导出）。
// 设计原则：新增/删除少量帧时绝不整体重排；只有显式 repack() 才全量布局。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SpriteAtlasLib = factory();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const RECOVERY_HINTS = {
    ATLAS_FULL: '图集空间不足：可执行“紧凑重排”整理碎片，或调大 maxWidth/maxHeight 后重试。',
    DUPLICATE_NAME: '帧名称已存在：请先删除同名帧，或换一个唯一名称。',
    INVALID_FRAME: '帧尺寸非法：宽高必须为大于 0 的整数。',
    NOT_FOUND: '目标帧不存在：刷新帧列表后重试。',
    INVALID_JSON: 'JSON 解析失败：请确认导入的是本工具导出的未修改文件。',
    INVALID_SCHEMA: 'JSON 结构不合法：缺少 meta.size 或 frames 字段，请重新导出。',
    INVALID_COORD: '切片坐标越界或非法：请勿手工改动坐标，重新导出后再导入。',
    OVERLAP: '导入数据存在重叠切片：文件已损坏，请从原始工程重新导出。',
    REPACK_FAILED: '重排后仍放不下全部帧：已自动回滚到重排前布局，请增大图集上限。',
  };

  class AtlasError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'AtlasError';
      this.code = code;
      this.details = details || null;
      // 恢复建议：界面与测试直接展示，不吞掉异常。
      this.recovery = RECOVERY_HINTS[code] || '检查输入后重试。';
    }
  }

  function assertInt(v) {
    return typeof v === 'number' && Number.isInteger(v);
  }

  class SpriteAtlas {
    constructor(options) {
      const opts = options || {};
      this.width = opts.width || 1024;
      this.height = opts.height || 1024;
      this.maxWidth = opts.maxWidth || 4096;
      this.maxHeight = opts.maxHeight || 4096;
      this.padding = opts.padding == null ? 1 : opts.padding;
      this.allowGrow = opts.allowGrow !== false;
      if (!assertInt(this.width) || !assertInt(this.height) || this.width <= 0 || this.height <= 0) {
        throw new AtlasError('INVALID_FRAME', '图集尺寸必须为正整数');
      }
      this.frames = new Map(); // name -> {name,x,y,w,h}
      this.freeRects = [{ x: 0, y: 0, w: this.width, h: this.height }];
      // 可观测指标
      this.stats = {
        insertCount: 0,
        removeCount: 0,
        repackCount: 0, // 整体重排次数（增量操作不应增加它）
        growCount: 0,
        lastOpMs: 0,
        lastOpMode: 'init', // insert | remove | repack | grow | import
        totalPackMs: 0,
      };
    }

    get frameCount() {
      return this.frames.size;
    }

    usedArea() {
      let area = 0;
      for (const f of this.frames.values()) area += f.w * f.h;
      return area;
    }

    utilization() {
      return this.usedArea() / (this.width * this.height);
    }

    memoryBytes() {
      // RGBA8888 显存估算，作为一项资源统计指标。
      return this.width * this.height * 4;
    }

    metrics() {
      return {
        frameCount: this.frameCount,
        atlasWidth: this.width,
        atlasHeight: this.height,
        usedArea: this.usedArea(),
        utilization: this.utilization(),
        memoryBytes: this.memoryBytes(),
        freeRectCount: this.freeRects.length,
        insertCount: this.stats.insertCount,
        removeCount: this.stats.removeCount,
        repackCount: this.stats.repackCount,
        growCount: this.stats.growCount,
        lastOpMs: this.stats.lastOpMs,
        lastOpMode: this.stats.lastOpMode,
        totalPackMs: this.stats.totalPackMs,
      };
    }

    _now() {
      return typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    }

    _recordOp(mode, startedAt) {
      const cost = this._now() - startedAt;
      this.stats.lastOpMs = cost;
      this.stats.lastOpMode = mode;
      this.stats.totalPackMs += cost;
      return cost;
    }

    // MaxRects：Best Short Side Fit。只查空闲矩形，绝不移动已放置帧。
    _findPosition(w, h) {
      let best = null;
      let bestShort = Infinity;
      let bestLong = Infinity;
      for (const r of this.freeRects) {
        if (r.w >= w && r.h >= h) {
          const leftoverH = Math.abs(r.w - w);
          const leftoverV = Math.abs(r.h - h);
          const short = Math.min(leftoverH, leftoverV);
          const long = Math.max(leftoverH, leftoverV);
          if (short < bestShort || (short === bestShort && long < bestLong)) {
            best = { x: r.x, y: r.y };
            bestShort = short;
            bestLong = long;
          }
        }
      }
      return best;
    }

    _splitFreeRects(placed) {
      const next = [];
      for (const r of this.freeRects) {
        if (
          placed.x >= r.x + r.w || placed.x + placed.w <= r.x ||
          placed.y >= r.y + r.h || placed.y + placed.h <= r.y
        ) {
          next.push(r);
          continue;
        }
        // 与放置区域相交，拆成最多 4 个剩余矩形
        if (placed.x > r.x) {
          next.push({ x: r.x, y: r.y, w: placed.x - r.x, h: r.h });
        }
        if (placed.x + placed.w < r.x + r.w) {
          next.push({ x: placed.x + placed.w, y: r.y, w: r.x + r.w - (placed.x + placed.w), h: r.h });
        }
        if (placed.y > r.y) {
          next.push({ x: r.x, y: r.y, w: r.w, h: placed.y - r.y });
        }
        if (placed.y + placed.h < r.y + r.h) {
          next.push({ x: r.x, y: placed.y + placed.h, w: r.w, h: r.y + r.h - (placed.y + placed.h) });
        }
      }
      this.freeRects = this._prune(next);
    }

    _prune(rects) {
      const out = [];
      for (let i = 0; i < rects.length; i++) {
        const a = rects[i];
        if (a.w <= 0 || a.h <= 0) continue;
        let contained = false;
        for (let j = 0; j < rects.length; j++) {
          if (i === j) continue;
          const b = rects[j];
          if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
            contained = true;
            break;
          }
        }
        if (!contained) out.push(a);
      }
      return out;
    }

    _padded(w, h) {
      return { w: w + this.padding, h: h + this.padding };
    }

    // 仅扩大画布：已有帧坐标不变，新增区域并入空闲表。
    _growToFit(needW, needH) {
      let grew = false;
      while ((this.width < needW || this._largestFreeWidth() < needW) && this.width < this.maxWidth) {
        const oldW = this.width;
        this.width = Math.min(this.maxWidth, Math.max(this.width * 2, needW));
        this.freeRects.push({ x: oldW, y: 0, w: this.width - oldW, h: this.height });
        grew = true;
        if (this.width >= needW) break;
      }
      while ((this.height < needH || !this._findPosition(needW, needH)) && this.height < this.maxHeight) {
        const oldH = this.height;
        this.height = Math.min(this.maxHeight, Math.max(this.height * 2, needH));
        this.freeRects.push({ x: 0, y: oldH, w: this.width, h: this.height - oldH });
        grew = true;
        if (this._findPosition(needW, needH)) break;
      }
      if (grew) {
        this.freeRects = this._prune(this.freeRects);
        this.stats.growCount++;
      }
      return grew;
    }

    _largestFreeWidth() {
      let m = 0;
      for (const r of this.freeRects) m = Math.max(m, r.w);
      return m;
    }

    insert(name, w, h) {
      const t0 = this._now();
      try {
        if (typeof name !== 'string' || name.length === 0) {
          throw new AtlasError('INVALID_FRAME', '帧名称必须是非空字符串', { name });
        }
        if (!assertInt(w) || !assertInt(h) || w <= 0 || h <= 0) {
          throw new AtlasError('INVALID_FRAME', `帧 "${name}" 尺寸非法: ${w}x${h}`, { name, w, h });
        }
        if (this.frames.has(name)) {
          throw new AtlasError('DUPLICATE_NAME', `帧 "${name}" 已存在`, { name });
        }
        const pad = this._padded(w, h);
        let pos = this._findPosition(pad.w, pad.h);
        if (!pos && this.allowGrow) {
          this._growToFit(pad.w, pad.h);
          pos = this._findPosition(pad.w, pad.h);
        }
        if (!pos) {
          throw new AtlasError('ATLAS_FULL', `图集放不下帧 "${name}" (${w}x${h})`, { name, w, h });
        }
        const placed = { x: pos.x, y: pos.y, w: pad.w, h: pad.h };
        this._splitFreeRects(placed);
        this.frames.set(name, { name, x: pos.x, y: pos.y, w, h });
        this.stats.insertCount++;
        return this.frames.get(name);
      } finally {
        this._recordOp('insert', t0);
      }
    }

    remove(name) {
      const t0 = this._now();
      try {
        const f = this.frames.get(name);
        if (!f) {
          throw new AtlasError('NOT_FOUND', `帧 "${name}" 不存在`, { name });
        }
        this.frames.delete(name);
        const pad = this._padded(f.w, f.h);
        this.freeRects.push({ x: f.x, y: f.y, w: pad.w, h: pad.h });
        this.freeRects = this._prune(this.freeRects);
        this.stats.removeCount++;
        return true;
      } finally {
        this._recordOp('remove', t0);
      }
    }

    // 唯一的整体重排入口。失败时回滚到重排前布局，保证状态不被破坏。
    repack() {
      const t0 = this._now();
      const snapshot = {
        frames: new Map(this.frames),
        freeRects: this.freeRects.map((r) => ({ ...r })),
        width: this.width,
        height: this.height,
      };
      try {
        const list = [...this.frames.values()].sort((a, b) => b.h - a.h || b.w - a.w);
        this.frames = new Map();
        this.freeRects = [{ x: 0, y: 0, w: this.width, h: this.height }];
        for (const f of list) {
          const pad = this._padded(f.w, f.h);
          const pos = this._findPosition(pad.w, pad.h);
          if (!pos) {
            throw new AtlasError('REPACK_FAILED', `重排后仍放不下帧 "${f.name}"`, { name: f.name });
          }
          this._splitFreeRects({ x: pos.x, y: pos.y, w: pad.w, h: pad.h });
          this.frames.set(f.name, { name: f.name, x: pos.x, y: pos.y, w: f.w, h: f.h });
        }
        this.stats.repackCount++;
        return true;
      } catch (err) {
        this.frames = snapshot.frames;
        this.freeRects = snapshot.freeRects;
        this.width = snapshot.width;
        this.height = snapshot.height;
        throw err;
      } finally {
        this._recordOp('repack', t0);
      }
    }

    getFrame(name) {
      return this.frames.get(name) || null;
    }

    // 导出：格式稳定，增量优化不改变导出内容。
    toJSON() {
      const frames = [...this.frames.values()]
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((f) => ({ name: f.name, frame: { x: f.x, y: f.y, w: f.w, h: f.h } }));
      return JSON.stringify(
        {
          meta: {
            app: 'sprite-atlas-incremental',
            version: 1,
            size: { w: this.width, h: this.height },
            frameCount: frames.length,
          },
          frames,
        },
        null,
        2
      );
    }

    // 导入：严格校验，任何异常都抛出 AtlasError，由调用方决定保留旧状态。
    static fromJSON(jsonText, options) {
      let data;
      try {
        data = JSON.parse(jsonText);
      } catch (e) {
        throw new AtlasError('INVALID_JSON', `JSON 解析失败: ${e.message}`);
      }
      if (!data || typeof data !== 'object' || !data.meta || !data.meta.size || !Array.isArray(data.frames)) {
        throw new AtlasError('INVALID_SCHEMA', '缺少 meta.size 或 frames 数组');
      }
      const W = data.meta.size.w;
      const H = data.meta.size.h;
      if (!assertInt(W) || !assertInt(H) || W <= 0 || H <= 0) {
        throw new AtlasError('INVALID_SCHEMA', `图集尺寸非法: ${W}x${H}`);
      }
      const seen = new Set();
      const rects = [];
      for (const item of data.frames) {
        if (!item || typeof item.name !== 'string' || item.name.length === 0 || !item.frame) {
          throw new AtlasError('INVALID_SCHEMA', '帧缺少 name 或 frame 字段', { item });
        }
        if (seen.has(item.name)) {
          throw new AtlasError('INVALID_SCHEMA', `帧名称重复: "${item.name}"`, { name: item.name });
        }
        seen.add(item.name);
        const { x, y, w, h } = item.frame;
        if (!assertInt(x) || !assertInt(y) || !assertInt(w) || !assertInt(h) || w <= 0 || h <= 0) {
          throw new AtlasError('INVALID_COORD', `帧 "${item.name}" 坐标/尺寸非法`, item.frame);
        }
        if (x < 0 || y < 0 || x + w > W || y + h > H) {
          throw new AtlasError('INVALID_COORD', `帧 "${item.name}" 超出图集边界`, item.frame);
        }
        rects.push({ name: item.name, x, y, w, h });
      }
      // 重叠检测：宁可拒绝导入，也不静默修复伪造成功。
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (SpriteAtlas._overlap(rects[i], rects[j])) {
            throw new AtlasError('OVERLAP', `帧 "${rects[i].name}" 与 "${rects[j].name}" 重叠`, {
              a: rects[i].name,
              b: rects[j].name,
            });
          }
        }
      }
      const atlas = new SpriteAtlas(
        Object.assign({ width: W, height: H, maxWidth: W, maxHeight: H, allowGrow: false }, options)
      );
      const t0 = atlas._now();
      for (const r of rects) {
        const pad = atlas._padded(r.w, r.h);
        atlas._splitFreeRects({ x: r.x, y: r.y, w: pad.w, h: pad.h });
        atlas.frames.set(r.name, { name: r.name, x: r.x, y: r.y, w: r.w, h: r.h });
      }
      atlas.stats.insertCount = rects.length;
      atlas._recordOp('import', t0);
      return atlas;
    }

    static _overlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    // 自检：无重叠、全部在界内。供测试与界面诊断使用。
    validate() {
      const list = [...this.frames.values()];
      const problems = [];
      for (const f of list) {
        if (f.x < 0 || f.y < 0 || f.x + f.w > this.width || f.y + f.h > this.height) {
          problems.push(`帧 "${f.name}" 越界`);
        }
      }
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (SpriteAtlas._overlap(list[i], list[j])) {
            problems.push(`帧 "${list[i].name}" 与 "${list[j].name}" 重叠`);
          }
        }
      }
      return problems;
    }
  }

  return { SpriteAtlas, AtlasError, RECOVERY_HINTS };
});
