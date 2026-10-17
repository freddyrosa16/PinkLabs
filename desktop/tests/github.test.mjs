import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubService } from "../server/github.mjs";

const person = {
  login: "freddy",
  avatar_url: "https://avatars.githubusercontent.com/u/1",
  html_url: "https://github.com/freddy",
};
const root = {
  full_name: "freddy/PinkLabs",
  name: "PinkLabs",
  owner: person,
  html_url: "https://github.com/freddy/PinkLabs",
  description: "An agent workspace",
  default_branch: "main",
  visibility: "public",
  stargazers_count: 4,
  forks_count: 2,
  updated_at: "2026-10-14T14:00:00Z",
  topics: ["agents"],
  license: { spdx_id: "MIT" },
  homepage: "https://example.com",
};
const notFound = () =>
  Object.assign(new Error("Private diagnostic must not escape"), {
    status: 404,
  });
const fixtures = {
  "repos/freddy/PinkLabs": root,
  "repos/freddy/PinkLabs/pulls?state=open&sort=updated&direction=desc&per_page=100":
    [
      {
        number: 4,
        title: "Add tools",
        html_url: "https://github.com/freddy/PinkLabs/pull/4",
        created_at: "2026-10-14T12:00:00Z",
        user: person,
        draft: true,
        head: { ref: "tools" },
      },
    ],
  "search/issues?q=repo%3Afreddy%2FPinkLabs%20is%3Apr%20is%3Aopen&per_page=1": {
    total_count: 1,
  },
  "repos/freddy/PinkLabs/commits?sha=main&per_page=7": [
    {
      sha: "abc123",
      html_url: "https://github.com/freddy/PinkLabs/commit/abc123",
      author: person,
      commit: {
        message: "First line\n\nDetails",
        author: { name: "Freddy", date: "2026-10-14T00:00:00Z" },
      },
    },
  ],
  "repos/freddy/PinkLabs/languages": { TypeScript: 75, Python: 25 },
  "repos/freddy/PinkLabs/contributors?per_page=12": [person],
  "repos/freddy/PinkLabs/releases?per_page=5": [
    {
      tag_name: "v1",
      name: "First release",
      published_at: "2026-10-13T00:00:00Z",
      html_url: "https://github.com/freddy/PinkLabs/releases/tag/v1",
      draft: false,
    },
  ],
  "repos/freddy/PinkLabs/releases/latest": {
    tag_name: "v1",
    published_at: "2026-10-13T00:00:00Z",
    html_url: "https://github.com/freddy/PinkLabs/releases/tag/v1",
  },
  "repos/freddy/PinkLabs/readme": {
    encoding: "base64",
    content: Buffer.from("# Pink Labs\nHello").toString("base64"),
    html_url: "https://github.com/freddy/PinkLabs/blob/main/README.md",
  },
  "user/starred/freddy/PinkLabs": null,
  "repos/freddy/PinkLabs/stargazers/history?per_page=6": [
    {
      week: Date.parse("2026-10-11T00:00:00Z") / 1000,
      total: 4,
      days: [0, 1, 2, 1, 0, 0, 0],
    },
  ],
  "repos/freddy/PinkLabs/commits/abc123/status": {
    state: "pending",
    total_count: 0,
  },
  "repos/freddy/PinkLabs/commits/abc123/check-runs?filter=latest&per_page=100&page=1":
    {
      total_count: 1,
      check_runs: [{ status: "completed", conclusion: "success" }],
    },
};

function service(overrides = {}) {
  return createGitHubService({
    now: () => new Date("2026-10-15T18:00:00Z"),
    request: async (endpoint) => {
      if (Object.hasOwn(overrides, endpoint)) {
        if (overrides[endpoint] instanceof Error) throw overrides[endpoint];
        return overrides[endpoint];
      }
      if (!Object.hasOwn(fixtures, endpoint))
        throw new Error(`Missing fixture ${endpoint}`);
      return fixtures[endpoint];
    },
  });
}

test("rejects repository paths and command-like input before requesting GitHub", async () => {
  let calls = 0;
  const api = createGitHubService({
    request: async () => {
      calls++;
    },
  });
  for (const invalid of [
    "--hostname",
    "../private",
    "owner/..",
    "owner/repo/extra",
    "owner/repo?x=y",
    "owner/repo;whoami",
    null,
  ]) {
    await assert.rejects(api.getRepository(invalid), /owner\/repository/);
  }
  assert.equal(calls, 0);
});

