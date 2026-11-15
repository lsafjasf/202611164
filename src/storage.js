import { APP_SCHEMA, DEFAULT_OPTIONS, DEFAULT_SELECTION, createInitialProject } from "./model.js";

export const SESSION_KEY = "framelab.session.v1";
export const EXPORT_KEY = "framelab.export.v1";
export const HISTORY_KEY = "framelab.history.v1";

function stableDigest(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createDefaultSession() {
  return {
    schema: "framelab.session.v1",
    project: createInitialProject(),
    options: { ...DEFAULT_OPTIONS },
    selectionId: DEFAULT_SELECTION,
    tool: "select",
    camera: { scale: 1, x: 0, y: 0 },
    zoom: 0.82,
    exportRecord: null,
    benchmark: null,
    verification: null,
    updatedAt: null,
  };
}

export function stateSnapshot(session) {
  const project = structuredClone(session.project);
  const options = { ...DEFAULT_OPTIONS, ...session.options };
  const selectionId = session.selectionId || null;
  return {
    schema: APP_SCHEMA,
    project,
    options,
    selectionId,
    revision: project.revision || 1,
    digest: stableDigest({ project, options, selectionId }),
  };
}

export function validateSession(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") {
    return { valid: false, errors: ["会话不是对象"] };
  }
  if (candidate.schema !== "framelab.session.v1") errors.push("会话版本不匹配");
  const project = candidate.project;
  if (!project || typeof project !== "object") {
    errors.push("缺少工程数据");
  } else {
    if (project.schema !== APP_SCHEMA) errors.push("工程版本不匹配");
    if (!Number.isFinite(project.width) || !Number.isFinite(project.height)) errors.push("工程尺寸无效");
    if (!Array.isArray(project.layers) || project.layers.length === 0) errors.push("工程没有图层");
    for (const layer of project.layers || []) {
      if (!layer.id || !layer.type) errors.push("图层缺少 id 或类型");
      if (![layer.x, layer.y, layer.w, layer.h].every(Number.isFinite)) {
        errors.push(`图层 ${layer.id || "?"} 的几何数据无效`);
      }
    }
  }
  if (!candidate.options || typeof candidate.options !== "object") errors.push("缺少优化开关");
  if (!("selectionId" in candidate)) errors.push("缺少用户选择");
  return { valid: errors.length === 0, errors };
}

export function sanitizeSession(candidate) {
  const fallback = createDefaultSession();
  const validation = validateSession(candidate);
  if (!validation.valid) return { session: fallback, errors: validation.errors, recovered: false };
  const projectIds = new Set(candidate.project.layers.map((layer) => layer.id));
  const selectionMissing =
    candidate.selectionId !== null &&
    candidate.selectionId !== undefined &&
    !projectIds.has(candidate.selectionId);
  const warnings = selectionMissing
    ? [`原选择 ${candidate.selectionId} 不在工程中，已改为未选择，未静默替换成其他对象`]
    : [];
  return {
    session: {
      ...fallback,
      ...candidate,
      project: structuredClone(candidate.project),
      options: {
        shadows: candidate.options.shadows !== false,
        sorting: candidate.options.sorting !== false,
        culling: candidate.options.culling !== false,
      },
      selectionId: selectionMissing ? null : candidate.selectionId,
      camera: { ...fallback.camera, ...(candidate.camera || {}) },
      zoom: Number.isFinite(candidate.zoom) ? candidate.zoom : fallback.zoom,
      exportRecord: candidate.exportRecord || null,
      benchmark: candidate.benchmark || null,
      verification: candidate.verification || null,
    },
    errors: [],
    warnings,
    recovered: false,
  };
}

export function persistSession(storage, session) {
  if (!storage) throw new Error("当前浏览器不允许访问本地存储");
  const wrapped = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  storage.setItem(SESSION_KEY, JSON.stringify(wrapped));
  return wrapped;
}

