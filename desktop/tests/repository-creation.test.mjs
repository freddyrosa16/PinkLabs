import test from "node:test";
import assert from "node:assert/strict";
import { createRepositoryService } from "../server/repository-creation.mjs";

const input = {
  owner: "freddy",
  name: "New-Project",
  description: "Literal `code` and $(examples).",
  visibility: "private",
  initializeReadme: false,
  gitignoreTemplate: "",
  licenseTemplate: "",
};
const account = { login: "freddy", type: "User" };
const membership = {
  state: "active",
  organization: { login: "PinkOrg" },
  user: account,
};
const rawRepo = (owner = input.owner, name = input.name) => ({
  full_name: `${owner}/${name}`,
  name,
  owner: { login: owner },
  description: input.description,
  private: true,
});
const summary = (owner = input.owner, name = input.name) => ({
  fullName: `${owner}/${name}`,
  name,
  description: input.description,
  private: true,
});
const failure = (status, extras = {}) =>
  Object.assign(new Error("private diagnostic must not escape"), {
    status,
    ...extras,
  });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function assertRejected(operation, pattern) {
  const result = await operation;
  assert.equal(result.status, "rejected");
  assert.equal(typeof result.message, "string");
  assert.ok(!result.message.includes("diagnostic"));
  if (pattern) assert.match(result.message, pattern);
}
function fixture(overrides = {}) {
  const calls = [];
  const api = createRepositoryService({
    request: async (endpoint, options) => {
      calls.push({ endpoint, options });
      if (Object.hasOwn(overrides, endpoint)) {
        const value = overrides[endpoint];
        if (value instanceof Error) throw value;
        return typeof value === "function" ? value(options) : value;
      }
      if (endpoint === "user") return account;
      if (endpoint === "user/memberships/orgs?state=active&per_page=100&page=1")
        return [membership];
      if (endpoint === "user/memberships/orgs/PinkOrg") return membership;
      if (endpoint === "gitignore/templates") return ["Node", "Python"];
      if (endpoint === "licenses?per_page=100&page=1")
        return [{ key: "mit", name: "MIT License" }];
      if (endpoint.startsWith("repos/")) throw failure(404);
      if (endpoint === "user/repos") return rawRepo();
      if (endpoint === "orgs/PinkOrg/repos")
        return { ...rawRepo("PinkOrg"), private: options.body.private };
      throw failure(404);
    },
  });
  return {
    api,
    calls,
    posts: () => calls.filter(({ options }) => options?.method === "POST"),
  };
}

test("options use the signed-in account, active memberships, and supported templates", async () => {
  const { api, calls } = fixture({
    "user/memberships/orgs?state=active&per_page=100&page=1": [
      membership,
      { ...membership, state: "pending", organization: { login: "Pending" } },
      {
        ...membership,
        user: { login: "other" },
        organization: { login: "WrongUser" },
      },
      { ...membership, organization: { login: "pinkorg" } },
    ],
  });
  assert.deepEqual(await api.getRepositoryCreationOptions(), {
    account: "freddy",
    owners: [
      { login: "freddy", type: "user" },
      { login: "PinkOrg", type: "organization" },
    ],
    gitignoreTemplates: ["Node", "Python"],
    licenses: [{ key: "mit", name: "MIT License" }],
    warnings: [],
  });
  assert.ok(calls.every(({ options }) => !options?.method));
});

test("optional failures preserve the personal owner and usable options with sanitized warnings", async () => {
  const { api } = fixture({
    "user/memberships/orgs?state=active&per_page=100&page=1": failure(403),
    "gitignore/templates": failure(500),
  });
  const options = await api.getRepositoryCreationOptions();
  assert.deepEqual(options.owners, [{ login: "freddy", type: "user" }]);
  assert.deepEqual(options.gitignoreTemplates, []);
  assert.equal(options.licenses[0].key, "mit");
  assert.equal(options.warnings.length, 2);
  assert.ok(
    options.warnings.every((warning) => !warning.includes("diagnostic")),
  );
});

test("organization and license pagination is bounded and reports partial results", async () => {
  const overrides = {};
  for (let page = 1; page <= 3; page++) {
    overrides[`user/memberships/orgs?state=active&per_page=100&page=${page}`] =
      Array.from({ length: 100 }, (_, index) => ({
        ...membership,
        organization: { login: `org-${page}-${index}` },
      }));
  }
  overrides["licenses?per_page=100&page=1"] = Array.from(
    { length: 100 },
    (_, index) => ({ key: `license-${index}`, name: `License ${index}` }),
  );
  overrides["licenses?per_page=100&page=2"] = failure(503);
  const { api, calls } = fixture(overrides);
  const options = await api.getRepositoryCreationOptions();
  assert.equal(options.owners.length, 301);
  assert.equal(options.licenses.length, 100);
  assert.ok(options.warnings.some((warning) => warning.includes("first 300")));
  assert.ok(
    options.warnings.some((warning) =>
      warning.includes("License templates could not be fully loaded"),
    ),
  );
  assert.ok(!calls.some(({ endpoint }) => endpoint.includes("page=4")));
});

