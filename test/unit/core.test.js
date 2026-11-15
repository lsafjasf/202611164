import assert from 'node:assert/strict';
import {
  buildBoundaryProject,
  buildDefaultProject,
  buildDanglingReferenceProject,
  buildDuplicateIdProject,
  buildIllegalTypeProject,
} from '../../src/core/sample-data.js';
import { validateProject } from '../../src/core/validate.js';
import {
  cloneProject,
  countObjects,
  createExportEnvelope,
  projectHash,
  toPrettyJSON,
} from '../../src/core/serialize.js';
import { EditorStore } from '../../src/core/store.js';
import { evaluateAt, interpolateKeyframes } from '../../src/core/engine.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

export const unitTests = [
  {
    group: 'default',
    name: '默认工程通过校验且对象数正确',
    run() {
      const project = buildDefaultProject();
      const result = validateProject(project);
      assert.equal(result.valid, true, JSON.stringify(result.errors));
      assert.deepEqual(countObjects(project), {
        projects: 1, assets: 1, layers: 3, keyframes: 5, total: 10,
      });
    },
  },
  {
    group: 'default',
    name: '关键帧插值在中间时刻命中目标值',
    run() {
      const project = buildDefaultProject();
      const layer = project.layers[0];
      const values = interpolateKeyframes(layer.keyframes, 2.5);
      assert.equal(values.x, 260);
      const evaluated = evaluateAt(project, 2.5);
      assert.equal(evaluated[0].x, 260);
      assert.ok(Math.abs(evaluated[0].opacity - 0.6) < 1e-9);
    },
  },
  {
    group: 'default',
    name: '导出-导入往返后哈希与对象数完全一致',
    async run() {
      const project = buildDefaultProject();
      const hashBefore = await projectHash(project);
      const store = new EditorStore(cloneProject(project), null);
      const { json } = store.exportProject();
      const result = store.importJSON(json);
      assert.equal(result.ok, true);
      assert.equal(await store.currentHash(), hashBefore);
      assert.deepEqual(countObjects(store.project), countObjects(project));
    },
  },
  {
    group: 'default',
    name: '三次往返不累积重复对象且哈希稳定',
    async run() {
      const project = buildDefaultProject();
      const hashBefore = await projectHash(project);
      const countsBefore = countObjects(project);
      const store = new EditorStore(cloneProject(project), null);
      for (let round = 0; round < 3; round += 1) {
        const exported = store.exportProject();
        const result = store.importJSON(exported.json);
        assert.equal(result.ok, true);
        assert.deepEqual(countObjects(store.project), countsBefore);
      }
      assert.equal(await store.currentHash(), hashBefore);
      const ids = store.project.layers.flatMap((layer) => [
        layer.id,
        ...layer.keyframes.map((keyframe) => keyframe.id),
      ]).concat(store.project.assets.map((asset) => asset.id));
      assert.equal(new Set(ids).size, ids.length);
    },
  },
  {
    group: 'default',
    name: '导出动作不修改工程状态（保留导出前快照）',
    run() {
      const store = new EditorStore(buildDefaultProject(), null);
      const before = JSON.stringify(store.project);
      store.exportProject();
      assert.equal(JSON.stringify(store.project), before);
      assert.equal(JSON.stringify(store.preExportSnapshot), before);
    },
  },
  {
    group: 'default',
    name: '导出包含规范 counts 字段',
    run() {
      const envelope = createExportEnvelope(buildDefaultProject());
      assert.equal(envelope.format, 'editor-project');
      assert.equal(envelope.counts.total, 10);
      assert.equal(toPrettyJSON(envelope).trimStart().startsWith('{'), true);
    },
  },
  {
    group: 'boundary',
    name: '边界工程（极值坐标/时长/帧率）通过校验',
    run() {
      const result = validateProject(buildBoundaryProject());
      assert.equal(result.valid, true, JSON.stringify(result.errors));
    },
  },
  {
    group: 'boundary',
    name: '越界数值与非法帧率被拒绝',
    run() {
      const project = buildBoundaryProject();
      project.layers[0].x = -10001;
      project.timeline.fps = 241;
      const result = validateProject(project);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.path === '$.layers[0].x'));
      assert.ok(result.errors.some((error) => error.path === '$.timeline.fps'));
    },
  },
  {
    group: 'boundary',
    name: '关键帧时间超出时间轴被拒绝',
    run() {
      const project = buildBoundaryProject();
      project.layers[0].keyframes[1].time = 3601;
      const result = validateProject(project);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.code === 'out-of-range'));
    },
  },
  {
    group: 'boundary',
    name: 'localStorage 持久化后重新载入恢复完整工程与选择',
    run() {
      const storage = new MemoryStorage();
      const store = new EditorStore(buildDefaultProject(), storage);
      store.selectLayer('layer-text');
      store.setCurrentTime(1.25);
      const reloaded = EditorStore.load(storage);
      assert.equal(reloaded.project.selection.layerId, 'layer-text');
      assert.equal(reloaded.project.selection.currentTime, 1.25);
      assert.equal(reloaded.project.layers.length, 3);
      assert.equal(reloaded.project.assets[0].id, 'asset-logo');
    },
  },
  {
    group: 'boundary',
    name: '损坏的 localStorage 数据回退到新工程而不抛异常',
    run() {
      const storage = new MemoryStorage();
      storage.setItem('editor-project-v1', '{broken');
      const store = EditorStore.load(storage);
      assert.equal(store.project.layers.length, 0);
    },
  },
  {
    group: 'error',
    name: '悬空素材引用阻止导入并保持原工程',
    async run() {
      const store = new EditorStore(buildDefaultProject(), null);
      const hashBefore = await store.currentHash();
      const result = store.importJSON(toPrettyJSON(buildDanglingReferenceProject()));
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].code, 'dangling-reference');
      assert.equal(await store.currentHash(), hashBefore);
    },
  },
  {
    group: 'error',
    name: '非法图层类型与非法缓动被报告',
    run() {
      const result = validateProject(buildIllegalTypeProject());
      assert.equal(result.valid, false);
      const codes = result.errors.map((error) => error.code);
      assert.ok(codes.includes('illegal-type'));
      assert.ok(result.errors.some((error) => error.path.includes('easing')));
    },
  },
  {
    group: 'error',
    name: '重复对象 id 被拒绝',
    run() {
      const result = validateProject(buildDuplicateIdProject());
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.code === 'duplicate-id'));
    },
  },
  {
    group: 'error',
    name: 'JSON 语法错误返回结构化错误且不改动工程',
    run() {
      const store = new EditorStore(buildDefaultProject(), null);
      const result = store.importJSON('{not-valid');
      assert.equal(result.ok, false);
      assert.equal(store.lastError.code, 'json-parse');
      assert.equal(store.project.id, 'proj-default');
    },
  },
  {
    group: 'error',
    name: '悬空选择引用阻止导入',
    run() {
      const project = buildDefaultProject();
      project.selection.layerId = 'layer-ghost';
      const result = validateProject(project);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.code === 'dangling-reference'));
    },
  },
  {
    group: 'error',
    name: '错误恢复：失败后可继续导入合法工程',
    run() {
      const store = new EditorStore(buildDefaultProject(), null);
      const failed = store.importJSON(toPrettyJSON(buildDanglingReferenceProject()));
      assert.equal(failed.ok, false);
      const recovered = store.importJSON(toPrettyJSON(buildDefaultProject()));
      assert.equal(recovered.ok, true);
      assert.equal(store.lastImport.ok, true);
      assert.equal(store.project.id, 'proj-default');
    },
  },
];
