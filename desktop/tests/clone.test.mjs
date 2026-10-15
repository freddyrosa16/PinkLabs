import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {
  cloneCommand,
  cloneFailureMessage,
  createCloneHandler,
} from "../server/clone.mjs";

test("clone methods produce distinct argv without a shell or changing authentication settings", () => {
  const destination = "/tmp/My Projects/hello.world";
  const env = {
    PATH: "/usr/bin",
    GH_HOST: "enterprise.example",
    GIT_SSH_COMMAND: "custom-ssh",
    SSH_AUTH_SOCK: "/tmp/agent",
  };
  const https = cloneCommand("owner/hello.world", "https", destination, env);
  const ssh = cloneCommand("owner/hello.world", "ssh", destination, env);
  const cli = cloneCommand("owner/hello.world", "cli", destination, env);
  assert.equal(https.executable, "git");
  assert.deepEqual(https.args, [
    "clone",
    "--",
    "https://github.com/owner/hello.world.git",
    destination,
  ]);
  assert.equal(ssh.executable, "git");
  assert.deepEqual(ssh.args, [
    "clone",
    "--",
    "git@github.com:owner/hello.world.git",
    destination,
  ]);
  assert.equal(cli.executable, "gh");
  assert.deepEqual(cli.args, [
    "repo",
    "clone",
    "owner/hello.world",
    destination,
  ]);
  assert.equal(cli.options.env.GH_HOST, "github.com");
  assert.equal(cli.options.env.GH_PROMPT_DISABLED, "1");
  for (const { options } of [https, ssh, cli]) {
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 300_000);
    assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(options.env.SSH_ASKPASS_REQUIRE, "never");
    assert.equal(options.env.GIT_SSH_COMMAND, env.GIT_SSH_COMMAND);
    assert.equal(options.env.SSH_AUTH_SOCK, env.SSH_AUTH_SOCK);
    assert.equal(options.env.GH_CONFIG_DIR, undefined);
  }
  assert.equal(env.GH_HOST, "enterprise.example");
  assert.equal(env.GIT_TERMINAL_PROMPT, undefined);
});

