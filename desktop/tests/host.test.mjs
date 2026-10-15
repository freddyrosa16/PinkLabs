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

test("local merge API forwards PR numbers and the exact validated merge payload", async (t) => {
  const calls = [];
  const repo = "freddyrosa16/PinkLabs";
  const pull = {
    number: 27,
    title: "Review this change",
    base: "release/next",
    headSha: "a".repeat(40),
    canMerge: true,
  };
  const merged = { merged: true, sha: "b".repeat(40) };
  const port = await serveAPI(t, {
    getPullRequest: async (...args) => {
      calls.push(["get", ...args]);
      return pull;
    },
    mergePullRequest: async (...args) => {
      calls.push(["merge", ...args]);
      return merged;
    },
  });
  const detail = await requestAPI(
    port,
    `/api/pull?repo=${encodeURIComponent(repo)}&number=27`,
  );
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body, pull);
  assert.equal(detail.headers["cache-control"], "no-store");
  const result = await requestAPI(port, "/api/merge", {
    method: "POST",
    headers: {
      origin: `http://127.0.0.1:${port}`,
      "content-type": "application/json; charset=utf-8",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({
      repo,
      number: 27,
      sha: "A".repeat(40),
      base: "release/next",
      method: "squash",
    }),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, merged);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["access-control-allow-origin"], undefined);
  assert.deepEqual(calls, [
    ["get", repo, 27],
    [
      "merge",
      repo,
      27,
      { sha: "a".repeat(40), base: "release/next", method: "squash" },
    ],
  ]);
});

test("local PR detail API rejects invalid numbers and cross-origin reads before the service", async (t) => {
  let calls = 0;
  const port = await serveAPI(t, {
    getPullRequest: async () => {
      calls++;
      return {};
    },
  });
  const pathname = "/api/pull?repo=freddyrosa16%2FPinkLabs";
  for (const number of [
    "",
    "0",
    "-1",
    "01",
    "1.5",
    "1e2",
    "Infinity",
    "9007199254740992",
    "27/merge",
  ]) {
    const response = await requestAPI(
      port,
      `${pathname}&number=${encodeURIComponent(number)}`,
    );
    assert.equal(response.status, 400, `Invalid number ${number}`);
  }
  assert.equal((await requestAPI(port, pathname)).status, 400);
  assert.equal(
    (await requestAPI(port, "/api/pull?repo=owner%2F..&number=27")).status,
    400,
  );
  for (const headers of [
    { origin: "https://evil.test" },
    { "sec-fetch-site": "cross-site" },
    { host: `evil.test:${port}` },
  ]) {
    assert.equal(
      (await requestAPI(port, `${pathname}&number=27`, { headers })).status,
      403,
    );
  }
  assert.equal(
    (await requestAPI(port, `${pathname}&number=27`, { method: "POST" }))
      .status,
    405,
  );
  assert.equal(calls, 0);
});

