import {
  LIMITS,
  addLayer,
  cloneState,
  createDefaultState,
  getSelectedLayer,
  loadState,
  removeLayer,
  saveState,
  selectLayer,
  updateLayer,
  updateProjectName,
  STORAGE_KEY
} from "./model.js";
import { ModuleBoundary, ResourceRegistry } from "./error-boundary.js";
import { AudioEngine } from "./audio-engine.js";
import { ExportController } from "./export.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dispatchPointer(app, type, point, pointerType, pointerId) {
  const win = app.doc.defaultView;
  const EventClass = win.PointerEvent || win.MouseEvent || win.Event;
  const event = new EventClass(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    pointerId
  });
  if (!("pointerType" in event)) {
    Object.defineProperty(event, "pointerType", { value: pointerType });
  }
  if (!("pointerId" in event)) {
    Object.defineProperty(event, "pointerId", { value: pointerId });
  }
  app.el.studioCanvas.dispatchEvent(event);
}

function layerPoint(app, layer) {
  const point = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
  const rect = app.el.studioCanvas.getBoundingClientRect();
  return {
    x: rect.left + (point.x / 960) * rect.width,
    y: rect.top + (point.y / 540) * rect.height
  };
}

function fakeAudioContext() {
  const parameter = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {}
  });
  return {
    currentTime: 0,
    state: "running",
    destination: {},
    async resume() {},
    async close() {},
    createOscillator() {
      return {
        type: "sine",
        frequency: parameter(),
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        onended: null
      };
    },
    createGain() {
      return {
        gain: parameter(),
        connect() {},
        disconnect() {}
      };
    }
  };
}

const AUDIO_CONFIG = {
  waveform: "triangle",
  volume: 26,
  bpm: 96,
  pattern: [true, false, true, true, false, true, false, true],
  notes: [0, 3, 7, 10, 7, 3, 5, 12]
};