test("invalid repository and method inputs are rejected before a dialog or process", async () => {
  const unexpected = () => assert.fail("Invalid input reached a side effect");
  const clone = createCloneHandler({
    execute: unexpected,
    selectFolder: unexpected,
    rememberFolder: unexpected,
    withPicker: unexpected,
  });
  for (const repo of [
    "--upload-pack=evil",
    "owner/../repo",
    "owner/repo;touch bad",
    "https://example.com/repo",
    "owner/repo\n",
    null,
    {},
  ])
    await assert.rejects(clone(repo, "ssh"), /repository/i);
  for (const method of [undefined, null, "SSH", "git", "ssh;bad", {}, ["ssh"]])
    await assert.rejects(
      clone("owner/repo", method),
      /HTTPS, SSH, or GitHub CLI/,
    );
  assert.throws(
    () => cloneCommand("owner/repo", "https", "--target"),
    /destination/,
  );
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pink-clone-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return realpath(root);
}

test("canceling the folder picker never starts a clone", async () => {
  let picked = 0;
  const clone = createCloneHandler({
    withPicker: (action) => action(),
    selectFolder: async () => {
      picked++;
      return null;
    },
    execute: () => assert.fail("Canceled clone executed"),
    rememberFolder: () => assert.fail("Canceled clone remembered a folder"),
  });
  for (const method of ["https", "ssh", "cli"])
    assert.deepEqual(await clone("owner/repo", method), { canceled: true });
  assert.equal(picked, 3);
});

test("existing folders, files, and dangling symlinks are never clone destinations", async (t) => {
  const parent = await fixture(t);
  await mkdir(path.join(parent, "folder"));
  await writeFile(path.join(parent, "file"), "keep");
  await symlink(path.join(parent, "missing"), path.join(parent, "link"));
  const clone = createCloneHandler({
    withPicker: (action) => action(),
    selectFolder: async () => parent,
    execute: () => assert.fail("Existing destination was used"),
    rememberFolder: () => assert.fail("Existing destination was remembered"),
  });
  for (const name of ["folder", "file", "link"])
    for (const method of ["https", "ssh", "cli"])
      await assert.rejects(clone(`owner/${name}`, method), /already exists/);
  assert.equal(await readFile(path.join(parent, "file"), "utf8"), "keep");
});

test("the selected method executes once and only a successful clone is remembered", async (t) => {
  const parent = await fixture(t);
  const calls = [];
  const remembered = [];
  let pickerActive = false;
  const clone = createCloneHandler({
    withPicker: async (action) => {
      pickerActive = true;
      try {
        return await action();
      } finally {
        pickerActive = false;
      }
    },
    selectFolder: async () => parent,
    execute: async (...args) => {
      assert.equal(pickerActive, true);
      calls.push(args);
      await mkdir(args[1].at(-1));
    },
    rememberFolder: async (folder) => {
      remembered.push(folder);
      return folder;
    },
  });
  for (const method of ["https", "ssh", "cli"]) {
    const expected = path.join(parent, method);
    assert.deepEqual(await clone(`owner/${method}`, method), {
      canceled: false,
      path: expected,
    });
    assert.equal(pickerActive, false);
  }
  assert.deepEqual(
    calls.map(([executable, args]) => [executable, args]),
    [
      [
        "git",
        [
          "clone",
          "--",
          "https://github.com/owner/https.git",
          path.join(parent, "https"),
        ],
      ],
      [
        "git",
        [
          "clone",
          "--",
          "git@github.com:owner/ssh.git",
          path.join(parent, "ssh"),
        ],
      ],
      ["gh", ["repo", "clone", "owner/cli", path.join(parent, "cli")]],
    ],
  );
  assert.deepEqual(
    remembered,
    ["https", "ssh", "cli"].map((name) => path.join(parent, name)),
  );
});

test("failed clones retain partial folders and return fixed method-aware guidance", async (t) => {
  const parent = await fixture(t);
  let executions = 0;
  const clone = createCloneHandler({
    withPicker: (action) => action(),
    selectFolder: async () => parent,
    execute: async (_executable, args) => {
      executions++;
      await mkdir(args.at(-1));
      await writeFile(path.join(args.at(-1), "partial"), "leave intact");
      throw { stderr: "Permission denied (publickey). sensitive-output" };
    },
    rememberFolder: () => assert.fail("Failed clone was remembered"),
  });
  await assert.rejects(clone("owner/repo", "ssh"), (error) => {
    assert.match(error.message, /SSH authentication failed/);
    assert.match(error.message, /partial folder/);
    assert.doesNotMatch(error.message, /sensitive-output/);
    return true;
  });
  assert.equal(executions, 1);
  assert.equal(
    await readFile(path.join(parent, "repo", "partial"), "utf8"),
    "leave intact",
  );
  assert.match(
    cloneFailureMessage({ code: "ENOENT" }, "cli"),
    /Install gh.*gh auth login/,
  );
  assert.match(cloneFailureMessage({ code: "ENOENT" }, "ssh"), /Install Git/);
  assert.match(cloneFailureMessage({}, "cli"), /gh auth status/);
  assert.match(cloneFailureMessage({}, "https"), /Git credentials/);
  assert.match(
    cloneFailureMessage({ stderr: "Host key verification failed." }, "ssh"),
    /Verify the host in your terminal/,
  );
});

test("the isolated preload forwards clone method through its named IPC method", async () => {
  const calls = [];
  let bridge;
  vm.runInNewContext(
    await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"),
    {
      require: (module) => {
        assert.equal(module, "electron");
        return {
          contextBridge: {
            exposeInMainWorld: (_name, value) => {
              bridge = value;
            },
          },
          ipcRenderer: {
            invoke: async (...args) => {
              calls.push(args);
              return { canceled: true };
            },
          },
        };
      },
    },
  );
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.invoke, undefined);
  for (const method of ["https", "ssh", "cli"])
    assert.deepEqual(await bridge.clone("owner/repo", method), {
      canceled: true,
    });
  assert.deepEqual(
    calls,
    ["https", "ssh", "cli"].map((method) => [
      "pink:clone",
      "owner/repo",
      method,
    ]),
  );
});
