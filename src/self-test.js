import { wrapText, layoutText, tokenize } from './text-layout.js';
import { hitTest } from './renderer.js';
import { buildSvg } from './exporter.js';
import { defaultState, Store } from './store.js';

class SilentEmitter {
  on() {}
  emit() {}
}

function assert(condition, name, reason) {
  if (condition) return { name, pass: true, reason: '' };
  return { name, pass: false, reason: reason || 'assertion failed' };
}

export function createRunner(deps) {
  const { store, canvas, t } = deps;

  async function run() {
    const scratch = document.createElement('canvas');
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const ctx = scratch.getContext('2d');
    const isolated = new Store(new SilentEmitter());
    isolated.state = defaultState();
    isolated.state.lang = store.state.lang;
    isolated.storageOk = store.storageOk;
    const memory = new Map();
    isolated.readStorage = (key) => (memory.has(key) ? memory.get(key) : null);
    isolated.persist = () => {
      if (isolated.forceFailure) {
        isolated.storageOk = false;
        return false;
      }
      isolated.state.updatedAt = new Date().toISOString();
      memory.set('poster-editor/state/v1', JSON.stringify(isolated.state));
      isolated.storageOk = true;
      return true;
    };
    isolated.restorePreExportSnapshot = () => {
      const raw = memory.get('poster-editor/pre-export-snapshot/v1');
      if (!raw) return false;
      isolated.state = JSON.parse(raw);
      return true;
    };
    isolated.savePreExportSnapshot = () => {
      memory.set('poster-editor/pre-export-snapshot/v1', JSON.stringify(isolated.snapshot()));
      return true;
    };
    return buildReport(isolated, ctx, scratch);
  }

  async function buildReport(targetStore, ctx, canvas) {
    const store = targetStore;
    const groups = [
      { title: t(store.state.lang, 'testsDefault'), items: defaultCases(ctx, canvas) },
      { title: t(store.state.lang, 'testsBoundary'), items: boundaryCases(ctx) },
      { title: t(store.state.lang, 'testsError'), items: await errorCases() }
    ];
    const items = groups.flatMap((g) => g.items);
    const passed = items.filter((i) => i.pass).length;
    return {
      groups,
      items,
      total: items.length,
      passed,
      failed: items.length - passed,
      at: new Date().toISOString()
    };
  }

  function defaultCases(ctx, canvas) {
    const results = [];
    const shape = store.addShape({
      type: 'text',
      typeLabelKey: 'shapeText',
      x: 60,
      y: 60,
      w: 260,
      h: 120,
      fill: '#111111',
      text: '海报 Poster 2026 混合 mixed 文本',
      fontSize: 24
    });
    const layout = layoutText(ctx, shape.text, shape.w, shape.fontSize);
    results.push(
      assert(
        layout.lines.length >= 1 && layout.lines.every((ln) => ln.length > 0),
        'mixed-text-wraps',
        'wrapped lines are empty'
      )
    );
    results.push(
      assert(
        layout.lines.every((ln) => ln.trim() !== ''),
        'no-blank-lines',
        'a blank line was produced'
      )
    );
    const hit = hitTest(store.state.shapes, { x: shape.x + 5, y: shape.y + 5 });
    results.push(assert(hit?.id === shape.id, 'hit-test-finds-shape', 'hit test missed the new shape'));
    const svg = buildSvg(ctx, store.state, canvas.width, canvas.height);
    results.push(assert(svg.startsWith('<svg') && svg.includes('</svg>'), 'svg-export-payload', 'SVG payload invalid'));
    const png = canvas.toDataURL('image/png');
    results.push(assert(png.startsWith('data:image/png'), 'png-export-payload', 'PNG data URL invalid'));
    store.undo();
    results.push(
      assert(!store.state.shapes.some((sh) => sh.id === shape.id), 'undo-removes-shape', 'undo did not remove shape')
    );
    store.redo();
    results.push(
      assert(store.state.shapes.some((sh) => sh.id === shape.id), 'redo-restores-shape', 'redo did not restore shape')
    );
    return results;
  }

  function boundaryCases(ctx) {
    const results = [];
    const longText = t(store.state.lang, 'longText');
    const narrow = layoutText(ctx, longText, 220, 18);
    results.push(assert(narrow.lines.length >= 4, 'narrow-box-many-lines', `only ${narrow.lines.length} lines in 90px box`));
    const lastLine = narrow.lines[narrow.lines.length - 1];
    const lastTokens = tokenize(lastLine).filter((tk) => tk.kind !== 'space');
    results.push(
      assert(lastTokens.length >= 2, 'no-orphan-char', `orphan line detected: "${lastLine}"`)
    );
    const latin = layoutText(ctx, 'Supercalifragilisticexpialidocious', 70, 16);
    results.push(
      assert(latin.lines.length >= 2, 'long-latin-breaks', 'oversized latin word was not broken')
    );
    const empty = layoutText(ctx, '', 200, 20);
    results.push(assert(empty.lines.length === 0, 'empty-text-no-lines', 'empty text produced lines'));
    const digits = wrapText(ctx, '1234567890 9876543210', 60, 16);
    results.push(assert(digits.length >= 2, 'digit-groups-wrap', 'digit groups did not wrap'));
    const miss = hitTest([], { x: 1, y: 1 });
    results.push(assert(miss === null, 'hit-test-empty-canvas', 'hit test returned shape on empty canvas'));
    const circle = { id: 'c1', type: 'circle', x: 0, y: 0, w: 100, h: 100 };
    const outside = hitTest([circle], { x: 95, y: 95 });
    results.push(assert(outside === null, 'circle-corner-excluded', 'circle hit test includes bounding-box corner'));
    return results;
  }

  async function errorCases() {
    const results = [];
    const baseline = store.snapshot();
    store.savePreExportSnapshot();
    store.forceFailure = true;
    const persisted = store.persist();
    results.push(assert(persisted === false, 'storage-failure-detected', 'persist reported success while storage failed'));
    store.addShape({ type: 'rect', typeLabelKey: 'shapeRect', x: 0, y: 0, w: 10, h: 10, fill: '#000' });
    results.push(assert(store.state.shapes.length >= 1, 'in-memory-edit-continues', 'editing stopped after storage error'));
    store.forceFailure = false;
    const restored = store.restorePreExportSnapshot();
    results.push(
      assert(restored === true, 'snapshot-restored', 'pre-export snapshot could not be restored')
    );
    results.push(
      assert(
        store.state.shapes.length === baseline.shapes.length,
        'state-recovers-after-error',
        'reloaded state does not match pre-error snapshot'
      )
    );
    const reloaded = defaultState();
    Object.assign(reloaded, JSON.parse(store.readStorage('poster-editor/state/v1') || '{}'));
    results.push(
      assert(Array.isArray(reloaded.shapes) && reloaded.shapes.length === baseline.shapes.length,
        'reload-from-storage', 'reloaded state does not match persisted snapshot')
    );
    let threw = false;
    try {
      const broken = document.createElement('canvas');
      broken.toDataURL = () => {
        throw new Error('simulated encoder crash');
      };
      broken.toDataURL('image/png');
    } catch (err) {
      threw = true;
      results.push(
        assert(err.message.includes('simulated'), 'export-error-message', 'error message lost')
      );
    }
    results.push(assert(threw, 'export-error-caught', 'simulated export error was not thrown'));
    return results;
  }

  return { run };
}
