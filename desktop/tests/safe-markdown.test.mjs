import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { githubImageUrl, webContentUrl } from "../src/rendering-policy.ts";

// Exercise the production TSX renderer with its actual Markdown/sanitizer
// dependencies. Node strips TS but needs the JSX transform for this one module.
const rendererUrl = new URL("../src/SafeMarkdown.tsx", import.meta.url).href;
const apiUrl = new URL("../src/api.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      [rendererUrl, apiUrl].includes(context.parentURL) &&
      specifier.startsWith("./")
    ) {
      return nextResolve(
        new URL(`${specifier}.ts`, context.parentURL).href,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== rendererUrl) return nextLoad(url, context);
    const source = ts.transpileModule(
      readFileSync(fileURLToPath(url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    return { format: "module", source, shortCircuit: true };
  },
});
const { SafeMarkdown, RepositoryAvatar } = await import(rendererUrl);
const linkBase = "https://github.com/example/project/blob/main/";
const imageBase = "https://raw.githubusercontent.com/example/project/main/";
const render = (body, props = {}) =>
  renderToStaticMarkup(
    React.createElement(SafeMarkdown, { linkBase, imageBase, ...props }, body),
  );
const readme = (body) => render(body, { html: true, images: "repository" });

test("links resolve relative to GitHub and reject executable, credentialed, malformed or control-character URLs", () => {
  assert.equal(
    webContentUrl("docs/start.md", linkBase),
    `${linkBase}docs/start.md`,
  );
  assert.equal(
    webContentUrl("https://example.org/docs"),
    "https://example.org/docs",
  );
  assert.equal(
    webContentUrl("http://example.org/docs"),
    "http://example.org/docs",
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///tmp/private",
    "mailto:a@example.org",
    "https://user:password@example.org",
    "https://[invalid",
    "https://exam\nple.org",
    "",
    undefined,
    null,
    42,
    {},
  ]) {
    assert.equal(webContentUrl(url, linkBase), null, String(url));
  }
});

test("automatic images require exact HTTPS GitHub content hosts and default ports", () => {
  for (const host of [
    "raw.githubusercontent.com",
    "user-images.githubusercontent.com",
    "camo.githubusercontent.com",
    "avatars.githubusercontent.com",
  ]) {
    assert.equal(
      githubImageUrl(`https://${host}/image.png`),
      `https://${host}/image.png`,
    );
  }
  assert.equal(
    githubImageUrl("./docs/image.png", imageBase),
    `${imageBase}docs/image.png`,
  );
  for (const url of [
    "http://raw.githubusercontent.com/image.png",
    "https://raw.githubusercontent.com:8443/image.png",
    "https://raw.githubusercontent.com.evil.example/image.png",
    "https://evil.example/raw.githubusercontent.com/image.png",
    "https://user@raw.githubusercontent.com/image.png",
    "https://127.0.0.1/image.png",
    "http://localhost:5173/api/private",
    "https://[::1]/image.png",
    "https://192.168.1.1/image.png",
    "https://tracker.example/pixel",
    "//tracker.example/pixel",
    "data:image/svg+xml,<svg/>",
    "file:///tmp/image.png",
    "https://github.com/user-attachments/assets/example",
  ])
    assert.equal(githubImageUrl(url, imageBase), null, url);
});

test("README keeps headings, tables, details and relative GitHub images", () => {
  const html = readme(
    "# Readme\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n<details><summary>More</summary><p>Details</p></details>\n\n![Diagram](docs/diagram.png)",
  );
  assert.match(html, /<h1>Readme<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /<details><summary>More<\/summary>/);
  assert.match(
    html,
    /src="https:\/\/raw\.githubusercontent\.com\/example\/project\/main\/docs\/diagram\.png"/,
  );
  assert.match(html, /loading="lazy"/);
  assert.match(html, /referrerPolicy="no-referrer"/);
});

test("README removes executable HTML and the picture/srcset automatic request bypass", () => {
  const html = readme(
    '<script>alert(1)</script><iframe src="http://localhost/private"></iframe><svg onload="alert(1)"></svg><picture><source srcset="http://127.0.0.1/private 1x, https://tracker.example/pixel 2x"><img src="https://raw.githubusercontent.com/example/project/main/logo.png" srcset="https://tracker.example/pixel" onerror="alert(1)" style="background:url(http://localhost/private)"></picture>',
  );
  assert.doesNotMatch(
    html,
    /<(?:script|iframe|svg|source)\b|srcset=|onerror=|onload=|style=/i,
  );
  assert.doesNotMatch(html, /127\.0\.0\.1|localhost|tracker\.example/);
  assert.match(html, /<img /);
});

test("third-party and local images cannot fetch automatically and have accessible explicit actions", () => {
  for (const body of [
    "![Diagram](https://tracker.example/pixel)",
    '<img src="http://127.0.0.1/private" alt="Diagram">',
    '<img src="//tracker.example/pixel" alt="Diagram">',
  ]) {
    const html = readme(body);
    assert.doesNotMatch(html, /<img\b|src=|srcSet=/i);
    assert.match(html, /\[Image: Diagram\]/);
    assert.match(html, /aria-label="Open image in browser: Diagram"/);
    assert.match(html, /type="button"/);
  }
});

test("invalid or stripped image URLs do not turn into requests to the repository root", () => {
  for (const body of [
    "![Bad](javascript:alert)",
    '<img src="data:image/svg+xml,invalid">',
    '<img alt="Missing">',
  ]) {
    const html = readme(body);
    assert.doesNotMatch(html, /<img\b|<button\b/);
  }
});

test("PR and comment mode retains GFM but never loads images or renders raw HTML", () => {
  const html = render(
    '**Review**\n\n- [x] Checked\n\n![Diagram](https://raw.githubusercontent.com/example/project/main/logo.png)\n\n<img src="https://tracker.example/pixel">',
  );
  assert.match(html, /<strong>Review<\/strong>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /\[Image: Diagram\]/);
  assert.doesNotMatch(html, /<img\b|src=|tracker\.example|Open image/);
});

test("blocked image inside a link does not create nested buttons or two navigation actions", () => {
  const html = readme(
    "[![Status](https://tracker.example/badge)](https://github.com/example/project)",
  );
  assert.equal((html.match(/<button\b/g) || []).length, 1);
  assert.match(html, /\[Image: Status\]/);
  assert.doesNotMatch(html, /Open image|<img\b/);
});

test("unsafe Markdown and raw HTML links become non-interactive text", () => {
  for (const body of [
    "[Bad](javascript:alert)",
    '<a href="data:text/html,hello">Bad</a>',
    '<a href="https://user:password@example.org">Bad</a>',
  ]) {
    assert.doesNotMatch(readme(body), /<button\b|href=/);
  }
  assert.match(readme("[Docs](docs/start.md)"), /<button type="button"/);
});

test("avatars only request GitHub's avatar CDN and carry no referrer", () => {
  const avatar = (src) =>
    renderToStaticMarkup(
      React.createElement(RepositoryAvatar, {
        src,
        alt: "Example",
        className: "avatar",
      }),
    );
  assert.match(
    avatar("https://avatars.githubusercontent.com/u/123"),
    /referrerPolicy="no-referrer"/,
  );
  for (const src of [
    "https://tracker.example/pixel",
    "http://avatars.githubusercontent.com/u/123",
    "",
    undefined,
  ]) {
    const html = avatar(src);
    assert.doesNotMatch(html, /<img\b/);
    assert.match(html, /aria-label="Example"/);
  }
});
