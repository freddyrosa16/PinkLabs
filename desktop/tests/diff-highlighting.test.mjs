import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseUnifiedDiff } from "../src/diff-lines.mjs";
import { common } from "lowlight";
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

test("every mapped extension resolves to an installed common grammar", () => {
  const extensions =
    "js jsx mjs cjs ts tsx mts cts py pyi pyw c h cc cpp cxx hpp hh cs go rs java kt kts rb php swift m mm json jsonc yaml yml toml ini html htm xml svg vue css scss less sh bash zsh sql md markdown graphql gql lua pl pm r mk wat".split(
      " ",
    );
  for (const filename of [
    ...extensions.map((extension) => `file.${extension}`),
    "Makefile",
    "GNUmakefile",
    ".bashrc",
    ".bash_profile",
    ".zshrc",
    ".profile",
  ]) {
    const language = languageForFilename(filename);
    assert.ok(language && Object.hasOwn(common, language), filename);
  }
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

test("template expressions reset string color while keeping nested syntax roles", () => {
  const source = "const label = `Hello ${user.name}, ${count + 1}!`;";
  const parsed = parseUnifiedDiff(`@@ -0,0 +1 @@\n+${source}`);
  const tokens = highlightDiffLines("example.ts", parsed.rows).rows[1];
  assert.ok(role(tokens, "string", "Hello"));
  assert.ok(
    tokens.some(
      (token) => token.className === "" && token.text.includes("${user.name}"),
    ),
  );
  assert.ok(role(tokens, "number", "1"));
  assert.ok(role(tokens, "string", "!`"));
  assert.equal(text(tokens), source);
});

test("real PR6 TSX excerpts highlight JSX tags, attributes, strings, and both versions", () => {
  // Exact hunks from 906c2f6 -- desktop/src/PullRequestDetails.tsx; no surrounding JSX closure.
  const patch = [
    "@@ -324,7 +324,7 @@ export function PullRequestDetails({",
    "         <>",
    '           <div className="pr-detail-title">',
    "             {done ? (",
    '-              <GitMergeIcon size={20} className="green" />',
    '+              <GitMergeIcon size={20} className="pr-merged-icon" />',
    "             ) : (",
    "               <GitPullRequestIcon",
    "                 size={20}",
    "@@ -334,7 +334,7 @@ export function PullRequestDetails({",
    "             <h3>{detail.title}</h3>",
    "           </div>",
    '           <div className="pr-detail-meta">',
    '-            <span className="badge">',
    '+            <span className={`badge${done ? " merged" : ""}`}>',
    "               {done",
    '                 ? "Merged"',
    '                 : detail.state === "closed"',
  ].join("\n");
  const parsed = parseUnifiedDiff(patch);
  const result = highlightDiffLines(
    "desktop/src/PullRequestDetails.tsx",
    parsed.rows,
  );
  for (const [index, line] of parsed.rows.entries()) {
    if (line.text.includes("<GitMergeIcon")) {
      assert.ok(role(result.rows[index], "tag", "GitMergeIcon"));
      assert.ok(role(result.rows[index], "property", "className"));
      assert.ok(role(result.rows[index], "property", "size"));
      assert.ok(role(result.rows[index], "number", "20"));
      assert.ok(
        role(
          result.rows[index],
          "string",
          line.kind === "deletion" ? '"green"' : '"pr-merged-icon"',
        ),
      );
    }
    if (line.text.includes("<span")) {
      assert.ok(role(result.rows[index], "tag", "span"));
      assert.ok(role(result.rows[index], "property", "className"));
      assert.ok(
        role(
          result.rows[index],
          "string",
          line.kind === "deletion" ? '"badge"' : '" merged"',
        ),
      );
    }
  }
  assert.equal(result.partial, false);
  assert.deepEqual(
    result.rows.map(text),
    parsed.rows.map((row) => row.text),
  );
});

test("JSX excerpts leave tag-like comments and quoted strings in their original roles", () => {
  const lines = [
    '/* <Fake className="comment">',
    "still a comment </Fake> */",
    'const quoted = "<Fake value=1 />";',
    "const single = '<Another />';",
    '<Real title="yes" />',
  ];
  const parsed = parseUnifiedDiff(
    `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`,
  );
  for (const filename of ["example.tsx", "example.jsx"]) {
    const result = highlightDiffLines(filename, parsed.rows);
    assert.ok(role(result.rows[1], "comment", "<Fake"));
    assert.ok(role(result.rows[2], "comment", "</Fake>"));
    assert.ok(role(result.rows[3], "string", "<Fake"));
    assert.ok(role(result.rows[4], "string", "<Another"));
    for (const line of result.rows.slice(1, 5))
      assert.ok(!line.some((token) => token.className === "pr-syntax-tag"));
    assert.ok(role(result.rows[5], "tag", "Real"));
    assert.deepEqual(
      result.rows.map(text),
      parsed.rows.map((row) => row.text),
    );
  }
});

test("JSX attributes preserve nested object and callback expression syntax", () => {
  const lines = [
    '<Box value={{nested: {message: "yes"}}}',
    ' onClick={() => { if (ready) { return "go"; } }}',
    ' count={20} title="after" />',
  ];
  const parsed = parseUnifiedDiff(
    `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`,
  );
  const result = highlightDiffLines("example.tsx", parsed.rows);
  assert.ok(role(result.rows[1], "tag", "Box"));
  assert.ok(role(result.rows[1], "property", "message"));
  assert.ok(role(result.rows[1], "string", '"yes"'));
  assert.ok(role(result.rows[2], "keyword", "return"));
  assert.ok(role(result.rows[2], "string", '"go"'));
  assert.ok(role(result.rows[3], "property", "count"));
  assert.ok(role(result.rows[3], "number", "20"));
  assert.ok(role(result.rows[3], "string", '"after"'));
  assert.deepEqual(
    result.rows.map(text),
    parsed.rows.map((row) => row.text),
  );
});

test("TSX generic arrows do not start a tag or consume following code", () => {
  const lines = [
    "const first = <T,>(value: T) => value;",
    "const next = <T extends Item>(value: T) => value;",
    "const result = first<Item>(input);",
    'const message = "after generics";',
  ];
  const parsed = parseUnifiedDiff(
    `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`,
  );
  const result = highlightDiffLines("example.tsx", parsed.rows);
  assert.ok(
    result.rows.every((line) =>
      line.every((token) => token.className !== "pr-syntax-tag"),
    ),
  );
  assert.ok(role(result.rows[2], "keyword", "extends"));
  assert.ok(role(result.rows[4], "string", '"after generics"'));
  assert.deepEqual(
    result.rows.map(text),
    parsed.rows.map((row) => row.text),
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

test("a shortened old line does not disable the new side or unrelated hunks", () => {
  const parsed = parseUnifiedDiff(
    `@@ -1,2 +1,2 @@\n-const before = "${"x".repeat(80)}";\n+const after = 2;\n tail();\n@@ -50 +50 @@\n-old();\n+const later = 3;`,
    { maxLineLength: 32 },
  );
  const result = highlightDiffLines("example.js", parsed.rows);
  assert.equal(result.highlighted, true);
  assert.equal(result.partial, true);
  assert.equal(result.reason, "shortened-line");
  assert.ok(result.rows[1].every((token) => token.className === ""));
  assert.ok(role(result.rows[2], "keyword", "const"));
  assert.ok(role(result.rows[6], "keyword", "const"));
  assert.deepEqual(
    result.rows.map(text),
    parsed.rows.map((row) => row.text),
  );
});

test("oversized hunks leave smaller hunks highlighted within the shared work budget", () => {
  const source = `const payload = "${"x".repeat(450)}";`;
  const block = Array.from({ length: 80 }, () => `+${source}`).join("\n");
  const parsed = parseUnifiedDiff(
    `@@ -0,0 +1,80 @@\n${block}\n@@ -0,0 +200,80 @@\n${block}\n@@ -0,0 +500 @@\n+const final = 3;`,
  );
  const result = highlightDiffLines("large.js", parsed.rows);
  assert.equal(result.highlighted, true);
  assert.equal(result.partial, true);
  assert.equal(result.reason, "too-large");
  assert.ok(role(result.rows[1], "keyword", "const"));
  assert.ok(
    result.rows[82].every((token) => token.className === ""),
    "second large hunk exceeds remaining budget",
  );
  assert.ok(
    role(result.rows[163], "keyword", "const"),
    "a later small hunk still fits",
  );
  assert.deepEqual(
    result.rows.map(text),
    parsed.rows.map((row) => row.text),
  );
});

test("a skipped new stream leaves shared context plain instead of using old syntax", () => {
  const parsed = parseUnifiedDiff(
    `@@ -1,3 +1,3 @@\n-/* old comment\n+const huge = "${"x".repeat(80)}";\n const shared = 1;\n */`,
    { maxLineLength: 32 },
  );
  const result = highlightDiffLines("example.js", parsed.rows);
  assert.ok(role(result.rows[1], "comment", "old comment"));
  assert.ok(result.rows[3].every((token) => token.className === ""));
  assert.equal(result.partial, true);
  assert.deepEqual(
    result.rows.map(text),
    parsed.rows.map((row) => row.text),
  );
});
