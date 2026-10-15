import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

// Normal JSX grouping expects surrounding value expressions and closing elements, which
// diff hunks often omit. Recognize individual tags while keeping JS/TS parsing in braces.
function jsxExcerptGrammar(base) {
  return (api) => {
    const language = common[base](api);
    const expression = {
      scope: "subst",
      begin: /\{/,
      end: /\}/,
      keywords: language.keywords,
      contains: [],
    };
    const fragment = { scope: "tag", match: /<\/?>/ };
    const constraint = /\s+(?:extends|in)\b/y;
    const tag = {
      scope: "tag",
      begin: /<\/?[A-Za-z][A-Za-z0-9._:-]*(?=[\s/>]|$)/,
      end: /\/?>/,
      contains: [
        { scope: "attr", match: /[A-Za-z_:][A-Za-z0-9_.:-]*/ },
        api.APOS_STRING_MODE,
        api.QUOTE_STRING_MODE,
        expression,
      ],
      "on:begin": (match, response) => {
        if (match[0].startsWith("</")) return;
        const afterName = match.index + match[0].length;
        constraint.lastIndex = afterName;
        // Avoid generic arrows (<T,>, <T extends Item>) and calls such as fn<Item>.
        // The comma case does not match begin; these guards avoid consuming their rest as a tag.
        if (
          constraint.test(match.input) ||
          (match.input[afterName] === ">" &&
            /[\w$.\]]/.test(match.input[match.index - 1] ?? ""))
        )
          response.ignoreMatch();
      },
    };
    for (const container of language.contains) {
      const index = container.contains?.findIndex(
        (mode) => mode.subLanguage === "xml" && mode.variants,
      );
      if (index >= 0) container.contains.splice(index, 1, fragment, tag);
    }
    language.contains.unshift(fragment, tag);
    expression.contains = ["self", ...language.contains];
    return { ...language, name: `${base} JSX excerpt`, aliases: [] };
  };
}
lowlight.register("javascript-diff-jsx", jsxExcerptGrammar("javascript"));
lowlight.register("typescript-diff-jsx", jsxExcerptGrammar("typescript"));

export const MAX_HIGHLIGHT_CHARACTERS = 60_000;
const MAX_HIGHLIGHT_TOKENS = 20_000;
const languages = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  pyi: "python",
  pyw: "python",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  php: "php",
  swift: "swift",
  m: "objectivec",
  mm: "objectivec",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  mk: "makefile",
  wat: "wasm",
};

export function languageForFilename(filename) {
  const name = filename.split("/").at(-1)?.toLowerCase() ?? "";
  if (["makefile", "gnumakefile"].includes(name)) return "makefile";
  if ([".bashrc", ".bash_profile", ".zshrc", ".profile"].includes(name))
    return "bash";
  return languages[name.split(".").at(-1)] ?? null;
}

function tokenRole(classes, inherited) {
  const has = (name) => classes.includes(`hljs-${name}`);
  // Template expressions contain code; only their surrounding literal inherits string color.
  if (has("subst")) return null;
  if (has("comment") || has("quote")) return "comment";
  if (has("keyword") || has("doctag") || has("selector-tag")) return "keyword";
  if (has("string") || has("regexp")) return "string";
  if (has("number") || has("literal") || has("symbol") || has("bullet"))
    return "number";
  if (has("type") || (has("title") && classes.includes("class_")))
    return "type";
  if (has("title") || has("function")) return "function";
  if (
    has("attr") ||
    has("attribute") ||
    has("property") ||
    has("variable") ||
    has("built_in")
  )
    return "property";
  if (has("tag") || has("name") || has("selector-id") || has("selector-class"))
    return "tag";
  if (has("meta") || has("section")) return "meta";
  return inherited;
}

// Keep only literal text and a fixed set of style roles; never serialize HTML or copy AST attributes.
function highlightLines(source, language) {
  const lines = [[]];
  let tokens = 0;
  function visit(node, inherited = null) {
    if (node.type === "text") {
      const pieces = node.value.split("\n");
      pieces.forEach((text, index) => {
        if (index) lines.push([]);
        if (!text) return;
        const row = lines.at(-1);
        const className = inherited ? `pr-syntax-${inherited}` : "";
        if (row.at(-1)?.className === className) row.at(-1).text += text;
        else {
          if (++tokens > MAX_HIGHLIGHT_TOKENS)
            throw new Error("Too many syntax tokens");
          row.push({ text, className });
        }
      });
    } else if (
      node.type === "root" ||
      (node.type === "element" && node.tagName === "span")
    ) {
      const role = tokenRole(node.properties?.className ?? [], inherited);
      for (const child of node.children) visit(child, role);
    }
  }
  visit(lowlight.highlight(language, source));
  return lines;
}

export function highlightDiffLines(filename, rows) {
  const language = languageForFilename(filename);
  const plain = () => rows.map((row) => [{ text: row.text, className: "" }]);
  const fallback = (reason) => ({
    language,
    rows: plain(),
    highlighted: false,
    partial: false,
    reason,
  });
  if (!language) return fallback("unknown-language");
  if (rows.length > 1_200) return fallback("too-large");
  const grammar = /\.[jt]sx$/i.test(filename)
    ? `${language}-diff-jsx`
    : language;
  const result = plain();
  let remaining = MAX_HIGHLIGHT_CHARACTERS;
  let reason = null;
  let group = [];
  function flushHunk() {
    // Prefer the new stream for shared context. Old context is only needed to parse deletions.
    for (const side of ["new", "old"]) {
      if (
        side === "old" &&
        !group.some((index) => rows[index].kind === "deletion")
      )
        continue;
      const indexes = group.filter(
        (index) =>
          rows[index].kind === "context" ||
          rows[index].kind === (side === "old" ? "deletion" : "addition"),
      );
      if (!indexes.length) continue;
      // A missing line tail can change all following syntax in this stream, not other hunks/sides.
      if (indexes.some((index) => rows[index].truncated)) {
        reason ??= "shortened-line";
        continue;
      }
      const size = indexes.reduce(
        (total, index) => total + rows[index].text.length + 1,
        0,
      );
      if (size > remaining) {
        reason ??= "too-large";
        continue;
      }
      // Charge both versions against one budget, including work that later fails validation.
      remaining -= size;
      try {
        const source = indexes.map((index) => rows[index].text).join("\n");
        const highlighted = highlightLines(source, grammar);
        if (
          highlighted.length !== indexes.length ||
          indexes.some(
            (index, position) =>
              highlighted[position].map((token) => token.text).join("") !==
              rows[index].text,
          )
        )
          throw new Error("Syntax text changed");
        indexes.forEach((index, position) => {
          // Never substitute old-side colors for shared context when the new side was skipped.
          if (side === "new" || rows[index].kind === "deletion")
            result[index] = highlighted[position];
        });
      } catch {
        reason ??= "unavailable";
      }
    }
    group = [];
  }
  rows.forEach((row, index) => {
    if (row.kind === "hunk") flushHunk();
    else if (["context", "addition", "deletion"].includes(row.kind))
      group.push(index);
    // No-newline metadata is not source and must not break an otherwise contiguous hunk.
  });
  flushHunk();
  const highlighted = result.some((line) =>
    line.some((token) => token.className),
  );
  return {
    language,
    rows: result,
    highlighted,
    partial: highlighted && reason !== null,
    reason,
  };
}
