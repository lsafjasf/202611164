/* 状态持久化：localStorage 保存用户选择与界面状态，IndexedDB 保存导出工程。 */
(function () {
  'use strict';

  const STATE_KEY = 'contrast-checker-state-v1';
  const DB_NAME = 'contrast-checker-db';
  const DB_VERSION = 1;
  const STORE = 'exports';

  const defaultState = function () {
    return {
      version: 1,
      scenario: 'default',
      colors: window.Palettes.cloneColors(window.Palettes.SCENARIOS.default.colors),
      baselineColors: window.Palettes.cloneColors(window.Palettes.SCENARIOS.error.colors),
      lastFocus: null,
      lastTestResult: null,
      lastSummary: null
    };
  };

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STATE_KEY);
      if (!raw) {
        return defaultState();
      }
      const parsed = JSON.parse(raw);
      const base = defaultState();
      const merged = Object.assign(base, parsed);
      merged.colors = Object.assign(base.colors, parsed.colors || {});
      merged.baselineColors = Object.assign(base.baselineColors, parsed.baselineColors || {});
      return merged;
    } catch (error) {
      return defaultState();
    }
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const request = fn(store);
        transaction.oncomplete = function () {
          db.close();
          resolve(request && request.result !== undefined ? request.result : undefined);
        };
        transaction.onerror = function () { db.close(); reject(transaction.error); };
      });
    });
  }

  function addExport(record) {
    return tx('readwrite', function (store) { return store.put(record); });
  }

  function listExports() {
    return tx('readonly', function (store) { return store.getAll(); }).then(function (records) {
      return (records || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
    });
  }

  function getExport(id) {
    return tx('readonly', function (store) { return store.get(id); });
  }

  function deleteExport(id) {
    return tx('readwrite', function (store) { return store.delete(id); });
  }

  window.StoreLayer = {
    STATE_KEY: STATE_KEY,
    defaultState: defaultState,
    loadState: loadState,
    saveState: saveState,
    addExport: addExport,
    listExports: listExports,
    getExport: getExport,
    deleteExport: deleteExport
  };
})();
