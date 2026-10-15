import { useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  BookIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  LinkIcon,
  MarkGithubIcon,
  RepoForkedIcon,
  StarIcon,
  SyncIcon,
  XCircleIcon,
  ClockIcon,
  LawIcon,
  TagIcon,
} from "@primer/octicons-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { CloneMethod, Repository, Status } from "./types";
import { ago, external } from "./api";
import { AnimatedIcon } from "./AnimatedIcon";
import { LanguageIcon } from "./LanguageIcon";
import { PullRequestWorkspace } from "./PullRequestWorkspace";
export function StatusIcon({ status }: { status: Status }) {
  return (
    <span
      className={`status ${status}`}
      title={status === "none" ? "No CI result" : status}
    >
      {status === "success" ? (
        <CheckCircleIcon />
      ) : status === "failure" ? (
        <XCircleIcon />
      ) : status === "pending" ? (
        <ClockIcon />
      ) : (
        <GitCommitIcon />
      )}
    </span>
  );
}
export function PullRows({
  repo,
  openPull,
  all = false,
}: {
  repo: Repository;
  openPull: (number: number) => void;
  all?: boolean;
}) {
  const rows = all ? repo.pulls : repo.pulls.slice(0, 5);
  return rows.length ? (
    <div>
      {rows.map((p) => (
        <button
          className="pull-row"
          key={p.number}
          onClick={() => openPull(p.number)}
        >
          <GitPullRequestIcon className={p.draft ? "muted" : "green"} />
          <div className="row-main">
            <strong>{p.title}</strong>
            <small>
              #{p.number} · opened {ago(p.date)} ago by {p.author.login}
              {p.draft ? " · Draft" : ""}
            </small>
          </div>
          <img className="avatar" src={p.author.avatar} alt={p.author.login} />
          <ChevronRightIcon className="muted" />
        </button>
      ))}
    </div>
  ) : (
    <div className="empty-row">No open pull requests to show.</div>
  );
}
export function GitHubView({
  repo,
  loading,
  error,
  tab,
  setTab,
  refresh,
  chooseRepo,
  createPull,
  openPull,
  selectedPull,
  selectPull,
  pullChanged,
  notify,
}: {
  repo: Repository | null;
  loading: boolean;
  error: string | null;
  tab: string;
  setTab: (tab: string) => void;
  refresh: () => void;
  chooseRepo: () => void;
  createPull: () => void;
  openPull: (number: number) => void;
  selectedPull: number | null;
  selectPull: (number: number | null) => void;
  pullChanged: (message: string) => void;
  notify: (message: string) => void;
}) {
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneMethod, setCloneMethod] = useState<CloneMethod>("https");
  const [cloning, setCloning] = useState(false);
  const clonePending = useRef(false);
  const cloneValue =
    cloneMethod === "cli"
      ? `gh repo clone ${repo?.fullName || ""}`
      : cloneMethod === "ssh"
        ? `git@github.com:${repo?.fullName || ""}.git`
        : `https://github.com/${repo?.fullName || ""}.git`;
  const cloneHelp = {
    https: "Uses your existing Git credentials for private repositories.",
    ssh: "Uses your GitHub SSH key. Keep it unlocked in your SSH agent before cloning.",
    cli: "Uses your GitHub CLI sign-in and its configured HTTPS or SSH protocol.",
  }[cloneMethod];
  const copy = async (text: string) => {
    try {
      if (window.pink) await window.pink.writeClipboard(text);
      else await navigator.clipboard.writeText(text);
      notify("Copied to clipboard.");
    } catch {
      notify(
        "Could not access the clipboard. Select and copy the URL or command.",
      );
    }
  };
  const clone = async () => {
    if (!repo || clonePending.current) return;
    if (!window.pink) {
      await copy(
        cloneMethod === "cli" ? cloneValue : `git clone ${cloneValue}`,
      );
      return;
    }
    clonePending.current = true;
    setCloning(true);
    try {
      const result = await window.pink.clone(repo.fullName, cloneMethod);
      if (!result.canceled) notify(`Cloned to ${result.path}`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      clonePending.current = false;
      setCloning(false);
      setCloneOpen(false);
    }
  };
  const short = (n: number) =>
    Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <MarkGithubIcon size={17} />
          <span>{repo?.owner.login || "GitHub"}</span>
          <span className="slash">›</span>
          <button
            className="repo-picker"
            onClick={chooseRepo}
            aria-label={`Choose repository${repo ? `, current: ${repo.name}` : ""}`}
          >
            <b>{repo?.name || "Choose repository"}</b>
            <ChevronDownIcon size={12} />
          </button>
        </div>
        <nav className="repo-tabs" aria-label="Repository views">
          {[
            ["overview", "Overview"],
            ["pulls", "Pull requests"],
            ["releases", "Releases"],
          ].map(([key, label]) => (
            <button
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
              key={key}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <button
            className="icon-button"
            aria-label="Refresh repository"
            disabled={loading}
            onClick={refresh}
          >
            {loading ? (
              <SyncIcon className="spin" />
            ) : (
              <AnimatedIcon name="refresh" />
            )}
          </button>
          {repo && (
            <button className="button" onClick={() => external(repo.url)}>
              Open on GitHub <ArrowUpRightIcon size={13} />
            </button>
          )}
        </div>
      </header>
      <div className="repo-scroll">
        {error && (
          <div className="error-banner" role="alert">
            <XCircleIcon />
            <div>
              <strong>
                {repo
                  ? "Couldn’t update GitHub — showing the last result"
                  : "Couldn’t load this repository"}
              </strong>
              <p>{error}</p>
            </div>
            <button className="button" onClick={refresh}>
              Retry
            </button>
            <button className="button" onClick={chooseRepo}>
              Choose repository
            </button>
          </div>
        )}
        {!repo ? (
          !error && (
            <div className="repo-loading" aria-live="polite">
              <SyncIcon className="spin" />
              <span>Loading your repository from GitHub…</span>
            </div>
          )
        ) : (
          <>
            <section className="repo-hero">
              <img className="repo-avatar" src={repo.owner.avatar} alt="" />
              <div className="repo-identity">
                <div className="repo-name">
                  <h1>{repo.name}</h1>
                  <span className="badge">{repo.visibility}</span>
                </div>
                <p>
                  {repo.description ||
                    "Your project, its progress, and everything around it."}
                </p>
                <div className="repo-meta">
                  {repo.languages[0] && (
                    <span>
                      <LanguageIcon
                        name={repo.languages[0].name}
                        color={repo.languages[0].color}
                      />
                      {repo.languages[0].name}
                    </span>
                  )}
                  <span>
                    <GitBranchIcon size={13} />
                    {repo.branch}
                  </span>
                  {repo.license && (
                    <span>
                      <LawIcon size={13} />
                      {repo.license}
                    </span>
                  )}
                  <span>
                    <ClockIcon size={13} />
                    Updated {ago(repo.updatedAt)} ago
                  </span>
                </div>
              </div>
              <div className="repo-actions">
                <button
                  className="split-button"
                  title="Manage your star on GitHub"
                  onClick={() => external(repo.url)}
                >
                  <span>
                    <StarIcon className={repo.viewerStarred ? "gold" : ""} />
                    {repo.viewerStarred ? "Starred" : "Star"}
                  </span>
                  <span>{short(repo.stars)}</span>
                </button>
                <button
                  className="split-button"
                  onClick={() => external(`${repo.url}/fork`)}
                >
                  <span>
                    <RepoForkedIcon />
                    Fork
                  </span>
                  <span>{short(repo.forks)}</span>
                </button>
                <div className="clone-wrap">
                  <button
                    className="button primary"
                    aria-expanded={cloneOpen}
                    onClick={() => setCloneOpen(!cloneOpen)}
                  >
                    <CodeIcon />
                    Clone
                    <ChevronDownIcon size={12} />
                  </button>
                  {cloneOpen && (
                    <>
                      <button
                        className="menu-dismiss"
                        aria-label="Close clone menu"
                        onClick={() => setCloneOpen(false)}
                      />
                      <div className="clone-menu">
                        <strong>Clone repository</strong>
                        <div
                          className="clone-method-tabs"
                          role="group"
                          aria-label="Clone method"
                        >
                          {(
                            [
                              ["https", "HTTPS"],
                              ["ssh", "SSH"],
                              ["cli", "GitHub CLI"],
                            ] as const
                          ).map(([method, label]) => (
                            <button
                              key={method}
                              className={cloneMethod === method ? "active" : ""}
                              aria-pressed={cloneMethod === method}
                              disabled={cloning}
                              onClick={() => setCloneMethod(method)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <label
                          className="clone-value-label"
                          htmlFor="clone-value"
                        >
                          {cloneMethod === "cli"
                            ? "GitHub CLI command"
                            : `${cloneMethod.toUpperCase()} URL`}
                        </label>
                        <div className="copy-field">
                          <input
                            id="clone-value"
                            readOnly
                            value={cloneValue}
                            onFocus={(event) => event.currentTarget.select()}
                            aria-describedby="clone-method-help"
                          />
                          <button
                            className="icon-button"
                            aria-label={
                              cloneMethod === "cli"
                                ? "Copy GitHub CLI command"
                                : "Copy clone URL"
                            }
                            onClick={() => copy(cloneValue)}
                          >
                            <CopyIcon />
                          </button>
                        </div>
                        <p className="clone-method-help" id="clone-method-help">
                          {cloneHelp}
                        </p>
                        <button
                          className="menu-action"
                          disabled={cloning}
                          onClick={clone}
                        >
                          <DownloadIcon />
                          {cloning
                            ? "Cloning…"
                            : window.pink
                              ? "Clone to your computer"
                              : cloneMethod === "cli"
                                ? "Copy GitHub CLI command"
                                : "Copy git clone command"}
                        </button>
                        <button
                          className="menu-action"
                          onClick={() =>
                            external(
                              `${repo.url}/archive/refs/heads/${encodeURIComponent(repo.branch)}.zip`,
                            )
                          }
                        >
                          <DownloadIcon />
                          Download ZIP
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
            <div className="stats-strip">
              <button onClick={() => setTab("pulls")} className="stat">
                <span>Open pull requests</span>
                <strong>{repo.openPrCount}</strong>
              </button>
              <button
                className="stat"
                onClick={() => external(`${repo.url}/actions`)}
              >
                <span>
                  CI on {repo.branch}, last {repo.commits.length} commits
                </span>
                <div className="ci-line">
                  <div className="ci-bars">
                    {repo.commits
                      .slice()
                      .reverse()
                      .map((c) => (
                        <i
                          key={c.sha}
                          className={c.status}
                          title={`${c.sha.slice(0, 7)}: ${c.status === "none" ? "No result" : c.status}`}
                        />
                      ))}
                  </div>
                  <b
                    className={
                      repo.ciStatus === "success"
                        ? "green"
                        : repo.ciStatus === "failure"
                          ? "red"
                          : ""
                    }
                  >
                    {
                      {
                        success: "Passing",
                        failure: "Failing",
                        pending: "Running",
                        none: "No result",
                      }[repo.ciStatus]
                    }
                  </b>
                </div>
              </button>
              <button className="stat" onClick={() => setTab("releases")}>
                <span>Latest release</span>
                <div>
                  <strong className="release-value">
                    {repo.release?.tag || "—"}
                  </strong>
                  <small>
                    {repo.release
                      ? `${ago(repo.release.date)} ago`
                      : repo.releases.length
                        ? "No stable release"
                        : "No releases available"}
                  </small>
                </div>
              </button>
              <div className="stat star-stat">
                <div>
                  <span>Stars, last 30 days</span>
                  <b className="gold">
                    {repo.starsThisMonth === null
                      ? "History unavailable"
                      : `+${short(repo.starsThisMonth)} this month`}
                  </b>
                </div>
                <StarChart
                  values={repo.starHistory.map((_, index) =>
                    repo.starHistory
                      .slice(0, index + 1)
                      .reduce((total, day) => total + day.count, 0),
                  )}
                />
              </div>
            </div>
            {repo.warnings.length > 0 && (
              <details className="data-notice">
                <summary>GitHub data notes</summary>
                <ul>
                  {repo.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {tab === "overview" ? (
              <div className="repo-grid">
                <div className="repo-primary">
                  <section>
                    <div className="section-heading">
                      <h2>
                        Open pull requests <span>{repo.openPrCount}</span>
                      </h2>
                      <button onClick={() => external(`${repo.url}/pulls`)}>
                        All on GitHub <ArrowUpRightIcon size={12} />
                      </button>
                    </div>
                    <PullRows repo={repo} openPull={openPull} />
                  </section>
                  <section className="commits-section">
                    <div className="section-heading">
                      <h2>
                        Recent commits{" "}
                        <span className="mono">{repo.branch}</span>
                      </h2>
                      <button
                        onClick={() =>
                          external(
                            `${repo.url}/commits/${encodeURIComponent(repo.branch)}`,
                          )
                        }
                      >
                        History <ArrowUpRightIcon size={12} />
                      </button>
                    </div>
                    {repo.commits.length ? (
                      repo.commits.slice(0, 5).map((c) => (
                        <button
                          className="commit-row"
                          key={c.sha}
                          onClick={() => external(c.url)}
                        >
                          <StatusIcon status={c.status} />
                          <code>{c.sha.slice(0, 7)}</code>
                          <span className="commit-message">
                            {c.message.split("\n")[0]}
                          </span>
                          <span className="commit-author">
                            <img
                              className="avatar"
                              src={c.author.avatar}
                              alt=""
                            />
                            {c.author.login}
                          </span>
                          <time title={new Date(c.date).toLocaleString()}>
                            {ago(c.date)}
                          </time>
                        </button>
                      ))
                    ) : (
                      <div className="empty-row">No commits available.</div>
                    )}
                  </section>
                </div>
                <aside className="repo-details">
                  <h2>About</h2>
                  {repo.homepage && (
                    <button
                      className="detail-link"
                      onClick={() => external(repo.homepage)}
                    >
                      <LinkIcon />
                      <span>
                        {repo.homepage
                          .replace(/^https?:\/\//, "")
                          .replace(/\/$/, "")}
                      </span>
                    </button>
                  )}
                  <button
                    className="detail-link muted-link"
                    onClick={() => setTab("readme")}
                  >
                    <BookIcon />
                    README
                  </button>
                  <div className="topics">
                    {repo.topics.map((t) => (
                      <button
                        key={t}
                        onClick={() =>
                          external(
                            `https://github.com/topics/${encodeURIComponent(t)}`,
                          )
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <h2 className="aside-heading">Languages</h2>
                  {repo.languages.length ? (
                    <>
                      <div className="language-bar">
                        {repo.languages.map((l) => (
                          <i
                            key={l.name}
                            style={{ flex: l.bytes, background: l.color }}
                            title={l.name}
                          />
                        ))}
                      </div>
                      <div className="language-list">
                        {repo.languages.map((l) => {
                          const pct =
                            (l.bytes /
                              repo.languages.reduce((a, b) => a + b.bytes, 0)) *
                            100;
                          return (
                            <span key={l.name}>
                              <LanguageIcon name={l.name} color={l.color} />
                              {l.name}
                              <small>{pct < 1 ? "<1" : Math.round(pct)}%</small>
                            </span>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="muted small">No language data available.</p>
                  )}
                  <h2 className="aside-heading">Contributors</h2>
                  <div className="contributors">
                    {repo.contributors.slice(0, 12).map((p) => (
                      <button
                        key={p.login}
                        onClick={() => external(p.url)}
                        title={p.login}
                      >
                        <img src={p.avatar} alt={p.login} />
                      </button>
                    ))}
                    {repo.contributors.length === 0 && (
                      <span className="muted small">
                        No contributors listed.
                      </span>
                    )}
                  </div>
                </aside>
              </div>
            ) : tab === "pulls" ? (
              <PullRequestWorkspace
                key={repo.fullName}
                repo={repo}
                selectedNumber={selectedPull}
                selectPull={selectPull}
                createPull={createPull}
                changed={pullChanged}
                refreshRepository={refresh}
              />
            ) : tab === "releases" ? (
              <section className="release-list">
                {repo.releases.length ? (
                  repo.releases.map((r) => (
                    <button
                      className="release-row"
                      key={r.tag}
                      onClick={() => external(r.url)}
                    >
                      <TagIcon size={22} />
                      <div>
                        <h2>{r.name || r.tag}</h2>
                        <small>
                          {r.tag} · {ago(r.date)} ago
                        </small>
                      </div>
                      <ArrowUpRightIcon />
                    </button>
                  ))
                ) : (
                  <div className="center-empty">
                    <TagIcon size={30} />
                    <h2>No releases available</h2>
                    <p>Published releases will appear here.</p>
                    <button
                      className="button"
                      onClick={() => external(`${repo.url}/releases`)}
                    >
                      View on GitHub <ArrowUpRightIcon />
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <div className="readme-full">
                <button
                  className="text-button"
                  onClick={() => setTab("overview")}
                >
                  ← Back to overview
                </button>
                <Readme repo={repo} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
function Readme({
  repo,
  compact = false,
}: {
  repo: Repository;
  compact?: boolean;
}) {
  return (
    <article className={`markdown ${compact ? "compact" : ""}`}>
      {repo.readme ? (
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeSanitize]}
          components={{
            a: ({ href, children }) => (
              <button
                className="markdown-link"
                onClick={() =>
                  href &&
                  external(
                    new URL(href, `${repo.url}/blob/${repo.branch}/`).href,
                  )
                }
              >
                {children}
              </button>
            ),
            img: ({ src, alt }) => (
              <img
                src={
                  src?.startsWith("http")
                    ? src
                    : `https://raw.githubusercontent.com/${repo.fullName}/${repo.branch}/${src}`
                }
                alt={alt || ""}
              />
            ),
          }}
        >
          {repo.readme}
        </Markdown>
      ) : (
        <p className="muted">No README available.</p>
      )}
    </article>
  );
}
function StarChart({ values }: { values: number[] }) {
  if (!values.length)
    return <div className="no-chart">No history available</div>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const points = values
    .map(
      (v, i) =>
        `${(i * 500) / Math.max(values.length - 1, 1)},${38 - ((v - min) * 32) / Math.max(max - min, 1)}`,
    )
    .join(" ");
  return (
    <svg
      className="star-chart"
      viewBox="0 0 500 42"
      preserveAspectRatio="none"
      role="img"
      aria-label="Cumulative stars gained over the last 30 days"
    >
      <polygon
        points={`0,42 ${points} 500,42`}
        fill="currentColor"
        opacity=".08"
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
