import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import { createApiMiddleware } from "../server/vite-api.mjs";
import {
  assertTrustedSender,
  containedPath,
  desktopPath,
  isTrustedRendererURL,
  resolveAppAsset,
  validateClipboardText,
  validateDevURL,
  validateExternalURL,
  validateRepositoryName,
} from "../server/validation.mjs";

test("clipboard writes accept text and enforce a 10,000 character limit", () => {
  assert.equal(
    validateClipboardText("https://github.com/freddyrosa16/PinkLabs.git"),
    "https://github.com/freddyrosa16/PinkLabs.git",
  );
  assert.equal(validateClipboardText(""), "");
  assert.equal(validateClipboardText("x".repeat(10_000)).length, 10_000);
  for (const value of [null, undefined, {}, ["text"], 42, "x".repeat(10_001)]) {
    assert.throws(() => validateClipboardText(value));
  }
});

test("Finder launches can resolve Homebrew tools without dropping existing PATH entries", () => {
  assert.equal(
    desktopPath("/usr/bin:/bin", "darwin"),
    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  );
  assert.equal(
    desktopPath(
      "/custom/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin",
      "darwin",
    ),
    "/custom/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin",
  );
  assert.equal(
    desktopPath(undefined, "darwin"),
    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  );
  assert.equal(
    desktopPath("/custom/bin:/usr/bin", "linux"),
    "/custom/bin:/usr/bin",
  );
});

test("repository input cannot become a shell argument, URL, or filesystem path", () => {
  assert.equal(
    validateRepositoryName("freddyrosa16/PinkLabs"),
    "freddyrosa16/PinkLabs",
  );
  assert.equal(
    validateRepositoryName("my-org/repo.name-1"),
    "my-org/repo.name-1",
  );
  for (const value of [
    undefined,
    "",
    "https://github.com/owner/repo",
    "../repo",
    "owner/..",
    "owner/.",
    "owner/repo/../../target",
    "-C /tmp/repo",
    "owner/repo;whoami",
    "owner/repo\n",
  ]) {
    assert.throws(() => validateRepositoryName(value));
  }
});

test("external links allow web pages but reject executable and credential URLs", () => {
  assert.equal(
    validateExternalURL("https://github.com/freddyrosa16/PinkLabs"),
    "https://github.com/freddyrosa16/PinkLabs",
  );
  assert.equal(
    validateExternalURL("http://localhost:3000"),
    "http://localhost:3000/",
  );
  for (const value of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "vscode://file/tmp",
    "https://user:password@github.com",
    "https://github.com\n",
    "",
    null,
  ]) {
    assert.throws(() => validateExternalURL(value));
  }
});

test("development content must be loaded from one configured loopback origin", () => {
  assert.equal(
    validateDevURL("http://127.0.0.1:5173/"),
    "http://127.0.0.1:5173",
  );
  assert.equal(
    validateDevURL("http://localhost:5173"),
    "http://localhost:5173",
  );
  for (const value of [
    "https://example.com",
    "http://localhost.evil.test:5173",
    "http://user@localhost:5173",
    "http://127.0.0.1:5173/remote",
    "http://127.0.0.1:5173/?url=other",
  ]) {
    assert.throws(() => validateDevURL(value));
  }
  assert.equal(
    isTrustedRendererURL("http://127.0.0.1:5173/", "http://127.0.0.1:5173"),
    true,
  );
  assert.equal(
    isTrustedRendererURL("http://127.0.0.1:5174/", "http://127.0.0.1:5173"),
    false,
  );
});

test("IPC rejects other windows, child frames, and navigated app frames", () => {
  const frame = { url: "pink://app/" };
  const owner = { mainFrame: frame, isDestroyed: () => false };
  assert.doesNotThrow(() =>
    assertTrustedSender({ sender: owner, senderFrame: frame }, owner),
  );
  assert.throws(() =>
    assertTrustedSender({ sender: {}, senderFrame: frame }, owner),
  );
  assert.throws(() =>
    assertTrustedSender(
      { sender: owner, senderFrame: { url: "pink://app/" } },
      owner,
    ),
  );
  frame.url = "https://github.com/";
  assert.throws(() =>
    assertTrustedSender({ sender: owner, senderFrame: frame }, owner),
  );
  frame.url = "pink://app.evil/";
  assert.throws(() =>
    assertTrustedSender({ sender: owner, senderFrame: frame }, owner),
  );
  frame.url = "pink://user@app/";
  assert.throws(() =>
    assertTrustedSender({ sender: owner, senderFrame: frame }, owner),
  );
});

