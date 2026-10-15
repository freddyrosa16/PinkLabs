import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubService } from "../server/github.mjs";
import { validatePullRequestCommentInput } from "../server/validation.mjs";

const repo = "owner/repo";
const rawPull = {
  number: 12,
  state: "open",
  locked: false,
  head: { sha: "a".repeat(40) },
  base: { ref: "main" },
};
const metadata = {
  archived: false,
  disabled: false,
  permissions: { pull: true, push: false },
};
const person = {
  login: "reader",
  avatar_url: "https://avatars.githubusercontent.com/u/1",
  html_url: "https://github.com/reader",
};
const date = "2026-10-15T18:00:00Z";
const comment = (id = 1, overrides = {}) => ({
  id,
  body: `Comment ${id}`,
  user: person,
  created_at: date,
  updated_at: date,
  html_url: `https://github.com/${repo}/pull/12#issuecomment-${id}`,
  ...overrides,
});
function fixture(options = {}) {
  const calls = [];
  let reads = 0;
  const api = createGitHubService({
    request: async (endpoint, requestOptions) => {
      calls.push({ endpoint, options: requestOptions });
      if (requestOptions?.method === "POST")
        return options.post
          ? options.post(requestOptions)
          : comment(99, { body: requestOptions.body.body });
      if (endpoint === `repos/${repo}/pulls/12`) {
        reads++;
        if (options.pull instanceof Error) throw options.pull;
        return typeof options.pull === "function"
          ? options.pull(reads)
          : (options.pull ?? rawPull);
      }
      if (endpoint === `repos/${repo}`) return options.metadata ?? metadata;
      const kind = endpoint.includes("/issues/")
        ? "comment"
        : endpoint.includes("/reviews?")
          ? "review"
          : "inline";
      const source = options[kind];
      if (source instanceof Error) throw source;
      return typeof source === "function" ? source(endpoint) : (source ?? []);
    },
  });
  return {
    api,
    calls,
    writes: () => calls.filter((call) => call.options?.method === "POST"),
  };
}

test("comment validation rejects blank, too long, wrong-type, and extra fields but preserves intentional whitespace", async () => {
  const body = "  Indented text\n\nline break  \n";
  assert.deepEqual(validatePullRequestCommentInput({ body }), { body });
  assert.equal(
    validatePullRequestCommentInput({ body: "x".repeat(65_536) }).body.length,
    65_536,
  );
  const { api, calls } = fixture();
  for (const input of [
    null,
    [],
    {},
    { body: " \n\t" },
    { body: null },
    { body: 1 },
    { body: "x".repeat(65_537) },
    { body: "Text", issue: 13 },
  ])
    await assert.rejects(api.createPullRequestComment(repo, 12, input), {
      status: 400,
    });
  await assert.rejects(
    api.createPullRequestComment("owner/../repo", 12, { body }),
  );
  await assert.rejects(api.createPullRequestComment(repo, "12", { body }));
  await assert.rejects(api.getPullRequestComments(repo, 0));
  assert.equal(calls.length, 0);
});

test("conversation combines general comments, submitted reviews, and inline context in deterministic chronological order", async () => {
  const { api } = fixture({
    comment: [
      comment(2),
      comment(1),
      comment(3, { created_at: "2026-10-15T19:00:00Z" }),
    ],
    review: [
      {
        id: 1,
        state: "APPROVED",
        body: "",
        user: person,
        submitted_at: date,
        html_url: "https://github.com/review/1",
      },
      {
        id: 2,
        state: "CHANGES_REQUESTED",
        body: "Please adjust this.",
        user: person,
        submitted_at: "2026-10-15T17:00:00Z",
      },
      {
        id: 3,
        state: "PENDING",
        body: "Private draft",
        user: person,
        submitted_at: null,
      },
    ],
    inline: [
      comment(1, {
        path: "src/main.ts",
        line: 22,
        in_reply_to_id: 80,
        pull_request_review_id: 1,
      }),
      comment(2, {
        path: "old.ts",
        line: null,
        original_line: 10,
        pull_request_review_id: 2,
      }),
      comment(3, { body: "Pending review draft", pull_request_review_id: 3 }),
    ],
  });
  const result = await api.getPullRequestComments(repo, 12);
  assert.deepEqual(
    result.comments.map((item) => item.id),
    [
      "review:2",
      "comment:1",
      "comment:2",
      "review:1",
      "inline:1",
      "inline:2",
      "comment:3",
    ],
  );
  const approval = result.comments.find((item) => item.id === "review:1");
  assert.equal(approval.body, "");
  assert.equal(approval.reviewState, "APPROVED");
  assert.equal(approval.updatedAt, date);
  const inline = result.comments.find((item) => item.id === "inline:1");
  assert.deepEqual(
    [inline.path, inline.line, inline.replyTo],
    ["src/main.ts", 22, 80],
  );
  assert.equal(
    result.comments.find((item) => item.id === "inline:2").line,
    null,
    "an outdated original line must not be presented as a current-file line",
  );
  assert.deepEqual(inline.author, {
    login: "reader",
    avatar: person.avatar_url,
    url: person.html_url,
  });
  assert.equal(result.truncated, false);
  assert.equal(
    result.canComment,
    true,
    "public readers do not need push permission",
  );
  assert.equal(result.commentBlockReason, "");
  assert.ok(!JSON.stringify(result).includes("Private draft"));
});

