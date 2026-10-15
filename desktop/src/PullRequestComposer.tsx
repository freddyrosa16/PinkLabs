import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import { api, external } from "./api";
import type { BranchComparison, PullRequest } from "./types";

export function PullRequestComposer({
  fullName,
  defaultBranch,
  open,
  close,
  created,
}: {
  fullName: string;
  defaultBranch: string;
  open: boolean;
  close: () => void;
  created: (pull: PullRequest) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchError, setBranchError] = useState("");
  const [retry, setRetry] = useState(0);
  const [base, setBase] = useState(defaultBranch);
  const [head, setHead] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [comparison, setComparison] = useState<{
    key: string;
    data: BranchComparison;
  } | null>(null);
  const [compareError, setCompareError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [result, setResult] = useState<PullRequest | null>(null);
  const selectionKey = JSON.stringify([base, head]);
  const checked = comparison?.key === selectionKey ? comparison.data : null;
  const canSubmit = Boolean(
    branches &&
    !branchError &&
    checked &&
    checked.aheadBy > 0 &&
    !checked.existingPull &&
    title.trim() &&
    !saving,
  );

  useEffect(() => {
    const node = dialog.current;
    if (open && !node?.open) node?.showModal();
    else if (!open && node?.open) node.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setBranchError("");
    api
      .listBranches(fullName)
      .then((names) => {
        if (current) setBranches(names);
      })
      .catch((error: Error) => {
        if (current) setBranchError(error.message);
      });
    return () => {
      current = false;
    };
  }, [fullName, open, retry]);

  useEffect(() => {
    setComparison(null);
    setCompareError("");
    setSubmitError("");
    if (!open || !base || !head || base === head) return;
    let current = true;
    api
      .compareBranches(fullName, { base, head })
      .then((data) => {
        if (current) setComparison({ key: selectionKey, data });
      })
      .catch((error: Error) => {
        if (current) setCompareError(error.message);
      });
    return () => {
      current = false;
    };
  }, [fullName, base, head, selectionKey, open, retry]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSubmitError("");
    try {
      const pull = await api.createPullRequest(fullName, {
        base,
        head,
        title: title.trim(),
        body,
        draft,
      });
      setResult(pull);
      setTitle("");
      setBody("");
      setHead("");
      created(pull);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Could not create this pull request. Your draft is still here.",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  const dismiss = () => {
    if (saving) return;
    close();
    setResult(null);
  };
  return (
    <dialog
      className="modal pr-composer"
      ref={dialog}
      aria-labelledby="pr-composer-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id="pr-composer-title">
            {result ? "Pull request created" : "New pull request"}
          </h2>
          <p className="pr-repo">{fullName}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close pull request form"
          disabled={saving}
          onClick={dismiss}
        >
          <XIcon />
        </button>
      </div>
      {result ? (
        <div className="pr-success" role="status">
          <CheckCircleIcon size={32} className="green" />
          <h3>{result.title}</h3>
          <p>
            #{result.number}
            {result.draft ? " · Draft" : " · Ready for review"}
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => external(result.url)}>
              View on GitHub <ArrowUpRightIcon size={13} />
            </button>
            <button className="button primary" onClick={dismiss}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <p className="pr-intro">
            Bring changes from your branch into another branch.
          </p>
          {branchError ? (
            <div className="pr-message error" role="alert">
              {branchError}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          ) : null}
          <fieldset
            disabled={saving || !branches || Boolean(branchError)}
            className="pr-fields"
          >
            <div className="pr-branches">
              <label>
                <span className="field-label">
                  <GitBranchIcon size={13} /> Base · receives changes
                </span>
                <select
                  aria-label="Base branch"
                  value={base}
                  onChange={(event) => setBase(event.target.value)}
                >
                  {!branches?.includes(base) && (
                    <option value={base}>{base || "Choose branch"}</option>
                  )}
                  {branches?.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </label>
              <ArrowLeftIcon className="pr-branch-arrow" />
              <label>
                <span className="field-label">
                  <GitBranchIcon size={13} /> Compare · your changes
                </span>
                <select
                  aria-label="Compare branch"
                  value={head}
                  onChange={(event) => setHead(event.target.value)}
                >
                  <option value="">Choose branch</option>
                  {branches?.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="pr-comparison" aria-live="polite">
              {!branches && !branchError ? (
                <>
                  <SyncIcon className="spin" /> Loading branches…
                </>
              ) : !head ? (
                "Choose a branch you’ve pushed to GitHub."
              ) : base === head ? (
                "Choose two different branches."
              ) : compareError ? (
                <span className="red">
                  {compareError}{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    Retry
                  </button>
                </span>
              ) : !checked ? (
                <>
                  <SyncIcon className="spin" /> Checking branches…
                </>
              ) : checked.existingPull ? (
                <span>
                  A pull request already exists:{" "}
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => external(checked.existingPull!.url)}
                  >
                    #{checked.existingPull.number} {checked.existingPull.title}{" "}
                    <ArrowUpRightIcon size={12} />
                  </button>
                </span>
              ) : checked.aheadBy === 0 ? (
                "There are no new commits to bring into the base branch."
              ) : (
                <span>
                  <b className="green">
                    {checked.aheadBy}{" "}
                    {checked.aheadBy === 1 ? "commit" : "commits"} to bring in
                  </b>
                  {checked.behindBy > 0
                    ? ` · ${checked.behindBy} behind ${base}`
                    : " · Ready to open a pull request"}
                </span>
              )}
            </div>
            <label className="field-label" htmlFor="pr-title">
              Title
            </label>
            <input
              id="pr-title"
              required
              maxLength={256}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What does this change do?"
            />
            <label className="field-label" htmlFor="pr-body">
              Description <span>· Markdown supported</span>
            </label>
            <textarea
              id="pr-body"
              maxLength={60000}
              rows={7}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Describe what changed, why, and how you tested it."
            />
            <label className="pr-draft">
              <input
                type="checkbox"
                checked={draft}
                onChange={(event) => setDraft(event.target.checked)}
              />
              <span>
                Create as draft{" "}
                <small>Keep it marked as work in progress.</small>
              </span>
            </label>
          </fieldset>
          {submitError && (
            <div className="pr-message error" role="alert">
              {submitError}
            </div>
          )}
          <div className="modal-actions">
            <span className="pr-draft-hint">
              Closing keeps your text while this repository is selected.
            </span>
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={dismiss}
            >
              Close
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={!canSubmit}
            >
              <GitPullRequestIcon size={14} />
              {saving
                ? "Creating…"
                : draft
                  ? "Create draft"
                  : "Create pull request"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
