import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createApiMiddleware } from "../server/vite-api.mjs";
import { isAllowedAPIRequest } from "../server/validation.mjs";

const headers = {
  host: "127.0.0.1:5173",
  origin: "http://127.0.0.1:5173",
  "sec-fetch-site": "same-origin",
};

test("a localhost Host and Origin do not authorize a remote socket peer", () => {
  for (const remoteAddress of [
    "192.168.1.8",
    "10.0.0.4",
    "203.0.113.9",
    "::ffff:192.168.1.8",
    "2001:db8::1",
    undefined,
  ]) {
    assert.equal(
      isAllowedAPIRequest({
        headers,
        socket: { localPort: 5173, remoteAddress },
      }),
      false,
      String(remoteAddress),
    );
  }
  for (const remoteAddress of [
    "127.0.0.1",
    "127.0.0.2",
    "::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(
      isAllowedAPIRequest({
        headers,
        socket: { localPort: 5173, remoteAddress },
      }),
      true,
      remoteAddress,
    );
  }
});

test("remote requests are rejected before read or write services run", async () => {
  const middleware = createApiMiddleware(
    new Proxy(
      {},
      { get: () => () => assert.fail("Untrusted peer reached GitHub") },
    ),
  );
  for (const [method, url] of [
    ["GET", "/api/repositories"],
    ["POST", "/api/pulls"],
  ]) {
    let status;
    let body;
    await middleware(
      {
        method,
        url,
        headers,
        socket: { localPort: 5173, remoteAddress: "192.168.1.8" },
      },
      {
        writeHead: (value) => {
          status = value;
        },
        end: (value) => {
          body = JSON.parse(value);
        },
      },
      () => assert.fail("An API request was delegated"),
    );
    assert.equal(status, 403);
    assert.match(body.error, /local Pink Labs preview/);
  }
});

test("malformed HTTP request targets return an error and the next request still works", async (t) => {
  let rejected = 0;
  let calls = 0;
  const middleware = createApiMiddleware({
    listRepositories: async () => {
      calls++;
      return [];
    },
  });
  const server = http.createServer((request, response) => {
    // A rejected async middleware would otherwise be unhandled by Connect/HTTP.
    void middleware(request, response, () => {
      response.writeHead(404).end("{}");
    }).catch(() => {
      rejected++;
      response.writeHead(500).end("{}");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(target) {
    return new Promise((resolve, reject) => {
      http
        .get(
          { host: "127.0.0.1", port: server.address().port, path: target },
          (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () =>
              resolve({ status: response.statusCode, body: JSON.parse(body) }),
            );
          },
        )
        .on("error", reject);
    });
  }
  assert.equal((await request("http://[invalid/api/repositories")).status, 400);
  assert.equal((await request("/api/repositories")).status, 200);
  assert.equal(
    rejected,
    0,
    "request handling must not reject outside the HTTP response boundary",
  );
  assert.equal(calls, 1);
});

async function loadOpenIDE({ folders, canonical, availableIDE = null }) {
  const source = await readFile(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function openIDE(");
  const end = source.indexOf("\nfunction installIPC()", start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = {
    path,
    process: { platform: "darwin" },
    os: { homedir: () => "/Users/test" },
    selectedFolders: new Set(folders),
    realpath: async () => canonical,
    lstat: async () => ({ isDirectory: () => true }),
    access: async (target) => {
      if (target !== availableIDE) throw new Error("Not installed");
    },
    execute: async (...args) => {
      calls.push(["execute", ...args]);
    },
    shell: {
      openPath: async (target) => {
        calls.push(["openPath", target]);
        return "";
      },
      showItemInFolder: (target) => {
        calls.push(["reveal", target]);
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.open = openIDE;`, context);
  return { open: context.open, calls };
}

test("the no-editor fallback reveals a selected .app directory instead of launching its association", async () => {
  const folder = "/Users/test/Projects/example.app";
  const { open, calls } = await loadOpenIDE({
    folders: [folder],
    canonical: folder,
  });
  assert.equal(await open(folder), "file-manager");
  assert.deepEqual(calls, [["reveal", folder]]);
});

test("opening projects still uses a known editor and refuses unselected canonical paths", async () => {
  const folder = "/Users/test/Projects/hello world";
  const editor = "/Applications/Cursor.app";
  const { open, calls } = await loadOpenIDE({
    folders: [folder],
    canonical: folder,
    availableIDE: editor,
  });
  assert.equal(await open(folder), "editor");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "execute");
  assert.equal(calls[0][1], "/usr/bin/open");
  assert.deepEqual(Array.from(calls[0][2]), ["-a", editor, folder]);
  assert.notEqual(calls[0][3].shell, true);
  const unselected = await loadOpenIDE({
    folders: [folder],
    canonical: "/Users/test/Other",
  });
  await assert.rejects(unselected.open(folder), /folder picker first/);
  assert.deepEqual(unselected.calls, []);
});

test("the production image policy permits local assets and explicit GitHub hosts only", async () => {
  const source = await readFile(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const productionCSP =");
  const end = source.indexOf("\nasync function serveApp(", start);
  assert.ok(start >= 0 && end > start);
  const policy = vm.runInNewContext(
    `${source.slice(start, end)}\nproductionCSP;`,
  );
  const directives = new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
  assert.deepEqual(directives.get("img-src"), [
    "'self'",
    "data:",
    "https://raw.githubusercontent.com",
    "https://user-images.githubusercontent.com",
    "https://camo.githubusercontent.com",
    "https://avatars.githubusercontent.com",
  ]);
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("frame-src"), ["'none'"]);
});
