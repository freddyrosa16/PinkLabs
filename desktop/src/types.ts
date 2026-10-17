export type Provider = "claude" | "openai" | "grok";
export type Status = "success" | "failure" | "pending" | "none";
export interface Person {
  login: string;
  avatar: string;
  url: string;
}
export interface Commit {
  sha: string;
  message: string;
  url: string;
  date: string;
  author: Person;
  status: Status;
}
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  date: string;
  author: Person;
  draft: boolean;
  branch: string;
}
export type MergeMethod = "merge" | "squash" | "rebase";
export type PullRequestState = "open" | "closed" | "all";
export interface PullRequestListItem extends PullRequest {
  state: "open" | "closed";
  merged: boolean;
}
export interface PullRequestList {
  pulls: PullRequestListItem[];
  truncated: boolean;
}
export interface PullRequestFile {
  filename: string;
  previousFilename: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  url: string;
}
export interface PullRequestFiles {
  headSha: string;
  files: PullRequestFile[];
  truncated: boolean;
}
export interface PullRequestComment {
  id: string;
  kind: "comment" | "review" | "inline";
  body: string;
  author: Person;
  date: string;
  updatedAt: string;
  url: string;
  path?: string;
  line?: number | null;
  reviewState?: string;
  replyTo?: number | null;
}
export interface PullRequestComments {
  comments: PullRequestComment[];
  truncated: boolean;
  canComment: boolean;
  commentBlockReason: string;
}
export interface CreatePullRequestCommentInput {
  body: string;
}
export interface BranchCleanup {
  branch: string;
  sha: string;
  canDelete: boolean;
  deleted: boolean;
  reason: string;
}
export interface DeletePullRequestBranchInput {
  branch: string;
  sha: string;
}
export interface DeletePullRequestBranchResult {
  deleted: true;
  branch: string;
}
export interface PullRequestDetail extends PullRequest {
  body: string;
  state: "open" | "closed";
  merged: boolean;
  base: string;
  headSha: string;
  mergeable: boolean | null;
  mergeState: string;
  canMerge: boolean;
  mergeBlockReason: string;
  mergeMethods: MergeMethod[];
  checks: { name: string; status: Status; url: string }[];
  checksIncomplete: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  branchCleanup: BranchCleanup;
}
export interface MergePullRequestInput {
  sha: string;
  base: string;
  method: MergeMethod;
}
export interface MergePullRequestResult {
  merged: true;
  sha: string;
}
export interface BranchSelection {
  base: string;
  head: string;
}
export interface PullRequestInput extends BranchSelection {
  title: string;
  body: string;
  draft: boolean;
}
export interface BranchComparison {
  aheadBy: number;
  behindBy: number;
  commitCount: number;
  existingPull: PullRequest | null;
}
export interface Repository {
  fullName: string;
  name: string;
  owner: Person;
  description: string;
  url: string;
  visibility: string;
  branch: string;
  empty: boolean;
  license: string;
  updatedAt: string;
  homepage: string;
  topics: string[];
  stars: number;
  forks: number;
  openPrCount: number;
  viewerStarred: boolean;
  commits: Commit[];
  pulls: PullRequest[];
  languages: { name: string; bytes: number; color: string }[];
  contributors: Person[];
  release: { tag: string; date: string; url: string } | null;
  releases: { tag: string; date: string; url: string; name: string }[];
  readme: string;
  readmeUrl: string;
  ciStatus: Status;
  starHistory: { date: string; count: number }[];
  starsThisMonth: number | null;
  warnings: string[];
  refreshIncomplete: boolean;
  fetchedAt: string;
}
export interface RepoSummary {
  fullName: string;
  name: string;
  description: string;
  private: boolean;
}
export interface RepositoryIdentity {
  owner: string;
  name: string;
}
export interface RepositoryCreationOptions {
  account: string;
  owners: { login: string; type: "user" | "organization" }[];
  gitignoreTemplates: string[];
  licenses: { key: string; name: string }[];
  warnings: string[];
}
export interface CreateRepositoryInput extends RepositoryIdentity {
  description: string;
  visibility: "private" | "public";
  initializeReadme: boolean;
  gitignoreTemplate: string;
  licenseTemplate: string;
}
export type CreateRepositoryResult =
  | { status: "created"; repository: RepoSummary }
  | { status: "rejected"; message: string }
  | { status: "uncertain"; message: string };
export type CloneMethod = "https" | "ssh" | "cli";
export interface PinkBridge {
  repository: (fullName: string) => Promise<Repository>;
  repositories: () => Promise<RepoSummary[]>;
  repositoryCreationOptions: () => Promise<RepositoryCreationOptions>;
  createRepository: (
    input: CreateRepositoryInput,
  ) => Promise<CreateRepositoryResult>;
  checkCreatedRepository: (
    input: RepositoryIdentity,
  ) => Promise<RepoSummary | null>;
  listBranches: (fullName: string) => Promise<string[]>;
  compareBranches: (
    fullName: string,
    selection: BranchSelection,
  ) => Promise<BranchComparison>;
  createPullRequest: (
    fullName: string,
    input: PullRequestInput,
  ) => Promise<PullRequest>;
  getPullRequest: (
    fullName: string,
    number: number,
  ) => Promise<PullRequestDetail>;
  listPullRequests: (
    fullName: string,
    state: PullRequestState,
  ) => Promise<PullRequestList>;
  getPullRequestFiles: (
    fullName: string,
    number: number,
    sha: string,
  ) => Promise<PullRequestFiles>;
  getPullRequestComments: (
    fullName: string,
    number: number,
  ) => Promise<PullRequestComments>;
  createPullRequestComment: (
    fullName: string,
    number: number,
    input: CreatePullRequestCommentInput,
  ) => Promise<PullRequestComment>;
  deletePullRequestBranch: (
    fullName: string,
    number: number,
    input: DeletePullRequestBranchInput,
  ) => Promise<DeletePullRequestBranchResult>;
  mergePullRequest: (
    fullName: string,
    number: number,
    input: MergePullRequestInput,
  ) => Promise<MergePullRequestResult>;
  openExternal: (url: string) => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
  clone: (
    fullName: string,
    method: CloneMethod,
  ) => Promise<{ canceled: boolean; path?: string }>;
  chooseFolder: () => Promise<string | null>;
  openIDE: (folder: string) => Promise<"editor" | "file-manager">;
}
declare global {
  interface Window {
    pink?: PinkBridge;
  }
}
