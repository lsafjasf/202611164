// 验证脚本：增量布局稳定性、视觉一致性、正常/边界/损坏三组场景。
// 全部使用固定随机种子，失败场景可重复。日志写入 artifacts/logs/。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SpriteAtlas, AtlasError } = require('../src/packer.js');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'artifacts', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------- 确定性工具 ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 每帧像素由名称决定：用于“视觉结果一致”校验（坐标不变 => 像素块必须逐字节一致）。
function renderAtlas(atlas) {
  const buf = Buffer.alloc(atlas.width * atlas.height * 4, 0);
  for (const f of atlas.frames.values()) {
    const h = crypto.createHash('md5').update(f.name).digest();
    const rgba = [h[0], h[1], h[2], 255];
    for (let y = f.y; y < f.y + f.h; y++) {
      for (let x = f.x; x < f.x + f.w; x++) {
        const i = (y * atlas.width + x) * 4;
        // 加一层坐标相关纹理，避免纯色填充掩盖错位
        buf[i] = (rgba[0] + x) & 0xff;
        buf[i + 1] = (rgba[1] + y) & 0xff;
        buf[i + 2] = rgba[2];
        buf[i + 3] = 255;
      }
    }
  }
  return buf;
}

function framePixels(atlas, frame) {
  const buf = Buffer.alloc(frame.w * frame.h * 4);
  const full = renderAtlas(atlas);
  for (let y = 0; y < frame.h; y++) {
    const src = ((frame.y + y) * atlas.width + frame.x) * 4;
    full.copy(buf, y * frame.w * 4, src, src + frame.w * 4);
  }
  return buf;
}

// ---------- 错误日志（修改前后都记录，不吞异常） ----------
class ErrorLog {
  constructor() { this.entries = []; }
  record(scenario, err, context) {
    this.entries.push({
      time: new Date().toISOString(),
      scenario,
      code: err.code || 'UNEXPECTED',
      name: err.name,
      message: err.message,
      recovery: err.recovery || null,
      context: context || null,
    });
  }
  count() { return this.entries.length; }
  byCode(code) { return this.entries.filter((e) => e.code === code).length; }
}

const errorLog = new ErrorLog();
const assertions = [];
function check(label, cond, detail) {
  assertions.push({ label, pass: !!cond, detail: detail || '' });
  if (!cond) console.error(`  [FAIL] ${label} ${detail || ''}`);
}

function resourceSnapshot(atlas, scenario, phase) {
  const m = atlas.metrics();
  return {
    scenario, phase,
    frameCount: m.frameCount,
    atlasSize: `${m.atlasWidth}x${m.atlasHeight}`,
    usedArea: m.usedArea,
    utilization: +(m.utilization * 100).toFixed(2) + '%',
    memoryBytes: m.memoryBytes,
    freeRectCount: m.freeRectCount,
    repackCount: m.repackCount,
    growCount: m.growCount,
    totalPackMs: +m.totalPackMs.toFixed(3),
    errorLogCount: errorLog.count(),
  };
}

const resourceLog = [];
const scenarioLogs = {};
function slog(scenario, line) {
  (scenarioLogs[scenario] = scenarioLogs[scenario] || []).push(line);
}

