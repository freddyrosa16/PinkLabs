import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as renderingPolicy from "../src/rendering-policy.ts";
import { createApiMiddleware } from "../server/vite-api.mjs";
import { assertTrustedSender } from "../server/validation.mjs";

const identity = { owner: "owner", name: "new-repo" };
const input = {
  ...identity,
  description: "Literal $(example), `code`, and Markdown stay text.",
  visibility: "private",
  initializeReadme: true,
  gitignoreTemplate: "Python",
  licenseTemplate: "mit",
};
const repository = {
  fullName: "owner/new-repo",
  name: identity.name,
  description: input.description,
  private: true,
};
const options = {
  account: "owner",
  owners: [{ login: "owner", type: "user" }],
  gitignoreTemplates: ["Python"],
  licenses: [{ key: "mit", name: "MIT License" }],
  warnings: [],
};
const created = { status: "created", repository };
const uncertain = {
  status: "uncertain",
  message: "Check GitHub before retrying.",
};
const rejected = {
  status: "rejected",
  message: "Choose a different owner or name.",
};

test("repository creation preload exposes named methods and preserves uncertain and rejected outcomes", async () => {
  let bridge;
  let creationResult = uncertain;
  const calls = [];
  const source = await readFile(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (_name, value) => {
            bridge = value;
          },
        },
        ipcRenderer: {
          invoke: async (...args) => {
            calls.push(args);
            return args[0] === "pink:repository-creation-options"
              ? options
              : args[0] === "pink:create-repository"
                ? creationResult
                : repository;
          },
        },
      };
    },
  });
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.invoke, undefined);
  assert.deepEqual(await bridge.repositoryCreationOptions(), options);
  assert.deepEqual(await bridge.createRepository(input), uncertain);
  creationResult = rejected;
  assert.deepEqual(await bridge.createRepository(input), rejected);
  assert.deepEqual(await bridge.checkCreatedRepository(identity), repository);
  assert.deepEqual(calls, [
    ["pink:repository-creation-options"],
    ["pink:create-repository", input],
    ["pink:create-repository", input],
    ["pink:created-repository", identity],
  ]);
});

