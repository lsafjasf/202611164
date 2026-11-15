/*
 * ProjectImporter: 基于 ChunkParser 的工程导入器。
 * - 分块解析 + setTimeout 让出主线程,页面保持可响应
 * - 进度回调 / 取消(原子提交,取消不留半成品)
 * - 字段级错误提示(路径 + 字段 + 原因)
 * - 严格 / 容错两种模式;可观测指标与日志
 */
(function (global) {
  'use strict';

  const ChunkParser =
    typeof module !== 'undefined' && module.exports
      ? require('./chunkParser.js').ChunkParser
      : global.ChunkJson.ChunkParser;

  const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'];

  class CancelledError extends Error {
    constructor() {
      super('导入已取消');
      this.name = 'CancelledError';
    }
  }

  function now() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  function memoryBytes() {
    if (typeof performance !== 'undefined' && performance.memory) {
      return performance.memory.usedJSHeapSize;
    }
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return null;
  }

  /** 校验单个关键帧,返回字段级错误数组 */
  function validateKeyframe(kf, index) {
    const errors = [];
    const path = 'root.keyframes[' + index + ']';
    if (kf === null || typeof kf !== 'object' || Array.isArray(kf)) {
      errors.push({ index, path, field: null,
        message: '关键帧必须是对象,实际为 ' + JSON.stringify(kf) });
      return errors;
    }
    if (typeof kf.id !== 'string' || kf.id.length === 0) {
      errors.push({ index, path, field: 'id',
        message: 'id 必须是非空字符串,实际为 ' + JSON.stringify(kf.id) });
    }
    if (typeof kf.time !== 'number' || !isFinite(kf.time) || kf.time < 0) {
      errors.push({ index, path, field: 'time',
        message: 'time 必须是 >=0 的有限数值,实际为 ' + JSON.stringify(kf.time) });
    }
    if (typeof kf.value !== 'number' || !isFinite(kf.value)) {
      errors.push({ index, path, field: 'value',
        message: 'value 必须是有限数值,实际为 ' + JSON.stringify(kf.value) });
    }
    if (kf.track !== undefined && typeof kf.track !== 'string') {
      errors.push({ index, path, field: 'track',
        message: 'track 必须是字符串,实际为 ' + JSON.stringify(kf.track) });
    }
    if (kf.easing !== undefined && EASINGS.indexOf(kf.easing) < 0) {
      errors.push({ index, path, field: 'easing',
        message: 'easing 必须是 ' + EASINGS.join('/') + ',实际为 ' +
          JSON.stringify(kf.easing) });
    }
    return errors;
  }

  /** 规范化关键帧(容错模式下只调用在合法项上) */
  function normalizeKeyframe(kf, index) {
    return {
      id: kf.id,
      time: kf.time,
      value: kf.value,
      track: typeof kf.track === 'string' ? kf.track : 'default',
      easing: kf.easing || 'linear',
      order: index
    };
  }

  /** 规范化工程的规范序列化(键序固定),用于哈希 */
  function canonicalize(project) {
    const parts = ['{"name":', JSON.stringify(project.name),
      ',"version":', JSON.stringify(project.version),
      ',"keyframes":['];
    project.keyframes.forEach((kf, i) => {
      if (i > 0) parts.push(',');
      parts.push('{"id":', JSON.stringify(kf.id),
        ',"time":', String(kf.time),
        ',"value":', String(kf.value),
        ',"track":', JSON.stringify(kf.track),
        ',"easing":', JSON.stringify(kf.easing),
        ',"order":', String(kf.order), '}');
    });
    parts.push(']}');
    return parts.join('');
  }

  // 纯 JS SHA-256(兜底,保证浏览器 file:// / Worker / 测试桩均可哈希)
  const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256Bytes(bytes) {
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const bitLen = bytes.length * 8;
    const padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    for (let i = 7; i >= 0; i -= 1) {
      padded.push((bitLen / Math.pow(2, i * 8)) & 0xff);
    }
    const w = new Array(64);
    for (let block = 0; block < padded.length; block += 64) {
      for (let i = 0; i < 16; i += 1) {
        w[i] = (padded[block + i * 4] << 24) |
          (padded[block + i * 4 + 1] << 16) |
          (padded[block + i * 4 + 2] << 8) |
          padded[block + i * 4 + 3];
      }
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i += 1) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0;
      h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0;
      h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(text));
    }
    if (typeof Buffer !== 'undefined') {
      return Array.from(Buffer.from(text, 'utf8'));
    }
    const out = [];
    for (let i = 0; i < text.length; i += 1) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const lo = text.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
          i += 1;
        }
      }
      if (code < 0x80) out.push(code);
      else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f));
      } else {
        out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return out;
  }

  async function sha256Hex(text) {
    if (typeof crypto !== 'undefined' && crypto.subtle &&
        typeof TextEncoder !== 'undefined') {
      const buf = await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') {
      try {
        const nodeCrypto = require('crypto');
        return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex');
      } catch (e) { /* 落到纯 JS 实现 */ }
    }
    return sha256Bytes(utf8Bytes(text));
  }
  class ProjectImporter {
    constructor(options) {
      options = options || {};
      this.mode = options.mode === 'tolerant' ? 'tolerant' : 'strict';
      this.sliceBudgetMs = options.sliceBudgetMs || 6;
      this.onProgress = options.onProgress || null;
      this.onLog = options.onLog || null;
      this._cancelled = false;
      this.logs = [];
    }

    log(level, message) {
      const entry = { t: new Date().toISOString(), level, message };
      this.logs.push(entry);
      if (this.onLog) this.onLog(entry);
    }

    cancel() {
      this._cancelled = true;
      this.log('warn', '收到取消请求,将在当前切片结束后回滚');
    }

    _yieldToUI() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    /**
     * 导入 JSON 文本。成功时 resolve:
     *   { project, stats, errors }
     * 失败(语法错误/严格模式校验失败)reject Error;
     * 取消 reject CancelledError。取消/失败均不产生半成品 project。
     */
    async import(text) {
      this._cancelled = false;
      const stats = {
        mode: this.mode,
        inputBytes: text.length,
        slices: 0,
        parsedKeyframes: 0,
        acceptedKeyframes: 0,
        errorCount: 0,
        cancelled: false,
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        keyframesPerSec: 0,
        memoryBeforeBytes: memoryBytes(),
        memoryAfterBytes: null,
        memoryDeltaBytes: null
      };
      const errors = [];
      const accepted = [];
      const t0 = now();
      this.log('info', '导入开始,模式=' + this.mode +
        ',输入=' + text.length + ' 字节');

      let keyframeIndex = 0;
      // 元素完成时,若栈为 [root对象, 数组] 且 root.pendingKey==='keyframes',
      // 则该元素是关键帧,立即做字段级校验。
      const parser = new ChunkParser(text, {
        onElement: (arrayFrame, value) => {
          const st = parser.stack;
          const isKeyframes =
            st.length === 2 &&
            st[0].type === 'object' &&
            st[1] === arrayFrame &&
            st[0].pendingKey === 'keyframes';
          if (!isKeyframes) return;
          const index = keyframeIndex++;
          stats.parsedKeyframes = index + 1;
          const errs = validateKeyframe(value, index);
          // 流式释放:校验后立即解除解析树对原始对象的引用,
          // 避免与规范化结果双重占用堆内存(数组长度保持不变,索引不受影响)。
          arrayFrame.value[arrayFrame.value.length - 1] = null;
          if (errs.length > 0) {
            for (const e of errs) {
              errors.push(e);
              this.log('error', '字段错误 ' + e.path +
                (e.field ? ' 字段 ' + e.field : '') + ': ' + e.message);
            }
            if (this.mode === 'strict') {
              throw new Error('严格模式下发现字段错误,首个错误: ' +
                errs[0].path + ' ' + errs[0].message);
            }
            return; // 容错模式:跳过该关键帧
          }
          accepted.push(normalizeKeyframe(value, index));
          stats.acceptedKeyframes = accepted.length;
        }
      });

      try {
        for (;;) {
          if (this._cancelled) {
            stats.cancelled = true;
            this.log('warn', '导入已取消,丢弃部分解析结果(已解析 ' +
              stats.parsedKeyframes + ' 个关键帧)');
            throw new CancelledError();
          }
          const { done, progress } = parser.step(this.sliceBudgetMs);
          stats.slices += 1;
          if (this.onProgress) {
            this.onProgress({
              progress,
              parsedKeyframes: stats.parsedKeyframes,
              acceptedKeyframes: stats.acceptedKeyframes,
              errorCount: errors.length,
              elapsedMs: now() - t0
            });
          }
          if (done) break;
          await this._yieldToUI();
        }
      } catch (err) {
        stats.elapsedMs = now() - t0;
        stats.memoryAfterBytes = memoryBytes();
        if (stats.memoryBeforeBytes != null && stats.memoryAfterBytes != null) {
          stats.memoryDeltaBytes = stats.memoryAfterBytes - stats.memoryBeforeBytes;
        }
        this.log(err.name === 'CancelledError' ? 'warn' : 'error',
          '导入失败: ' + err.message);
        err.stats = stats;
        err.errors = errors;
        throw err;
      }

      const root = parser.root;
      if (root === null || typeof root !== 'object' || Array.isArray(root)) {
        const err = new Error('根节点必须是对象');
        this.log('error', '导入失败: ' + err.message);
        err.stats = stats;
        err.errors = errors;
        throw err;
      }
      if (!Array.isArray(root.keyframes)) {
        const err = new Error('缺少 keyframes 数组字段');
        this.log('error', '导入失败: ' + err.message);
        err.stats = stats;
        err.errors = errors;
        throw err;
      }
      if (errors.length > 0 && this.mode === 'strict') {
        const err = new Error('严格模式下存在 ' + errors.length + ' 个字段错误');
        err.stats = stats;
        err.errors = errors;
        throw err;
      }

      const project = {
        name: typeof root.name === 'string' ? root.name : 'untitled',
        version: typeof root.version === 'number' ? root.version : 1,
        keyframes: accepted
      };
      try {
        project.hash = await sha256Hex(canonicalize(project));
      } catch (err) {
        this.log('error', '哈希计算失败: ' + err.message);
        err.stats = stats;
        err.errors = errors;
        throw err;
      }

      stats.errorCount = errors.length;
      stats.elapsedMs = now() - t0;
      stats.keyframesPerSec = stats.elapsedMs > 0
        ? Math.round(accepted.length / (stats.elapsedMs / 1000))
        : accepted.length;
      stats.memoryAfterBytes = memoryBytes();
      if (stats.memoryBeforeBytes != null && stats.memoryAfterBytes != null) {
        stats.memoryDeltaBytes = stats.memoryAfterBytes - stats.memoryBeforeBytes;
      }
      this.log('info', '导入完成: ' + accepted.length + ' 个关键帧,耗时 ' +
        stats.elapsedMs.toFixed(1) + 'ms,hash=' + project.hash.slice(0, 12) + '…');
      if (errors.length > 0) {
        this.log('warn', '容错模式跳过 ' + errors.length +
          ' 个字段错误;建议修复源文件后改用严格模式复核');
      }
      return { project, stats, errors };
    }
  }

  const api = {
    ProjectImporter,
    CancelledError,
    validateKeyframe,
    normalizeKeyframe,
    canonicalize,
    sha256Hex,
    EASINGS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ProjectImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