// ---------- 场景 A：正常输入，60 帧两轮增量修改 ----------
function scenarioNormal() {
  const S = 'A-normal';
  slog(S, '# 场景 A：60 帧 + 两轮增量修改');
  const rng = mulberry32(20261116);
  const atlas = new SpriteAtlas({ width: 1024, height: 1024, maxWidth: 1024, maxHeight: 1024, allowGrow: false });

  // 第 1 轮：插入 60 帧
  const sizes = [];
  for (let i = 0; i < 60; i++) {
    sizes.push({ w: 16 + Math.floor(rng() * 48), h: 16 + Math.floor(rng() * 48) });
  }
  const t0 = performance.now();
  sizes.forEach((s, i) => atlas.insert(`frame_${String(i).padStart(3, '0')}`, s.w, s.h));
  const round1Ms = performance.now() - t0;
  resourceLog.push(resourceSnapshot(atlas, S, 'round1-after-60-inserts'));
  slog(S, `round1: 插入 60 帧, 耗时 ${round1Ms.toFixed(2)}ms, 利用率 ${(atlas.utilization() * 100).toFixed(2)}%`);

  const coordsBefore = new Map([...atlas.frames.values()].map((f) => [f.name, { x: f.x, y: f.y }]));
  const pixelsBefore = new Map([...atlas.frames.values()].map((f) => [f.name, sha256(framePixels(atlas, f))]));
  const repackBefore = atlas.stats.repackCount;

  // 第 2 轮：删除 8 帧 + 新增 10 帧（典型的小规模增量修改）
  const removed = [];
  for (let i = 0; i < 8; i++) {
    const name = `frame_${String(i * 7).padStart(3, '0')}`;
    atlas.remove(name);
    removed.push(name);
  }
  for (let i = 0; i < 10; i++) {
    atlas.insert(`frame_new_${String(i).padStart(2, '0')}`, 16 + Math.floor(rng() * 48), 16 + Math.floor(rng() * 48));
  }
  resourceLog.push(resourceSnapshot(atlas, S, 'round2-after-incremental-edit'));
  slog(S, `round2: 删除 ${removed.length} 帧, 新增 10 帧, 当前 ${atlas.frameCount} 帧`);

  // 校验 1：增量修改不触发整体重排
  check('A: 增量修改未触发整体重排', atlas.stats.repackCount === repackBefore && atlas.stats.repackCount === 0,
    `repackCount=${atlas.stats.repackCount}`);

  // 校验 2：未触碰帧坐标完全不变
  let moved = [];
  for (const [name, c] of coordsBefore) {
    if (removed.includes(name)) continue;
    const now = atlas.getFrame(name);
    if (!now || now.x !== c.x || now.y !== c.y) moved.push(name);
  }
  check('A: 未触碰帧坐标零变化', moved.length === 0, moved.length ? `移动了: ${moved.join(',')}` : `${coordsBefore.size - removed.length} 帧全部保持`);

  // 校验 3：无重叠、坐标合法
  const problems = atlas.validate();
  check('A: 无重叠且切片坐标合法', problems.length === 0, problems.join('; '));

  // 校验 4：视觉一致 —— 未删除帧的像素块逐字节一致
  let visualDiff = [];
  for (const [name, hash] of pixelsBefore) {
    if (removed.includes(name)) continue;
    const f = atlas.getFrame(name);
    if (!f || sha256(framePixels(atlas, f)) !== hash) visualDiff.push(name);
  }
  check('A: 未触碰帧视觉结果一致(像素哈希)', visualDiff.length === 0, visualDiff.join(','));

  // 校验 5：JSON 导出/导入恢复全部帧，且视觉一致
  const json = atlas.toJSON();
  fs.writeFileSync(path.join(LOG_DIR, 'scenario-A-atlas.json'), json);
  const restored = SpriteAtlas.fromJSON(json);
  const sameFrames = [...atlas.frames.entries()].every(([n, f]) => {
    const g = restored.getFrame(n);
    return g && g.x === f.x && g.y === f.y && g.w === f.w && g.h === f.h;
  }) && restored.frameCount === atlas.frameCount;
  check('A: JSON 往返恢复全部帧坐标', sameFrames, `frames=${restored.frameCount}/${atlas.frameCount}`);
  check('A: JSON 往返后整图视觉一致', sha256(renderAtlas(restored)) === sha256(renderAtlas(atlas)));
  resourceLog.push(resourceSnapshot(restored, S, 'round2-json-restored'));
  return atlas;
}

