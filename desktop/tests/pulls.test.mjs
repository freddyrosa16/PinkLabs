import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubRequest, createGitHubService } from "../server/github.mjs";
import {
  validateBranchName,
  validateComparisonInput,
  validatePullRequestInput,
} from "../server/validation.mjs";

const fullName = "owner/repo";
const input = {
  base: "main",
  head: "codex/feature",
  title: "A useful change",
  body: "## Details\nKeep literal `code` and $(examples).",
  draft: true,
};
const rawPull = {
  number: 12,
  title: input.title,
  html_url: "https://github.com/owner/repo/pull/12",
  created_at: "2026-10-15T18:00:00Z",
  draft: true,
  user: {
    login: "freddy",
    avatar_url: "https://avatars.githubusercontent.com/u/1",
    html_url: "https://github.com/freddy",
  },
  head: { ref: input.head, repo: { full_name: fullName } },
};
const normalizedPull = {
  number: 12,
  title: input.title,
  url: rawPull.html_url,
  date: rawPull.created_at,
  draft: true,
  branch: input.head,
  author: {
    login: "freddy",
    avatar: rawPull.user.avatar_url,
    url: rawPull.user.html_url,
  },
};
const existingPath =
  "repos/owner/repo/pulls?state=open&base=main&head=owner%3Acodex%2Ffeature&per_page=100";
const comparePath =
  "repos/owner/repo/compare/main...codex%2Ffeature?per_page=1";

function service({ existing = [], ahead = 2, post, branchError, lookup } = {}) {
  const calls = [];
  const api = createGitHubService({
    request: async (endpoint, options) => {
      calls.push({ endpoint, options });
      if (endpoint === existingPath) return lookup ? lookup() : existing;
      if (endpoint === comparePath)
        return { ahead_by: ahead, behind_by: 1, total_commits: ahead };
      if (endpoint === "repos/owner/repo/branches/main") {
        if (branchError) throw branchError;
        return { name: "main" };
      }
      if (endpoint === "repos/owner/repo/branches/codex%2Ffeature")
        return { name: "codex/feature" };
      if (endpoint === "repos/owner/repo/pulls" && options?.method === "POST")
        return post ? post(options) : rawPull;
      throw new Error("Unexpected fixture request");
    },
  });
  return { api, calls };
}

test("branch and PR input validation permits nested branches and rejects unbounded or ambiguous fields", () => {
  assert.equal(validateBranchName("codex/feature-name"), "codex/feature-name");
  assert.equal(validateBranchName("feature/文書"), "feature/文書");
  assert.deepEqual(
    validateComparisonInput({ base: "main", head: "codex/feature" }),
    { base: "main", head: "codex/feature" },
  );
  assert.deepEqual(
    validatePullRequestInput({ ...input, title: "  A useful change  " }),
    input,
  );
  for (const branch of [
    "",
    "../main",
    "other:fork",
    "main...other",
    "feature//one",
    "feature/",
    "/main",
    "-flag",
    "a.lock/b",
    "x/.hidden",
    "a@{b",
    "a?b",
    "a b",
    "a\\b",
    "a\nb",
    "x".repeat(256),
  ]) {
    assert.throws(() => validateBranchName(branch));
  }
  for (const change of [
    { base: input.head },
    { title: " " },
    { title: "line\nbreak" },
    { title: "x".repeat(257) },
    { body: "x".repeat(60_001) },
    { body: "null\u0000byte" },
    { draft: "true" },
    { unexpected: true },
  ]) {
    assert.throws(() => validatePullRequestInput({ ...input, ...change }));
  }
});

test("invalid PR input is rejected before any GitHub request", async () => {
  let requests = 0;
  const api = createGitHubService({
    request: async () => {
      requests++;
    },
  });
  await assert.rejects(
    api.createPullRequest(fullName, { ...input, head: "other:fork" }),
  );
  await assert.rejects(api.createPullRequest("owner/../escape", input));
  await assert.rejects(
    api.compareBranches(fullName, {
      base: "main",
      head: "feature",
      admin: true,
    }),
  );
  assert.equal(requests, 0);
});

test("branch listing follows pagination and reports its explicit bound instead of silently omitting branches", async () => {
  const pages = [];
  const api = createGitHubService({
    request: async (endpoint) => {
      pages.push(endpoint);
      return endpoint.endsWith("page=1")
        ? Array.from({ length: 100 }, (_, i) => ({ name: `branch-${i}` }))
        : [{ name: "codex/final" }];
    },
  });
  const branches = await api.listBranches(fullName);
  assert.equal(branches.length, 101);
  assert.equal(branches.at(-1), "codex/final");
  assert.deepEqual(pages, [
    "repos/owner/repo/branches?per_page=100&page=1",
    "repos/owner/repo/branches?per_page=100&page=2",
  ]);
  let calls = 0;
  const bounded = createGitHubService({
    request: async () => {
      calls++;
      return Array.from({ length: 100 }, (_, i) => ({
        name: `branch-${calls}-${i}`,
      }));
    },
  });
  await assert.rejects(
    bounded.listBranches(fullName),
    /more than 1,000 branches/,
  );
  assert.equal(calls, 11);
});

