import { webContentUrl } from "./rendering-policy";
import type {
  Repository,
  RepoSummary,
  RepositoryIdentity,
  RepositoryCreationOptions,
  CreateRepositoryInput,
  CreateRepositoryResult,
  BranchSelection,
  BranchComparison,
  PullRequestInput,
  PullRequest,
  PullRequestDetail,
  MergePullRequestInput,
  MergePullRequestResult,
  PullRequestState,
  PullRequestList,
  PullRequestFiles,
  DeletePullRequestBranchInput,
  DeletePullRequestBranchResult,
  PullRequestComments,
  PullRequestComment,
  CreatePullRequestCommentInput,
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
  listPullRequests: (repo: string, state: PullRequestState = "all") =>
    window.pink
      ? window.pink.listPullRequests(repo, state)
      : get<PullRequestList>(
          `/api/pulls?${new URLSearchParams({ repo, state })}`,
        ),
  getPullRequestFiles: (repo: string, number: number, sha: string) =>
    window.pink
      ? window.pink.getPullRequestFiles(repo, number, sha)
      : get<PullRequestFiles>(
          `/api/pull-files?${new URLSearchParams({ repo, number: String(number), sha })}`,
        ),
  getPullRequestComments: (repo: string, number: number) =>
    window.pink
      ? window.pink.getPullRequestComments(repo, number)
      : get<PullRequestComments>(
          `/api/pull-comments?${new URLSearchParams({ repo, number: String(number) })}`,
        ),
  createPullRequestComment: (
    repo: string,
    number: number,
    input: CreatePullRequestCommentInput,
  ) =>
    window.pink
      ? window.pink.createPullRequestComment(repo, number, input)
      : get<PullRequestComment>("/api/pull-comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo, number, ...input }),
        }),
  deletePullRequestBranch: (
    repo: string,
    number: number,
    input: DeletePullRequestBranchInput,
  ) =>
    window.pink
      ? window.pink.deletePullRequestBranch(repo, number, input)
      : get<DeletePullRequestBranchResult>("/api/delete-pull-branch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo, number, ...input }),
        }),
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
  repositoryCreationOptions: () =>
    window.pink
      ? window.pink.repositoryCreationOptions()
      : get<RepositoryCreationOptions>("/api/repository-creation-options"),
  createRepository: (input: CreateRepositoryInput) =>
    window.pink
      ? window.pink.createRepository(input)
      : get<CreateRepositoryResult>("/api/create-repository", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
  checkCreatedRepository: (input: RepositoryIdentity) =>
    window.pink
      ? window.pink.checkCreatedRepository(input)
      : get<RepoSummary | null>(
          `/api/created-repository?${new URLSearchParams({ owner: input.owner, name: input.name })}`,
        ),
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
  getPullRequest: (repo: string, number: number) =>
    window.pink
      ? window.pink.getPullRequest(repo, number)
      : get<PullRequestDetail>(
          `/api/pull?${new URLSearchParams({ repo, number: String(number) })}`,
        ),
  mergePullRequest: (
    repo: string,
    number: number,
    input: MergePullRequestInput,
  ) =>
    window.pink
      ? window.pink.mergePullRequest(repo, number, input)
      : get<MergePullRequestResult>("/api/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo, number, ...input }),
        }),
};
export function external(value: string) {
  const url = webContentUrl(value);
  if (!url) return;
  if (window.pink) window.pink.openExternal(url).catch(console.error);
  else window.open(url, "_blank", "noopener,noreferrer");
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