// ---------- 场景 B：边界输入 ----------
function scenarioBoundary() {
  const S = 'B-boundary';
  slog(S, '# 场景 B：边界输入');
  const atlas = new SpriteAtlas({ width: 128, height: 128, maxWidth: 128, maxHeight: 128, allowGrow: false });
  resourceLog.push(resourceSnapshot(atlas, S, 'before'));

  // 空图集导出/导入往返
  const empty = SpriteAtlas.fromJSON(atlas.toJSON());
  check('B: 空图集 JSON 往返', empty.frameCount === 0 && empty.width === 128);

  // 1x1 最小帧
  atlas.insert('tiny', 1, 1);
  check('B: 1x1 最小帧插入', atlas.getFrame('tiny').w === 1);

  // 与图集等大的帧
  const big = new SpriteAtlas({ width: 64, height: 64, maxWidth: 64, maxHeight: 64, allowGrow: false, padding: 0 });
  big.insert('full', 64, 64);
  check('B: 等图集尺寸帧插入', big.utilization() === 1);

  // 零尺寸帧 -> INVALID_FRAME，状态不变
  const countBefore = atlas.frameCount;
  try { atlas.insert('zero', 0, 10); check('B: 零尺寸帧被拒绝', false); }
  catch (e) { errorLog.record(S, e, { op: 'insert', name: 'zero' }); check('B: 零尺寸帧被拒绝', e.code === 'INVALID_FRAME'); }
  check('B: 非法插入后资源数不变', atlas.frameCount === countBefore);

  // 超大帧（超过 max）-> ATLAS_FULL，状态不变
  try { atlas.insert('huge', 256, 256); check('B: 超限帧被拒绝', false); }
  catch (e) { errorLog.record(S, e, { op: 'insert', name: 'huge' }); check('B: 超限帧被拒绝', e.code === 'ATLAS_FULL'); }
  check('B: 超限失败后资源数不变', atlas.frameCount === countBefore);

  // 重名 -> DUPLICATE_NAME
  try { atlas.insert('tiny', 2, 2); check('B: 重名被拒绝', false); }
  catch (e) { errorLog.record(S, e, { op: 'insert', name: 'tiny' }); check('B: 重名被拒绝', e.code === 'DUPLICATE_NAME'); }

  // 删除不存在帧 -> NOT_FOUND
  try { atlas.remove('ghost'); check('B: 删除不存在帧报错', false); }
  catch (e) { errorLog.record(S, e, { op: 'remove', name: 'ghost' }); check('B: 删除不存在帧报错', e.code === 'NOT_FOUND'); }

  // 错误恢复演示：小图集塞满后插入失败 -> 记录异常 -> 紧凑重排 -> 重试成功
  // 三根 16x64 全高列，删掉中间列后空闲区碎成两条 16 宽列，32 宽列放不进
  const packed = new SpriteAtlas({ width: 64, height: 64, maxWidth: 64, maxHeight: 64, allowGrow: false, padding: 0 });
  packed.insert('p1', 16, 64);
  packed.insert('p2', 16, 64);
  packed.insert('p3', 16, 64);
  packed.remove('p2');
  const beforeRecovery = resourceSnapshot(packed, S, 'recovery-before');
  resourceLog.push(beforeRecovery);
  let recovered = false;
  try {
    packed.insert('p4', 32, 64);
  } catch (e) {
    errorLog.record(S, e, { op: 'insert', name: 'p4', strategy: 'repack-then-retry' });
    check('B: 碎片导致空间不足报 ATLAS_FULL', e.code === 'ATLAS_FULL');
    packed.repack(); // 按恢复建议执行紧凑重排
    packed.insert('p4', 32, 64); // 重排合并碎片后重试成功
    recovered = packed.getFrame('p4') != null;
  }
  check('B: 重排恢复后重试成功', recovered);
  check('B: 恢复路径确实发生了重排', packed.stats.repackCount === 1, `repackCount=${packed.stats.repackCount}`);
  check('B: 恢复后布局仍合法', packed.validate().length === 0);
  resourceLog.push(resourceSnapshot(packed, S, 'recovery-after'));

  // 重排失败回滚：帧总量超过图集容量时 repack 必须回滚
  const over = new SpriteAtlas({ width: 32, height: 32, maxWidth: 32, maxHeight: 32, allowGrow: false, padding: 0 });
  over.insert('o1', 32, 32);
  over.frames.set('o2', { name: 'o2', x: 0, y: 0, w: 32, h: 32 }); // 模拟外部强行注入超额帧
  const coordsBeforeRollback = JSON.stringify([...over.frames.entries()]);
  try { over.repack(); check('B: 超重排被拒绝', false); }
  catch (e) {
    errorLog.record(S, e, { op: 'repack' });
    check('B: 超重排被拒绝', e.code === 'REPACK_FAILED');
  }
  check('B: 重排失败后布局回滚', JSON.stringify([...over.frames.entries()]) === coordsBeforeRollback);

  resourceLog.push(resourceSnapshot(atlas, S, 'after'));
}

