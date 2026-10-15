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
export interface PinkBridge {
  repository: (fullName: string) => Promise<Repository>;
  repositories: () => Promise<RepoSummary[]>;
  listBranches: (fullName: string) => Promise<string[]>;
  compareBranches: (
    fullName: string,
    selection: BranchSelection,
  ) => Promise<BranchComparison>;
  createPullRequest: (
    fullName: string,
    input: PullRequestInput,
  ) => Promise<PullRequest>;
  openExternal: (url: string) => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
  clone: (fullName: string) => Promise<{ canceled: boolean; path?: string }>;
  chooseFolder: () => Promise<string | null>;
  openIDE: (folder: string) => Promise<void>;
}
declare global {
  interface Window {
    pink?: PinkBridge;
  }
}