test("normalizes live endpoint shapes into the frontend contract", async () => {
  const repo = await service().getRepository("freddy/PinkLabs");
  assert.equal(repo.fullName, "freddy/PinkLabs");
  assert.equal(repo.pulls[0].author.login, "freddy");
  assert.equal(repo.pulls[0].draft, true);
  assert.equal(repo.openPrCount, 1);
  assert.equal(repo.commits[0].message, "First line");
  assert.equal(
    repo.ciStatus,
    "success",
    "zero legacy statuses must not override a passing check run",
  );
  assert.equal(repo.languages[0].bytes, 75);
  assert.equal(repo.readme, "# Pink Labs\nHello");
  assert.equal(repo.release.tag, "v1");
  assert.equal(repo.viewerStarred, true);
  assert.equal(repo.starHistory.length, 30);
  assert.deepEqual(
    repo.starHistory.find((day) => day.date === "2026-10-13"),
    { date: "2026-10-13", count: 2 },
  );
  assert.equal(repo.starsThisMonth, 4);
  assert.deepEqual(repo.warnings, []);
  assert.equal(repo.refreshIncomplete, false);
  assert.equal(repo.empty, false);
});

test("only a commits409 proves an empty repository and removes its nonexistent branch", async () => {
  const endpoint = "repos/freddy/PinkLabs/commits?sha=main&per_page=7";
  const empty = await service({
    [endpoint]: Object.assign(new Error("Git Repository is empty"), {
      status: 409,
    }),
  }).getRepository("freddy/PinkLabs");
  assert.equal(empty.empty, true);
  assert.equal(empty.branch, "");
  assert.deepEqual(empty.commits, []);
  assert.equal(empty.refreshIncomplete, false);
  for (const response of [
    [],
    Object.assign(new Error("Could not read commits"), { status: 403 }),
  ]) {
    const unproven = await service({ [endpoint]: response }).getRepository(
      "freddy/PinkLabs",
    );
    assert.equal(unproven.empty, false);
    assert.equal(unproven.branch, "main");
  }
});

test("open PR count includes loaded rows when GitHub search lags and retains larger totals", async () => {
  const countEndpoint =
    "search/issues?q=repo%3Afreddy%2FPinkLabs%20is%3Apr%20is%3Aopen&per_page=1";
  const pullsEndpoint =
    "repos/freddy/PinkLabs/pulls?state=open&sort=updated&direction=desc&per_page=100";
  const lagging = await service({
    [countEndpoint]: { total_count: 0 },
  }).getRepository("freddy/PinkLabs");
  assert.equal(lagging.pulls.length, 1);
  assert.equal(lagging.openPrCount, 1);

  const largerTotal = await service({
    [countEndpoint]: { total_count: 120 },
    [pullsEndpoint]: Array.from({ length: 100 }, (_, i) => ({
      ...fixtures[pullsEndpoint][0],
      number: i + 1,
    })),
  }).getRepository("freddy/PinkLabs");
  assert.equal(largerTotal.pulls.length, 100);
  assert.equal(largerTotal.openPrCount, 120);

  const merged = await service({
    [countEndpoint]: { total_count: 1 },
    [pullsEndpoint]: [],
  }).getRepository("freddy/PinkLabs");
  assert.equal(
    merged.openPrCount,
    0,
    "an empty live list overrides a stale search index after merging",
  );
  const failed = await service({
    [countEndpoint]: { total_count: 1 },
    [pullsEndpoint]: new Error("unavailable"),
  }).getRepository("freddy/PinkLabs");
  assert.equal(
    failed.openPrCount,
    1,
    "a failed list still uses the search total",
  );
});

test("missing optional resources remain absent and failed endpoints produce honest warnings", async () => {
  const unavailable = Object.assign(new Error("secret should not escape"), {
    status: 403,
  });
  const repo = await service({
    "repos/freddy/PinkLabs/readme": notFound(),
    "repos/freddy/PinkLabs/releases/latest": notFound(),
    "user/starred/freddy/PinkLabs": notFound(),
    "repos/freddy/PinkLabs/languages": unavailable,
    "repos/freddy/PinkLabs/stargazers/history?per_page=6": unavailable,
  }).getRepository("freddy/PinkLabs");
  assert.equal(repo.readme, "");
  assert.equal(repo.release, null);
  assert.equal(repo.viewerStarred, false);
  assert.deepEqual(repo.languages, []);
  assert.deepEqual(repo.starHistory, []);
  assert.equal(repo.starsThisMonth, null);
  assert.ok(repo.warnings.some((w) => w.includes("Languages")));
  assert.ok(repo.warnings.some((w) => w.includes("Star history")));
  assert.ok(repo.warnings.every((w) => !w.includes("secret")));
  assert.equal(repo.refreshIncomplete, true);
});