// ---------- 场景 C：损坏输入（每个用例跑两遍验证可重复） ----------
function scenarioCorrupted() {
  const S = 'C-corrupted';
  slog(S, '# 场景 C：损坏输入');
  // 当前状态作为“已有界面状态”，导入失败不得改变它
  const atlas = new SpriteAtlas({ width: 256, height: 256, allowGrow: false });
  atlas.insert('keep_me', 32, 32);
  const stateBefore = atlas.toJSON();
  resourceLog.push(resourceSnapshot(atlas, S, 'before'));

  const cases = [
    ['非 JSON 文本', 'this is not json {{{', 'INVALID_JSON'],
    ['截断的 JSON', '{"meta":{"size":{"w":256,"h":256}},"frames":[{"name":"a"', 'INVALID_JSON'],
    ['缺少 frames 字段', JSON.stringify({ meta: { size: { w: 256, h: 256 } } }), 'INVALID_SCHEMA'],
    ['缺少 meta.size', JSON.stringify({ frames: [] }), 'INVALID_SCHEMA'],
    ['负坐标', JSON.stringify({ meta: { size: { w: 256, h: 256 } }, frames: [{ name: 'a', frame: { x: -5, y: 0, w: 10, h: 10 } }] }), 'INVALID_COORD'],
    ['零高度', JSON.stringify({ meta: { size: { w: 256, h: 256 } }, frames: [{ name: 'a', frame: { x: 0, y: 0, w: 10, h: 0 } }] }), 'INVALID_COORD'],
    ['坐标越界', JSON.stringify({ meta: { size: { w: 256, h: 256 } }, frames: [{ name: 'a', frame: { x: 250, y: 0, w: 10, h: 10 } }] }), 'INVALID_COORD'],
    ['帧名称为空', JSON.stringify({ meta: { size: { w: 256, h: 256 } }, frames: [{ name: '', frame: { x: 0, y: 0, w: 10, h: 10 } }] }), 'INVALID_SCHEMA'],
    ['帧名称重复', JSON.stringify({ meta: { size: { w: 256, h: 256 } }, frames: [
      { name: 'a', frame: { x: 0, y: 0, w: 10, h: 10 } },
      { name: 'a', frame: { x: 20, y: 0, w: 10, h: 10 } }] }), 'INVALID_SCHEMA'],
    ['切片重叠', JSON.stringify({ meta: { size: { w: 256, h: 256 } }, frames: [
      { name: 'a', frame: { x: 0, y: 0, w: 32, h: 32 } },
      { name: 'b', frame: { x: 16, y: 16, w: 32, h: 32 } }] }), 'OVERLAP'],
  ];

  for (const [label, payload, expectedCode] of cases) {
    const results = [];
    for (let run = 1; run <= 2; run++) {
      try {
        SpriteAtlas.fromJSON(payload);
        results.push('NO_ERROR');
      } catch (e) {
        errorLog.record(S, e, { case: label, run });
        results.push(e.code || 'UNEXPECTED');
      }
    }
    check(`C: "${label}" 抛出 ${expectedCode}`, results[0] === expectedCode, `got ${results[0]}`);
    check(`C: "${label}" 失败可重复`, results[0] === results[1], `run1=${results[0]} run2=${results[1]}`);
    // 导入失败不影响现有图集（界面语义：旧状态保留）
    check(`C: "${label}" 后现有状态未被破坏`, atlas.toJSON() === stateBefore);
  }
  resourceLog.push(resourceSnapshot(atlas, S, 'after'));
  slog(S, `损坏用例 ${cases.length} 个 x 2 轮, 累计错误日志 ${errorLog.byCode('INVALID_JSON') + errorLog.byCode('INVALID_SCHEMA') + errorLog.byCode('INVALID_COORD') + errorLog.byCode('OVERLAP')} 条`);
}

