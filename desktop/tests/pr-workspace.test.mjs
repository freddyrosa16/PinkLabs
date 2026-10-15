import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubService } from "../server/github.mjs";

const repo = "owner/repo";
const sha = "a".repeat(40);
const branch = "codex/feature";
const payload = { branch, sha };
const rawPull = {
  number: 12,
  title: "Reviewed change",
  body: "Details",
  state: "closed",
  merged: true,
  merged_at: "2026-10-15T18:00:00Z",
  draft: false,
  html_url: `https://github.com/${repo}/pull/12`,
  head: { ref: branch, sha, repo: { full_name: repo } },
  base: { ref: "main", sha: "b".repeat(40) },
  mergeable: true,
  mergeable_state: "clean",
  changed_files: 3,
};
const metadata = {
  default_branch: "main",
  permissions: { push: true },
  allow_merge_commit: true,
};
const rawBranch = { name: branch, commit: { sha }, protected: false };
const textFile = {
  filename: "src/main.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: "@@ -1 +1 @@\n-old\n+new",
  blob_url: `https://github.com/${repo}/blob/${sha}/src/main.ts`,
};
const files = [
  textFile,
  {
    filename: "new.txt",
    previous_filename: "old.txt",
    status: "renamed",
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: "@@ -0,0 +1 @@\n+hello",
  },
  {
    filename: "image.png",
    status: "added",
    additions: 0,
    deletions: 0,
    changes: 0,
  },
];
const missing = () =>
  Object.assign(new Error("Private diagnostic"), { status: 404 });

function fixture(options = {}) {
  const calls = [];
  const reads = { pull: 0, branch: 0, metadata: 0, head: 0, base: 0 };
  const choose = (key, fallback) => {
    const value = options[key] ?? fallback;
    const count = ++reads[key];
    if (value instanceof Error) throw value;
    return typeof value === "function" ? value(count) : value;
  };
  const api = createGitHubService({
    request: async (endpoint, requestOptions) => {
      calls.push({ endpoint, options: requestOptions });
      if (requestOptions?.method === "DELETE")
        return options.remove ? options.remove() : null;
      if (endpoint === `repos/${repo}/pulls/12`) return choose("pull", rawPull);
      if (endpoint === `repos/${repo}`) return choose("metadata", metadata);
      if (endpoint === `repos/${repo}/branches/${encodeURIComponent(branch)}`)
        return choose("branch", rawBranch);
      if (endpoint.startsWith(`repos/${repo}/pulls?state=open&head=`))
        return choose("head", []);
      if (endpoint.startsWith(`repos/${repo}/pulls?state=open&base=`))
        return choose("base", []);
      if (endpoint.startsWith(`repos/${repo}/pulls/12/files?`))
        return options.files
          ? options.files(
              Number(
                new URL(`https://api.github.com/${endpoint}`).searchParams.get(
                  "page",
                ),
              ),
            )
          : files;
      if (endpoint.startsWith(`repos/${repo}/pulls?state=`))
        return options.list ? options.list(endpoint) : [rawPull];
      if (endpoint.includes("/check-runs?"))
        return { total_count: 0, check_runs: [] };
      if (endpoint.includes("/status?"))
        return { total_count: 0, statuses: [] };
      throw new Error("Unexpected fixture request");
    },
  });
  return {
    api,
    calls,
    reads,
    writes: () => calls.filter(({ options }) => options?.method === "DELETE"),
  };
}

test("workspace service rejects invalid state, revision, branch, number, and bypass fields before requests", async () => {
  const { api, calls } = fixture();
  for (const state of ["merged", "all&evil=1", "", null])
    await assert.rejects(api.listPullRequests(repo, state));
  for (const value of ["short", "a".repeat(41), null])
    await assert.rejects(api.getPullRequestFiles(repo, 12, value));
  for (const fields of [
    { ...payload, force: true },
    { ...payload, branch: "../main" },
    { ...payload, sha: "head" },
    null,
  ])
    await assert.rejects(api.deletePullRequestBranch(repo, 12, fields));
  await assert.rejects(api.getPullRequestFiles(repo, "12", sha));
  await assert.rejects(api.deletePullRequestBranch(repo, 0, payload));
  await assert.rejects(api.listPullRequests("owner/../repo"));
  assert.equal(calls.length, 0);
});

