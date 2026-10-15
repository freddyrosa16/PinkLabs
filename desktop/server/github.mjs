import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
async function ghRequest(endpoint) {
  try {
    const { stdout } = await run(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        endpoint,
        "--header",
        "Accept: application/vnd.github+json",
        "--header",
        `X-GitHub-Api-Version: ${API_VERSION}`,
      ],
      { timeout: 25_000, maxBuffer: 12 * 1024 * 1024, windowsHide: true },
    );
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
}

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
    const branch = metadata.default_branch || "main";
    const fetchedAt = now();
    async function optional(label, endpoint, fallback, missingCodes = []) {
      try {
        return await request(endpoint);
      } catch (error) {
        if (!missingCodes.includes(error.status)) {
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
        [],
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
    const pulls = array(pullsRaw).map((pull) => ({
      number: pull.number,
      title: pull.title || "",
      url: pull.html_url || "",
      date: pull.created_at || "",
      author: person(pull.user),
      draft: Boolean(pull.draft),
      branch: pull.head?.ref || "",
    }));
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
      branch,
      license:
        metadata.license?.spdx_id === "NOASSERTION"
          ? "Other"
          : metadata.license?.spdx_id || "",
      updatedAt: metadata.updated_at || "",
      homepage: metadata.homepage || "",
      topics: array(metadata.topics),
      stars: metadata.stargazers_count || 0,
      forks: metadata.forks_count || 0,
      openPrCount: Number.isFinite(pullCount?.total_count)
        ? pullCount.total_count
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
  return { getRepository, listRepositories };
}

const service = createGitHubService();
export const getRepository = service.getRepository;
export const listRepositories = service.listRepositories;