export function loadPersistedState(storage) {
  const fallback = createDefaultSession();
  if (!storage) {
    return { session: fallback, exportRecord: null, warnings: ["本地存储不可用，已使用默认工程"] };
  }
  let rawSession = null;
  let rawExport = null;
  try {
    rawSession = storage.getItem(SESSION_KEY);
    rawExport = storage.getItem(EXPORT_KEY);
  } catch {
    return { session: fallback, exportRecord: null, warnings: ["读取本地存储失败，已使用默认工程"] };
  }
  if (!rawSession) {
    return { session: fallback, exportRecord: null, warnings: [] };
  }
  try {
    const parsed = JSON.parse(rawSession);
    const result = sanitizeSession(parsed);
    if (result.errors.length) {
      const exported = parseExport(rawExport);
      if (exported) {
        return {
          session: sessionFromExport(exported),
          exportRecord: exported,
          warnings: [`会话损坏（${result.errors.join("；")}），已从导出记录恢复`],
        };
      }
      return { session: fallback, exportRecord: null, warnings: [`会话损坏（${result.errors.join("；")}），已恢复默认工程`] };
    }
    return {
      session: result.session,
      exportRecord: parseExport(rawExport),
      warnings: result.warnings || [],
    };
  } catch (error) {
    const exported = parseExport(rawExport);
    if (exported) {
      return {
        session: sessionFromExport(exported),
        exportRecord: exported,
        warnings: [`会话解析失败（${error.message}），已从导出记录恢复`],
      };
    }
    return {
      session: fallback,
      exportRecord: null,
      warnings: [`会话解析失败（${error.message}），已恢复默认工程`],
    };
  }
}

export function parseExport(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed?.schema !== "framelab.export.v1" || !parsed.project) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sessionFromExport(exportRecord) {
  const session = createDefaultSession();
  return {
    ...session,
    project: structuredClone(exportRecord.project),
    options: { ...DEFAULT_OPTIONS, ...exportRecord.options },
    selectionId: exportRecord.selectionId || DEFAULT_SELECTION,
    camera: { ...session.camera, ...(exportRecord.camera || {}) },
    zoom: Number.isFinite(exportRecord.zoom) ? exportRecord.zoom : session.zoom,
    exportRecord: {
      id: exportRecord.id,
      exportedAt: exportRecord.exportedAt,
      digest: exportRecord.digest,
      preExportDigest: exportRecord.preExportDigest,
      selectionId: exportRecord.selectionId,
      revision: exportRecord.revision,
    },
  };
}

export function exportSession(storage, session, now = new Date()) {
  const validation = validateSession({ ...session, schema: "framelab.session.v1" });
  if (!validation.valid) {
    throw new Error(`导出前校验失败：${validation.errors.join("；")}`);
  }
  const preExport = stateSnapshot(session);
  const exportedDigest = stableDigest({
    project: session.project,
    options: session.options,
    selectionId: session.selectionId,
  });
  const exportRecord = {
    schema: "framelab.export.v1",
    id: `export-${Date.now().toString(36)}`,
    exportedAt: now.toISOString(),
    project: structuredClone(session.project),
    options: { ...session.options },
    selectionId: session.selectionId,
    camera: { ...session.camera },
    zoom: session.zoom,
    revision: session.project.revision,
    digest: exportedDigest,
    preExportDigest: preExport.digest,
    preExport,
  };
  if (!storage) throw new Error("无法写入导出恢复点：本地存储不可用");
  storage.setItem(EXPORT_KEY, JSON.stringify(exportRecord));
  const updated = persistSession(storage, {
    ...session,
    exportRecord: {
      id: exportRecord.id,
      exportedAt: exportRecord.exportedAt,
      digest: exportRecord.digest,
      preExportDigest: exportRecord.preExportDigest,
      selectionId: exportRecord.selectionId,
      revision: exportRecord.revision,
    },
  });
  return { exportRecord, session: updated, preExport };
}

export function restoreExport(storage, session) {
  const raw = storage?.getItem(EXPORT_KEY);
  const exportRecord = parseExport(raw);
  if (!exportRecord) throw new Error("没有可用的导出记录");
  const restored = {
    ...sessionFromExport(exportRecord),
    exportRecord: session.exportRecord || {
      id: exportRecord.id,
      exportedAt: exportRecord.exportedAt,
      digest: exportRecord.digest,
      preExportDigest: exportRecord.preExportDigest,
      selectionId: exportRecord.selectionId,
      revision: exportRecord.revision,
    },
  };
  persistSession(storage, restored);
  return { session: restored, exportRecord };
}

export function snapshotDigest(session) {
  return stateSnapshot(session).digest;
}

export function createExportFile(exportRecord) {
  return JSON.stringify(exportRecord, null, 2);
}
