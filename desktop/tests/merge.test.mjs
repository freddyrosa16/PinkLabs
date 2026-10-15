import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubService } from "../server/github.mjs";

const repo = "owner/repo";
const sha = "a".repeat(40);
const mergedSha = "b".repeat(40);
const payload = { sha, base: "main", method: "squash" };
const rawPull = {
  number: 12,
  title: "Add merge controls",
  body: "A reviewed change.",
  html_url: "https://github.com/owner/repo/pull/12",
  created_at: "2026-10-15T18:00:00Z",
  user: { login: "freddy" },
  state: "open",
  draft: false,
  merged: false,
  head: { sha, ref: "codex/feature" },
  base: { ref: "main" },
  mergeable: true,
  mergeable_state: "clean",
  rebaseable: true,
  additions: 10,
  deletions: 2,
  changed_files: 3,
  commits: 2,
};
const metadata = {
  permissions: { push: true },
  allow_merge_commit: true,
  allow_squash_merge: true,
  allow_rebase_merge: true,
};

function fixture({
  pull = rawPull,
  repository = metadata,
  runs,
  statuses,
  put,
} = {}) {
  const calls = [];
  let reads = 0;
  const api = createGitHubService({
    request: async (endpoint, options) => {
      calls.push({ endpoint, options });
      if (
        endpoint === `repos/${repo}/pulls/12/merge` &&
        options?.method === "PUT"
      )
        return put ? put(options) : { merged: true, sha: mergedSha };
      if (endpoint === `repos/${repo}/pulls/12`) {
        reads++;
        return typeof pull === "function" ? pull(reads) : pull;
      }
      if (endpoint === `repos/${repo}`) return repository;
      if (endpoint.includes("/check-runs?"))
        return runs
          ? runs(
              Number(
                new URL(`https://api.github.com/${endpoint}`).searchParams.get(
                  "page",
                ),
              ),
            )
          : { total_count: 0, check_runs: [] };
      if (endpoint.includes("/status?"))
        return statuses
          ? statuses(
              Number(
                new URL(`https://api.github.com/${endpoint}`).searchParams.get(
                  "page",
                ),
              ),
            )
          : { total_count: 0, state: "pending", statuses: [] };
      throw new Error("Unexpected fixture endpoint");
    },
  });
  return {
    api,
    calls,
    writes: () => calls.filter(({ options }) => options?.method === "PUT"),
  };
}