test("comparison encodes slash names and returns counts plus the matching existing PR", async () => {
  const { api, calls } = service({ existing: [rawPull] });
  assert.deepEqual(
    await api.compareBranches(fullName, { base: input.base, head: input.head }),
    { aheadBy: 2, behindBy: 1, commitCount: 2, existingPull: normalizedPull },
  );
  assert.ok(calls.some((call) => call.endpoint === comparePath));
  assert.ok(calls.some((call) => call.endpoint === existingPath));
  assert.ok(calls.every((call) => call.options?.method !== "POST"));
});

test("creation sends one structured payload, normalizes the result, and coalesces overlapping submissions", async () => {
  const { api, calls } = service();
  const first = api.createPullRequest(fullName, input);
  assert.strictEqual(api.createPullRequest(fullName, input), first);
  assert.deepEqual(await first, normalizedPull);
  const writes = calls.filter((call) => call.options?.method === "POST");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    endpoint: "repos/owner/repo/pulls",
    options: { method: "POST", body: input },
  });
});

test("an existing PR is returned without writing and a head without new commits cannot create one", async () => {
  const duplicate = service({ existing: [rawPull] });
  assert.deepEqual(
    await duplicate.api.createPullRequest(fullName, input),
    normalizedPull,
  );
  assert.ok(duplicate.calls.every((call) => call.options?.method !== "POST"));
  const noChanges = service({ ahead: 0 });
  await assert.rejects(
    noChanges.api.createPullRequest(fullName, input),
    (error) => error.status === 422 && /no new commits/.test(error.message),
  );
  assert.ok(noChanges.calls.every((call) => call.options?.method !== "POST"));
});

test("a matching branch in a different source repository is not treated as this repository's PR", async () => {
  const otherRepoPull = {
    ...rawPull,
    head: { ...rawPull.head, repo: { full_name: "owner/another-repo" } },
  };
  const { api } = service({ existing: [otherRepoPull] });
  assert.equal(
    (
      await api.compareBranches(fullName, {
        base: input.base,
        head: input.head,
      })
    ).existingPull,
    null,
  );
});

test("a race or lost POST response is reconciled by reading the existing PR, without repeating the write", async () => {
  let lookups = 0;
  const { api, calls } = service({
    lookup: () => (++lookups === 1 ? [] : [rawPull]),
    post: () => {
      throw Object.assign(new Error("private diagnostic"), { status: 422 });
    },
  });
  assert.deepEqual(
    await api.createPullRequest(fullName, input),
    normalizedPull,
  );
  assert.equal(
    calls.filter((call) => call.options?.method === "POST").length,
    1,
  );
  assert.equal(lookups, 2);
});

test("missing branches and uncertain creation errors are sanitized and do not trigger automatic writes", async () => {
  const missing = service({
    branchError: Object.assign(new Error("private diagnostic"), {
      status: 404,
    }),
  });
  await assert.rejects(
    missing.api.createPullRequest(fullName, input),
    (error) =>
      /branch.*not found/i.test(error.message) &&
      !error.message.includes("private diagnostic"),
  );
  assert.ok(missing.calls.every((call) => call.options?.method !== "POST"));
  const uncertain = service({
    post: () => {
      throw new Error("secret payload diagnostic");
    },
  });
  await assert.rejects(
    uncertain.api.createPullRequest(fullName, input),
    (error) =>
      /Refresh Pull Requests before retrying/.test(error.message) &&
      !error.message.includes("secret"),
  );
  assert.equal(
    uncertain.calls.filter((call) => call.options?.method === "POST").length,
    1,
  );
});

test("the gh transport keeps authored content out of argv and writes exact JSON to stdin", async () => {
  let invocation;
  let stdin;
  const request = createGitHubRequest({
    execute: (command, args, options) => {
      invocation = { command, args, options };
      const result = Promise.resolve({ stdout: JSON.stringify(rawPull) });
      result.child = {
        stdin: {
          on() {},
          end(value) {
            stdin = value;
          },
        },
      };
      return result;
    },
  });
  const payload = {
    ...input,
    title: "--hostname attacker.test $(echo example)",
  };
  assert.deepEqual(
    await request("repos/owner/repo/pulls", { method: "POST", body: payload }),
    rawPull,
  );
  assert.equal(invocation.command, "gh");
  assert.equal(invocation.options.shell, undefined);
  assert.deepEqual(invocation.args.slice(-2), ["--input", "-"]);
  assert.ok(!invocation.args.includes(payload.title));
  assert.ok(!invocation.args.includes(payload.body));
  assert.deepEqual(JSON.parse(stdin), payload);
});
