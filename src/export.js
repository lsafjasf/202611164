import { cloneState, createId, createProjectPayload, recordExport } from "./model.js";
import { ResourceRegistry } from "./error-boundary.js";
import { dataUrlToBlob, drawScene } from "./render.js";

function safeFilename(name, extension, revision) {
  const base = (name || "未命名作品")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return `${base}-rev${revision}.${extension}`;
}

function defaultDelivery(blob, filename, registry) {
  if (typeof document === "undefined" || typeof globalThis.URL?.createObjectURL !== "function") {
    throw new Error("当前环境无法创建下载链接。");
  }
  registry.cleanup("download");
  const url = globalThis.URL.createObjectURL(blob);
  registry.add("download", () => globalThis.URL.revokeObjectURL(url), { filename });
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  anchor.dataset.exportDownload = "true";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  registry.cleanup("download");
}

export class ExportFailure extends Error {
  constructor(message, context) {
    super(message);
    this.name = "ExportFailure";
    this.context = context;
  }
}

export class ExportController {
  constructor(options = {}) {
    this.delivery = options.delivery || defaultDelivery;
    this.now = options.now || (() => new Date().toISOString());
    this.resources = new ResourceRegistry("export");
    this.lastSnapshot = null;
    this.lastRecord = null;
    this.sequence = 0;
  }

  capture(state) {
    this.lastSnapshot = cloneState(state);
    return this.lastSnapshot;
  }

  fail(format, state, message) {
    const at = this.now();
    const record = {
      id: createId("export", Date.now(), this.sequence += 0.17),
      format,
      projectName: state.projectName || "未命名作品",
      revision: state.revision,
      status: "failure",
      at,
      bytes: 0,
      reason: message
    };
    throw new ExportFailure(message, {
      format,
      at,
      revision: state.revision,
      snapshot: this.lastSnapshot,
      record
    });
  }

  async exportJson(state, options = {}) {
    this.capture(state);
    if (options.fail) this.fail("json", state, "模拟的一次性导出故障：下载通道未就绪。");
    const at = this.now();
    const payload = createProjectPayload(state, at);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const filename = safeFilename(state.projectName, "json", state.revision);
    if (options.deliver !== false) {
      try {
        await this.delivery(blob, filename, this.resources);
      } catch (error) {
        this.fail("json", state, `下载未开始：${error.message}`);
      }
    }
    const record = {
      id: createId("export", Date.now(), this.sequence += 0.31),
      format: "json",
      projectName: state.projectName || "未命名作品",
      revision: state.revision,
      status: "success",
      at,
      bytes: new TextEncoder().encode(json).length,
      reason: ""
    };
    this.lastRecord = record;
    return { record, payload, blob, filename };
  }

  async createPngBlob(state, canvasFactory) {
    const factory = canvasFactory || (() => document.createElement("canvas"));
    const canvas = factory();
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext("2d");
    drawScene(ctx, state);
    if (typeof canvas.toBlob === "function") {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas 未能生成 PNG 数据。"));
        }, "image/png");
      });
    }
    if (typeof canvas.toDataURL === "function") {
      return dataUrlToBlob(canvas.toDataURL("image/png"));
    }
    throw new Error("当前画布不支持 PNG 编码。");
  }

  async exportPng(state, options = {}) {
    this.capture(state);
    if (options.fail) this.fail("png", state, "模拟的一次性导出故障：PNG 编码器不可用。");
    const at = this.now();
    let blob;
    try {
      blob = await this.createPngBlob(state, options.canvasFactory);
    } catch (error) {
      this.fail("png", state, `PNG 生成失败：${error.message}`);
    }
    const filename = safeFilename(state.projectName, "png", state.revision);
    if (options.deliver !== false) {
      try {
        await this.delivery(blob, filename, this.resources);
      } catch (error) {
        this.fail("png", state, `下载未开始：${error.message}`);
      }
    }
    const record = {
      id: createId("export", Date.now(), this.sequence += 0.43),
      format: "png",
      projectName: state.projectName || "未命名作品",
      revision: state.revision,
      status: "success",
      at,
      bytes: blob.size || 0,
      reason: ""
    };
    this.lastRecord = record;
    return { record, blob, filename };
  }

  restoreSnapshot() {
    return this.lastSnapshot ? cloneState(this.lastSnapshot) : null;
  }

  dispose() {
    this.resources.cleanupAll();
  }
}

export function attachExportRecord(state, record) {
  return recordExport(state, record);
}
