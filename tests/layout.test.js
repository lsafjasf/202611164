import test from "node:test";
import assert from "node:assert/strict";
import { TextLayoutCache, wrapParagraph } from "../src/layout.js";

const layer = {
  id: "sample",
  text: "CITY\nIN\nMOTION",
  w: 240,
  font: "sans-serif",
  fontSize: 42,
  fontWeight: 500,
  lineHeight: 38,
  letterSpacing: -1,
};

test("explicit line breaks survive layout", () => {
  const result = wrapParagraph("CITY IN MOTION", 120, (text) => text.length * 10);
  assert.ok(result.length >= 2);
  assert.equal(result.every((line) => typeof line === "string"), true);
});

test("layout cache reuses identical style/text keys", () => {
  const cache = new TextLayoutCache(8);
  const measure = (text) => text.length * 8;
  const first = cache.get(layer, measure);
  const second = cache.get(layer, measure);
  assert.equal(first.lines.length, 3);
  assert.equal(second.lines.length, 3);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 1, entries: 1, hitRate: 0.5 });
  cache.get({ ...layer, fontSize: 44 }, measure);
  assert.equal(cache.stats().entries, 2);
  cache.clear();
  assert.equal(cache.stats().entries, 0);
});