test("authentication failure prevents misleading owner options and exposes no raw diagnostics", async () => {
  const { api, calls } = fixture({ user: failure(401) });
  await assert.rejects(
    api.getRepositoryCreationOptions(),
    (error) =>
      error.status === 401 &&
      /gh auth login/.test(error.message) &&
      !error.message.includes("diagnostic"),
  );
  assert.equal(calls.length, 1);
});

test("strict creation and check inputs reject paths, command flags, unknown fields and invalid types before requests", async () => {
  const { api, calls } = fixture();
  for (const invalid of [
    null,
    [],
    {},
    { ...input, owner: "../owner" },
    { ...input, owner: "--hostname" },
    { ...input, name: ".." },
    { ...input, name: "repo/name" },
    { ...input, name: " a " },
    { ...input, name: "x".repeat(101) },
    { ...input, description: "x".repeat(351) },
    { ...input, description: "a\0b" },
    { ...input, description: null },
    { ...input, visibility: "internal" },
    { ...input, initializeReadme: "true" },
    { ...input, licenseTemplate: "../mit" },
    { ...input, gitignoreTemplate: "Node?x" },
    { ...input, gitignoreTemplate: null },
    { ...input, delete: true },
  ])
    await assertRejected(api.createRepository(invalid));
  for (const invalid of [
    null,
    { owner: "freddy", name: ".." },
    { owner: "freddy", name: "fine", extra: true },
  ])
    await assert.rejects(
      api.checkCreatedRepository(invalid),
      (error) => error.status === 400,
    );
  assert.equal(calls.length, 0);
});

test("personal creation uses one JSON POST with literal content and explicit private visibility", async () => {
  const { api, posts } = fixture();
  assert.deepEqual(await api.createRepository(input), {
    status: "created",
    repository: summary(),
  });
  assert.deepEqual(posts(), [
    {
      endpoint: "user/repos",
      options: {
        method: "POST",
        body: {
          name: input.name,
          description: input.description,
          private: true,
          auto_init: false,
        },
      },
    },
  ]);
});

test("organization creation verifies active membership and sends selected initialization options", async () => {
  const { api, posts } = fixture();
  const created = await api.createRepository({
    ...input,
    owner: "PinkOrg",
    visibility: "public",
    initializeReadme: true,
    gitignoreTemplate: "Node",
    licenseTemplate: "mit",
  });
  assert.equal(created.repository.fullName, "PinkOrg/New-Project");
  assert.deepEqual(posts(), [
    {
      endpoint: "orgs/PinkOrg/repos",
      options: {
        method: "POST",
        body: {
          name: input.name,
          description: input.description,
          private: false,
          auto_init: true,
          gitignore_template: "Node",
          license_template: "mit",
        },
      },
    },
  ]);
});

test("unverified, pending, and wrong-account organization owners cannot create repositories", async () => {
  for (const value of [
    failure(404),
    { ...membership, state: "pending" },
    { ...membership, user: { login: "other" } },
    { ...membership, organization: { login: "OtherOrg" } },
  ]) {
    const { api, posts } = fixture({ "user/memberships/orgs/PinkOrg": value });
    await assertRejected(
      api.createRepository({ ...input, owner: "PinkOrg" }),
      /active membership/,
    );
    assert.equal(posts().length, 0);
  }
});

test("template values must be in a successfully loaded allowlist; missing lists allow only no template", async () => {
  for (const value of [failure(503), [], ["Node"]]) {
    const { api, posts } = fixture({ "gitignore/templates": value });
    await assertRejected(
      api.createRepository({ ...input, gitignoreTemplate: "Invented" }),
      /could not be verified/,
    );
    assert.equal(posts().length, 0);
  }
  const { api, posts } = fixture({
    "licenses?per_page=100&page=1": failure(500),
    "gitignore/templates": failure(500),
  });
  await assertRejected(
    api.createRepository({ ...input, licenseTemplate: "mit" }),
    /could not be verified/,
  );
  assert.equal(posts().length, 0);
  assert.equal((await api.createRepository(input)).status, "created");
});