test("all and closed history reveal merged PRs independently of the open list", async () => {
  const { api, calls } = fixture({
    list: (endpoint) =>
      endpoint.includes("state=open")
        ? []
        : [rawPull, { ...rawPull, number: 13, merged: false, merged_at: null }],
  });
  const all = await api.listPullRequests(repo);
  assert.deepEqual(
    all.pulls.map(({ number, state, merged }) => ({ number, state, merged })),
    [
      { number: 12, state: "closed", merged: true },
      { number: 13, state: "closed", merged: false },
    ],
  );
  assert.equal(all.truncated, false);
  assert.equal((await api.listPullRequests(repo, "closed")).pulls.length, 2);
  assert.equal((await api.listPullRequests(repo, "open")).pulls.length, 0);
  assert.ok(
    calls[0].endpoint.includes("state=all&sort=updated&direction=desc"),
  );
});

test("history bounds the recent hundred and probes for one actual omitted result", async () => {
  for (const overflow of [[], [rawPull]]) {
    const { api, calls } = fixture({
      list: (endpoint) =>
        endpoint.endsWith("per_page=1&page=101")
          ? overflow
          : Array.from({ length: 100 }, (_, i) => ({
              ...rawPull,
              number: i + 1,
            })),
    });
    const result = await api.listPullRequests(repo);
    assert.equal(result.pulls.length, 100);
    assert.equal(result.truncated, overflow.length > 0);
    assert.equal(calls.length, 2);
  }
});

test("files preserve patches, renames, and absent binary patches at the reviewed head", async () => {
  const { api, reads } = fixture();
  const result = await api.getPullRequestFiles(repo, 12, sha);
  assert.equal(result.headSha, sha);
  assert.equal(result.truncated, false);
  assert.equal(result.files[0].patch, textFile.patch);
  assert.equal(result.files[0].url, textFile.blob_url);
  assert.equal(result.files[1].previousFilename, "old.txt");
  assert.equal(result.files[2].patch, null);
  assert.equal(result.files[2].previousFilename, null);
  assert.equal(reads.pull, 2);
});

test("diff loading rejects stale heads before requests and head or base changes during pagination", async () => {
  const stale = fixture();
  await assert.rejects(
    stale.api.getPullRequestFiles(repo, 12, "c".repeat(40)),
    { status: 409 },
  );
  assert.equal(
    stale.calls.filter((call) => call.endpoint.includes("/files?")).length,
    0,
  );
  for (const after of [
    { ...rawPull, head: { ...rawPull.head, sha: "c".repeat(40) } },
    { ...rawPull, base: { ...rawPull.base, ref: "release" } },
    { ...rawPull, base: { ...rawPull.base, sha: "c".repeat(40) } },
  ]) {
    const { api } = fixture({
      pull: (count) => (count === 1 ? rawPull : after),
    });
    await assert.rejects(
      api.getPullRequestFiles(repo, 12, sha),
      (error) => error.status === 409 && /changed while/.test(error.message),
    );
  }
});

test("file pagination follows later pages and exposes its thousand-file bound honestly", async () => {
  for (const total of [101, 1000, 1001]) {
    const { api, calls } = fixture({
      pull: { ...rawPull, changed_files: total },
      files: (page) =>
        Array.from(
          { length: Math.min(100, total - (page - 1) * 100) },
          (_, i) => ({ ...textFile, filename: `file-${page}-${i}.txt` }),
        ),
    });
    const result = await api.getPullRequestFiles(repo, 12, sha);
    assert.equal(result.files.length, Math.min(total, 1000));
    assert.equal(result.truncated, total > 1000);
    assert.equal(
      calls.filter((call) => call.endpoint.includes("/files?")).length,
      Math.min(10, Math.ceil(total / 100)),
    );
  }
});