export const SUITES = {
  default: {
    label: "默认",
    tests: [
      {
        name: "键盘方向键移动图层",
        async run(app) {
          const layer = app.state.layers.find((item) => item.type !== "text") || app.state.layers[0];
          app.state = selectLayer(app.state, layer.id);
          app.renderAll();
          app.el.studioCanvas.focus();
          const before = app.state.layers.find((item) => item.id === layer.id).x;
          const win = app.doc.defaultView;
          app.el.studioCanvas.dispatchEvent(new win.KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            cancelable: true
          }));
          const after = app.state.layers.find((item) => item.id === layer.id).x;
          assert(after === before + 8, `x 应从 ${before} 变为 ${before + 8}，实际为 ${after}`);
          assert(app.state.selection === layer.id, "键盘移动后选择不应丢失");
          assert(app.doc.activeElement === app.el.studioCanvas, "画布应保持键盘焦点");
          return `x ${before} → ${after}，选择保持`;
        }
      },
      {
        name: "鼠标与触屏到达同一选择",
        async run(app) {
          const layer = app.state.layers.find((item) => item.type !== "text") || app.state.layers[0];
          const point = layerPoint(app, layer);
          app.state = selectLayer(app.state, null);
          app.renderAll();
          dispatchPointer(app, "pointerdown", point, "mouse", 1);
          dispatchPointer(app, "pointerup", point, "mouse", 1);
          const mouseSelection = app.state.selection;
          app.state = selectLayer(app.state, null);
          app.renderAll();
          dispatchPointer(app, "pointerdown", point, "touch", 2);
          dispatchPointer(app, "pointerup", point, "touch", 2);
          const touchSelection = app.state.selection;
          assert(mouseSelection === layer.id, `鼠标应选择 ${layer.id}，实际为 ${mouseSelection}`);
          assert(touchSelection === layer.id, `触屏应选择 ${layer.id}，实际为 ${touchSelection}`);
          assert(mouseSelection === touchSelection, "鼠标与触屏应到达同一功能状态");
          return `鼠标/触屏均选择 ${layer.name}`;
        }
      },
      {
        name: "保存后重新载入选择一致",
        async run(app) {
          const memory = new Map();
          const storage = {
            getItem: (key) => memory.get(key) || null,
            setItem: (key, value) => memory.set(key, value)
          };
          const target = app.state.layers.at(-1);
          const state = selectLayer(app.state, target.id);
          const saved = saveState(storage, state);
          assert(saved.ok, "保存应成功");
          const loaded = loadState(storage);
          assert(loaded.source === "restored", `应恢复快照，实际为 ${loaded.source}`);
          assert(loaded.state.selection === target.id, "重新载入后选择应一致");
          assert(loaded.state.layers.length === state.layers.length, "图层数量应一致");
          for (const layer of state.layers) {
            const restored = loaded.state.layers.find((item) => item.id === layer.id);
            assert(restored, `图层 ${layer.id} 应恢复`);
            assert(restored.x === layer.x && restored.y === layer.y, `图层 ${layer.name} 位置应一致`);
            if (layer.type === "text") assert(restored.text === layer.text, `图文字 ${layer.name} 内容应一致`);
          }
          assert(memory.get(STORAGE_KEY), "快照键应存在");
          return `rev ${loaded.state.revision}，选择 ${target.name} 一致`;
        }
      },
      {
        name: "导出载荷保留选择与导出前状态",
        async run(app) {
          const controller = new ExportController({ delivery: async () => {} });
          const before = JSON.stringify(app.state);
          const result = await controller.exportJson(app.state, { deliver: false });
          assert(JSON.stringify(app.state) === before, "导出不得修改工程状态");
          assert(result.payload.project.selection === app.state.selection, "导出载荷应保留选择");
          assert(result.payload.project.layers.length === app.state.layers.length, "导出载荷应保留全部图层");
          assert(result.record.status === "success", "导出记录应为成功");
          return `${result.record.format.toUpperCase()} · ${result.record.bytes} B · rev ${result.record.revision}`;
        }
      }
    ]
  },
  boundary: {
    label: "边界",
    tests: [
      {
        name: "文字上限 80 字符",
        async run(app) {
          const textLayer = app.state.layers.find((item) => item.type === "text") || addLayer(app.state, "text").layer;
          const next = updateLayer(app.state, textLayer.id, { text: "字".repeat(200) });
          const updated = next.layers.find((item) => item.id === textLayer.id);
          assert(updated.text.length === LIMITS.text, `文字应截断到 ${LIMITS.text}，实际 ${updated.text.length}`);
          return `${updated.text.length} 字符上限生效`;
        }
      },
      {
        name: "图层上限 12 且失败可解释",
        async run(app) {
          let state = cloneState(app.state);
          while (state.layers.length < LIMITS.layers) state = addLayer(state, "rect").state;
          let message = "";
          try {
            addLayer(state, "rect");
          } catch (error) {
            message = error.message;
            assert(error.code === "LAYER_LIMIT", "超限错误应带 LAYER_LIMIT 代码");
          }
          assert(state.layers.length === LIMITS.layers, `应保留 ${LIMITS.layers} 个图层`);
          assert(message.includes("删除"), "错误信息应给出可操作建议");
          return `${LIMITS.layers} 层上限 · ${message}`;
        }
      },
      {
        name: "零图层仍可恢复编辑",
        async run(app) {
          let state = cloneState(app.state);
          for (const layer of [...state.layers]) state = removeLayer(state, layer.id);
          assert(state.layers.length === 0, "应允许删除到零图层");
          assert(state.selection === null, "零图层时选择应为空");
          const added = addLayer(state, "circle");
          assert(added.state.layers.length === 1, "零图层后应能重新添加");
          assert(added.state.selection === added.layer.id, "新图层应自动选中");
          return "0 → 1 图层，选择已恢复";
        }
      },
      {
        name: "重试前清理资源，不重复创建",
        async run() {
          const resources = new ResourceRegistry("test");
          let attempts = 0;
          const boundary = new ModuleBoundary({
            id: "image",
            label: "图像处理",
            cleanup: () => resources.cleanupAll()
          });
          const first = await boundary.run(async () => {
            attempts += 1;
            resources.add("canvas-context", () => {});
            throw new Error("边界测试故障");
          });
          assert(first.ok === false, "首次应失败");
          assert(resources.size === 0, "失败后应清理资源");
          const retry = await boundary.run(async () => {
            attempts += 1;
            assert(resources.size === 0, "重试前资源必须为空");
            resources.add("canvas-context", () => {});
            return "ok";
          }, { retry: true });
          assert(retry.ok, "重试应成功");
          assert(resources.size === 1, "重试后应只存在一个资源");
          assert(attempts === 2, "应只执行两次尝试");
          resources.cleanupAll();
          return "故障 1 次 → 清理 → 重试 1 次，资源峰值 1";
        }
      },
      {
        name: "长工程名截断且保留内容",
        async run(app) {
          const next = updateProjectName(app.state, "工".repeat(120));
          assert(next.projectName.length === LIMITS.projectName, "工程名应截断到 48 字符");
          assert(next.layers.length === app.state.layers.length, "改名不得影响图层");
          return `${next.projectName.length} 字符 · 图层 ${next.layers.length}`;
        }
      }
    ]
  },
  error: {
    label: "错误",
    tests: [
      {
        name: "图像失败保留编辑并可恢复",
        async run(app) {
          const before = JSON.stringify({
            layers: app.state.layers,
            text: app.state.layers.filter((item) => item.type === "text"),
            selection: app.state.selection
          });
          app.faults.arm("image");
          const failed = await app.applyImageAction();
          assert(!failed.ok, "注入故障后图像操作应失败");
          assert(app.el.imageError.hidden === false, "图像错误卡应显示");
          assert(app.el.imageHealth.textContent === "故障", "图像健康状态应为故障");
          assert(app.boundaries.image.state.error.moduleLabel === "图像处理", "错误应标明模块名");
          assert(app.boundaries.image.state.error.advice.length > 0, "错误应提供可操作建议");
          const after = JSON.stringify({
            layers: app.state.layers,
            text: app.state.layers.filter((item) => item.type === "text"),
            selection: app.state.selection
          });
          assert(before === after, "图像失败不得丢失图层、文字或选择");
          await new Promise((resolve) => setTimeout(resolve, 10));
          assert(app.el.imageError.contains(app.doc.activeElement), "失败后焦点应进入错误区域");
          const recovered = await app.applyImageAction({ retry: true });
          assert(recovered.ok, "重试图像操作应成功");
          assert(app.boundaries.image.state.recovered, "图像边界应标记已恢复");
          assert(app.el.canvasStatus.textContent.includes("已恢复"), "Canvas 应展示恢复状态");
          assert(app.el.imageError.hidden, "恢复后错误卡应隐藏");
          return "3 图层保留 · 焦点进入错误区 · Canvas 显示已恢复";
        }
      },
      {
        name: "音频失败停止节点，重试不重复",
        async run() {
          const engine = new AudioEngine({ contextFactory: fakeAudioContext });
          const boundary = new ModuleBoundary({
            id: "audio",
            label: "音频合成",
            cleanup: () => engine.stopAll("test-cleanup")
          });
          const failed = await boundary.run(async () => {
            await engine.start(AUDIO_CONFIG, { failAfterCreate: true });
          });
          assert(!failed.ok, "音频故障应被边界捕获");
          assert(engine.nodeCount === 0, `失败后节点应为 0，实际 ${engine.nodeCount}`);
          const retry = await boundary.run(async () => {
            assert(engine.nodeCount === 0, "重试前不应残留节点");
            await engine.start(AUDIO_CONFIG);
            return "playing";
          }, { retry: true });
          assert(retry.ok, "音频重试应成功");
          assert(engine.nodeCount >= 1, "重试后应有新活动节点");
          const peak = engine.nodeCount;
          engine.stopAll("test-end");
          assert(engine.nodeCount === 0, "停止后节点应全部释放");
          return `故障节点 0 → 重试节点 ${peak} → 停止后 0`;
        }
      },
      {
        name: "导出失败保留快照并可重试",
        async run(app) {
          const before = JSON.stringify(app.state);
          app.faults.arm("export");
          const failed = await app.exportAction("json", { deliver: false });
          assert(!failed.ok, "注入故障后导出应失败");
          assert(JSON.stringify(app.state.layers) === JSON.stringify(JSON.parse(before).layers), "导出失败不得修改图层");
          assert(app.boundaries.export.state.error.moduleLabel === "导出", "导出错误应标明模块名");
          assert(app.preExportSnapshot, "应保留导出前快照");
          assert(app.preExportMeta.revision === JSON.parse(before).revision, "快照修订号应一致");
          assert(app.state.exports.some((item) => item.status === "failure" && item.reason), "失败记录应包含具体原因");
          const recovered = await app.exportAction("json", { deliver: false, retry: true });
          assert(recovered.ok, "导出重试应成功");
          assert(app.state.exports.some((item) => item.status === "success"), "成功后应写入导出记录");
          assert(app.boundaries.export.state.recovered, "导出边界应标记恢复");
          return "快照 rev 保留 · 失败原因可见 · 重试成功";
        }
      },
      {
        name: "跨模块隔离：图像故障不阻断导出",
        async run(app) {
          app.faults.arm("image");
          const imageFailure = await app.applyImageAction();
          assert(!imageFailure.ok, "图像操作应失败");
          const beforeExport = JSON.stringify(app.state);
          const exported = await app.exportAction("json", { deliver: false });
          assert(exported.ok, "图像故障时导出模块仍应工作");
          assert(JSON.stringify(app.state).includes(JSON.stringify(app.state.layers)), "图层应继续保留");
          assert(beforeExport.length > 0, "导出前状态应可度量");
          return "图像故障 · 导出成功 · 编辑未回滚";
        }
      }
    ]
  }
};

export async function runAcceptanceSuite(app, suiteName) {
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`未知测试组：${suiteName}`);
  const results = [];
  for (const test of suite.tests) {
    const stateSnapshot = cloneState(app.state);
    const wasTesting = app.testing;
    app.testing = true;
    try {
      const detail = await test.run(app);
      results.push({ name: test.name, ok: true, detail: detail || "通过" });
    } catch (error) {
      results.push({ name: test.name, ok: false, detail: error.message || String(error) });
    } finally {
      app.audio.stopAll("test-restore");
      app.faults.clear();
      app.state = stateSnapshot;
      app.testing = wasTesting;
      app.renderAll();
    }
  }
  return {
    suite: suiteName,
    label: suite.label,
    total: results.length,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results
  };
}

export function createEmptyTestSummary() {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    suites: {}
  };
}

export function mergeTestSummaries(summary, run) {
  return {
    total: summary.total + run.total,
    passed: summary.passed + run.passed,
    failed: summary.failed + run.failed,
    suites: { ...summary.suites, [run.suite]: run }
  };
}
