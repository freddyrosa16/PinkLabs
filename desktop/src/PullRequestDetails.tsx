import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  ClockIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  SyncIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, external } from "./api";
import { PullRequestDiff } from "./PullRequestDiff";
import { PullRequestComments } from "./PullRequestComments";
import type { MergeMethod, PullRequestDetail, Status } from "./types";

function pullRequestError(cause: unknown) {
  const message =
    cause instanceof Error
      ? cause.message
      : "The pull request could not be updated. Refresh its status and try again.";
  return message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
}
function CheckStatusIcon({ status }: { status: Status }) {
  return (
    <span className={`status ${status}`} aria-hidden="true">
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
const methods: Record<MergeMethod, { label: string; description: string }> = {
  merge: {
    label: "Merge commit",
    description: "Keep the branch’s commits and add a merge commit.",
  },
  squash: {
    label: "Squash and merge",
    description: "Combine the branch’s changes into one commit.",
  },
  rebase: {
    label: "Rebase and merge",
    description: "Add the branch’s commits individually, with new commit IDs.",
  },
};

export function PullRequestDetails({
  fullName,
  number,
  changed,
  busyChanged,
  refreshVersion,
  commentsRefreshVersion,
}: {
  fullName: string;
  number: number;
  changed: (message: string) => void;
  busyChanged?: (busy: boolean) => void;
  refreshVersion: string;
  commentsRefreshVersion: string;
}) {
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [tab, setTab] = useState<"overview" | "files">("overview");
  const [method, setMethod] = useState<MergeMethod>("merge");
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState<"merge" | "delete" | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [mergedSha, setMergedSha] = useState("");
  const [deletedBranch, setDeletedBranch] = useState("");
  const submitting = useRef(false);
  const completedWrite = useRef(false);
  const busyCallback = useRef(busyChanged);
  const previousRefresh = useRef(refreshVersion);
  busyCallback.current = busyChanged;
  useEffect(() => () => busyCallback.current?.(false), []);
  useEffect(() => {
    busyCallback.current?.(Boolean(saving || commentSaving));
  }, [saving, commentSaving]);
  useEffect(() => {
    if (
      previousRefresh.current === refreshVersion ||
      saving ||
      commentSaving ||
      confirming ||
      confirmingDelete
    )
      return;
    previousRefresh.current = refreshVersion;
    setRetry((value) => value + 1);
  }, [refreshVersion, saving, commentSaving, confirming, confirmingDelete]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setConfirming(false);
    setConfirmingDelete(false);
    api
      .getPullRequest(fullName, number)
      .then((pull) => {
        if (!current) return;
        setDetail(pull);
        setReviewRevision((value) => value + 1);
        setMethod((previous) =>
          pull.mergeMethods.includes(previous)
            ? previous
            : pull.mergeMethods[0] || "merge",
        );
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            completedWrite.current
              ? `The completed action is confirmed, but the latest details could not be loaded. ${pullRequestError(cause)}`
              : pullRequestError(cause),
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [fullName, number, retry]);

  function refresh() {
    if (submitting.current || commentSaving) return;
    setLoading(true);
    setConfirming(false);
    setConfirmingDelete(false);
    setRetry((value) => value + 1);
  }
  async function merge() {
    if (
      !detail?.canMerge ||
      detail.merged ||
      mergedSha ||
      !detail.mergeMethods.includes(method) ||
      !confirming ||
      saving ||
      commentSaving ||
      loading ||
      error ||
      submitting.current
    )
      return;
    submitting.current = true;
    setSaving("merge");
    let result;
    try {
      result = await api.mergePullRequest(fullName, number, {
        sha: detail.headSha,
        base: detail.base,
        method,
      });
      if (!result.merged)
        throw new Error(
          "GitHub did not confirm this merge. Refresh the pull request before trying again.",
        );
    } catch (cause) {
      setError(pullRequestError(cause));
      setConfirming(false);
      return;
    } finally {
      submitting.current = false;
      setSaving(null);
    }
    completedWrite.current = true;
    setMergedSha(result.sha);
    setNotice(`Pull request #${number} merged into ${detail.base}.`);
    setDetail((previous) =>
      previous
        ? { ...previous, merged: true, state: "closed", canMerge: false }
        : previous,
    );
    refresh();
    changed(`Pull request #${number} merged.`);
  }
  async function deleteBranch() {
    const cleanup = detail?.branchCleanup;
    if (
      !detail?.merged ||
      !cleanup?.canDelete ||
      cleanup.deleted ||
      deletedBranch ||
      !confirmingDelete ||
      saving ||
      commentSaving ||
      loading ||
      error ||
      submitting.current
    )
      return;
    submitting.current = true;
    setSaving("delete");
    try {
      const result = await api.deletePullRequestBranch(fullName, number, {
        branch: cleanup.branch,
        sha: cleanup.sha,
      });
      if (!result.deleted || result.branch !== cleanup.branch)
        throw new Error(
          "GitHub did not confirm branch deletion. Refresh the pull request before trying again.",
        );
    } catch (cause) {
      setError(pullRequestError(cause));
      setConfirmingDelete(false);
      return;
    } finally {
      submitting.current = false;
      setSaving(null);
    }
    completedWrite.current = true;
    setDeletedBranch(cleanup.branch);
    setNotice(`Deleted branch ${cleanup.branch} on GitHub.`);
    setDetail((previous) =>
      previous
        ? {
            ...previous,
            branchCleanup: {
              ...previous.branchCleanup,
              deleted: true,
              canDelete: false,
            },
          }
        : previous,
    );
    refresh();
    changed(`Branch ${cleanup.branch} deleted.`);
  }
  const done = Boolean(mergedSha || detail?.merged);
  const isOpen = detail?.state === "open" && !done;
  const blocked = Boolean(saving || commentSaving || loading || error);
  const cleanup = detail?.branchCleanup;
  const branchDeleted = Boolean(deletedBranch || cleanup?.deleted);
  const titleId = `pr-details-title-${number}`;

  return (
    <section className="pr-detail-panel" aria-labelledby={titleId}>
      <div className="pr-detail-header">
        <div>
          <h2 id={titleId}>Pull request #{number}</h2>
          <p className="pr-repo">{fullName}</p>
        </div>
        <button
          className="text-button"
          disabled={loading || Boolean(saving) || commentSaving}
          onClick={refresh}
        >
          <SyncIcon size={12} className={loading ? "spin" : ""} />{" "}
          {loading ? "Refreshing…" : "Refresh details"}
        </button>
      </div>
      {notice && (
        <div className="pr-detail-notice" role="status">
          <CheckCircleIcon size={16} /> {notice}
          {mergedSha && !deletedBranch && (
            <span>
              {" "}
              Commit <code>{mergedSha.slice(0, 7)}</code>
            </span>
          )}
        </div>
      )}
      {error && (
        <div className="pr-message" role="alert">
          {error} Refresh details before another action.
        </div>
      )}
      {!detail ? (
        <div className="pr-detail-loading" role="status">
          {loading ? (
            <>
              <SyncIcon className="spin" /> Loading pull request…
            </>
          ) : (
            "Pull request details could not be loaded. Use Refresh details to retry."
          )}
        </div>
      ) : (
        <>
          <div className="pr-detail-title">
            {done ? (
              <GitMergeIcon size={20} className="green" />
            ) : (
              <GitPullRequestIcon
                size={20}
                className={detail.draft || !isOpen ? "muted" : "green"}
              />
            )}
            <h3>{detail.title}</h3>
          </div>
          <div className="pr-detail-meta">
            <span className="badge">
              {done
                ? "Merged"
                : detail.state === "closed"
                  ? "Closed"
                  : detail.draft
                    ? "Draft"
                    : "Open"}
            </span>
            <span>By {detail.author.login}</span>
            <span>
              <code>{detail.branch}</code> → <code>{detail.base}</code>
            </span>
          </div>
          <div className="pr-change-summary">
            <span>
              {detail.commits} {detail.commits === 1 ? "commit" : "commits"}
            </span>
            <span>{detail.changedFiles} files changed</span>
            <span className="green">+{detail.additions}</span>
            <span className="red">−{detail.deletions}</span>
          </div>
          <div
            className="pr-detail-tabs"
            role="tablist"
            aria-label="Pull request details"
          >
            <button
              role="tab"
              id={`pr-overview-tab-${number}`}
              aria-controls={`pr-overview-${number}`}
              aria-selected={tab === "overview"}
              className={tab === "overview" ? "active" : ""}
              disabled={Boolean(saving)}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            <button
              role="tab"
              id={`pr-files-tab-${number}`}
              aria-controls={`pr-files-${number}`}
              aria-selected={tab === "files"}
              className={tab === "files" ? "active" : ""}
              disabled={Boolean(saving)}
              onClick={() => setTab("files")}
            >
              Files changed <span>{detail.changedFiles}</span>
            </button>
          </div>
          <div
            role="tabpanel"
            id={`pr-overview-${number}`}
            aria-labelledby={`pr-overview-tab-${number}`}
            hidden={tab !== "overview"}
          >
            <div className="pr-description markdown">
              {detail.body ? (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    a: ({ href, children }) => (
                      <button
                        className="markdown-link"
                        onClick={() => href && external(href)}
                      >
                        {children}
                      </button>
                    ),
                    img: ({ alt }) => (
                      <span className="muted">
                        {alt ? `[Image: ${alt}]` : "[Image]"}
                      </span>
                    ),
                  }}
                >
                  {detail.body}
                </Markdown>
              ) : (
                <p className="muted">No description provided.</p>
              )}
            </div>
            {isOpen && (
              <div className="pr-checks">
                <div className="pr-checks-heading">
                  <h3>Checks</h3>
                </div>
                {detail.checksIncomplete && (
                  <p className="pr-check-warning">
                    Some check results could not be loaded. Refresh to try
                    again.
                  </p>
                )}
                {!detail.checks.length ? (
                  <p className="muted">
                    {detail.checksIncomplete
                      ? "Check status is unavailable."
                      : "No automated checks reported for this commit."}
                  </p>
                ) : (
                  <ul>
                    {detail.checks.map((check, index) => (
                      <li key={`${check.name}-${index}`}>
                        <CheckStatusIcon status={check.status} />
                        <span>{check.name}</span>
                        <small>
                          {
                            {
                              success: "Passed",
                              failure: "Failed",
                              pending: "Running / pending",
                              none: "Skipped / neutral",
                            }[check.status]
                          }
                        </small>
                        {check.url && (
                          <button
                            className="icon-button"
                            aria-label={`Open ${check.name} on GitHub`}
                            onClick={() => external(check.url)}
                          >
                            <ArrowUpRightIcon size={12} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <PullRequestComments
              fullName={fullName}
              number={number}
              refreshVersion={`${reviewRevision}:${commentsRefreshVersion}`}
              disabled={Boolean(
                saving || confirming || confirmingDelete || loading,
              )}
              busyChanged={setCommentSaving}
            />
          </div>
          {tab === "files" && (
            <div
              role="tabpanel"
              id={`pr-files-${number}`}
              aria-labelledby={`pr-files-tab-${number}`}
            >
              <PullRequestDiff
                key={reviewRevision}
                fullName={fullName}
                number={number}
                headSha={detail.headSha}
              />
            </div>
          )}
          {isOpen && (
            <div className="pr-merge-section">
              {confirming ? (
                <div
                  className="pr-merge-confirm"
                  role="region"
                  aria-label="Confirm pull request merge"
                >
                  <h3>
                    Merge #{number} into {detail.base}?
                  </h3>
                  <p>
                    This will add the changes from <b>{detail.branch}</b> to{" "}
                    <b>{detail.base}</b> on GitHub using{" "}
                    <b>{methods[method].label.toLowerCase()}</b>.
                  </p>
                  <p className="muted">
                    Reviewed commit: <code>{detail.headSha.slice(0, 7)}</code>.
                    If new commits arrive, you’ll need to refresh and confirm
                    again.
                  </p>
                </div>
              ) : (
                <>
                  {error ? (
                    <p className="pr-check-warning">
                      Refresh details to review the latest PR before merging.
                    </p>
                  ) : detail.mergeBlockReason ? (
                    <p className="pr-check-warning">
                      {detail.mergeBlockReason}
                    </p>
                  ) : detail.canMerge ? (
                    <p className="pr-merge-ready">
                      <CheckCircleIcon size={14} /> Ready to merge. GitHub will
                      recheck its rules when you confirm.
                    </p>
                  ) : null}
                  {detail.mergeMethods.length > 0 && (
                    <>
                      <label
                        className="field-label"
                        htmlFor={`pr-merge-method-${number}`}
                      >
                        Merge method
                      </label>
                      <select
                        id={`pr-merge-method-${number}`}
                        value={method}
                        disabled={blocked || !detail.canMerge}
                        onChange={(event) =>
                          setMethod(event.target.value as MergeMethod)
                        }
                      >
                        {detail.mergeMethods.map((value) => (
                          <option value={value} key={value}>
                            {methods[value].label}
                          </option>
                        ))}
                      </select>
                      <p className="pr-method-help">
                        {methods[method].description}
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {done && (
            <div className="pr-branch-cleanup">
              {branchDeleted ? (
                <p className="pr-merge-ready">
                  <CheckCircleIcon size={14} /> Branch{" "}
                  <code>
                    {deletedBranch || cleanup?.branch || detail.branch}
                  </code>{" "}
                  has been deleted on GitHub.
                </p>
              ) : confirmingDelete && cleanup ? (
                <div
                  className="pr-merge-confirm pr-delete-confirm"
                  role="region"
                  aria-label="Confirm branch deletion"
                >
                  <h3>
                    Delete branch <code>{cleanup.branch}</code>?
                  </h3>
                  <p>
                    This removes the branch <b>{cleanup.branch}</b> from{" "}
                    <b>{fullName}</b> on GitHub. Your local branch, this pull
                    request, and the merged changes remain.
                  </p>
                </div>
              ) : (
                <>
                  <p>
                    The pull request is merged. Its description and changed
                    files remain available here.
                  </p>
                  {cleanup?.reason && (
                    <p className="pr-check-warning">{cleanup.reason}</p>
                  )}
                </>
              )}
            </div>
          )}
          <div className="pr-detail-actions modal-actions">
            <button
              className="button pr-external"
              disabled={Boolean(saving)}
              onClick={() => external(detail.url)}
            >
              Open on GitHub <ArrowUpRightIcon size={12} />
            </button>
            {isOpen &&
              (confirming ? (
                <>
                  <button
                    className="button"
                    disabled={Boolean(saving)}
                    onClick={() => setConfirming(false)}
                  >
                    Back
                  </button>
                  <button
                    className="button primary"
                    disabled={blocked || !detail.canMerge}
                    onClick={merge}
                  >
                    <GitMergeIcon size={14} />{" "}
                    {saving === "merge" ? "Merging…" : "Confirm merge"}
                  </button>
                </>
              ) : (
                <button
                  className="button primary"
                  disabled={
                    blocked ||
                    !detail.canMerge ||
                    !detail.mergeMethods.includes(method)
                  }
                  onClick={() => setConfirming(true)}
                >
                  <GitMergeIcon size={14} /> Merge pull request
                </button>
              ))}
            {done &&
              !branchDeleted &&
              cleanup?.canDelete &&
              (confirmingDelete ? (
                <>
                  <button
                    className="button"
                    disabled={Boolean(saving)}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button"
                    disabled={blocked}
                    onClick={deleteBranch}
                  >
                    <GitBranchIcon size={14} />{" "}
                    {saving === "delete" ? "Deleting…" : "Confirm deletion"}
                  </button>
                </>
              ) : (
                <button
                  className="button"
                  disabled={blocked}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <GitBranchIcon size={14} /> Delete branch
                </button>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
