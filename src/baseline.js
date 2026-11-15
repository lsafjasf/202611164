/*
 * 基线(修改前)导入器:一次性 JSON.parse + 全量校验。
 * 无主线程让出、无进度、不可取消、错误不含字段路径。
 * 仅用于与 ProjectImporter 做修改前/后对比。
 */
(function (global) {
  'use strict';

  const PI =
    typeof module !== 'undefined' && module.exports
      ? require('./importer.js')
      : global.ProjectImport;

  function memoryBytes() {
    if (typeof performance !== 'undefined' && performance.memory) {
      return performance.memory.usedJSHeapSize;
    }
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return null;
  }

  /**
   * 与修改前行为一致:解析失败或首个校验错误即抛出,
   * 错误信息不含字段级定位。
   */
  async function baselineImport(text) {
    const t0 = Date.now();
    const mem0 = memoryBytes();
    const logs = [];
    logs.push({ t: new Date().toISOString(), level: 'info',
      message: '基线导入开始,输入=' + text.length + ' 字节' });
    const stats = {
      mode: 'baseline',
      inputBytes: text.length,
      memoryBeforeBytes: mem0
    };
    let root;
    try {
      root = JSON.parse(text); // 一次性阻塞解析
    } catch (err) {
      logs.push({ t: new Date().toISOString(), level: 'error',
        message: '基线导入失败: ' + err.message });
      err.logs = logs;
      err.stats = stats;
      throw err;
    }
    if (!root || typeof root !== 'object' || !Array.isArray(root.keyframes)) {
      const err = new Error('工程格式非法');
      logs.push({ t: new Date().toISOString(), level: 'error',
        message: '基线导入失败: ' + err.message });
      err.logs = logs;
      err.stats = stats;
      throw err;
    }
    const keyframes = [];
    for (let i = 0; i < root.keyframes.length; i += 1) {
      const errs = PI.validateKeyframe(root.keyframes[i], i);
      if (errs.length > 0) {
        const err = new Error('关键帧校验失败: ' + errs[0].message);
        logs.push({ t: new Date().toISOString(), level: 'error',
          message: '基线导入失败: ' + err.message });
        err.logs = logs;
        err.stats = stats;
        throw err;
      }
      keyframes.push(PI.normalizeKeyframe(root.keyframes[i], i));
    }
    const project = {
      name: typeof root.name === 'string' ? root.name : 'untitled',
      version: typeof root.version === 'number' ? root.version : 1,
      keyframes
    };
    project.hash = await PI.sha256Hex(PI.canonicalize(project));
    stats.elapsedMs = Date.now() - t0;
    stats.memoryAfterBytes = memoryBytes();
    if (mem0 != null && stats.memoryAfterBytes != null) {
      stats.memoryDeltaBytes = stats.memoryAfterBytes - mem0;
    }
    logs.push({ t: new Date().toISOString(), level: 'info',
      message: '基线导入完成: ' + keyframes.length + ' 个关键帧,耗时 ' +
        stats.elapsedMs + 'ms' });
    return { project, stats, errors: [], logs };
  }

  const api = { baselineImport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.BaselineImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
