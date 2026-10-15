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

function requestAPI(port, pathname, { method = "GET", headers = {} } = {}) {
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
    request.end();
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
