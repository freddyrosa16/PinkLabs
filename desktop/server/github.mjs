import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRepositoryService } from "./repository-creation.mjs";
import {
  validateComparisonInput,
  validatePullRequestInput,
  validatePullRequestNumber,
  validateMergeInput,
  validateBranchName,
  validateCommitSHA,
  validatePullRequestState,
  validateDeleteBranchInput,
  validatePullRequestCommentInput,
} from "./validation.mjs";

const run = promisify(execFile);
const API_VERSION = "2026-03-10";
const DAY = 86_400_000;
const COLORS = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  HTML: "#e34c26",
  CSS: "#663399",
  SCSS: "#c6538c",
  Rust: "#dea584",
  Go: "#00add8",
  Java: "#b07219",
  Swift: "#f05138",
  Kotlin: "#a97bff",
  Ruby: "#701516",
  Shell: "#89e051",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  PHP: "#4f5d95",
  Dart: "#00b4ab",
  Jupyter: "#da5b0b",
  "Jupyter Notebook": "#da5b0b",
};

export function validateRepository(fullName) {
  if (typeof fullName !== "string")
    throw new Error("Use a GitHub repository in owner/repository format.");
  const value = fullName.trim();
  const [owner, repo, extra] = value.split("/");
  if (
    extra !== undefined ||
    !/^[a-z\d][a-z\d-]{0,38}$/i.test(owner ?? "") ||
    !/^[a-z\d_.-]{1,100}$/i.test(repo ?? "") ||
    repo === "." ||
    repo === ".."
  ) {
    throw new Error("Use a GitHub repository in owner/repository format.");
  }
  return value;
}

function publicError(error, context = "GitHub data") {
  let message;
  if (error?.status === 401)
    message =
      "GitHub authentication expired. Sign in again with gh auth login.";
  else if (error?.status === 403 || error?.status === 429)
    message = `${context} is unavailable: access is restricted or the GitHub rate limit was reached.`;
  else if (error?.status === 404)
    message =
      "Repository not found, or your GitHub account does not have access.";
  else if (error?.code === "ENOENT")
    message =
      "GitHub CLI is unavailable. Install gh and sign in with gh auth login.";
  else if (error?.killed || error?.code === "ETIMEDOUT")
    message = "GitHub took too long to respond. Try refreshing.";
  else
    message = `Could not load ${context}. Check your connection and gh auth status, then try again.`;
  return Object.assign(new Error(message), { status: error?.status });
}

// All CLI arguments are passed directly, never interpreted by a shell. Authentication
// stays in gh; its stdout/stderr and credentials never reach the renderer as errors.
export function createGitHubRequest({ execute = run } = {}) {
  return async function ghRequest(endpoint, { method = "GET", body } = {}) {
    try {
      const args = [
        "api",
        "--hostname",
        "github.com",
        "--method",
        method,
        endpoint,
        "--header",
        "Accept: application/vnd.github+json",
        "--header",
        `X-GitHub-Api-Version: ${API_VERSION}`,
      ];
      if (body !== undefined) args.push("--input", "-");
      const operation = execute("gh", args, {
        timeout: 25_000,
        maxBuffer: 12 * 1024 * 1024,
        windowsHide: true,
      });
      if (body !== undefined) {
        // User-authored titles/descriptions are JSON on stdin, never CLI flags or shell text.
        operation.child.stdin.on("error", () => {});
        operation.child.stdin.end(JSON.stringify(body));
      }
      const { stdout } = await operation;
      return stdout.trim() ? JSON.parse(stdout) : null;
    } catch (error) {
      const status =
        Number(String(error.stderr ?? "").match(/\bHTTP (\d{3})\b/)?.[1]) ||
        undefined;
      throw Object.assign(new Error("GitHub request failed"), {
        status,
        code: error.code,
        killed: error.killed,
      });
    }
  };
}
const ghRequest = createGitHubRequest();

const person = (value, fallback = "Unknown") => ({
  login: value?.login || fallback,
  avatar: value?.avatar_url || "",
  url: value?.html_url || "",
});
const release = (value) =>
  value
    ? {
        tag: value.tag_name || "",
        date: value.published_at || value.created_at || "",
        url: value.html_url || "",
      }
    : null;
const array = (value) => (Array.isArray(value) ? value : []);
const isSHA = (value) =>
  typeof value === "string" && /^[a-f\d]{40}$/i.test(value);
const actionError = (message, status = 409) =>
  Object.assign(new Error(message), { status });
const pullRequest = (pull) => ({
  number: pull.number,
  title: pull.title || "",
  url: pull.html_url || "",
  date: pull.created_at || "",
  author: person(pull.user),
  draft: Boolean(pull.draft),
  branch: pull.head?.ref || "",
});

function pullComment(value, kind) {
  const date = kind === "review" ? value?.submitted_at : value?.created_at;
  if (
    !Number.isSafeInteger(value?.id) ||
    value.id <= 0 ||
    typeof date !== "string" ||
    !Number.isFinite(Date.parse(date)) ||
    (kind === "review" && (typeof value.state !== "string" || !value.state))
  )
    throw new Error("Incomplete conversation response");
  const result = {
    id: `${kind}:${value.id}`,
    kind,
    body: typeof value.body === "string" ? value.body : "",
    author: person(value.user),
    date,
    updatedAt: typeof value.updated_at === "string" ? value.updated_at : date,
    url: value.html_url || "",
  };
  if (kind === "review") result.reviewState = value.state.toUpperCase();
  if (kind === "inline") {
    result.path = typeof value.path === "string" ? value.path : "";
    // Outdated comments can have no current line. Do not relabel original_line
    // as a line in the current file; the GitHub URL retains that older context.
    result.line =
      Number.isSafeInteger(value.line) && value.line > 0 ? value.line : null;
    result.replyTo =
      Number.isSafeInteger(value.in_reply_to_id) && value.in_reply_to_id > 0
        ? value.in_reply_to_id
        : null;
  }
  return result;
}

