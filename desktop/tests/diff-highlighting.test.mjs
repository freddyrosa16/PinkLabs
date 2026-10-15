import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseUnifiedDiff } from "../src/diff-lines.mjs";
import {
  highlightDiffLines,
  languageForFilename,
  MAX_HIGHLIGHT_CHARACTERS,
} from "../src/diff-highlighting.mjs";

const text = (tokens) => tokens.map((token) => token.text).join("");
const role = (tokens, name, content) =>
  tokens.some(
    (token) =>
      token.className === `pr-syntax-${name}` && token.text.includes(content),
  );

test("language selection uses known filenames without guessing unknown source", () => {
  assert.equal(languageForFilename("src/Component.TSX"), "typescript");
  assert.equal(languageForFilename("agent/main.py"), "python");
  assert.equal(languageForFilename("Cargo.toml"), "ini");
  assert.equal(languageForFilename("src/Makefile"), "makefile");
  assert.equal(languageForFilename("images/asset.unknown"), null);
});

test("common code produces semantic tokens and preserves every source character", () => {
  const parsed = parseUnifiedDiff(
    '@@ -0,0 +1,3 @@\n+export const answer = 42;\n+const message = "Hello";\n+// explain',
  );
  const before = structuredClone(parsed.rows);
  const result = highlightDiffLines("src/example.ts", parsed.rows);
  assert.equal(result.highlighted, true);
  assert.ok(role(result.rows[1], "keyword", "const"));
  assert.ok(role(result.rows[1], "number", "42"));
  assert.ok(role(result.rows[2], "string", '"Hello"'));
  assert.ok(role(result.rows[3], "comment", "// explain"));
  assert.deepEqual(
    result.rows.map(text),
    parsed.rows.map((row) => row.text),
  );
  assert.deepEqual(
    parsed.rows,
    before,
    "highlighting must not change line numbers or diff metadata",
  );
});

test("literal markup remains escaped React text, with no source-derived attributes", () => {
  const source =
    '<img src=x onerror="alert(1)"><script>window.bad = true</script> & ${shell}';
  const parsed = parseUnifiedDiff(`@@ -0,0 +1 @@\n+${source}`);
  const tokens = highlightDiffLines("example.html", parsed.rows).rows[1];
  assert.equal(text(tokens), source);
  const rendered = renderToStaticMarkup(
    createElement(
      "code",
      {},
      tokens.map((token, index) =>
        createElement(
          "span",
          { key: index, className: token.className || undefined },
          token.text,
        ),
      ),
    ),
  );
  assert.ok(!rendered.includes("<img"));
  assert.ok(!rendered.includes("<script"));
  assert.ok(rendered.includes("&lt;"));
  for (const token of tokens) {
    assert.deepEqual(Object.keys(token).sort(), ["className", "text"]);
    assert.match(
      token.className,
      /^(?:pr-syntax-(?:keyword|string|number|comment|function|type|property|tag|meta))?$/,
    );
  }
});

test("multiline syntax keeps old and new hunk streams independent", () => {
  const parsed = parseUnifiedDiff(
    "@@ -1,4 +1,4 @@\n-/* old heading\n-const oldValue = 1;\n-*/\n+const newValue = 2;\n+/* new heading\n+*/\n const tail = 3;",
  );
  const result = highlightDiffLines("example.js", parsed.rows);
  assert.ok(role(result.rows[2], "comment", "const oldValue"));
  assert.ok(!role(result.rows[2], "keyword", "const"));
  assert.ok(role(result.rows[4], "keyword", "const"));
  assert.ok(role(result.rows[5], "comment", "new heading"));
  assert.ok(role(result.rows[7], "keyword", "const"));
  assert.deepEqual(
    result.rows.map(text),
    parsed.rows.map((row) => row.text),
  );
});

test("syntax state resets at separate hunks and preserves empty code lines", () => {
  const parsed = parseUnifiedDiff(
    "@@ -0,0 +1,2 @@\n+/* unfinished in this excerpt\n+\n@@ -50 +50 @@\n-const old = 1;\n+const next = 2;",
  );
  const result = highlightDiffLines("example.js", parsed.rows);
  assert.equal(text(result.rows[2]), "");
  assert.ok(role(result.rows[4], "keyword", "const"));
  assert.ok(role(result.rows[5], "keyword", "const"));
  assert.equal(
    result.rows[3][0].className,
    "",
    "hunk metadata is not source code",
  );
});

test("added and deleted Python files retain the right side's line locations", () => {
  for (const [patch, sourceIndex, oldLine, newLine] of [
    ['@@ -0,0 +1,2 @@\n+def greet():\n+    return "hi"', 1, null, 1],
    ['@@ -1,2 +0,0 @@\n-def greet():\n-    return "hi"', 1, 1, null],
  ]) {
    const parsed = parseUnifiedDiff(patch);
    const result = highlightDiffLines("agent.py", parsed.rows);
    assert.ok(role(result.rows[sourceIndex], "keyword", "def"));
    assert.ok(role(result.rows[sourceIndex], "function", "greet"));
    assert.equal(parsed.rows[sourceIndex].oldLine, oldLine);
    assert.equal(parsed.rows[sourceIndex].newLine, newLine);
  }
});

test("unknown, large, and shortened source falls back without losing text", () => {
  const parsed = parseUnifiedDiff('@@ -0,0 +1 @@\n+const value = "literal";');
  const unknown = highlightDiffLines("file.custom-format", parsed.rows);
  assert.equal(unknown.reason, "unknown-language");
  assert.deepEqual(
    unknown.rows.map(text),
    parsed.rows.map((row) => row.text),
  );
  const big = [
    {
      kind: "addition",
      text: "x".repeat(MAX_HIGHLIGHT_CHARACTERS + 1),
      oldLine: null,
      newLine: 1,
      truncated: false,
    },
  ];
  const large = highlightDiffLines("large.js", big);
  assert.equal(large.reason, "too-large");
  assert.equal(text(large.rows[0]), big[0].text);
  const shortened = parseUnifiedDiff(
    '@@ -0,0 +1 @@\n+const longName = "too long";',
    { maxLineLength: 8 },
  );
  const clipped = highlightDiffLines("short.js", shortened.rows);
  assert.equal(clipped.reason, "shortened-line");
  assert.deepEqual(
    clipped.rows.map(text),
    shortened.rows.map((row) => row.text),
  );
  assert.equal(shortened.rows[1].truncated, true);
});
