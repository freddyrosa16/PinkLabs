import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/composer-menu-position.ts", import.meta.url),
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
const { positionComposerMenu } = exports;

function rect(left, top, width, height) {
  return { left, top, width, right: left + width, bottom: top + height };
}

function fixture(overrides = {}) {
  return {
    trigger: rect(300, 365, 120, 34),
    composer: rect(280, 280, 600, 130),
    viewport: { left: 0, top: 0, width: 1280, height: 900 },
    layoutHeight: 900,
    menuHeight: 140,
    align: "left",
    ...overrides,
  };
}

function assertClearAndVisible(input) {
  const position = positionComposerMenu(input);
  assert.equal(
    Number(position.top !== undefined) + Number(position.bottom !== undefined),
    1,
    "exactly one vertical anchor avoids stretching a menu between both edges",
  );
  for (const value of Object.values(position))
    assert.ok(Number.isFinite(value));
  assert.ok(position.width > 0);
  assert.ok(position.maxHeight > 0);
  // Reconstruct the painted rectangle from CSS fixed positioning. This checks
  // the output contract without duplicating the helper's placement decision.
  const height = Math.min(input.menuHeight, position.maxHeight);
  const top = position.top ?? input.layoutHeight - position.bottom - height;
  const bottom = top + height;
  assert.ok(
    position.left >= input.viewport.left,
    "menu stays inside the visible left edge",
  );
  assert.ok(
    position.left + position.width <=
      input.viewport.left + input.viewport.width,
    "menu stays inside the visible right edge",
  );
  assert.ok(
    top >= input.viewport.top,
    "menu stays inside the visible top edge",
  );
  assert.ok(
    bottom <= input.viewport.top + input.viewport.height,
    "menu stays inside the visible bottom edge",
  );
  assert.ok(
    bottom < input.composer.top || top > input.composer.bottom,
    "the entire menu clears the message box, including its draft and toolbar",
  );
  return { position, top, bottom, height };
}

test("a centered composer opens a fitting menu below the entire message box", () => {
  const input = fixture();
  const result = assertClearAndVisible(input);
  assert.ok(result.top > input.composer.bottom);
  assert.equal(
    result.height,
    input.menuHeight,
    "all options fit without unnecessary clipping",
  );
});

test("a bottom-docked composer opens above the entire message box", () => {
  const input = fixture({
    trigger: rect(780, 550, 130, 34),
    composer: rect(280, 450, 650, 140),
    viewport: { left: 0, top: 0, width: 1280, height: 620 },
    layoutHeight: 620,
    menuHeight: 150,
    align: "right",
  });
  const result = assertClearAndVisible(input);
  assert.ok(result.bottom < input.composer.top);
  assert.equal(result.height, input.menuHeight);
});

test("an oversized project menu scrolls on the larger side when neither side fits", () => {
  for (const [top, expectedSide] of [
    [100, "below"],
    [290, "above"],
  ]) {
    const input = fixture({
      trigger: rect(330, top + 165, 130, 34),
      composer: rect(300, top, 600, 210),
      viewport: { left: 0, top: 0, width: 1280, height: 600 },
      layoutHeight: 600,
      menuHeight: 1200,
    });
    const result = assertClearAndVisible(input);
    assert.ok(
      result.height < input.menuHeight,
      "long lists are constrained to a scrollable viewport",
    );
    assert.ok(
      result.height > 200,
      "use the roomy side rather than the small remaining strip",
    );
    assert.ok(
      expectedSide === "below"
        ? result.top > input.composer.bottom
        : result.bottom < input.composer.top,
    );
  }
});

test("a narrow viewport clamps either alignment without obscuring the composer", () => {
  for (const align of ["left", "right"]) {
    const input = fixture({
      trigger: rect(178, 240, 34, 34),
      composer: rect(8, 150, 204, 136),
      viewport: { left: 0, top: 0, width: 220, height: 640 },
      layoutHeight: 640,
      menuHeight: 200,
      align,
    });
    const result = assertClearAndVisible(input);
    assert.ok(
      result.position.width < 240,
      "the usual minimum menu width yields to a narrow screen",
    );
    assert.ok(result.position.left > 0);
    assert.ok(
      result.position.left + result.position.width < input.viewport.width,
    );
  }
});

test("an offset visual viewport constrains an above menu in layout coordinates", () => {
  const input = fixture({
    trigger: rect(420, 395, 80, 34),
    composer: rect(130, 300, 360, 140),
    viewport: { left: 110, top: 140, width: 400, height: 440 },
    layoutHeight: 900,
    menuHeight: 170,
    align: "right",
  });
  const result = assertClearAndVisible(input);
  assert.ok(result.bottom < input.composer.top);
  assert.ok(result.position.left > input.viewport.left);
});

test("an offset visual viewport also places a fitting below menu within its visible bounds", () => {
  const input = fixture({
    trigger: rect(140, 290, 100, 30),
    composer: rect(130, 230, 360, 110),
    viewport: { left: 110, top: 200, width: 400, height: 500 },
    layoutHeight: 900,
    menuHeight: 140,
  });
  const result = assertClearAndVisible(input);
  assert.ok(result.top > input.composer.bottom);
  assert.equal(result.height, input.menuHeight);
});