function mergeStatuses(statuses) {
  if (statuses.includes("failure")) return "failure";
  if (statuses.includes("pending")) return "pending";
  if (statuses.includes("success")) return "success";
  return "none";
}

function checkStatus(check) {
  if (check.status !== "completed") return "pending";
  if (check.conclusion === "success") return "success";
  if (["neutral", "skipped"].includes(check.conclusion)) return "none";
  return check.conclusion ? "failure" : "pending";
}

function starSeries(weeks, today) {
  const daily = new Map();
  for (const week of weeks) {
    if (!Number.isFinite(week.week) || !Array.isArray(week.days))
      throw new Error("Unexpected star history");
    week.days.slice(0, 7).forEach((count, index) => {
      if (!Number.isFinite(count) || count < 0)
        throw new Error("Unexpected star count");
      daily.set(
        new Date(week.week * 1000 + index * DAY).toISOString().slice(0, 10),
        count,
      );
    });
  }
  const midnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const starHistory = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(midnight - (29 - i) * DAY).toISOString().slice(0, 10);
    return { date, count: daily.get(date) ?? 0 };
  });
  const month = today.toISOString().slice(0, 7);
  const lastDate = today.toISOString().slice(0, 10);
  const starsThisMonth = [...daily].reduce(
    (sum, [date, count]) =>
      sum + (date.startsWith(month) && date <= lastDate ? count : 0),
    0,
  );
  return { starHistory, starsThisMonth };
}