test("custom protocol resolves only assets under the built client directory", () => {
  const root = path.resolve("/tmp/pink-labs/client");
  assert.equal(
    resolveAppAsset("pink://app/", root),
    path.join(root, "index.html"),
  );
  assert.equal(
    resolveAppAsset("pink://app/assets/main.js?v=1", root),
    path.join(root, "assets/main.js"),
  );
  for (const value of [
    "pink://evil/index.html",
    "pink://app/%2e%2e%2fsecret",
    "pink://app/assets/%2e%2e%5csecret",
    "pink://app/%00.env",
    "file:///tmp/private",
  ]) {
    assert.throws(() => resolveAppAsset(value, root));
  }
  assert.equal(containedPath(root, path.join(root, "assets/main.js")), true);
  assert.equal(containedPath(root, `${root}-other/secret`), false);
  assert.equal(containedPath(root, path.join(root, "../secret")), false);
});

function requestAPI(
  port,
  pathname,
  { method = "GET", headers = {}, body } = {},
) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: "127.0.0.1", port, path: pathname, method, headers },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: JSON.parse(body),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

test("local HTTP API returns repository data and blocks cross-origin reads and writes", async (t) => {
  const seen = [];
  const middleware = createApiMiddleware({
    getRepository: async (repo) => {
      seen.push(repo);
      return { fullName: repo, commits: [] };
    },
    listRepositories: async () => [{ fullName: "freddyrosa16/PinkLabs" }],
  });
  const server = http.createServer((request, response) =>
    middleware(request, response, () => {
      response.writeHead(404);
      response.end("{}");
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const normal = await requestAPI(
    port,
    "/api/repository?repo=freddyrosa16%2FPinkLabs",
  );
  assert.equal(normal.status, 200);
  assert.equal(normal.body.fullName, "freddyrosa16/PinkLabs");
  assert.equal(normal.headers["cache-control"], "no-store");
  assert.equal(normal.headers["access-control-allow-origin"], undefined);
  assert.equal((await requestAPI(port, "/api/repositories")).body.length, 1);
  assert.equal(
    (
      await requestAPI(port, "/api/repositories", {
        headers: {
          origin: `http://127.0.0.1:${port}`,
          "sec-fetch-site": "same-origin",
        },
      })
    ).status,
    200,
  );

  assert.equal(
    (await requestAPI(port, "/api/repositories", { method: "POST" })).status,
    405,
  );
  assert.equal(
    (
      await requestAPI(port, "/api/repositories", {
        headers: { origin: "https://evil.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await requestAPI(port, "/api/repositories", {
        headers: { host: `evil.test:${port}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await requestAPI(port, "/api/repositories", {
        headers: { "sec-fetch-site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await requestAPI(port, "/api/repository?repo=owner%2F..")).status,
    400,
  );
  assert.equal((await requestAPI(port, "/api/clone")).status, 404);
  assert.deepEqual(seen, ["freddyrosa16/PinkLabs"]);
});

async function serveAPI(t, services) {
  const middleware = createApiMiddleware(services);
  const server = http.createServer((request, response) =>
    middleware(request, response, () => {
      response.writeHead(404);
      response.end("{}");
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test("local PR API forwards branch comparisons and one validated JSON creation", async (t) => {
  const calls = [];
  const pull = { number: 2, title: "Add PR flow", draft: true };
  const comparison = {
    aheadBy: 2,
    behindBy: 0,
    commitCount: 2,
    existingPull: null,
  };
  const port = await serveAPI(t, {
    listBranches: async (repo) => {
      calls.push(["branches", repo]);
      return ["main", "codex/pr-flow"];
    },
    compareBranches: async (repo, input) => {
      calls.push(["compare", repo, input]);
      return comparison;
    },
    createPullRequest: async (repo, input) => {
      calls.push(["create", repo, input]);
      return pull;
    },
  });
  const repo = "freddyrosa16/PinkLabs";
  assert.deepEqual(
    (await requestAPI(port, `/api/branches?repo=${encodeURIComponent(repo)}`))
      .body,
    ["main", "codex/pr-flow"],
  );
  assert.deepEqual(
    (
      await requestAPI(
        port,
        `/api/compare?repo=${encodeURIComponent(repo)}&base=main&head=codex%2Fpr-flow`,
      )
    ).body,
    comparison,
  );
  const input = {
    base: "main",
    head: "codex/pr-flow",
    title: " Add PR flow ",
    body: "## Changes\n\nLiteral `$(example)` stays text.",
    draft: true,
  };
  const created = await requestAPI(port, "/api/pulls", {
    method: "POST",
    headers: {
      origin: `http://127.0.0.1:${port}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ repo, ...input }),
  });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body, pull);
  assert.equal(created.headers["cache-control"], "no-store");
  assert.equal(created.headers["access-control-allow-origin"], undefined);
  assert.deepEqual(calls, [
    ["branches", repo],
    ["compare", repo, { base: "main", head: "codex/pr-flow" }],
    ["create", repo, { ...input, title: "Add PR flow" }],
  ]);
});

test("local PR API rejects cross-origin, malformed, unsupported, and oversized writes before service calls", async (t) => {
  let calls = 0;
  const port = await serveAPI(t, {
    createPullRequest: async () => {
      calls++;
      return {};
    },
  });
  const valid = {
    repo: "freddyrosa16/PinkLabs",
    base: "main",
    head: "codex/pr-flow",
    title: "Add PR flow",
    body: "",
    draft: false,
  };
  const headers = {
    origin: `http://127.0.0.1:${port}`,
    "content-type": "application/json",
  };
  const cases = [
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      headers: { ...headers, origin: "https://evil.test" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      headers: { ...headers, "sec-fetch-site": "cross-site" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      headers: { ...headers, "content-type": "text/plain" },
      body: JSON.stringify(valid),
      status: 415,
    },
    { headers, body: "{broken", status: 400 },
    { headers, body: "[]", status: 400 },
    {
      headers,
      body: JSON.stringify({ ...valid, repo: "owner/.." }),
      status: 400,
    },
    {
      headers,
      body: JSON.stringify({ ...valid, head: "owner:fork" }),
      status: 400,
    },
    {
      headers,
      body: JSON.stringify({ ...valid, draft: "false" }),
      status: 400,
    },
    {
      headers,
      body: JSON.stringify({ ...valid, unexpected: "field" }),
      status: 400,
    },
    {
      headers,
      body: JSON.stringify({ ...valid, body: "x".repeat(60_001) }),
      status: 400,
    },
    {
      headers: { ...headers, "content-length": 270_000 },
      body: "x".repeat(270_000),
      status: 413,
    },
    {
      headers: { ...headers, "transfer-encoding": "chunked" },
      body: "x".repeat(270_000),
      status: 413,
    },
  ];
  for (const { status, ...options } of cases) {
    const response = await requestAPI(port, "/api/pulls", {
      method: "POST",
      ...options,
    });
    assert.equal(response.status, status, response.body.error);
    assert.equal(typeof response.body.error, "string");
  }
  assert.equal(
    (
      await requestAPI(port, "/api/pulls", {
        method: "PUT",
        headers,
        body: JSON.stringify(valid),
      })
    ).status,
    405,
  );
  assert.equal(calls, 0);
});

test("local PR API forwards useful service failures without reporting success", async (t) => {
  let calls = 0;
  const port = await serveAPI(t, {
    createPullRequest: async () => {
      calls++;
      throw Object.assign(new Error("The head branch has no new commits."), {
        status: 422,
      });
    },
  });
  const response = await requestAPI(port, "/api/pulls", {
    method: "POST",
    headers: {
      origin: `http://127.0.0.1:${port}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      repo: "freddyrosa16/PinkLabs",
      base: "main",
      head: "codex/pr-flow",
      title: "Add PR flow",
      body: "",
      draft: false,
    }),
  });
  assert.equal(response.status, 422);
  assert.deepEqual(response.body, {
    error: "The head branch has no new commits.",
  });
  assert.equal(calls, 1);
});
