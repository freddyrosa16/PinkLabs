import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, external } from "./api";
import { StatusIcon } from "./GitHubView";
import type { MergeMethod, PullRequestDetail } from "./types";

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
  close,
  merged,
}: {
  fullName: string;
  number: number;
  close: () => void;
  merged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [method, setMethod] = useState<MergeMethod>("merge");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [mergedSha, setMergedSha] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setConfirming(false);
    api
      .getPullRequest(fullName, number)
      .then((pull) => {
        if (!current) return;
        setDetail(pull);
        setMethod((previous) =>
          pull.mergeMethods.includes(previous)
            ? previous
            : pull.mergeMethods[0] || "merge",
        );
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [fullName, number, retry]);

  async function merge() {
    if (
      !detail?.canMerge ||
      !confirming ||
      saving ||
      loading ||
      error ||
      submitting.current
    )
      return;
    submitting.current = true;
    setSaving(true);
    try {
      const result = await api.mergePullRequest(fullName, number, {
        sha: detail.headSha,
        base: detail.base,
        method,
      });
      if (!result.merged)
        throw new Error(
          "GitHub did not confirm this merge. Refresh the pull request before trying again.",
        );
      setMergedSha(result.sha);
      merged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The pull request could not be merged. Refresh its status and try again.",
      );
      setConfirming(false);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  const done = Boolean(mergedSha || detail?.merged);
  const dismiss = () => {
    if (!saving) close();
  };
  return (
    <dialog
      ref={dialog}
      className="modal pr-details"
      aria-labelledby="pr-details-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id="pr-details-title">
            {done ? "Pull request merged" : `Pull request #${number}`}
          </h2>
          <p className="pr-repo">{fullName}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close pull request"
          disabled={saving}
          onClick={dismiss}
        >
          <XIcon />
        </button>
      </div>
      {error && (
        <div className="pr-message" role="alert">
          {error}
        </div>
      )}
      {!detail ? (
        <div className="pr-detail-loading" role="status">
          {loading ? (
            <>
              <SyncIcon className="spin" /> Loading pull request…
            </>
          ) : (
            <button
              className="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
      ) : done ? (
        <div className="pr-success" role="status">
          <GitMergeIcon size={32} className="green" />
          <h3>{detail.title}</h3>
          <p>
            #{number} has been merged into <b>{detail.base}</b> on GitHub.
          </p>
          {mergedSha && (
            <p className="pr-merge-sha">
              Commit <code>{mergedSha.slice(0, 7)}</code>
            </p>
          )}
          <div className="modal-actions">
            <button className="button primary" onClick={dismiss}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pr-detail-title">
            <GitPullRequestIcon
              size={20}
              className={detail.draft ? "muted" : "green"}
            />
            <h3>{detail.title}</h3>
          </div>
          <div className="pr-detail-meta">
            <span className="badge">
              {detail.draft
                ? "Draft"
                : detail.state === "closed"
                  ? "Closed"
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
          {!confirming ? (
            <>
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
              <div className="pr-checks">
                <div className="pr-checks-heading">
                  <h3>Checks</h3>
                  <button
                    className="text-button"
                    disabled={loading || saving}
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    <SyncIcon size={12} className={loading ? "spin" : ""} />{" "}
                    {loading ? "Checking…" : "Refresh status"}
                  </button>
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
                        <StatusIcon status={check.status} />
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
              <div className="pr-merge-section">
                {detail.mergeBlockReason ? (
                  <p className="pr-check-warning">{detail.mergeBlockReason}</p>
                ) : (
                  <p className="pr-merge-ready">
                    <CheckCircleIcon size={14} /> Ready to merge. GitHub will
                    recheck its rules when you confirm.
                  </p>
                )}
                {detail.mergeMethods.length > 0 && (
                  <>
                    <label className="field-label" htmlFor="pr-merge-method">
                      Merge method
                    </label>
                    <select
                      id="pr-merge-method"
                      value={method}
                      disabled={saving || loading || !detail.canMerge}
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
              </div>
            </>
          ) : (
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
                Reviewed commit: <code>{detail.headSha.slice(0, 7)}</code>. If
                new commits arrive, you’ll need to refresh and confirm again.
              </p>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="button pr-external"
              disabled={saving}
              onClick={() => external(detail.url)}
            >
              Full diff on GitHub <ArrowUpRightIcon size={12} />
            </button>
            {confirming ? (
              <>
                <button
                  className="button"
                  disabled={saving}
                  onClick={() => setConfirming(false)}
                >
                  Back
                </button>
                <button
                  className="button primary"
                  disabled={saving || loading || Boolean(error)}
                  onClick={merge}
                >
                  <GitMergeIcon size={14} />
                  {saving ? "Merging…" : "Confirm merge"}
                </button>
              </>
            ) : (
              <>
                <button className="button" onClick={dismiss}>
                  Close
                </button>
                <button
                  className="button primary"
                  disabled={!detail.canMerge || loading || Boolean(error)}
                  onClick={() => setConfirming(true)}
                >
                  <GitMergeIcon size={14} />
                  Merge pull request
                </button>
              </>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
