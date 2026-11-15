import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("UI DOM references and state fields are declared", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/ui/app.js", root), "utf8"),
  ]);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const referencedIds = [...source.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
  const missingIds = [...new Set(referencedIds)].filter((id) => !ids.has(id));
  assert.deepEqual(missingIds, []);

  const stateBlock = /const state = \{([\s\S]*?)\n\};/.exec(source);
  assert.ok(stateBlock, "state object should be declared");
  const stateFields = new Set(
    [...stateBlock[1].matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)].map((match) => match[1]),
  );
  const stateReferences = new Set(
    [...source.matchAll(/\bstate\.([a-zA-Z0-9_]+)/g)].map((match) => match[1]),
  );
  const missingFields = [...stateReferences].filter((field) => !stateFields.has(field));
  assert.deepEqual(missingFields, []);
});

test("UI catch paths record errors instead of silently succeeding", async () => {
  const source = await readFile(new URL("src/ui/app.js", root), "utf8");
  assert.equal(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(source), false);
  assert.match(source, /recordError\(error/);
  assert.match(source, /console\.error\(/);
});
