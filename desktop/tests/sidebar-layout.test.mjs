import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/sidebar-layout.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports });
const {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_STORAGE_KEY,
  sidebarMaxWidth,
  clampSidebarWidth,
  settleSidebarWidth,
  readSidebarPreference,
} = exports;

// Read plain values across the VM boundary without comparing realm prototypes.
const preference = (raw) => ({ ...readSidebarPreference(raw) });

test("uses the agreed initial width, resize limits, and versioned preference key", () => {
  assert.equal(DEFAULT_SIDEBAR_WIDTH, 230);
  assert.equal(MIN_SIDEBAR_WIDTH, 200);
  assert.equal(MAX_SIDEBAR_WIDTH, 340);
  assert.equal(SIDEBAR_COLLAPSE_THRESHOLD, 140);
  assert.equal(SIDEBAR_STORAGE_KEY, "pink-labs.sidebar.v1");
});

test("reserves 420 pixels for content while keeping the sidebar within its limits", () => {
  for (const [viewport, expected] of [
    [1440, 340],
    [760, 340],
    [759.9, 339],
    [700, 280],
    [650.8, 230],
    [620, 200],
    [400, 200],
    [0, 200],
    [-100, 200],
  ]) {
    assert.equal(sidebarMaxWidth(viewport), expected, `viewport ${viewport}`);
  }
});

test("clamps drag widths to the usable viewport and whole pixels", () => {
  for (const [width, viewport, expected] of [
    [100, 1440, 200],
    [200, 1440, 200],
    [275.9, 1440, 275],
    [340, 1440, 340],
    [900, 1440, 340],
    [340, 700, 280],
    [230, 600, 200],
    [-20, 1440, 200],
  ]) {
    assert.equal(clampSidebarWidth(width, viewport), expected);
  }
});

test("only release below 140 collapses; releases above it settle to a usable width", () => {
  for (const width of [-1, 0, 100, 139, 139.99]) {
    assert.equal(settleSidebarWidth(width, 1440), 0, `release at ${width}`);
  }
  assert.equal(settleSidebarWidth(140, 1440), 200);
  assert.equal(settleSidebarWidth(199.9, 1440), 200);
  assert.equal(settleSidebarWidth(270.9, 1440), 270);
  assert.equal(settleSidebarWidth(500, 1440), 340);
  assert.equal(settleSidebarWidth(340, 700), 280);
});

test("invalid measurements never produce NaN, an infinite width, or accidental collapse", () => {
  for (const invalid of [NaN, Infinity, -Infinity, undefined, null, "300"]) {
    assert.equal(sidebarMaxWidth(invalid), 340);
    assert.equal(clampSidebarWidth(invalid, 1440), 230);
    assert.equal(clampSidebarWidth(invalid, 600), 200);
    assert.equal(settleSidebarWidth(invalid, 1440), 230);
  }
  assert.equal(clampSidebarWidth(300, NaN), 300);
});

test("reads a saved width and collapse state without coupling them", () => {
  assert.deepEqual(preference('{"width":275,"collapsed":false}'), {
    width: 275,
    collapsed: false,
  });
  assert.deepEqual(preference('{"width":310,"collapsed":true}'), {
    width: 310,
    collapsed: true,
  });
  assert.deepEqual(preference('{"width":275.9,"collapsed":true}'), {
    width: 275,
    collapsed: true,
  });
});

test("keeps persisted finite widths usable, including the remembered width when collapsed", () => {
  for (const [saved, expected] of [
    [-100, 200],
    [0, 200],
    [139, 200],
    [200, 200],
    [340, 340],
    [900, 340],
  ]) {
    assert.deepEqual(
      preference(JSON.stringify({ width: saved, collapsed: true })),
      { width: expected, collapsed: true },
    );
  }
});

test("missing, malformed, and incorrectly typed preferences reset safely", () => {
  const invalid = [
    null,
    "",
    "{broken",
    "null",
    "true",
    "230",
    '"text"',
    "[]",
    "{}",
    '{"width":280}',
    '{"collapsed":true}',
    '{"width":"280","collapsed":true}',
    '{"width":null,"collapsed":true}',
    '{"width":1e400,"collapsed":true}',
    '{"width":280,"collapsed":"false"}',
    '{"width":280,"collapsed":0}',
  ];
  for (const raw of invalid) {
    assert.deepEqual(preference(raw), { width: 230, collapsed: false }, raw);
  }
});
