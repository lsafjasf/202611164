import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_KEY,
  SESSION_KEY,
  createDefaultSession,
  exportSession,
  loadPersistedState,
  persistSession,
  restoreExport,
  stateSnapshot,
} from "../src/storage.js";

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

test("export preserves pre-export digest, selection and options", () => {
  const storage = memoryStorage();
  const session = createDefaultSession();
  session.selectionId = "halo";
  session.options = { shadows: false, sorting: true, culling: false };
  session.project.layers.find((layer) => layer.id === "halo").x += 12;
  const before = stateSnapshot(session);
  const result = exportSession(storage, session, new Date("2026-11-16T00:00:00.000Z"));
  assert.equal(result.exportRecord.preExportDigest, before.digest);
  assert.equal(result.exportRecord.selectionId, "halo");
  assert.equal(result.exportRecord.options.shadows, false);
  assert.equal(result.exportRecord.preExport.selectionId, "halo");
  assert.ok(storage.getItem(EXPORT_KEY));
});

test("reload restores user selection, project revision and export record", () => {
  const storage = memoryStorage();
  const session = createDefaultSession();
  session.selectionId = "session-time";
  session.project.revision = 7;
  exportSession(storage, session);
  const loaded = loadPersistedState(storage);
  assert.equal(loaded.session.selectionId, "session-time");
  assert.equal(loaded.session.project.revision, 7);
  assert.equal(loaded.warnings.length, 0);
  assert.ok(loaded.exportRecord.digest);
  const restored = restoreExport(storage, loaded.session);
  assert.equal(restored.session.selectionId, "session-time");
});

test("corrupt session is reported and recovered from export", () => {
  const storage = memoryStorage();
  const session = createDefaultSession();
  session.selectionId = "subhead";
  exportSession(storage, session);
  storage.setItem(SESSION_KEY, "{broken json");
  const loaded = loadPersistedState(storage);
  assert.equal(loaded.session.selectionId, "subhead");
  assert.ok(loaded.warnings[0].includes("导出记录恢复"));
});

test("persist writes a complete reloadable session", () => {
  const storage = memoryStorage();
  const session = createDefaultSession();
  session.selectionId = "barcode";
  persistSession(storage, session);
  assert.ok(storage.getItem(SESSION_KEY));
  const loaded = JSON.parse(storage.getItem(SESSION_KEY));
  assert.equal(loaded.selectionId, "barcode");
  assert.equal(loaded.project.layers.length, 16);
});

test("missing selection is reported instead of silently replaced", () => {
  const storage = memoryStorage();
  const session = createDefaultSession();
  session.selectionId = "removed-layer";
  persistSession(storage, session);
  const loaded = loadPersistedState(storage);
  assert.equal(loaded.session.selectionId, null);
  assert.ok(loaded.warnings[0].includes("未静默替换"));
});