test("native repository creation validates the sender before any service call and never retries", async () => {
  const source = await readFile(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function installIPC() {");
  const end = source.indexOf("\nfunction createWindow()", start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Map();
  const calls = [];
  const frame = { url: "pink://app/" };
  const owner = { mainFrame: frame, isDestroyed: () => false };
  let fail = false;
  let result = uncertain;
  vm.runInNewContext(`${source.slice(start, end)}\ninstallIPC();`, {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    mainWindow: { webContents: owner },
    devOrigin: null,
    assertTrustedSender,
    getRepositoryCreationOptions: async () => {
      calls.push(["options"]);
      return options;
    },
    createRepository: async (value) => {
      calls.push(["create", value]);
      if (fail) throw new Error("Owner does not allow creation.");
      return result;
    },
    checkCreatedRepository: async (value) => {
      calls.push(["check", value]);
      return repository;
    },
    cloneRepository: () => {},
    openIDE: () => {},
  });
  const entries = [
    ["pink:repository-creation-options", []],
    ["pink:create-repository", [input]],
    ["pink:created-repository", [identity]],
  ];
  const event = { sender: owner, senderFrame: frame };
  for (const [name, args] of entries) {
    const handler = handlers.get(name);
    assert.equal(typeof handler, "function");
    for (const invalid of [
      { sender: {}, senderFrame: frame },
      { sender: owner, senderFrame: { url: "pink://app/" } },
      { sender: owner },
    ])
      assert.throws(() => handler(invalid, ...args));
    frame.url = "https://evil.test/";
    assert.throws(() => handler(event, ...args));
    frame.url = "pink://app/";
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await handlers.get(entries[0][0])(event), options);
  assert.deepEqual(await handlers.get(entries[1][0])(event, input), uncertain);
  assert.deepEqual(
    await handlers.get(entries[2][0])(event, identity),
    repository,
  );
  result = rejected;
  assert.deepEqual(await handlers.get(entries[1][0])(event, input), rejected);
  fail = true;
  await assert.rejects(
    handlers.get(entries[1][0])(event, input),
    /does not allow creation/,
  );
  assert.deepEqual(calls, [
    ["options"],
    ["create", input],
    ["check", identity],
    ["create", input],
    ["create", input],
  ]);
});

async function serve(t, services) {
  const middleware = createApiMiddleware(services);
  const server = http.createServer((request, response) => {
    void middleware(request, response, () => response.writeHead(404).end("{}"));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  return (pathname, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method,
          headers: { origin, "content-type": "application/json", ...headers },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: JSON.parse(text),
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(body);
    });
}

test("local creation API forwards exact inputs and keeps created, rejected, uncertain, and missing outcomes distinct", async (t) => {
  const calls = [];
  let result = created;
  let found = repository;
  const request = await serve(t, {
    getRepositoryCreationOptions: async () => {
      calls.push(["options"]);
      return options;
    },
    createRepository: async (value) => {
      calls.push(["create", value]);
      return result;
    },
    checkCreatedRepository: async (value) => {
      calls.push(["check", value]);
      return found;
    },
  });
  const response = await request("/api/repository-creation-options");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, options);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  const post = () =>
    request("/api/create-repository", {
      method: "POST",
      body: JSON.stringify(input),
    });
  assert.deepEqual((await post()).body, created);
  result = uncertain;
  assert.deepEqual((await post()).body, uncertain);
  result = rejected;
  assert.deepEqual((await post()).body, rejected);
  assert.deepEqual(
    (await request("/api/created-repository?owner=owner&name=new-repo")).body,
    repository,
  );
  found = null;
  assert.equal(
    (await request("/api/created-repository?owner=owner&name=new-repo")).body,
    null,
  );
  assert.deepEqual(calls, [
    ["options"],
    ["create", input],
    ["create", input],
    ["create", input],
    ["check", identity],
    ["check", identity],
  ]);
});

test("local repository creation rejects untrusted and malformed requests before calling a service", async (t) => {
  let calls = 0;
  const service = async () => {
    calls++;
    return created;
  };
  const request = await serve(t, {
    createRepository: service,
    getRepositoryCreationOptions: service,
    checkCreatedRepository: service,
  });
  const post = { method: "POST", body: JSON.stringify(input) };
  for (const pathname of [
    "/api/create-repository",
    "/api/repository-creation-options",
    "/api/created-repository?owner=owner&name=new-repo",
  ]) {
    const config = pathname === "/api/create-repository" ? post : {};
    for (const headers of [
      { origin: "https://evil.test" },
      { host: "evil.test" },
      { "sec-fetch-site": "cross-site" },
    ])
      assert.equal(
        (await request(pathname, { ...config, headers })).status,
        403,
      );
  }
  assert.equal(
    (
      await request("/api/create-repository", {
        ...post,
        headers: { origin: "" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/create-repository", { ...post, method: "PUT" }))
      .status,
    405,
  );
  assert.equal(
    (await request("/api/repository-creation-options", post)).status,
    405,
  );
  assert.equal((await request("/api/create-repository")).status, 404);
  assert.equal((await request("/api/created-repository", post)).status, 405);
  assert.equal(
    (
      await request("/api/create-repository", {
        ...post,
        headers: { "content-type": "text/plain" },
      })
    ).status,
    415,
  );
  for (const body of ["{broken", "null", "[]", '"text"'])
    assert.equal(
      (await request("/api/create-repository", { ...post, body })).status,
      400,
    );
  assert.equal(
    (
      await request("/api/create-repository", {
        ...post,
        body: "x".repeat(256 * 1024 + 1),
      })
    ).status,
    413,
  );
  assert.equal(calls, 0);
});

test("repository creation routes reject remote peers even with a matching localhost Origin", async () => {
  const middleware = createApiMiddleware(
    new Proxy(
      {},
      {
        get: () => () =>
          assert.fail("A remote peer reached a repository service"),
      },
    ),
  );
  for (const [method, url] of [
    ["GET", "/api/repository-creation-options"],
    ["GET", "/api/created-repository?owner=owner&name=new-repo"],
    ["POST", "/api/create-repository"],
  ]) {
    let status;
    await middleware(
      {
        method,
        url,
        headers: { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" },
        socket: { localPort: 5173, remoteAddress: "192.168.1.8" },
      },
      {
        writeHead: (value) => {
          status = value;
        },
        end: () => {},
      },
      () => assert.fail("API request escaped the route boundary"),
    );
    assert.equal(status, 403);
  }
});

test("local repository services preserve validation failures and do not retry creation", async (t) => {
  const calls = [];
  const request = await serve(t, {
    createRepository: async (value) => {
      calls.push(value);
      throw Object.assign(new Error("Choose an allowed owner."), {
        status: 422,
      });
    },
    checkCreatedRepository: async () => {
      throw Object.assign(new Error("Invalid repository name."), {
        status: 400,
      });
    },
  });
  const response = await request("/api/create-repository", {
    method: "POST",
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error, "Choose an allowed owner.");
  assert.equal(
    (await request("/api/created-repository?owner=owner&name=..")).status,
    400,
  );
  assert.deepEqual(calls, [input]);
});

test("renderer repository APIs use native calls or exact relative HTTP contracts without write retries", async () => {
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
  const window = {};
  const calls = [];
  let fail = false;
  let creationResult = uncertain;
  vm.runInNewContext(compiled, {
    exports,
    window,
    URLSearchParams,
    require: (name) => {
      assert.equal(name, "./rendering-policy");
      return renderingPolicy;
    },
    fetch: async (pathname, init) => {
      calls.push([pathname, init]);
      return {
        ok: !fail,
        json: async () =>
          fail
            ? { error: "Check before retrying." }
            : pathname.endsWith("options")
              ? options
              : init
                ? creationResult
                : null,
      };
    },
  });
  assert.deepEqual(await exports.api.repositoryCreationOptions(), options);
  assert.deepEqual(await exports.api.createRepository(input), uncertain);
  assert.equal(
    await exports.api.checkCreatedRepository({
      owner: "owner&other",
      name: "repo#name",
    }),
    null,
  );
  assert.equal(calls[0][0], "/api/repository-creation-options");
  assert.equal(calls[1][0], "/api/create-repository");
  assert.equal(calls[1][1].method, "POST");
  assert.equal(calls[1][1].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1][1].body), input);
  assert.equal(
    calls[2][0],
    "/api/created-repository?owner=owner%26other&name=repo%23name",
  );
  creationResult = rejected;
  assert.deepEqual(await exports.api.createRepository(input), rejected);
  fail = true;
  await assert.rejects(
    exports.api.createRepository(input),
    /Check before retrying/,
  );
  assert.equal(calls.length, 5);
  const nativeCalls = [];
  creationResult = created;
  window.pink = {
    repositoryCreationOptions: async () => {
      nativeCalls.push(["options"]);
      return options;
    },
    createRepository: async (value) => {
      nativeCalls.push(["create", value]);
      return creationResult;
    },
    checkCreatedRepository: async (value) => {
      nativeCalls.push(["check", value]);
      return repository;
    },
  };
  assert.deepEqual(await exports.api.repositoryCreationOptions(), options);
  assert.deepEqual(await exports.api.createRepository(input), created);
  creationResult = rejected;
  assert.deepEqual(await exports.api.createRepository(input), rejected);
  assert.deepEqual(
    await exports.api.checkCreatedRepository(identity),
    repository,
  );
  assert.deepEqual(nativeCalls, [
    ["options"],
    ["create", input],
    ["create", input],
    ["check", identity],
  ]);
  assert.equal(calls.length, 5, "native calls do not also use HTTP");
});
