import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import {
  assertTrustedSender,
  validateRepositoryName,
} from "../server/validation.mjs";

const repo = "owner/repo";
const number = 17;
const input = { body: "## Review\n\nLiteral `$(example)` stays text." };
const comment = {
  id: "comment:42",
  kind: "comment",
  body: input.body,
  author: { login: "reviewer", avatar: "", url: "" },
  date: "2026-10-15T12:00:00Z",
  updatedAt: "2026-10-15T12:00:00Z",
  url: "https://github.com/owner/repo/pull/17#issuecomment-42",
};
const comments = {
  comments: [comment],
  truncated: false,
  canComment: true,
  commentBlockReason: "",
};

test("isolated preload forwards comment reads and writes through named channels", async () => {
  const calls = [];
  let bridge;
  const source = await readFile(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, "pink");
            bridge = value;
          },
        },
        ipcRenderer: {
          invoke: async (...args) => {
            calls.push(args);
            return args[0] === "pink:pull-request-comments"
              ? comments
              : comment;
          },
        },
      };
    },
  });
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.invoke, undefined);
  assert.equal(bridge.ipcRenderer, undefined);
  assert.deepEqual(await bridge.getPullRequestComments(repo, number), comments);
  assert.deepEqual(
    await bridge.createPullRequestComment(repo, number, input),
    comment,
  );
  assert.deepEqual(calls, [
    ["pink:pull-request-comments", repo, number],
    ["pink:create-pull-request-comment", repo, number, input],
  ]);
});

test("main comment IPC enforces the existing sender boundary before forwarding to services", async () => {
  const source = await readFile(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function installIPC() {");
  const end = source.indexOf("\nfunction createWindow()", start);
  assert.ok(start >= 0 && end > start, "IPC registration entrypoint exists");
  const handlers = new Map();
  const calls = [];
  const frame = { url: "pink://app/" };
  const owner = { mainFrame: frame, isDestroyed: () => false };
  const rejection = Object.assign(new Error("Comments are locked."), {
    status: 403,
  });
  let rejectWrite = false;
  vm.runInNewContext(`${source.slice(start, end)}\ninstallIPC();`, {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    mainWindow: { webContents: owner },
    devOrigin: null,
    assertTrustedSender,
    validateRepositoryName,
    getPullRequestComments: async (...args) => {
      calls.push(["get", ...args]);
      return comments;
    },
    createPullRequestComment: async (...args) => {
      calls.push(["create", ...args]);
      if (rejectWrite) throw rejection;
      return comment;
    },
    cloneRepository: () => {},
    openIDE: () => {},
  });
  const read = handlers.get("pink:pull-request-comments");
  const create = handlers.get("pink:create-pull-request-comment");
  const event = { sender: owner, senderFrame: frame };
  assert.equal(typeof read, "function");
  assert.equal(typeof create, "function");
  for (const handler of [read, create]) {
    for (const invalidEvent of [
      { sender: {}, senderFrame: frame },
      { sender: owner, senderFrame: { url: "pink://app/" } },
      { sender: owner },
    ]) {
      assert.throws(() => handler(invalidEvent, repo, number, input));
    }
    frame.url = "https://evil.test/";
    assert.throws(() => handler(event, repo, number, input));
    frame.url = "pink://app/";
    assert.throws(() => handler(event, "owner/..", number, input));
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await read(event, repo, number), comments);
  assert.deepEqual(await create(event, repo, number, input), comment);
  assert.deepEqual(calls, [
    ["get", repo, number],
    ["create", repo, number, input],
  ]);
  rejectWrite = true;
  await assert.rejects(create(event, repo, number, input), (error) => {
    assert.equal(error, rejection);
    return true;
  });
  assert.equal(calls.length, 3, "failed creation is not retried by IPC");
});

test("renderer comment API forwards native calls and the browser JSON contract without retries", async () => {
  const source = await readFile(
    new URL("../src/api.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  const calls = [];
  const window = {};
  let fail = false;
  vm.runInNewContext(compiled, {
    exports,
    window,
    URLSearchParams,
    fetch: async (pathname, options) => {
      calls.push([pathname, options]);
      return {
        ok: !fail,
        json: async () =>
          fail
            ? { error: "Refresh before retrying this comment." }
            : options
              ? comment
              : comments,
      };
    },
  });
  assert.deepEqual(
    await exports.api.getPullRequestComments(repo, number),
    comments,
  );
  assert.deepEqual(
    await exports.api.createPullRequestComment(repo, number, input),
    comment,
  );
  assert.equal(calls[0][0], "/api/pull-comments?repo=owner%2Frepo&number=17");
  assert.equal(calls[0][1], undefined);
  assert.equal(calls[1][0], "/api/pull-comments");
  assert.equal(calls[1][1].method, "POST");
  assert.equal(calls[1][1].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    repo,
    number,
    body: input.body,
  });
  fail = true;
  await assert.rejects(
    exports.api.createPullRequestComment(repo, number, input),
    /Refresh before retrying/,
  );
  assert.equal(
    calls.length,
    3,
    "browser failures do not automatically repeat writes",
  );
  const nativeCalls = [];
  window.pink = {
    getPullRequestComments: async (...args) => {
      nativeCalls.push(["get", ...args]);
      return comments;
    },
    createPullRequestComment: async (...args) => {
      nativeCalls.push(["create", ...args]);
      return comment;
    },
  };
  assert.deepEqual(
    await exports.api.getPullRequestComments(repo, number),
    comments,
  );
  assert.deepEqual(
    await exports.api.createPullRequestComment(repo, number, input),
    comment,
  );
  assert.deepEqual(nativeCalls, [
    ["get", repo, number],
    ["create", repo, number, input],
  ]);
  assert.equal(
    calls.length,
    3,
    "native bridge does not also issue HTTP requests",
  );
});
