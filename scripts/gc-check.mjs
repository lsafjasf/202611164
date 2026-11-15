import assert from "node:assert/strict";
import { collectSubtreeIds, findNode } from "../src/core/model.js";
import { CacheEngine } from "../src/core/engine.js";
import { VIEWPORT, buildNormalScene } from "../src/core/scenarios.js";

if (typeof global.gc !== "function") {
  throw new Error("Run with: node --expose-gc scripts/gc-check.mjs");
}

const scene = buildNormalScene();
const engine = new CacheEngine({ mode: "fixed" });
engine.render(scene, { viewport: VIEWPORT });

function makeWeakReferences(node) {
  const refs = [new WeakRef(node)];
  for (let index = 0; index < node.children.length; index += 1) {
    refs.push(new WeakRef(node.children[index]));
  }
  return refs;
}

let target = findNode(scene.root, "chart-panel");
const ids = collectSubtreeIds(target);
const references = makeWeakReferences(target);
const targetId = target.id;
target = null;
const deleted = engine.deleteNode(scene, targetId);
assert.equal(deleted.referencesRemaining, 0);
assert.equal(engine.countReferences(ids), 0);

for (let attempt = 0; attempt < 50; attempt += 1) {
  global.gc();
  await new Promise((resolve) => setImmediate(resolve));
}

const alive = references.filter((ref) => ref.deref()).length;
assert.equal(alive, 0, `${alive} deleted node object(s) are still strongly reachable`);
console.log(`GC check passed: ${references.length} deleted node objects collected`);
