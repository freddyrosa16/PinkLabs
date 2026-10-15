import test from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff } from "../src/diff-lines.mjs";

const locations = (patch) =>
  parseUnifiedDiff(patch).rows.map(({ kind, oldLine, newLine, text }) => ({
    kind,
    oldLine,
    newLine,
    text,
  }));

test("unified hunks track old and new offsets independently and reset at later hunks", () => {
  assert.deepEqual(
    locations(
      "@@ -10,3 +20,4 @@ function\n same\n-old\n+new\n+extra\n tail\n@@ -100 +200 @@\n-before\n+after",
    ),
    [
      {
        kind: "hunk",
        oldLine: null,
        newLine: null,
        text: "@@ -10,3 +20,4 @@ function",
      },
      { kind: "context", oldLine: 10, newLine: 20, text: "same" },
      { kind: "deletion", oldLine: 11, newLine: null, text: "old" },
      { kind: "addition", oldLine: null, newLine: 21, text: "new" },
      { kind: "addition", oldLine: null, newLine: 22, text: "extra" },
      { kind: "context", oldLine: 12, newLine: 23, text: "tail" },
      { kind: "hunk", oldLine: null, newLine: null, text: "@@ -100 +200 @@" },
      { kind: "deletion", oldLine: 100, newLine: null, text: "before" },
      { kind: "addition", oldLine: null, newLine: 200, text: "after" },
    ],
  );
});

test("added and deleted files handle zero-length hunk sides", () => {
  const added = parseUnifiedDiff("@@ -0,0 +1,2 @@\n+first\n+second\n").rows;
  assert.deepEqual(
    added.slice(1).map((line) => [line.oldLine, line.newLine]),
    [
      [null, 1],
      [null, 2],
    ],
  );
  const deleted = parseUnifiedDiff("@@ -1,2 +0,0 @@\n-first\n-second").rows;
  assert.deepEqual(
    deleted.slice(1).map((line) => [line.oldLine, line.newLine]),
    [
      [1, null],
      [2, null],
    ],
  );
});

test("file headers and no-newline markers are metadata without advancing line numbers", () => {
  const rows = parseUnifiedDiff(
    "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file",
  ).rows;
  assert.deepEqual(
    rows.map((line) => line.kind),
    ["meta", "meta", "hunk", "deletion", "meta", "addition", "meta"],
  );
  assert.equal(rows[5].newLine, 1);
  assert.equal(rows[4].text, "\\ No newline at end of file");
});

test("literal markup, shell text, whitespace, and diff-like source remain unchanged", () => {
  const literal = '<script>$(echo "hello")</script> & \\n\t';
  const rows = parseUnifiedDiff(
    `@@ -1,2 +1,2 @@\n---literal\n+++literal\n ${literal}\n`,
  ).rows;
  assert.equal(rows[1].text, "--literal");
  assert.equal(rows[2].text, "++literal");
  assert.equal(rows[3].text, literal);
  assert.equal(rows[3].oldLine, 2);
  assert.equal(rows[3].newLine, 2);
});

test("row bounds signal omitted content, while an exact-length patch is complete", () => {
  const patch = "@@ -0,0 +1,3 @@\n+a\n+b\n+c\n";
  const limited = parseUnifiedDiff(patch, { maxRows: 3 });
  assert.equal(limited.rows.length, 3);
  assert.equal(limited.hasMoreLines, true);
  assert.equal(limited.rows[2].newLine, 2);
  assert.equal(parseUnifiedDiff(patch, { maxRows: 4 }).hasMoreLines, false);
});

test("long lines are bounded and flagged without losing following line offsets", () => {
  const result = parseUnifiedDiff(
    `@@ -0,0 +1,2 @@\n+${"x".repeat(100_000)}\n+tail`,
    { maxLineLength: 20 },
  );
  assert.equal(result.rows[1].text, "x".repeat(20));
  assert.equal(result.rows[1].truncated, true);
  assert.equal(result.shortenedLines, 1);
  assert.equal(result.rows[2].newLine, 2);
  assert.equal(result.rows[2].text, "tail");
});

test("CRLF patches and empty context lines preserve meaningful content", () => {
  const rows = parseUnifiedDiff("@@ -2,2 +2,2 @@\r\n \r\n same\r\n").rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[1].text, "");
  assert.equal(rows[1].oldLine, 2);
  assert.equal(rows[2].text, "same");
  assert.equal(rows[2].newLine, 3);
  assert.deepEqual(parseUnifiedDiff(""), {
    rows: [],
    hasMoreLines: false,
    shortenedLines: 0,
  });
});

test("malformed hunk ranges do not manufacture misleading line numbers", () => {
  const rows = parseUnifiedDiff("@@ -999999999999999999999 +1 @@\n+text").rows;
  assert.equal(rows[0].kind, "meta");
  assert.equal(rows[1].kind, "meta");
  assert.equal(rows[1].newLine, null);
  assert.throws(() => parseUnifiedDiff("text", { maxRows: 0 }), RangeError);
});