test("existing repository and account changes fail before a write", async () => {
  const existing = fixture({ "repos/freddy/New-Project": rawRepo() });
  await assertRejected(existing.api.createRepository(input), /already exists/);
  assert.equal(existing.posts().length, 0);
  let calls = 0;
  const changed = fixture({
    user: () => (++calls === 1 ? account : { ...account, login: "other" }),
  });
  await assertRejected(changed.api.createRepository(input), /account changed/);
  assert.equal(changed.posts().length, 0);
});

test("an unavailable preflight is a safe rejection rather than an uncertain write", async () => {
  for (const overrides of [
    { user: failure(undefined, { code: "ETIMEDOUT" }) },
    { "repos/freddy/New-Project": failure(503) },
  ]) {
    const { api, posts } = fixture(overrides);
    await assertRejected(api.createRepository(input));
    assert.equal(posts().length, 0);
  }
});

test("simultaneous identical creations share one operation; changed options cannot join that write", async () => {
  const gate = deferred();
  const posted = deferred();
  const { api, posts } = fixture({
    "user/repos": () => {
      posted.resolve();
      return gate.promise;
    },
  });
  const first = api.createRepository(input);
  assert.strictEqual(
    api.createRepository({ ...input, owner: "FREDDY", name: "new-project" }),
    first,
  );
  await assertRejected(
    api.createRepository({ ...input, visibility: "public" }),
    /already in progress/,
  );
  await posted.promise;
  assert.equal(posts().length, 1);
  gate.resolve(rawRepo());
  assert.equal((await first).status, "created");
});

test("a confirmed repeated creation reads the repository and does not send another POST", async () => {
  let exists = false;
  const { api, posts } = fixture({
    "repos/freddy/New-Project": () => {
      if (!exists) throw failure(404);
      return rawRepo();
    },
    "user/repos": () => {
      exists = true;
      return rawRepo();
    },
  });
  await api.createRepository(input);
  assert.deepEqual(await api.createRepository(input), {
    status: "created",
    repository: summary(),
  });
  assert.equal(posts().length, 1);
});

test("ambiguous creation never retries and remains blocked until an explicit absent check", async () => {
  const { api, posts } = fixture({
    "user/repos": failure(undefined, { code: "ETIMEDOUT" }),
  });
  const first = await api.createRepository(input);
  assert.equal(first.status, "uncertain");
  assert.match(first.message, /Check for the repository/);
  assert.ok(!first.message.includes("diagnostic"));
  assert.equal((await api.createRepository(input)).status, "uncertain");
  assert.equal(posts().length, 1);
  assert.equal(
    await api.checkCreatedRepository({ owner: input.owner, name: input.name }),
    null,
  );
  assert.equal(posts().length, 1, "checking never retries creation");
  await api.createRepository(input);
  assert.equal(
    posts().length,
    2,
    "only the explicit manual create after absence can write again",
  );
});