test("local merge API rejects untrusted, invalid, malformed, and oversized writes before the service", async (t) => {
  let calls = 0;
  const port = await serveAPI(t, {
    mergePullRequest: async () => {
      calls++;
      return { merged: true };
    },
  });
  const valid = {
    repo: "freddyrosa16/PinkLabs",
    number: 27,
    sha: "a".repeat(40),
    base: "main",
    method: "merge",
  };
  const headers = {
    origin: `http://127.0.0.1:${port}`,
    "content-type": "application/json",
  };
  const invalidFields = [
    { repo: "owner/.." },
    { number: undefined },
    { number: 0 },
    { number: -1 },
    { number: 1.5 },
    { number: "27" },
    { number: null },
    { number: Number.MAX_SAFE_INTEGER + 1 },
    { sha: undefined },
    { sha: null },
    { sha: 123 },
    { sha: "a".repeat(7) },
    { sha: "a".repeat(41) },
    { sha: "g".repeat(40) },
    { base: undefined },
    { base: "" },
    { base: "../main" },
    { base: "-main" },
    { base: "owner:main" },
    { method: undefined },
    { method: "admin" },
    { method: "SQUASH" },
    { admin: true },
    { bypass_rules: true },
    { merge_action: "direct_merge" },
  ];
  const cases = [
    {
      label: "missing origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      label: "cross origin",
      headers: { ...headers, origin: "https://evil.test" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      label: "cross-site fetch",
      headers: { ...headers, "sec-fetch-site": "cross-site" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      label: "unsupported content type",
      headers: { ...headers, "content-type": "text/plain" },
      body: JSON.stringify(valid),
      status: 415,
    },
    ...["{broken", "[]", "null", '"text"'].map((body) => ({
      label: `invalid JSON object ${body}`,
      headers,
      body,
      status: 400,
    })),
    ...invalidFields.map((fields) => ({
      label: `invalid fields ${Object.keys(fields).join(",")}: ${JSON.stringify(fields)}`,
      headers,
      body: JSON.stringify({ ...valid, ...fields }),
      status: 400,
    })),
    {
      label: "oversized declared body",
      headers: { ...headers, "content-length": 270_000 },
      body: "x".repeat(270_000),
      status: 413,
    },
    {
      label: "oversized chunked body",
      headers: { ...headers, "transfer-encoding": "chunked" },
      body: "x".repeat(270_000),
      status: 413,
    },
  ];
  for (const { label, status, ...options } of cases) {
    const response = await requestAPI(port, "/api/merge", {
      method: "POST",
      ...options,
    });
    assert.equal(response.status, status, label);
    assert.equal(typeof response.body.error, "string", label);
    assert.equal(calls, 0, `${label} reached the merge service`);
  }
  assert.equal(
    (
      await requestAPI(port, "/api/merge", {
        method: "PUT",
        headers,
        body: JSON.stringify(valid),
      })
    ).status,
    405,
  );
  assert.equal(calls, 0);
});

test("local merge API preserves actionable service errors for blocked, stale, and invalid merges", async (t) => {
  let calls = 0;
  let serviceStatus;
  const port = await serveAPI(t, {
    mergePullRequest: async () => {
      calls++;
      throw Object.assign(new Error(`Merge rejected with ${serviceStatus}.`), {
        status: serviceStatus,
      });
    },
  });
  for (const status of [405, 409, 422]) {
    serviceStatus = status;
    const response = await requestAPI(port, "/api/merge", {
      method: "POST",
      headers: {
        origin: `http://127.0.0.1:${port}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repo: "freddyrosa16/PinkLabs",
        number: 27,
        sha: "a".repeat(40),
        base: "main",
        method: "rebase",
      }),
    });
    assert.equal(response.status, status);
    assert.deepEqual(response.body, {
      error: `Merge rejected with ${status}.`,
    });
  }
  assert.equal(calls, 3);
});

test("local PR workspace API forwards list state, file revision, and exact branch deletion details", async (t) => {
  const calls = [];
  const repo = "freddyrosa16/PinkLabs";
  const sha = "a".repeat(40);
  const pullList = {
    pulls: [{ number: 27, title: "Review workspace", state: "closed" }],
    truncated: false,
  };
  const files = {
    headSha: sha,
    files: [{ filename: "src/workspace.ts", status: "modified" }],
    truncated: true,
  };
  const deleted = { deleted: true, branch: "codex/pr-workspace" };
  const port = await serveAPI(t, {
    listPullRequests: async (...args) => {
      calls.push(["list", ...args]);
      return pullList;
    },
    getPullRequestFiles: async (...args) => {
      calls.push(["files", ...args]);
      return files;
    },
    deletePullRequestBranch: async (...args) => {
      calls.push(["delete", ...args]);
      return deleted;
    },
  });
  for (const state of [undefined, "all", "open", "closed"]) {
    const query = new URLSearchParams({ repo });
    if (state !== undefined) query.set("state", state);
    const response = await requestAPI(port, `/api/pulls?${query}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, pullList);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  const fileResponse = await requestAPI(
    port,
    `/api/pull-files?${new URLSearchParams({ repo, number: "27", sha })}`,
  );
  assert.equal(fileResponse.status, 200);
  assert.deepEqual(fileResponse.body, files);
  const deleteResponse = await requestAPI(port, "/api/delete-pull-branch", {
    method: "POST",
    headers: {
      origin: `http://127.0.0.1:${port}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ repo, number: 27, branch: deleted.branch, sha }),
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(deleteResponse.body, deleted);
  assert.equal(deleteResponse.headers["cache-control"], "no-store");
  assert.equal(
    deleteResponse.headers["access-control-allow-origin"],
    undefined,
  );
  assert.deepEqual(calls, [
    ["list", repo, "all"],
    ["list", repo, "all"],
    ["list", repo, "open"],
    ["list", repo, "closed"],
    ["files", repo, 27, sha],
    ["delete", repo, 27, { branch: deleted.branch, sha }],
  ]);
});

test("local PR workspace reads reject invalid state, revision, number, and cross-origin access before services", async (t) => {
  let calls = 0;
  const unexpectedRead = async () => {
    calls++;
    return {};
  };
  const port = await serveAPI(t, {
    listPullRequests: unexpectedRead,
    getPullRequestFiles: unexpectedRead,
  });
  const repo = "freddyrosa16/PinkLabs";
  const sha = "a".repeat(40);
  const invalidQueries = [
    ["/api/pulls", { repo, state: "merged" }],
    ["/api/pulls", { repo, state: "OPEN" }],
    ["/api/pulls", { state: "all" }],
    ["/api/pulls", { repo: "owner/..", state: "all" }],
    ["/api/pull-files", { repo, number: "27" }],
    ["/api/pull-files", { repo, sha }],
    ["/api/pull-files", { repo: "owner/..", number: "27", sha }],
    ...["", "0", "-1", "1.5", "01", "1e2", "9007199254740992"].map((number) => [
      "/api/pull-files",
      { repo, number, sha },
    ]),
    ...["", "main", "a".repeat(7), "a".repeat(41), "g".repeat(40)].map(
      (revision) => ["/api/pull-files", { repo, number: "27", sha: revision }],
    ),
  ];
  for (const [route, fields] of invalidQueries) {
    const pathname = `${route}?${new URLSearchParams(fields)}`;
    const response = await requestAPI(port, pathname);
    assert.equal(response.status, 400, pathname);
    assert.equal(typeof response.body.error, "string", pathname);
    assert.equal(calls, 0, `${pathname} reached a service`);
  }
  for (const pathname of [
    `/api/pulls?${new URLSearchParams({ repo })}`,
    `/api/pull-files?${new URLSearchParams({ repo, number: "27", sha })}`,
  ]) {
    for (const headers of [
      { origin: "https://evil.test" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      assert.equal(
        (await requestAPI(port, pathname, { headers })).status,
        403,
        pathname,
      );
    }
  }
  assert.equal(calls, 0);
});

test("local PR branch deletion rejects unsafe input and untrusted or oversized writes before the service", async (t) => {
  let calls = 0;
  const port = await serveAPI(t, {
    deletePullRequestBranch: async () => {
      calls++;
      return { deleted: true };
    },
  });
  const valid = {
    repo: "freddyrosa16/PinkLabs",
    number: 27,
    branch: "codex/pr-workspace",
    sha: "a".repeat(40),
  };
  const headers = {
    origin: `http://127.0.0.1:${port}`,
    "content-type": "application/json",
  };
  const invalidFields = [
    { repo: "owner/.." },
    { number: undefined },
    { number: 0 },
    { number: -1 },
    { number: 1.5 },
    { number: "27" },
    { number: null },
    { number: Number.MAX_SAFE_INTEGER + 1 },
    { branch: undefined },
    { branch: "" },
    { branch: null },
    { branch: "../main" },
    { branch: "-main" },
    { branch: "owner:main" },
    { branch: "feature\nmain" },
    { sha: undefined },
    { sha: null },
    { sha: "a".repeat(7) },
    { sha: "a".repeat(41) },
    { sha: "g".repeat(40) },
    { admin: true },
    { force: true },
    { bypass_rules: true },
    { unexpected: "field" },
  ];
  const cases = [
    {
      label: "missing origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      label: "cross origin",
      headers: { ...headers, origin: "https://evil.test" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      label: "cross-site fetch",
      headers: { ...headers, "sec-fetch-site": "cross-site" },
      body: JSON.stringify(valid),
      status: 403,
    },
    {
      label: "unsupported content type",
      headers: { ...headers, "content-type": "text/plain" },
      body: JSON.stringify(valid),
      status: 415,
    },
    ...["{broken", "[]", "null"].map((body) => ({
      label: `invalid JSON object ${body}`,
      headers,
      body,
      status: 400,
    })),
    ...invalidFields.map((fields) => ({
      label: `invalid fields ${Object.keys(fields).join(",")}: ${JSON.stringify(fields)}`,
      headers,
      body: JSON.stringify({ ...valid, ...fields }),
      status: 400,
    })),
    {
      label: "oversized declared body",
      headers: { ...headers, "content-length": 270_000 },
      body: "x".repeat(270_000),
      status: 413,
    },
    {
      label: "oversized chunked body",
      headers: { ...headers, "transfer-encoding": "chunked" },
      body: "x".repeat(270_000),
      status: 413,
    },
  ];
  for (const { label, status, ...options } of cases) {
    const response = await requestAPI(port, "/api/delete-pull-branch", {
      method: "POST",
      ...options,
    });
    assert.equal(response.status, status, label);
    assert.equal(typeof response.body.error, "string", label);
    assert.equal(calls, 0, `${label} reached the branch deletion service`);
  }
  assert.equal(
    (
      await requestAPI(port, "/api/delete-pull-branch", {
        method: "DELETE",
        headers,
        body: JSON.stringify(valid),
      })
    ).status,
    405,
  );
  assert.equal(calls, 0);
});

test("local PR workspace API preserves service conflicts and validation failures", async (t) => {
  let calls = 0;
  let serviceStatus;
  const fail = async () => {
    calls++;
    throw Object.assign(new Error(`Request rejected with ${serviceStatus}.`), {
      status: serviceStatus,
    });
  };
  const port = await serveAPI(t, {
    listPullRequests: fail,
    getPullRequestFiles: fail,
    deletePullRequestBranch: fail,
  });
  const repo = "freddyrosa16/PinkLabs";
  const sha = "a".repeat(40);
  for (const status of [409, 422]) {
    serviceStatus = status;
    const responses = [
      await requestAPI(port, `/api/pulls?${new URLSearchParams({ repo })}`),
      await requestAPI(
        port,
        `/api/pull-files?${new URLSearchParams({ repo, number: "27", sha })}`,
      ),
      await requestAPI(port, "/api/delete-pull-branch", {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${port}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ repo, number: 27, branch: "codex/work", sha }),
      }),
    ];
    for (const response of responses) {
      assert.equal(response.status, status);
      assert.deepEqual(response.body, {
        error: `Request rejected with ${status}.`,
      });
    }
  }
  assert.equal(calls, 6);
});
