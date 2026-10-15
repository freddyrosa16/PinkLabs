import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("the isolated preload forwards PR review and merge through named IPC methods only", async () => {
  const calls = [];
  let bridge;
  const source = await readFile(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    require: (module) => {
      assert.equal(module, "electron");
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
            return args[0] === "pink:pull-request"
              ? { number: 17, state: "open" }
              : { merged: true, sha: "a".repeat(40) };
          },
        },
      };
    },
  });
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.invoke, undefined);
  assert.equal(bridge.ipcRenderer, undefined);
  assert.deepEqual(await bridge.getPullRequest("owner/repo", 17), {
    number: 17,
    state: "open",
  });
  const input = { sha: "b".repeat(40), base: "main", method: "squash" };
  assert.deepEqual(await bridge.mergePullRequest("owner/repo", 17, input), {
    merged: true,
    sha: "a".repeat(40),
  });
  assert.deepEqual(calls, [
    ["pink:pull-request", "owner/repo", 17],
    ["pink:merge-pull-request", "owner/repo", 17, input],
  ]);
});