test("merge validation rejects invalid repository, number, SHA, method, base, and bypass fields before requests", async () => {
  const { api, calls } = fixture();
  for (const number of [0, -1, 1.5, "12", null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(api.getPullRequest(repo, number));
    await assert.rejects(api.mergePullRequest(repo, number, payload));
  }
  for (const fields of [
    { ...payload, sha: "short" },
    { ...payload, sha: "z".repeat(40) },
    { ...payload, base: "../main" },
    { ...payload, method: "admin" },
    { ...payload, bypass_rules: true },
    { ...payload, admin: true },
    null,
  ])
    await assert.rejects(api.mergePullRequest(repo, 12, fields));
  await assert.rejects(api.mergePullRequest("owner/../repo", 12, payload));
  assert.equal(calls.length, 0);
});

test("pull details normalize actual changes, methods, check results, and zero legacy statuses", async () => {
  const { api } = fixture({
    runs: () => ({
      total_count: 3,
      check_runs: [
        {
          name: "Tests",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/check/1",
        },
        { name: "Optional lint", status: "completed", conclusion: "neutral" },
        { name: "Skipped job", status: "completed", conclusion: "skipped" },
      ],
    }),
  });
  const detail = await api.getPullRequest(repo, 12);
  assert.equal(detail.body, rawPull.body);
  assert.equal(detail.headSha, sha);
  assert.equal(detail.base, "main");
  assert.equal(detail.canMerge, true);
  assert.equal(detail.mergeBlockReason, "");
  assert.deepEqual(detail.mergeMethods, ["merge", "squash", "rebase"]);
  assert.deepEqual(detail.checks, [
    { name: "Tests", status: "success", url: "https://github.com/check/1" },
    { name: "Optional lint", status: "none", url: "" },
    { name: "Skipped job", status: "none", url: "" },
  ]);
  assert.equal(detail.checksIncomplete, false);
  assert.deepEqual(
    [detail.additions, detail.deletions, detail.changedFiles, detail.commits],
    [10, 2, 3, 2],
  );
});

test("detail eligibility blocks conflicts, unknown state, draft, closed, permissions, and required rules", async () => {
  const cases = [
    {
      pull: { ...rawPull, merged: true, state: "closed" },
      reason: /already been merged/,
    },
    { pull: { ...rawPull, state: "closed" }, reason: /closed/ },
    { pull: { ...rawPull, draft: true }, reason: /draft/ },
    {
      pull: { ...rawPull, mergeable: false, mergeable_state: "dirty" },
      reason: /conflicts/,
    },
    {
      pull: { ...rawPull, mergeable: null, mergeable_state: "unknown" },
      reason: /Refresh in a moment/,
    },
    {
      pull: { ...rawPull, mergeable_state: "blocked" },
      reason: /requires reviews/,
    },
    {
      pull: { ...rawPull, mergeable_state: "behind" },
      reason: /Update the head/,
    },
    {
      pull: { ...rawPull, mergeable_state: "new-unknown-state" },
      reason: /not confirmed/,
    },
    {
      repository: { ...metadata, permissions: { push: false } },
      reason: /permission/,
    },
    {
      repository: { ...metadata, permissions: undefined },
      reason: /permission/,
    },
    { repository: { ...metadata, archived: true }, reason: /archived/ },
    {
      repository: { permissions: { push: true } },
      reason: /No supported merge method/,
    },
  ];
  for (const { reason, ...options } of cases) {
    const { api, writes } = fixture(options);
    const detail = await api.getPullRequest(repo, 12);
    assert.equal(detail.canMerge, false);
    assert.match(detail.mergeBlockReason, reason);
    await assert.rejects(
      api.mergePullRequest(repo, 12, payload),
      (error) => error.status === 405 && reason.test(error.message),
    );
    assert.equal(writes().length, 0);
  }
});

test("optional failing checks remain visible without overriding GitHub's unstable eligibility", async () => {
  const { api } = fixture({
    pull: { ...rawPull, mergeable_state: "unstable" },
    runs: () => ({
      total_count: 1,
      check_runs: [
        { name: "Optional lint", status: "completed", conclusion: "failure" },
      ],
    }),
  });
  const detail = await api.getPullRequest(repo, 12);
  assert.equal(detail.checks[0].status, "failure");
  assert.equal(detail.canMerge, true);
});

test("checks and legacy statuses follow later pages and expose late failures", async () => {
  const { api, calls } = fixture({
    runs: (page) => ({
      total_count: 101,
      check_runs:
        page === 1
          ? Array.from({ length: 100 }, (_, i) => ({
              name: `Job ${i}`,
              status: "completed",
              conclusion: "success",
            }))
          : [
              {
                name: "Late failed job",
                status: "completed",
                conclusion: "failure",
              },
            ],
    }),
    statuses: (page) => ({
      total_count: 101,
      statuses:
        page === 1
          ? Array.from({ length: 100 }, (_, i) => ({
              context: `Status ${i}`,
              state: "success",
            }))
          : [{ context: "Late failed status", state: "error" }],
    }),
  });
  const detail = await api.getPullRequest(repo, 12);
  assert.equal(detail.checks.length, 202);
  assert.equal(
    detail.checks.filter((item) => item.status === "failure").length,
    2,
  );
  assert.equal(detail.checksIncomplete, false);
  assert.equal(
    calls.filter((call) => call.endpoint.endsWith("page=2")).length,
    2,
  );
});

test("unavailable, malformed, and truncated checks stay incomplete and cannot authorize merging", async () => {
  const cases = [
    {
      runs: () => {
        throw new Error("Private auth diagnostics");
      },
    },
    { runs: () => ({ check_runs: [], total_count: "unknown" }) },
    {
      runs: (page) => ({
        total_count: 1001,
        check_runs: Array.from({ length: 100 }, (_, i) => ({
          name: `Job ${page}-${i}`,
          status: "completed",
          conclusion: "success",
        })),
      }),
    },
    {
      statuses: () => {
        throw new Error("Private auth diagnostics");
      },
    },
  ];
  for (const options of cases) {
    const { api, calls, writes } = fixture(options);
    const detail = await api.getPullRequest(repo, 12);
    assert.equal(detail.checksIncomplete, true);
    assert.equal(detail.canMerge, false);
    assert.match(detail.mergeBlockReason, /could not be loaded.*1,000-result/);
    assert.ok(!JSON.stringify(detail).includes("Private auth"));
    assert.ok(
      calls.filter((call) => call.endpoint.includes("check-runs")).length <= 10,
    );
    await assert.rejects(api.mergePullRequest(repo, 12, payload), {
      status: 405,
    });
    assert.equal(writes().length, 0);
  }
});

test("initial and immediately-before-PUT preflights reject changed head or base without a write", async () => {
  for (const change of [
    { head: { ...rawPull.head, sha: "c".repeat(40) } },
    { base: { ref: "release" } },
  ]) {
    for (const late of [false, true]) {
      const { api, writes } = fixture({
        pull: (read) =>
          !late || read > 1 ? { ...rawPull, ...change } : rawPull,
      });
      await assert.rejects(
        api.mergePullRequest(repo, 12, payload),
        (error) => error.status === 409 && /changed/.test(error.message),
      );
      assert.equal(writes().length, 0);
    }
  }
  const becameDraft = fixture({
    pull: (read) => (read > 1 ? { ...rawPull, draft: true } : rawPull),
  });
  await assert.rejects(becameDraft.api.mergePullRequest(repo, 12, payload), {
    status: 405,
  });
  assert.equal(becameDraft.writes().length, 0);
});

test("merge uses fresh allowed methods, re-reads PR last, pins SHA, and coalesces identical submissions", async () => {
  const { api, calls, writes } = fixture();
  const first = api.mergePullRequest(repo, 12, payload);
  assert.strictEqual(api.mergePullRequest(repo, 12, payload), first);
  await assert.rejects(
    api.mergePullRequest(repo, 12, { ...payload, method: "rebase" }),
    /already in progress/,
  );
  assert.deepEqual(await first, { merged: true, sha: mergedSha });
  assert.equal(writes().length, 1);
  assert.deepEqual(writes()[0], {
    endpoint: `repos/${repo}/pulls/12/merge`,
    options: { method: "PUT", body: { sha, merge_method: "squash" } },
  });
  assert.equal(calls.at(-2).endpoint, `repos/${repo}/pulls/12`);

  const disabled = fixture({
    repository: { ...metadata, allow_squash_merge: false },
  });
  await assert.rejects(
    disabled.api.mergePullRequest(repo, 12, payload),
    /method is no longer available/,
  );
  assert.equal(disabled.writes().length, 0);
});

test("a lost merge response reconciles exact merged head and base by reading once, without replay", async () => {
  const { api, calls, writes } = fixture({
    pull: (read) =>
      read > 2
        ? {
            ...rawPull,
            merged: true,
            state: "closed",
            merge_commit_sha: mergedSha,
          }
        : rawPull,
    put: () => {
      throw new Error("Private timeout detail");
    },
  });
  assert.deepEqual(await api.mergePullRequest(repo, 12, payload), {
    merged: true,
    sha: mergedSha,
  });
  assert.equal(writes().length, 1);
  assert.equal(
    calls.filter((call) => call.endpoint === `repos/${repo}/pulls/12`).length,
    3,
  );
  assert.equal(
    calls.filter((call) => call.endpoint.includes("check-runs")).length,
    1,
  );
});

test("unconfirmed responses never report success for closed-unmerged, changed, or incomplete reconciliation", async () => {
  const reconciliations = [
    { ...rawPull, state: "closed", merged: false },
    {
      ...rawPull,
      state: "closed",
      merged: true,
      merge_commit_sha: mergedSha,
      base: { ref: "release" },
    },
    {
      ...rawPull,
      state: "closed",
      merged: true,
      merge_commit_sha: mergedSha,
      head: { ...rawPull.head, sha: "c".repeat(40) },
    },
    { ...rawPull, state: "closed", merged: true, merge_commit_sha: null },
  ];
  for (const after of reconciliations) {
    const { api, writes } = fixture({
      pull: (read) => (read > 2 ? after : rawPull),
      put: () => ({ merged: false }),
    });
    await assert.rejects(
      api.mergePullRequest(repo, 12, payload),
      /did not confirm the merge.*Refresh/,
    );
    assert.equal(writes().length, 1);
  }
});

test("GitHub rejects merge with sanitized actionable 405, 409, and 422 errors, without automatic retries", async () => {
  for (const status of [405, 409, 422]) {
    const { api, calls, writes } = fixture({
      put: () => {
        throw Object.assign(new Error("Private stderr credential"), { status });
      },
    });
    await assert.rejects(
      api.mergePullRequest(repo, 12, payload),
      (error) =>
        error.status === status &&
        !error.message.includes("Private") &&
        /Refresh/.test(error.message),
    );
    assert.equal(writes().length, 1);
    assert.equal(
      calls.filter((call) => call.endpoint === `repos/${repo}/pulls/12`).length,
      2,
    );
  }
});