test("a failed or malformed check cannot unlock an uncertain creation", async () => {
  for (const outcome of [failure(503), rawRepo("other")]) {
    let lookups = 0;
    const { api, posts } = fixture({
      "user/repos": failure(500),
      "repos/freddy/New-Project": () => {
        if (++lookups === 1) throw failure(404);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    });
    await api.createRepository(input);
    await assert.rejects(
      api.checkCreatedRepository({ owner: input.owner, name: input.name }),
    );
    assert.equal((await api.createRepository(input)).status, "uncertain");
    assert.equal(posts().length, 1);
  }
});

test("switching accounts cannot clear another account's uncertain organization creation", async () => {
  let login = "freddy";
  const { api, posts } = fixture({
    user: () => ({ ...account, login }),
    "user/memberships/orgs/PinkOrg": () => ({
      ...membership,
      user: { login },
    }),
    "orgs/PinkOrg/repos": failure(500),
  });
  const selected = { ...input, owner: "PinkOrg" };
  assert.equal((await api.createRepository(selected)).status, "uncertain");
  login = "other";
  await assert.rejects(
    api.checkCreatedRepository({ owner: selected.owner, name: selected.name }),
    /account used for creation/,
  );
  assert.equal((await api.createRepository(selected)).status, "uncertain");
  assert.equal(posts().length, 1);
  login = "freddy";
  assert.equal(
    await api.checkCreatedRepository({
      owner: selected.owner,
      name: selected.name,
    }),
    null,
  );
  assert.equal(posts().length, 1);
});

test("check reconciles a successful write with a lost reply without creating again", async () => {
  let exists = false;
  const { api, posts } = fixture({
    "repos/freddy/New-Project": () => {
      if (!exists) throw failure(404);
      return rawRepo();
    },
    "user/repos": () => {
      exists = true;
      throw failure(502);
    },
  });
  assert.equal((await api.createRepository(input)).status, "uncertain");
  assert.deepEqual(
    await api.checkCreatedRepository({ owner: input.owner, name: input.name }),
    summary(),
  );
  assert.equal(posts().length, 1);
  assert.equal((await api.createRepository(input)).status, "created");
  assert.equal(posts().length, 1);
});

test("a check waits for an in-flight creation before resolving its outcome", async () => {
  const gate = deferred();
  const posted = deferred();
  let exists = false;
  const { api, calls, posts } = fixture({
    "repos/freddy/New-Project": () => {
      if (!exists) throw failure(404);
      return rawRepo();
    },
    "user/repos": () => {
      posted.resolve();
      return gate.promise;
    },
  });
  const creation = api.createRepository(input);
  await posted.promise;
  const check = api.checkCreatedRepository({
    owner: input.owner,
    name: input.name,
  });
  await Promise.resolve();
  assert.equal(
    calls.filter(({ endpoint }) => endpoint === "repos/freddy/New-Project")
      .length,
    1,
  );
  exists = true;
  gate.reject(failure(500));
  assert.equal((await creation).status, "uncertain");
  assert.deepEqual(await check, summary());
  assert.equal(posts().length, 1);
});

test("a pending read-only check cannot race with a new creation", async () => {
  const gate = deferred();
  const { api, posts } = fixture({ user: () => gate.promise });
  const check = api.checkCreatedRepository({
    owner: input.owner,
    name: input.name,
  });
  assert.strictEqual(
    api.checkCreatedRepository({ owner: input.owner, name: input.name }),
    check,
  );
  await assertRejected(api.createRepository(input), /check is in progress/);
  gate.resolve(account);
  assert.equal(await check, null);
  assert.equal(posts().length, 0);
});

test("unexpected successful-response identity is uncertain, never a claimed success or automatic retry", async () => {
  for (const raw of [
    null,
    rawRepo("other"),
    { ...rawRepo(), name: "WrongName" },
    { ...rawRepo(), private: undefined },
    { ...rawRepo(), private: false },
  ]) {
    const { api, posts } = fixture({ "user/repos": raw });
    assert.equal((await api.createRepository(input)).status, "uncertain");
    assert.equal((await api.createRepository(input)).status, "uncertain");
    assert.equal(posts().length, 1);
  }
});

for (const outcome of [
  "mismatched response",
  "lost response",
  "completed creation",
]) {
  test(`recovery preserves requested visibility after ${outcome} without changing GitHub settings`, async () => {
    for (const visibility of ["private", "public"]) {
      const intendedPrivate = visibility === "private";
      let exists = false;
      let actualPrivate =
        outcome === "mismatched response" ? !intendedPrivate : intendedPrivate;
      const { api, calls, posts } = fixture({
        "user/repos": () => {
          exists = true;
          if (outcome === "lost response") throw failure(502);
          return { ...rawRepo(), private: actualPrivate };
        },
        "repos/freddy/New-Project": () => {
          if (!exists) throw failure(404);
          return { ...rawRepo(), private: actualPrivate };
        },
      });
      const selected = { ...input, visibility };
      assert.equal(
        (await api.createRepository(selected)).status,
        outcome === "completed creation" ? "created" : "uncertain",
      );
      // A successful service reply may be lost by the renderer, and repository
      // visibility may change externally before the user checks that result.
      actualPrivate = !intendedPrivate;
      await assert.rejects(
        api.checkCreatedRepository({ owner: input.owner, name: input.name }),
        (error) => {
          assert.equal(error.status, 409);
          assert.match(
            error.message,
            new RegExp(
              `is ${actualPrivate ? "private" : "public"}.*requested ${visibility}`,
            ),
          );
          assert.ok(!error.message.includes("diagnostic"));
          return true;
        },
      );
      assert.equal((await api.createRepository(selected)).status, "uncertain");
      assert.equal(
        posts().length,
        1,
        "a visibility mismatch keeps creation blocked",
      );
      actualPrivate = intendedPrivate;
      assert.deepEqual(
        await api.checkCreatedRepository({
          owner: input.owner,
          name: input.name,
        }),
        { ...summary(), private: intendedPrivate },
      );
      assert.equal((await api.createRepository(selected)).status, "created");
      assert.equal(posts().length, 1);
      assert.ok(
        calls.every(
          ({ options }) => !options?.method || options.method === "POST",
        ),
        "recovery never changes visibility or other GitHub settings",
      );
    }
  });
}

test("definite GitHub rejections expose useful sanitized errors and never retry the write", async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429, 451]) {
    const { api, posts } = fixture({ "user/repos": failure(status) });
    await assertRejected(api.createRepository(input));
    assert.equal(posts().length, 1);
  }
});