test("all three conversation sources paginate and mark only genuinely omitted records as truncated", async () => {
  for (const overflow of [false, true]) {
    const source = (kind) => (endpoint) => {
      const params = new URL(`https://api.github.com/${endpoint}`).searchParams;
      const page = Number(params.get("page"));
      if (params.get("per_page") === "1") return overflow ? [comment(301)] : [];
      return Array.from({ length: 100 }, (_, i) =>
        kind === "review"
          ? {
              id: (page - 1) * 100 + i + 1,
              state: "COMMENTED",
              submitted_at: date,
            }
          : comment((page - 1) * 100 + i + 1),
      );
    };
    const { api, calls } = fixture({
      comment: source("comment"),
      review: source("review"),
      inline: source("inline"),
    });
    const result = await api.getPullRequestComments(repo, 12);
    assert.equal(result.comments.length, 900);
    assert.equal(result.truncated, overflow);
    assert.equal(
      calls.filter((call) => call.endpoint.includes("per_page")).length,
      12,
    );
  }
});

test("conversation failure is explicit instead of returning a deceptively empty or complete timeline", async () => {
  const missing = Object.assign(new Error("Private auth output"), {
    status: 404,
  });
  const absent = fixture({ pull: missing });
  await assert.rejects(
    absent.api.getPullRequestComments(repo, 12),
    (error) => error.status === 404 && !error.message.includes("Private"),
  );
  assert.equal(
    absent.calls.filter((call) => call.endpoint.includes("per_page")).length,
    0,
  );
  for (const options of [
    { review: new Error("Private auth output") },
    { inline: { items: [] } },
    { comment: [comment(1, { created_at: "not-a-date" })] },
  ]) {
    await assert.rejects(
      fixture(options).api.getPullRequestComments(repo, 12),
      (error) =>
        /Could not load/.test(error.message) &&
        !error.message.includes("Private"),
    );
  }
});

test("archived, disabled, unknown, and locked conversations explain restrictions without blocking a normal reader", async () => {
  const cases = [
    {
      metadata: { ...metadata, archived: true },
      reason: /archived or disabled/,
    },
    {
      metadata: { ...metadata, disabled: true },
      reason: /archived or disabled/,
    },
    { metadata: {}, reason: /could not be verified/ },
    { pull: { ...rawPull, locked: true }, reason: /conversation is locked/ },
  ];
  for (const { reason, ...options } of cases) {
    const { api, writes } = fixture(options);
    const result = await api.getPullRequestComments(repo, 12);
    assert.equal(result.canComment, false);
    assert.match(result.commentBlockReason, reason);
    await assert.rejects(
      api.createPullRequestComment(repo, 12, { body: "Hello" }),
      (error) => error.status === 403 && reason.test(error.message),
    );
    assert.equal(writes().length, 0);
  }
  const maintainer = fixture({
    pull: { ...rawPull, locked: true },
    metadata: { ...metadata, permissions: { push: true } },
  });
  assert.equal(
    (await maintainer.api.getPullRequestComments(repo, 12)).canComment,
    true,
  );
  const merged = fixture({
    pull: { ...rawPull, state: "closed", merged: true },
  });
  assert.equal(
    (await merged.api.getPullRequestComments(repo, 12)).canComment,
    true,
  );
});

test("comment posting rechecks PR restrictions and rejects a lock added after conversation loading", async () => {
  const { api, writes } = fixture({
    pull: (read) => ({ ...rawPull, locked: read > 1 }),
  });
  assert.equal((await api.getPullRequestComments(repo, 12)).canComment, true);
  await assert.rejects(
    api.createPullRequestComment(repo, 12, { body: "Hello" }),
    { status: 403 },
  );
  assert.equal(writes().length, 0);
});

test("posting sends one structured exact body, coalesces simultaneous duplicates, and normalizes the created comment", async () => {
  const body = "  Review notes\n\nLiteral `$(example)` stays text.  \n";
  const { api, writes } = fixture();
  const first = api.createPullRequestComment(repo, 12, { body });
  assert.strictEqual(api.createPullRequestComment(repo, 12, { body }), first);
  const result = await first;
  assert.equal(result.id, "comment:99");
  assert.equal(result.kind, "comment");
  assert.equal(result.body, body);
  assert.deepEqual(writes(), [
    {
      endpoint: `repos/${repo}/issues/12/comments`,
      options: { method: "POST", body: { body } },
    },
  ]);
  await api.createPullRequestComment(repo, 12, { body });
  assert.equal(
    writes().length,
    2,
    "a later intentional repeated comment is a separate request",
  );
});

test("ambiguous comment responses never retry or claim success from matching text", async () => {
  for (const post of [
    () => {
      throw new Error("Private timeout diagnostic");
    },
    () => ({}),
    () => comment(99, { created_at: null }),
  ]) {
    const { api, calls, writes } = fixture({
      post,
      comment: [comment(99, { body: "Hello" })],
    });
    await assert.rejects(
      api.createPullRequestComment(repo, 12, { body: "Hello" }),
      (error) =>
        /check the comments before retrying/.test(error.message) &&
        !error.message.includes("Private"),
    );
    assert.equal(writes().length, 1);
    assert.equal(
      calls.filter((call) => call.endpoint.includes("per_page")).length,
      0,
    );
  }
});

test("known posting failures preserve useful statuses and sanitize CLI output", async () => {
  for (const status of [401, 403, 404, 422, 429]) {
    const { api, writes } = fixture({
      post: () => {
        throw Object.assign(new Error("Private token stderr"), { status });
      },
    });
    await assert.rejects(
      api.createPullRequestComment(repo, 12, { body: "Hello" }),
      (error) => error.status === status && !error.message.includes("Private"),
    );
    assert.equal(writes().length, 1);
  }
});