// ---------- 汇总输出 ----------
function writeReports() {
  fs.writeFileSync(path.join(LOG_DIR, 'error-log.json'), JSON.stringify(errorLog.entries, null, 2));
  fs.writeFileSync(path.join(LOG_DIR, 'resource-log.json'), JSON.stringify(resourceLog, null, 2));
  for (const [name, lines] of Object.entries(scenarioLogs)) {
    fs.writeFileSync(path.join(LOG_DIR, `scenario-${name}.log`), lines.join('\n') + '\n');
  }
  const failed = assertions.filter((a) => !a.pass);
  const lines = [];
  lines.push('# 精灵图集增量工具验证报告');
  lines.push('');
  lines.push(`- 时间: ${new Date().toISOString()}`);
  lines.push(`- 断言: ${assertions.length - failed.length}/${assertions.length} 通过`);
  lines.push(`- 错误日志: ${errorLog.count()} 条 (artifacts/logs/error-log.json)`);
  lines.push('');
  lines.push('## 断言明细');
  for (const a of assertions) {
    lines.push(`- [${a.pass ? 'PASS' : 'FAIL'}] ${a.label}${a.detail ? ` — ${a.detail}` : ''}`);
  }
  lines.push('');
  lines.push('## 资源与性能统计（修改前后）');
  lines.push('| 场景 | 阶段 | 帧数 | 图集 | 利用率 | 显存估算(B) | 空闲矩形 | 重排次数 | 累计耗时(ms) | 错误日志数 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of resourceLog) {
    lines.push(`| ${r.scenario} | ${r.phase} | ${r.frameCount} | ${r.atlasSize} | ${r.utilization} | ${r.memoryBytes} | ${r.freeRectCount} | ${r.repackCount} | ${r.totalPackMs} | ${r.errorLogCount} |`);
  }
  lines.push('');
  lines.push('## 错误日志摘要');
  for (const e of errorLog.entries) {
    lines.push(`- [${e.scenario}] ${e.code}: ${e.message} → 恢复建议: ${e.recovery}`);
  }
  fs.writeFileSync(path.join(ROOT, 'artifacts', 'test-report.md'), lines.join('\n') + '\n');
  return failed;
}

function main() {
  console.log('运行场景 A（正常输入，60 帧两轮增量）...');
  scenarioNormal();
  console.log('运行场景 B（边界输入）...');
  scenarioBoundary();
  console.log('运行场景 C（损坏输入）...');
  scenarioCorrupted();
  const failed = writeReports();
  console.log(`报告已写入 artifacts/test-report.md, 日志在 artifacts/logs/`);
  if (failed.length) {
    console.error(`${failed.length} 个断言失败`);
    process.exit(1);
  }
  console.log(`全部 ${assertions.length} 个断言通过, 错误日志 ${errorLog.count()} 条`);
}

main();