test("partial upstream patches and local patch byte limits are explicit", async () => {
  const partial = fixture({
    pull: { ...rawPull, changed_files: 1 },
    files: () => [{ ...textFile, additions: 2, changes: 3 }],
  });
  const partialResult = await partial.api.getPullRequestFiles(repo, 12, sha);
  assert.equal(partialResult.truncated, true);
  assert.equal(partialResult.files[0].patch, textFile.patch);
  const huge = fixture({
    pull: { ...rawPull, changed_files: 1 },
    files: () => [{ ...textFile, patch: "+" + "x".repeat(256 * 1024) }],
  });
  const hugeResult = await huge.api.getPullRequestFiles(repo, 12, sha);
  assert.equal(hugeResult.truncated, true);
  assert.equal(hugeResult.files[0].patch, null);
  const combined = fixture({
    pull: { ...rawPull, changed_files: 9 },
    files: () =>
      Array.from({ length: 9 }, (_, i) => ({
        ...textFile,
        filename: `${i}.txt`,
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: "+" + "x".repeat(250 * 1024),
      })),
  });
  const combinedResult = await combined.api.getPullRequestFiles(repo, 12, sha);
  assert.equal(combinedResult.truncated, true);
  assert.equal(combinedResult.files.at(-1).patch, null);
});

test("branch cleanup permits only a merged local unchanged unprotected branch unused by open PRs", async () => {
  const { api } = fixture();
  assert.deepEqual((await api.getPullRequest(repo, 12)).branchCleanup, {
    branch,
    sha,
    canDelete: true,
    deleted: false,
    reason: "",
  });
  const cases = [
    {
      pull: { ...rawPull, merged: false, state: "open" },
      reason: /Only a merged/,
    },
    { pull: { ...rawPull, merged: false }, reason: /Only a merged/ },
    {
      pull: {
        ...rawPull,
        head: { ...rawPull.head, repo: { full_name: "someone/fork" } },
      },
      reason: /another repository/,
    },
    {
      metadata: { ...metadata, default_branch: branch },
      reason: /default or destination/,
    },
    {
      pull: { ...rawPull, base: { ...rawPull.base, ref: branch } },
      reason: /default or destination/,
    },
    {
      metadata: { ...metadata, permissions: { push: false } },
      reason: /permission/,
    },
    { metadata: { ...metadata, archived: true }, reason: /archived/ },
    { branch: { ...rawBranch, protected: true }, reason: /protected/ },
    {
      branch: { ...rawBranch, commit: { sha: "c".repeat(40) } },
      reason: /new or different commits/,
    },
    { head: [{ number: 14 }], reason: /used by an open/ },
    { base: [{ number: 14 }], reason: /used by an open/ },
  ];
  for (const { reason, ...options } of cases) {
    const sample = fixture(options);
    const detail = await sample.api.getPullRequest(repo, 12);
    assert.equal(detail.branchCleanup.canDelete, false);
    assert.match(detail.branchCleanup.reason, reason);
    await assert.rejects(
      sample.api.deletePullRequestBranch(repo, 12, payload),
      (error) => error.status === 405 && reason.test(error.message),
    );
    assert.equal(sample.writes().length, 0);
  }
});

test("optional cleanup failures cannot break PR details, and absent branches are already deleted", async () => {
  const unavailable = fixture({
    branch: new Error("Private metadata diagnostic"),
  });
  const detail = await unavailable.api.getPullRequest(repo, 12);
  assert.equal(detail.number, 12);
  assert.equal(detail.checksIncomplete, false);
  assert.equal(detail.branchCleanup.canDelete, false);
  assert.match(detail.branchCleanup.reason, /could not be verified/);
  assert.ok(!JSON.stringify(detail).includes("Private"));
  const absent = fixture({ branch: missing() });
  assert.equal(
    (await absent.api.getPullRequest(repo, 12)).branchCleanup.deleted,
    true,
  );
  assert.deepEqual(
    await absent.api.deletePullRequestBranch(repo, 12, payload),
    { deleted: true, branch },
  );
  assert.equal(absent.writes().length, 0);
});