test("expected missing resources do not classify a successful refresh as incomplete", async () => {
  const repo = await service({
    "repos/freddy/PinkLabs/readme": notFound(),
    "repos/freddy/PinkLabs/releases/latest": notFound(),
    "user/starred/freddy/PinkLabs": notFound(),
    "repos/freddy/PinkLabs/commits?sha=main&per_page=7": Object.assign(
      new Error("Empty repository"),
      { status: 409 },
    ),
  }).getRepository("freddy/PinkLabs");
  assert.equal(repo.refreshIncomplete, false);
  assert.deepEqual(repo.warnings, []);
  assert.equal(repo.readme, "");
  assert.equal(repo.release, null);
  assert.equal(repo.viewerStarred, false);
  assert.deepEqual(repo.commits, []);
});

test("truncation and unsupported formats remain informational, rather than network refresh failures", async () => {
  const pullEndpoint =
    "repos/freddy/PinkLabs/pulls?state=open&sort=updated&direction=desc&per_page=100";
  const cases = [
    {
      [pullEndpoint]: Array.from({ length: 100 }, (_, index) => ({
        ...fixtures[pullEndpoint][0],
        number: index + 1,
      })),
      "search/issues?q=repo%3Afreddy%2FPinkLabs%20is%3Apr%20is%3Aopen&per_page=1":
        { total_count: 120 },
    },
    { "repos/freddy/PinkLabs/readme": { encoding: "none", content: "" } },
    {
      "repos/freddy/PinkLabs/stargazers/history?per_page=6": [
        { week: "unsupported", days: [] },
      ],
    },
  ];
  for (const overrides of cases) {
    const repo = await service(overrides).getRepository("freddy/PinkLabs");
    assert.ok(repo.warnings.length > 0);
    assert.equal(
      repo.refreshIncomplete,
      false,
      "informational notices must not slow automatic updates",
    );
  }
});

test("CI considers check failures and distinguishes no CI from pending or passing", async () => {
  const noChecks = { total_count: 0, check_runs: [] };
  const checkEndpoint =
    "repos/freddy/PinkLabs/commits/abc123/check-runs?filter=latest&per_page=100&page=1";
  assert.equal(
    (
      await service({ [checkEndpoint]: noChecks }).getRepository(
        "freddy/PinkLabs",
      )
    ).ciStatus,
    "none",
  );
  assert.equal(
    (
      await service({
        [checkEndpoint]: {
          total_count: 1,
          check_runs: [{ status: "in_progress", conclusion: null }],
        },
      }).getRepository("freddy/PinkLabs")
    ).ciStatus,
    "pending",
  );
  assert.equal(
    (
      await service({
        "repos/freddy/PinkLabs/commits/abc123/status": {
          state: "success",
          total_count: 1,
        },
        [checkEndpoint]: {
          total_count: 1,
          check_runs: [{ status: "completed", conclusion: "failure" }],
        },
      }).getRepository("freddy/PinkLabs")
    ).ciStatus,
    "failure",
  );
});

test("an unavailable CI endpoint cannot claim an overall pass", async () => {
  const repo = await service({
    "repos/freddy/PinkLabs/commits/abc123/status": Object.assign(
      new Error("private"),
      { status: 403 },
    ),
  }).getRepository("freddy/PinkLabs");
  assert.equal(repo.ciStatus, "none");
  assert.ok(repo.warnings.some((w) => w.includes("CI")));
  assert.equal(repo.refreshIncomplete, true);
});

test("CI reads later check-run pages so a failure cannot hide beyond the first hundred", async () => {
  const repo = await service({
    "repos/freddy/PinkLabs/commits/abc123/check-runs?filter=latest&per_page=100&page=1":
      {
        total_count: 101,
        check_runs: Array.from({ length: 100 }, () => ({
          status: "completed",
          conclusion: "success",
        })),
      },
    "repos/freddy/PinkLabs/commits/abc123/check-runs?filter=latest&per_page=100&page=2":
      {
        total_count: 101,
        check_runs: [{ status: "completed", conclusion: "timed_out" }],
      },
  }).getRepository("freddy/PinkLabs");
  assert.equal(repo.ciStatus, "failure");
  assert.equal(
    repo.refreshIncomplete,
    false,
    "a completed failing check is data, not a failed API refresh",
  );
});

test("root failures are sanitized and distinguish missing access from optional failure", async () => {
  await assert.rejects(
    service({ "repos/freddy/PinkLabs": notFound() }).getRepository(
      "freddy/PinkLabs",
    ),
    /not found|access/i,
  );
  await assert.rejects(
    service({
      "repos/freddy/PinkLabs": new Error("ghp_private-token"),
    }).getRepository("freddy/PinkLabs"),
    (error) =>
      !error.message.includes("private-token") && /GitHub/.test(error.message),
  );
});

test("repository picker exposes only the summary contract", async () => {
  const api = createGitHubService({
    request: async () => [
      { ...root, private: false, permissions: { admin: true } },
    ],
  });
  assert.deepEqual(await api.listRepositories(), [
    {
      fullName: "freddy/PinkLabs",
      name: "PinkLabs",
      description: "An agent workspace",
      private: false,
    },
  ]);
});