export function createGitHubService({
  request = ghRequest,
  now = () => new Date(),
} = {}) {
  const creatingPulls = new Map();
  const mergingPulls = new Map();
  const deletingBranches = new Map();
  const creatingComments = new Map();

  async function readPull(fullName, number) {
    const pull = await request(`repos/${fullName}/pulls/${number}`);
    if (
      pull?.number !== number ||
      !["open", "closed"].includes(pull.state) ||
      !isSHA(pull.head?.sha) ||
      typeof pull.base?.ref !== "string"
    )
      throw new Error("Incomplete pull request response");
    return pull;
  }

  async function conversationAccess(fullName, number) {
    const [pull, metadata] = await Promise.all([
      readPull(fullName, number),
      request(`repos/${fullName}`),
    ]);
    let commentBlockReason = "";
    if (
      typeof metadata?.archived !== "boolean" ||
      typeof pull.locked !== "boolean"
    )
      commentBlockReason =
        "Comment permissions could not be verified. Refresh before posting.";
    else if (metadata.archived || metadata.disabled)
      commentBlockReason =
        "This repository is archived or disabled, so new comments cannot be posted.";
    else if (pull.locked && metadata?.permissions?.push !== true)
      commentBlockReason =
        "This conversation is locked. Pink Labs could not verify permission to comment on it; open GitHub to check your access.";
    // Readable public PRs do not require push permission to comment. GitHub also
    // checks token scopes and interaction restrictions when the comment is sent.
    return { canComment: !commentBlockReason, commentBlockReason };
  }

  async function conversationPageSet(endpoint) {
    const rows = [];
    const separator = endpoint.includes("?") ? "&" : "?";
    for (let page = 1; page <= 3; page++) {
      const batch = await request(
        `${endpoint}${separator}per_page=100&page=${page}`,
      );
      if (!Array.isArray(batch) || batch.length > 100)
        throw new Error("Incomplete conversation page");
      rows.push(...batch);
      if (batch.length < 100) return { rows, truncated: false };
    }
    // Probe one item beyond the 300-record bound without fetching another full page.
    const extra = await request(`${endpoint}${separator}per_page=1&page=301`);
    if (!Array.isArray(extra))
      throw new Error("Incomplete conversation pagination");
    return { rows, truncated: extra.length > 0 };
  }

  async function getPullRequestComments(input, value) {
    const fullName = validateRepository(input);
    const number = validatePullRequestNumber(value);
    try {
      const access = await conversationAccess(fullName, number);
      const [general, reviews, inline] = await Promise.all([
        conversationPageSet(`repos/${fullName}/issues/${number}/comments`),
        conversationPageSet(`repos/${fullName}/pulls/${number}/reviews`),
        conversationPageSet(
          `repos/${fullName}/pulls/${number}/comments?sort=created&direction=asc`,
        ),
      ]);
      const pendingReviews = new Set(
        reviews.rows
          .filter((row) => String(row?.state).toUpperCase() === "PENDING")
          .map((row) => row.id),
      );
      const comments = [
        ...general.rows.map((row) => pullComment(row, "comment")),
        ...reviews.rows
          .filter((row) => String(row?.state).toUpperCase() !== "PENDING")
          .map((row) => pullComment(row, "review")),
        ...inline.rows
          .filter((row) => !pendingReviews.has(row?.pull_request_review_id))
          .map((row) => pullComment(row, "inline")),
      ];
      const order = { comment: 0, review: 1, inline: 2 };
      const unique = [
        ...new Map(comments.map((comment) => [comment.id, comment])).values(),
      ];
      unique.sort(
        (a, b) =>
          Date.parse(a.date) - Date.parse(b.date) ||
          order[a.kind] - order[b.kind] ||
          Number(a.id.split(":")[1]) - Number(b.id.split(":")[1]),
      );
      return {
        comments: unique,
        truncated: general.truncated || reviews.truncated || inline.truncated,
        ...access,
      };
    } catch (error) {
      throw publicError(error, "GitHub pull request conversation");
    }
  }

  function createPullRequestComment(input, value, fields) {
    let fullName, number, payload;
    try {
      fullName = validateRepository(input);
      number = validatePullRequestNumber(value);
      payload = validatePullRequestCommentInput(fields);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = JSON.stringify([fullName.toLowerCase(), number, payload.body]);
    if (creatingComments.has(key)) return creatingComments.get(key);
    const operation = (async () => {
      let access;
      try {
        access = await conversationAccess(fullName, number);
      } catch (error) {
        throw publicError(error, "GitHub comment permissions");
      }
      if (!access.canComment) throw actionError(access.commentBlockReason, 403);
      try {
        const created = await request(
          `repos/${fullName}/issues/${number}/comments`,
          { method: "POST", body: payload },
        );
        return pullComment(created, "comment");
      } catch (error) {
        if ([401, 403, 404, 429].includes(error.status))
          throw publicError(error, "Comment posting");
        if (error.status === 422)
          throw actionError(
            "GitHub rejected this comment. Check its content, your permissions, and posting limits before trying again.",
            422,
          );
        // No automatic write retry or body-based reconciliation: identical text
        // may be intentional, so it cannot prove that this particular POST succeeded.
        throw new Error(
          "GitHub did not confirm the comment. Refresh and check the comments before retrying; it may already have been posted.",
        );
      }
    })().finally(() => creatingComments.delete(key));
    creatingComments.set(key, operation);
    return operation;
  }

  async function listPullRequests(input, value = "all") {
    const fullName = validateRepository(input);
    const state = validatePullRequestState(value);
    const path = `repos/${fullName}/pulls?state=${state}&sort=updated&direction=desc`;
    try {
      const rows = await request(`${path}&per_page=100&page=1`);
      if (
        !Array.isArray(rows) ||
        rows.some(
          (pull) =>
            !["open", "closed"].includes(pull?.state) ||
            !Number.isSafeInteger(pull?.number),
        )
      )
        throw new Error("Incomplete pull request list");
      let truncated = false;
      if (rows.length === 100) {
        // With per_page=1, page 101 is the first result beyond the returned hundred.
        const extra = await request(`${path}&per_page=1&page=101`);
        if (!Array.isArray(extra))
          throw new Error("Incomplete pagination response");
        truncated = extra.length > 0;
      }
      return {
        pulls: rows.slice(0, 100).map((pull) => ({
          ...pullRequest(pull),
          state: pull.state,
          merged:
            pull.merged === true ||
            (typeof pull.merged_at === "string" && pull.merged_at.length > 0),
        })),
        truncated: truncated || rows.length > 100,
      };
    } catch (error) {
      throw publicError(error, "GitHub pull request history");
    }
  }

  async function getPullRequestFiles(input, value, expectedSha) {
    const fullName = validateRepository(input);
    const number = validatePullRequestNumber(value);
    const sha = validateCommitSHA(expectedSha);
    try {
      const before = await readPull(fullName, number);
      if (before.head.sha.toLowerCase() !== sha)
        throw Object.assign(
          actionError(
            "This pull request changed. Refresh its details before reading the files.",
          ),
          { userSafe: true },
        );
      const files = [];
      let truncated = false,
        patchBytes = 0;
      for (let page = 1; page <= 10; page++) {
        const batch = await request(
          `repos/${fullName}/pulls/${number}/files?per_page=100&page=${page}`,
        );
        if (!Array.isArray(batch)) throw new Error("Incomplete files response");
        for (const file of batch.slice(0, 100)) {
          if (
            typeof file?.filename !== "string" ||
            typeof file.status !== "string" ||
            [file.additions, file.deletions, file.changes].some(
              (count) => !Number.isSafeInteger(count) || count < 0,
            )
          )
            throw new Error("Incomplete file response");
          let patch =
            typeof file.patch === "string" && file.patch ? file.patch : null;
          if (patch !== null) {
            const bytes = Buffer.byteLength(patch, "utf8");
            if (bytes > 256 * 1024 || patchBytes + bytes > 2 * 1024 * 1024) {
              patch = null;
              truncated = true;
            } else {
              patchBytes += bytes;
              // GitHub may return only part of a large text patch. Keep that text,
              // but flag the response if its changed lines do not match file totals.
              const lines = patch.split("\n");
              if (
                lines.filter((line) => line.startsWith("+")).length !==
                  file.additions ||
                lines.filter((line) => line.startsWith("-")).length !==
                  file.deletions
              )
                truncated = true;
            }
          }
          files.push({
            filename: file.filename,
            previousFilename:
              typeof file.previous_filename === "string"
                ? file.previous_filename
                : null,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch,
            url: file.blob_url || file.contents_url || "",
          });
        }
        if (batch.length < 100) break;
        if (
          page === 10 &&
          (!Number.isSafeInteger(before.changed_files) ||
            before.changed_files > files.length)
        )
          truncated = true;
      }
      const after = await readPull(fullName, number);
      if (
        after.head.sha.toLowerCase() !== sha ||
        after.base.ref !== before.base.ref ||
        after.base.sha !== before.base.sha
      )
        throw Object.assign(
          actionError(
            "This pull request changed while its files were loading. Refresh and review the latest version.",
          ),
          { userSafe: true },
        );
      if (
        Number.isSafeInteger(after.changed_files) &&
        after.changed_files > files.length
      )
        truncated = true;
      return { headSha: sha, files, truncated };
    } catch (error) {
      if (error.userSafe) throw error;
      throw publicError(error, "GitHub pull request files");
    }
  }

  function cleanupBasics(fullName, pull, metadata) {
    const branch = typeof pull.head?.ref === "string" ? pull.head.ref : "";
    const sha = isSHA(pull.head?.sha) ? pull.head.sha.toLowerCase() : "";
    let reason = "";
    if (pull.merged !== true || pull.state !== "closed")
      reason = "Only a merged pull request's branch can be deleted.";
    else if (
      pull.head?.repo?.full_name?.toLowerCase() !== fullName.toLowerCase()
    )
      reason = "Branches from another repository cannot be deleted here.";
    else if (!metadata?.default_branch)
      reason =
        "The repository's default branch could not be verified. Refresh before deleting.";
    else if (branch === metadata.default_branch || branch === pull.base.ref)
      reason = "The default or destination branch cannot be deleted.";
    else if (metadata.permissions?.push !== true)
      reason =
        "Your GitHub account does not have permission to delete this branch.";
    else if (metadata.archived || metadata.disabled)
      reason = "This repository is archived or disabled.";
    else {
      try {
        validateBranchName(branch);
        validateCommitSHA(sha);
      } catch {
        reason =
          "The branch or its commit could not be verified. Refresh before deleting.";
      }
    }
    return { branch, sha, canDelete: false, deleted: false, reason };
  }

  async function readBranch(fullName, branch) {
    const value = await request(
      `repos/${fullName}/branches/${encodeURIComponent(branch)}`,
    );
    if (
      value?.name !== branch ||
      !isSHA(value.commit?.sha) ||
      typeof value.protected !== "boolean"
    )
      throw new Error("Incomplete branch response");
    return value;
  }

  async function branchUsedByOpenPull(fullName, branch) {
    const owner = fullName.split("/")[0];
    const results = await Promise.all([
      request(
        `repos/${fullName}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`,
      ),
      request(
        `repos/${fullName}/pulls?state=open&base=${encodeURIComponent(branch)}&per_page=1`,
      ),
    ]);
    if (results.some((rows) => !Array.isArray(rows)))
      throw new Error("Incomplete open pull response");
    return results.some((rows) => rows.length > 0);
  }

  async function branchCleanup(fullName, pull, metadata) {
    const result = cleanupBasics(fullName, pull, metadata);
    if (result.reason) return result;
    try {
      let branch;
      try {
        branch = await readBranch(fullName, result.branch);
      } catch (error) {
        if (error.status === 404)
          return {
            ...result,
            deleted: true,
            reason: "This branch has already been deleted.",
          };
        throw error;
      }
      if (branch.protected)
        return {
          ...result,
          reason: "This branch is protected and cannot be deleted here.",
        };
      if (branch.commit.sha.toLowerCase() !== result.sha)
        return {
          ...result,
          reason:
            "This branch has new or different commits. Its current work must be reviewed before deletion.",
        };
      if (await branchUsedByOpenPull(fullName, result.branch))
        return {
          ...result,
          reason:
            "This branch is used by an open pull request and cannot be deleted.",
        };
      return { ...result, canDelete: true };
    } catch {
      // Cleanup is optional: unavailable branch metadata must not break PR details or merging.
      return {
        ...result,
        reason:
          "Branch cleanup could not be verified. Refresh before deleting.",
      };
    }
  }

  function deletePullRequestBranch(input, value, fields) {
    let fullName, number, payload;
    try {
      fullName = validateRepository(input);
      number = validatePullRequestNumber(value);
      payload = validateDeleteBranchInput(fields);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = `${fullName.toLowerCase()}#${payload.branch}`;
    const signature = JSON.stringify([number, payload]);
    const running = deletingBranches.get(key);
    if (running)
      return running.signature === signature
        ? running.promise
        : Promise.reject(
            actionError(
              "Branch deletion is already in progress. Wait, then refresh.",
            ),
          );
    const promise = (async () => {
      let pull, metadata;
      try {
        [pull, metadata] = await Promise.all([
          readPull(fullName, number),
          request(`repos/${fullName}`),
        ]);
      } catch (error) {
        throw publicError(error, "GitHub branch cleanup");
      }
      const cleanup = await branchCleanup(fullName, pull, metadata);
      if (cleanup.branch !== payload.branch || cleanup.sha !== payload.sha)
        throw actionError(
          "The pull request branch or commit changed. Refresh and review it before deleting.",
        );
      if (cleanup.deleted) return { deleted: true, branch: payload.branch };
      if (!cleanup.canDelete) throw actionError(cleanup.reason, 405);
      // Recheck all mutable conditions. DELETE refs has no atomic expected-SHA
      // parameter, so a remote push in the final network gap cannot be ruled out.
      let finalPull, finalMetadata, used;
      try {
        [finalPull, finalMetadata, used] = await Promise.all([
          readPull(fullName, number),
          request(`repos/${fullName}`),
          branchUsedByOpenPull(fullName, payload.branch),
        ]);
      } catch (error) {
        throw publicError(error, "GitHub branch deletion preflight");
      }
      const final = cleanupBasics(fullName, finalPull, finalMetadata);
      if (
        final.reason ||
        final.branch !== payload.branch ||
        final.sha !== payload.sha ||
        used
      )
        throw actionError(
          final.reason ||
            "This branch changed or is used by an open pull request. Refresh before deleting.",
        );
      let branch;
      try {
        branch = await readBranch(fullName, payload.branch);
      } catch (error) {
        throw publicError(error, "GitHub branch deletion preflight");
      }
      if (branch.protected || branch.commit.sha.toLowerCase() !== payload.sha)
        throw actionError(
          "This branch is now protected or has different commits. Refresh before deleting.",
        );
      try {
        const result = await request(
          `repos/${fullName}/git/refs/heads/${encodeURIComponent(payload.branch)}`,
          { method: "DELETE" },
        );
        if (result !== null) throw new Error("Unexpected deletion response");
        return { deleted: true, branch: payload.branch };
      } catch (error) {
        if (!error.status || error.status >= 500 || error.status === 404) {
          try {
            // Verify repository access before interpreting a missing branch as success.
            await request(`repos/${fullName}`);
            try {
              await readBranch(fullName, payload.branch);
            } catch (missing) {
              if (missing.status === 404)
                return { deleted: true, branch: payload.branch };
            }
          } catch {
            /* Keep the outcome unconfirmed; never automatically repeat DELETE. */
          }
        }
        if ([405, 409, 422].includes(error.status))
          throw actionError(
            "GitHub blocked branch deletion. Refresh to check branch protection, repository rules, and newer commits.",
            error.status,
          );
        if ([401, 403, 429].includes(error.status))
          throw publicError(error, "Branch deletion");
        throw new Error(
          "GitHub did not confirm branch deletion. Refresh before retrying; the branch may already be deleted.",
        );
      }
    })().finally(() => deletingBranches.delete(key));
    deletingBranches.set(key, { signature, promise });
    return promise;
  }

  async function pullChecks(fullName, sha) {
    async function collect(kind) {
      const checks = [];
      let expected = 0;
      try {
        for (let page = 1; page <= 10; page++) {
          const endpoint =
            kind === "runs"
              ? `repos/${fullName}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`
              : `repos/${fullName}/commits/${sha}/status?per_page=100&page=${page}`;
          const result = await request(endpoint);
          const batch = kind === "runs" ? result?.check_runs : result?.statuses;
          if (
            !Array.isArray(batch) ||
            !Number.isSafeInteger(result?.total_count) ||
            result.total_count < 0
          )
            throw new Error("Incomplete check response");
          expected = Math.max(expected, result.total_count);
          checks.push(
            ...batch.map((item) =>
              kind === "runs"
                ? {
                    name: item.name || "Unnamed check",
                    status: checkStatus(item),
                    url: item.html_url || item.details_url || "",
                  }
                : {
                    name: item.context || "Commit status",
                    status:
                      item.state === "success"
                        ? "success"
                        : ["failure", "error"].includes(item.state)
                          ? "failure"
                          : "pending",
                    url: item.target_url || "",
                  },
            ),
          );
          if (checks.length >= expected) return { checks, incomplete: false };
          if (batch.length < 100) break;
        }
      } catch {
        // Preserve the checks we did load, but never present partial data as complete.
      }
      return { checks, incomplete: true };
    }
    const [runs, statuses] = await Promise.all([
      collect("runs"),
      collect("statuses"),
    ]);
    return {
      checks: [...runs.checks, ...statuses.checks],
      checksIncomplete: runs.incomplete || statuses.incomplete,
    };
  }

  async function getPullRequest(input, value) {
    const fullName = validateRepository(input);
    const number = validatePullRequestNumber(value);
    let pull, metadata;
    try {
      [pull, metadata] = await Promise.all([
        readPull(fullName, number),
        request(`repos/${fullName}`),
      ]);
    } catch (error) {
      throw publicError(error, "GitHub pull request details");
    }
    const headSha = pull.head.sha.toLowerCase();
    const [{ checks, checksIncomplete }, cleanup] = await Promise.all([
      pullChecks(fullName, headSha),
      branchCleanup(fullName, pull, metadata),
    ]);
    const mergeable =
      typeof pull.mergeable === "boolean" ? pull.mergeable : null;
    const mergeState =
      typeof pull.mergeable_state === "string"
        ? pull.mergeable_state.toLowerCase()
        : "unknown";
    const mergeMethods = ["merge", "squash", "rebase"].filter(
      (method) =>
        metadata?.[
          method === "merge" ? "allow_merge_commit" : `allow_${method}_merge`
        ] === true &&
        (method !== "rebase" || pull.rebaseable !== false),
    );
    let mergeBlockReason = "";
    if (pull.merged)
      mergeBlockReason = "This pull request has already been merged.";
    else if (pull.state !== "open")
      mergeBlockReason = "This pull request is closed.";
    else if (pull.draft)
      mergeBlockReason =
        "Mark this draft ready for review on GitHub before merging.";
    else if (metadata?.archived || metadata?.disabled)
      mergeBlockReason = "This repository is archived or disabled.";
    else if (metadata?.permissions?.push !== true)
      mergeBlockReason =
        "Your GitHub account does not have permission to merge into this repository.";
    else if (!mergeMethods.length)
      mergeBlockReason =
        "No supported merge method is available for this pull request.";
    else if (mergeable === false || mergeState === "dirty")
      mergeBlockReason =
        "Resolve this pull request's merge conflicts before merging.";
    else if (mergeable === null || mergeState === "unknown")
      mergeBlockReason =
        "GitHub is still checking whether this pull request can merge. Refresh in a moment.";
    else if (mergeState === "behind")
      mergeBlockReason =
        "Update the head branch with the base branch before merging.";
    else if (mergeState === "blocked")
      mergeBlockReason =
        "GitHub requires reviews, checks, or other branch rules to be satisfied before merging.";
    else if (!["clean", "unstable", "has_hooks"].includes(mergeState))
      mergeBlockReason =
        "GitHub has not confirmed that this pull request is ready to merge. Refresh its details.";
    else if (checksIncomplete)
      mergeBlockReason =
        "Some check results could not be loaded, or exceed the 1,000-result limit per source. Refresh before merging.";
    return {
      ...pullRequest(pull),
      body: typeof pull.body === "string" ? pull.body : "",
      state: pull.state,
      merged: pull.merged === true,
      base: pull.base.ref,
      headSha,
      mergeable,
      mergeState,
      canMerge: !mergeBlockReason,
      mergeBlockReason,
      mergeMethods,
      checks,
      checksIncomplete,
      additions: pull.additions ?? 0,
      deletions: pull.deletions ?? 0,
      changedFiles: pull.changed_files ?? 0,
      commits: pull.commits ?? 0,
      branchCleanup: cleanup,
    };
  }

  function mergePullRequest(input, value, fields) {
    let fullName, number, payload;
    try {
      fullName = validateRepository(input);
      number = validatePullRequestNumber(value);
      payload = validateMergeInput(fields);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = `${fullName.toLowerCase()}#${number}`;
    const signature = JSON.stringify(payload);
    const running = mergingPulls.get(key);
    if (running)
      return running.signature === signature
        ? running.promise
        : Promise.reject(
            actionError(
              "A merge is already in progress. Wait, then refresh this pull request.",
            ),
          );
    const promise = (async () => {
      // Recheck permission, protections, target branch, and the exact commit the user reviewed.
      const fresh = await getPullRequest(fullName, number);
      if (fresh.headSha !== payload.sha || fresh.base !== payload.base)
        throw actionError(
          "This pull request changed since you reviewed it. Refresh and review its latest head commit and base branch before merging.",
        );
      if (!fresh.canMerge) throw actionError(fresh.mergeBlockReason, 405);
      if (!fresh.mergeMethods.includes(payload.method))
        throw actionError(
          "This merge method is no longer available. Refresh and choose an allowed method.",
          405,
        );
      // Check collection can take time. Re-read immediately before PUT; GitHub's sha
      // guard is atomic for the head, but its API has no equivalent base-branch guard.
      let finalPull;
      try {
        finalPull = await readPull(fullName, number);
      } catch (error) {
        throw publicError(error, "GitHub merge preflight");
      }
      if (
        finalPull.head.sha.toLowerCase() !== payload.sha ||
        finalPull.base.ref !== payload.base
      )
        throw actionError(
          "This pull request changed during the merge check. Refresh and review it again.",
        );
      if (
        finalPull.state !== "open" ||
        finalPull.merged ||
        finalPull.draft ||
        finalPull.mergeable !== true ||
        !["clean", "unstable", "has_hooks"].includes(
          finalPull.mergeable_state,
        ) ||
        (payload.method === "rebase" && finalPull.rebaseable === false)
      )
        throw actionError(
          "This pull request is no longer ready to merge. Refresh its details before continuing.",
          405,
        );
      try {
        const result = await request(
          `repos/${fullName}/pulls/${number}/merge`,
          {
            method: "PUT",
            body: { sha: payload.sha, merge_method: payload.method },
          },
        );
        if (result?.merged === true && isSHA(result.sha))
          return { merged: true, sha: result.sha };
        throw new Error("GitHub did not confirm the merge");
      } catch (error) {
        // A timeout can happen after success. Read once to reconcile; never replay the PUT.
        if (!error.status || error.status >= 500) {
          try {
            const merged = await readPull(fullName, number);
            if (
              merged.merged === true &&
              merged.state === "closed" &&
              merged.head.sha.toLowerCase() === payload.sha &&
              merged.base.ref === payload.base &&
              isSHA(merged.merge_commit_sha)
            )
              return { merged: true, sha: merged.merge_commit_sha };
          } catch {
            /* Leave the outcome unconfirmed below. */
          }
        }
        if (error.status === 405)
          throw actionError(
            "GitHub blocked the merge. Refresh to check required reviews, checks, branch rules, or merge queue requirements.",
            405,
          );
        if (error.status === 409)
          throw actionError(
            "The head commit changed before the merge. Refresh and review the latest changes.",
          );
        if (error.status === 422)
          throw actionError(
            "GitHub could not validate this merge. Refresh and check the selected merge method and repository rules.",
            422,
          );
        if ([401, 403, 404, 429].includes(error.status))
          throw publicError(error, "Pull request merge");
        throw new Error(
          "GitHub did not confirm the merge. Refresh this pull request before retrying; the merge may already have completed.",
        );
      }
    })().finally(() => mergingPulls.delete(key));
    mergingPulls.set(key, { signature, promise });
    return promise;
  }

  async function listBranches(input) {
    const fullName = validateRepository(input);
    const branches = [];
    try {
      for (let page = 1; page <= 11; page++) {
        const batch = await request(
          `repos/${fullName}/branches?per_page=100&page=${page}`,
        );
        if (!Array.isArray(batch))
          throw new Error("Unexpected branches response");
        if (page === 11 && batch.length) {
          throw Object.assign(
            new Error(
              "This repository has more than 1,000 branches. Use GitHub to choose from the full list.",
            ),
            { userSafe: true },
          );
        }
        branches.push(
          ...batch
            .map((branch) => branch.name)
            .filter((name) => typeof name === "string"),
        );
        if (batch.length < 100) return [...new Set(branches)];
      }
      return [...new Set(branches)];
    } catch (error) {
      if (error.userSafe) throw error;
      throw publicError(error, "GitHub branches");
    }
  }

  async function existingPull(fullName, { base, head }) {
    const owner = fullName.split("/")[0];
    const pulls = await request(
      `repos/${fullName}/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${head}`)}&per_page=100`,
    );
    if (!Array.isArray(pulls))
      throw new Error("Unexpected pull request response");
    const existing = pulls.find(
      (pull) =>
        pull.head?.repo?.full_name?.toLowerCase() === fullName.toLowerCase(),
    );
    return existing ? pullRequest(existing) : null;
  }

  async function compareBranches(input, value) {
    const fullName = validateRepository(input);
    const { base, head } = validateComparisonInput(value);
    const path = `repos/${fullName}`;
    try {
      const [comparison, existing, baseBranch, headBranch] = await Promise.all([
        request(
          `${path}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1`,
        ),
        existingPull(fullName, { base, head }),
        request(`${path}/branches/${encodeURIComponent(base)}`),
        request(`${path}/branches/${encodeURIComponent(head)}`),
      ]);
      if (baseBranch?.name !== base || headBranch?.name !== head) {
        throw Object.assign(
          new Error(
            "A selected branch no longer exists. Refresh the branch list.",
          ),
          { status: 404, userSafe: true },
        );
      }
      for (const count of [
        comparison?.ahead_by,
        comparison?.behind_by,
        comparison?.total_commits,
      ]) {
        if (!Number.isSafeInteger(count) || count < 0)
          throw new Error("Unexpected comparison response");
      }
      return {
        aheadBy: comparison.ahead_by,
        behindBy: comparison.behind_by,
        commitCount: comparison.total_commits,
        existingPull: existing,
      };
    } catch (error) {
      if (error.userSafe) throw error;
      if (error.status === 404)
        throw Object.assign(
          new Error(
            "A selected branch or repository was not found. Check access and refresh the branch list.",
          ),
          { status: 404 },
        );
      throw publicError(error, "GitHub branch comparison");
    }
  }

  function createPullRequest(input, value) {
    let fullName, payload;
    try {
      fullName = validateRepository(input);
      payload = validatePullRequestInput(value);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = JSON.stringify([
      fullName.toLowerCase(),
      payload.base,
      payload.head,
    ]);
    if (creatingPulls.has(key)) return creatingPulls.get(key);
    const operation = (async () => {
      const comparison = await compareBranches(fullName, {
        base: payload.base,
        head: payload.head,
      });
      if (comparison.existingPull) return comparison.existingPull;
      if (!comparison.aheadBy) {
        throw Object.assign(
          new Error(
            "The head branch has no new commits to include in a pull request.",
          ),
          { status: 422 },
        );
      }
      try {
        const created = await request(`repos/${fullName}/pulls`, {
          method: "POST",
          body: payload,
        });
        if (!Number.isSafeInteger(created?.number) || !created.html_url)
          throw new Error("GitHub did not confirm creation");
        return pullRequest(created);
      } catch (error) {
        // A concurrent submit or lost response may already have created the PR.
        // Reconcile by reading; never automatically repeat the write.
        try {
          const existing = await existingPull(fullName, payload);
          if (existing) return existing;
        } catch {
          /* Keep the original sanitized failure below. */
        }
        if (error.status === 422)
          throw Object.assign(
            new Error(
              "GitHub could not create this pull request. Check the branches, title, and repository permissions.",
            ),
            { status: 422 },
          );
        if ([401, 403, 404, 429].includes(error.status))
          throw publicError(error, "Pull request creation");
        throw new Error(
          "GitHub did not confirm creation. Refresh Pull Requests before retrying.",
        );
      }
    })().finally(() => creatingPulls.delete(key));
    creatingPulls.set(key, operation);
    return operation;
  }

  async function listRepositories() {
    try {
      const repos = await request(
        "user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100",
      );
      return array(repos).map((repo) => ({
        fullName: repo.full_name,
        name: repo.name,
        description: repo.description || "",
        private: Boolean(repo.private),
      }));
    } catch (error) {
      throw publicError(error, "GitHub repositories");
    }
  }

  async function getRepository(input) {
    const fullName = validateRepository(input);
    const path = `repos/${fullName}`;
    let metadata;
    try {
      metadata = await request(path);
    } catch (error) {
      throw publicError(error, "GitHub repository");
    }
    if (!metadata?.name)
      throw new Error(
        "GitHub returned an incomplete repository response. Try refreshing.",
      );

    const warnings = [];
    let refreshIncomplete = false;
    let empty = false;
    const branch = metadata.default_branch || "main";
    const fetchedAt = now();
    async function optional(
      label,
      endpoint,
      fallback,
      missingCodes = [],
      onMissing,
    ) {
      try {
        return await request(endpoint);
      } catch (error) {
        if (missingCodes.includes(error.status)) {
          onMissing?.(error);
        } else {
          refreshIncomplete = true;
          warnings.push(`${label} could not be loaded from GitHub.`);
        }
        return fallback;
      }
    }
    const [
      pullsRaw,
      pullCount,
      commitsRaw,
      languagesRaw,
      contributorsRaw,
      latestRaw,
      releasesRaw,
      readmeRaw,
      starred,
      starsRaw,
    ] = await Promise.all([
      optional(
        "Pull requests",
        `${path}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
        null,
      ),
      optional(
        "Pull request count",
        `search/issues?q=${encodeURIComponent(`repo:${fullName} is:pr is:open`)}&per_page=1`,
        null,
      ),
      optional(
        "Recent commits",
        `${path}/commits?sha=${encodeURIComponent(branch)}&per_page=7`,
        [],
        [409],
        () => {
          empty = true;
        },
      ),
      optional("Languages", `${path}/languages`, {}),
      optional("Contributors", `${path}/contributors?per_page=12`, [], [204]),
      optional("Latest release", `${path}/releases/latest`, null, [404]),
      optional("Releases", `${path}/releases?per_page=5`, []),
      optional("README", `${path}/readme`, null, [404]),
      optional("Star status", `user/starred/${fullName}`, false, [404]).then(
        (value) => value !== false,
      ),
      optional("Star history", `${path}/stargazers/history?per_page=6`, null),
    ]);

    async function commitCI(sha) {
      if (!/^[a-f\d]{6,64}$/i.test(sha)) return "none";
      const results = await Promise.allSettled([
        request(`${path}/commits/${sha}/status`),
        (async () => {
          const first = await request(
            `${path}/commits/${sha}/check-runs?filter=latest&per_page=100&page=1`,
          );
          const checks = array(first?.check_runs);
          const pages = Math.ceil((first?.total_count || checks.length) / 100);
          if (pages > 5)
            throw new Error("More check runs than the bounded request limit");
          const rest = await Promise.all(
            Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
              request(
                `${path}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${index + 2}`,
              ),
            ),
          );
          return checks.concat(...rest.map((page) => array(page?.check_runs)));
        })(),
      ]);
      const statuses = [];
      let unavailable = false;
      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (result.status === "rejected") {
          unavailable = true;
          continue;
        }
        if (index === 0) {
          const combined = result.value;
          if (combined?.total_count > 0)
            statuses.push(
              ["failure", "error"].includes(combined.state)
                ? "failure"
                : combined.state === "success"
                  ? "success"
                  : "pending",
            );
        } else statuses.push(...result.value.map(checkStatus));
      }
      const status = mergeStatuses(statuses);
      if (unavailable) {
        refreshIncomplete = true;
        warnings.push(
          `CI is partially unavailable for commit ${sha.slice(0, 7)}.`,
        );
        // A known failure/pending state remains useful, but partial success is not a pass.
        if (status === "success") return "none";
      }
      return status;
    }

    const commits = await Promise.all(
      array(commitsRaw)
        .slice(0, 7)
        .map(async (commit) => ({
          sha: commit.sha,
          message: String(commit.commit?.message || "").split("\n")[0],
          url: commit.html_url || "",
          date:
            commit.commit?.author?.date || commit.commit?.committer?.date || "",
          author: person(
            commit.author,
            commit.commit?.author?.name || "Unknown",
          ),
          status: await commitCI(commit.sha),
        })),
    );
    const pulls = array(pullsRaw).map(pullRequest);
    if (pulls.length === 100)
      warnings.push(
        "Showing the 100 most recently updated open pull requests.",
      );

    let stars = { starHistory: [], starsThisMonth: null };
    if (Array.isArray(starsRaw)) {
      try {
        stars = starSeries(starsRaw, fetchedAt);
      } catch {
        warnings.push(
          "Star history returned an unsupported response; no estimate is shown.",
        );
      }
    }
    let readme = "";
    if (
      readmeRaw?.encoding === "base64" &&
      typeof readmeRaw.content === "string"
    ) {
      readme = Buffer.from(readmeRaw.content, "base64").toString("utf8");
    } else if (readmeRaw)
      warnings.push(
        "README content is unavailable in this format. Open it on GitHub.",
      );

    return {
      fullName: metadata.full_name || fullName,
      name: metadata.name,
      owner: person(metadata.owner),
      description: metadata.description || "",
      url: metadata.html_url || `https://github.com/${fullName}`,
      visibility:
        metadata.visibility || (metadata.private ? "private" : "public"),
      branch: empty ? "" : branch,
      empty,
      license:
        metadata.license?.spdx_id === "NOASSERTION"
          ? "Other"
          : metadata.license?.spdx_id || "",
      updatedAt: metadata.updated_at || "",
      homepage: metadata.homepage || "",
      topics: array(metadata.topics),
      stars: metadata.stargazers_count || 0,
      forks: metadata.forks_count || 0,
      openPrCount:
        Array.isArray(pullsRaw) && pulls.length < 100
          ? pulls.length
          : Number.isFinite(pullCount?.total_count)
            ? Math.max(pullCount.total_count, pulls.length)
            : pulls.length,
      viewerStarred: starred,
      commits,
      pulls,
      languages: Object.entries(languagesRaw || {})
        .filter(([, bytes]) => Number.isFinite(bytes) && bytes > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name, bytes]) => ({
          name,
          bytes,
          color: COLORS[name] || "#8b8b98",
        })),
      contributors: array(contributorsRaw).map((contributor) =>
        person(contributor),
      ),
      release: release(latestRaw),
      releases: array(releasesRaw)
        .filter((item) => !item.draft)
        .map((item) => ({
          ...release(item),
          name: item.name || item.tag_name || "",
        })),
      readme,
      readmeUrl:
        readmeRaw?.html_url ||
        `${metadata.html_url || `https://github.com/${fullName}`}/blob/${encodeURIComponent(branch)}/README.md`,
      ciStatus: commits[0]?.status || "none",
      ...stars,
      warnings: [...new Set(warnings)],
      refreshIncomplete,
      fetchedAt: fetchedAt.toISOString(),
    };
  }
  return {
    getRepository,
    listRepositories,
    listBranches,
    compareBranches,
    createPullRequest,
    getPullRequest,
    mergePullRequest,
    listPullRequests,
    getPullRequestFiles,
    deletePullRequestBranch,
    getPullRequestComments,
    createPullRequestComment,
  };
}

const service = createGitHubService();
export const getRepository = service.getRepository;
export const listRepositories = service.listRepositories;
export const listBranches = service.listBranches;
export const compareBranches = service.compareBranches;
export const createPullRequest = service.createPullRequest;
export const getPullRequest = service.getPullRequest;
export const mergePullRequest = service.mergePullRequest;
export const listPullRequests = service.listPullRequests;
export const getPullRequestFiles = service.getPullRequestFiles;
export const deletePullRequestBranch = service.deletePullRequestBranch;
export const getPullRequestComments = service.getPullRequestComments;
export const createPullRequestComment = service.createPullRequestComment;

const repositoryCreation = createRepositoryService({ request: ghRequest });
export const getRepositoryCreationOptions =
  repositoryCreation.getRepositoryCreationOptions;
export const createRepository = repositoryCreation.createRepository;
export const checkCreatedRepository = repositoryCreation.checkCreatedRepository;
