import type {
  Repository,
  RepoSummary,
  BranchSelection,
  BranchComparison,
  PullRequestInput,
  PullRequest,
} from "./types";
const pendingRepositories = new Map<string, Promise<Repository>>();
async function get<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "GitHub could not be reached. Try again.");
  return data;
}
export const api = {
  repository: (repo: string) => {
    const existing = pendingRepositories.get(repo);
    if (existing) return existing;
    const request = (
      window.pink
        ? window.pink.repository(repo)
        : get<Repository>(`/api/repository?repo=${encodeURIComponent(repo)}`)
    ).finally(() => pendingRepositories.delete(repo));
    pendingRepositories.set(repo, request);
    return request;
  },
  repositories: () =>
    window.pink
      ? window.pink.repositories()
      : get<RepoSummary[]>("/api/repositories"),
  listBranches: (repo: string) =>
    window.pink
      ? window.pink.listBranches(repo)
      : get<string[]>(`/api/branches?${new URLSearchParams({ repo })}`),
  compareBranches: (repo: string, selection: BranchSelection) =>
    window.pink
      ? window.pink.compareBranches(repo, selection)
      : get<BranchComparison>(
          `/api/compare?${new URLSearchParams({ repo, ...selection })}`,
        ),
  createPullRequest: (repo: string, input: PullRequestInput) =>
    window.pink
      ? window.pink.createPullRequest(repo, input)
      : get<PullRequest>("/api/pulls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo, ...input }),
        }),
};
export function external(url: string) {
  try {
    const parsed = new URL(url);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return;
    if (window.pink) window.pink.openExternal(url).catch(console.error);
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    /* Ignore invalid repository links. */
  }
}
export function ago(date: string) {
  const hours = Math.max(0, (Date.now() - new Date(date).getTime()) / 3600000);
  if (!Number.isFinite(hours)) return "";
  if (hours < 1) return `${Math.max(1, Math.floor(hours * 60))}m`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  if (hours < 720) return `${Math.floor(hours / 24)}d`;
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