test("deletion validates the confirmed branch and SHA, then rechecks mutation conditions immediately before DELETE", async () => {
  for (const fields of [
    { branch: "codex/another", sha },
    { branch, sha: "c".repeat(40) },
  ]) {
    const { api, writes } = fixture();
    await assert.rejects(api.deletePullRequestBranch(repo, 12, fields), {
      status: 409,
    });
    assert.equal(writes().length, 0);
  }
  const lateCases = [
    {
      branch: (read) =>
        read === 1
          ? rawBranch
          : { ...rawBranch, commit: { sha: "c".repeat(40) } },
    },
    {
      branch: (read) =>
        read === 1 ? rawBranch : { ...rawBranch, protected: true },
    },
    {
      pull: (read) =>
        read === 1 ? rawPull : { ...rawPull, merged: false, state: "open" },
    },
    {
      metadata: (read) =>
        read === 1 ? metadata : { ...metadata, default_branch: branch },
    },
    { head: (read) => (read === 1 ? [] : [{ number: 14 }]) },
    { base: (read) => (read === 1 ? [] : [{ number: 14 }]) },
  ];
  for (const options of lateCases) {
    const { api, writes } = fixture(options);
    await assert.rejects(api.deletePullRequestBranch(repo, 12, payload), {
      status: 409,
    });
    assert.equal(writes().length, 0);
  }
});

test("one confirmed deletion uses an encoded branch and coalesces only matching submissions", async () => {
  const { api, calls, writes } = fixture();
  const first = api.deletePullRequestBranch(repo, 12, payload);
  assert.strictEqual(api.deletePullRequestBranch(repo, 12, payload), first);
  await assert.rejects(
    api.deletePullRequestBranch(repo, 12, { branch, sha: "c".repeat(40) }),
    /already in progress/,
  );
  assert.deepEqual(await first, { deleted: true, branch });
  assert.deepEqual(writes(), [
    {
      endpoint: `repos/${repo}/git/refs/heads/codex%2Ffeature`,
      options: { method: "DELETE" },
    },
  ]);
  assert.equal(calls.at(-2).endpoint, `repos/${repo}/branches/codex%2Ffeature`);
});

test("uncertain deletion reconciles an absent branch with a read and never repeats DELETE", async () => {
  const { api, reads, writes } = fixture({
    branch: (read) => {
      if (read > 2) throw missing();
      return rawBranch;
    },
    remove: () => {
      throw new Error("Private timeout detail");
    },
  });
  assert.deepEqual(await api.deletePullRequestBranch(repo, 12, payload), {
    deleted: true,
    branch,
  });
  assert.equal(writes().length, 1);
  assert.equal(reads.branch, 3);
  assert.equal(
    reads.metadata,
    3,
    "repository access is rechecked before treating a 404 as absent",
  );
});

test("uncertain deletion stays unconfirmed when branch persists or cannot be verified", async () => {
  for (const options of [
    {},
    {
      branch: (read) => {
        if (read > 2) throw new Error("Private auth failure");
        return rawBranch;
      },
    },
    {
      metadata: (read) => {
        if (read > 2) throw missing();
        return metadata;
      },
    },
  ]) {
    const { api, writes } = fixture({
      ...options,
      remove: () => {
        throw new Error("Private timeout detail");
      },
    });
    await assert.rejects(
      api.deletePullRequestBranch(repo, 12, payload),
      (error) =>
        /did not confirm branch deletion/.test(error.message) &&
        !error.message.includes("Private"),
    );
    assert.equal(writes().length, 1);
  }
  for (const status of [403, 409, 422]) {
    const { api, writes } = fixture({
      remove: () => {
        throw Object.assign(new Error("Private stderr"), { status });
      },
    });
    await assert.rejects(
      api.deletePullRequestBranch(repo, 12, payload),
      (error) => error.status === status && !error.message.includes("Private"),
    );
    assert.equal(writes().length, 1);
  }
});
