import { useEffect, useRef, useState } from "react";
import {
  GitMergeIcon,
  GitPullRequestIcon,
  GitPullRequestClosedIcon,
  PlusIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { api, ago } from "./api";
import { PullRequestDetails } from "./PullRequestDetails";
import type { PullRequestList, PullRequestState, Repository } from "./types";

export function PullRequestWorkspace({
  repo,
  selectedNumber,
  selectPull,
  createPull,
  changed,
  refreshRepository,
}: {
  repo: Repository;
  selectedNumber: number | null;
  selectPull: (number: number | null) => void;
  createPull: () => void;
  changed: (message: string) => void;
  refreshRepository: () => void;
}) {
  const [filter, setFilter] = useState<PullRequestState>("all");
  const [list, setList] = useState<PullRequestList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const selection = useRef({ number: selectedNumber, selectPull });
  selection.current = { number: selectedNumber, selectPull };
  useEffect(() => {
    let current = true;
    setLoading(true);
    api
      .listPullRequests(repo.fullName, filter)
      .then((result) => {
        if (!current) return;
        setList(result);
        setError("");
        if (selection.current.number === null && result.pulls[0])
          selection.current.selectPull(result.pulls[0].number);
      })
      .catch((cause: Error) => {
        if (current)
          setError(
            cause.message.replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              "",
            ),
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [repo.fullName, repo.fetchedAt, filter, revision]);
  const chooseFilter = (value: PullRequestState) => {
    if (busy || filter === value) return;
    setFilter(value);
    setList(null);
    selectPull(null);
  };
  const openCount =
    list && !list.truncated && filter !== "closed"
      ? list.pulls.filter((pull) => pull.state === "open").length
      : repo.openPrCount;
  const selectedRow = list?.pulls.find(
    (pull) => pull.number === selectedNumber,
  );
  return (
    <section className="pr-workspace" aria-label="Pull request workspace">
      <div className="section-heading pr-workspace-heading">
        <div>
          <h2>
            Pull requests <span>{openCount} open</span>
          </h2>
          <p>Review the changes, merge, and clean up branches here.</p>
        </div>
        <button className="button" disabled={busy} onClick={createPull}>
          <PlusIcon size={13} /> New pull request
        </button>
      </div>
      <div className="pr-list-toolbar">
        <div className="pr-filter-tabs" aria-label="Filter pull requests">
          {(
            [
              ["all", "All"],
              ["open", "Open"],
              ["closed", "Closed / merged"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              disabled={busy}
              onClick={() => chooseFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="text-button"
          disabled={loading || busy}
          onClick={() => {
            setRevision((n) => n + 1);
            refreshRepository();
          }}
          aria-label="Refresh pull request list"
        >
          <SyncIcon size={12} /> Refresh list
        </button>
      </div>
      {error && (
        <div className="pr-message" role="alert">
          {error}{" "}
          <button
            className="inline-link"
            onClick={() => setRevision((n) => n + 1)}
            disabled={loading || busy}
          >
            Retry
          </button>
        </div>
      )}
      <div className="pr-workspace-list" aria-label="Pull requests">
        {!list ? (
          <div className="empty-row">
            {loading
              ? "Loading pull requests…"
              : "Pull requests could not be loaded."}
          </div>
        ) : list.pulls.length ? (
          list.pulls.map((pull) => (
            <button
              key={pull.number}
              className={`pull-row ${selectedNumber === pull.number ? "is-selected" : ""}`}
              aria-pressed={selectedNumber === pull.number}
              disabled={busy}
              onClick={() => selectPull(pull.number)}
            >
              {pull.merged ? (
                <GitMergeIcon className="pr-merged-icon" />
              ) : pull.state === "closed" ? (
                <GitPullRequestClosedIcon className="red" />
              ) : (
                <GitPullRequestIcon
                  className={pull.draft ? "muted" : "green"}
                />
              )}
              <div className="row-main">
                <strong>{pull.title}</strong>
                <small>
                  #{pull.number} · {pull.author.login} · opened {ago(pull.date)}{" "}
                  ago
                </small>
              </div>
              <span className={`pr-state-label ${pull.merged ? "merged" : ""}`}>
                {pull.merged
                  ? "Merged"
                  : pull.state === "closed"
                    ? "Closed"
                    : pull.draft
                      ? "Draft"
                      : "Open"}
              </span>
            </button>
          ))
        ) : (
          <div className="empty-row">
            {filter === "open"
              ? "No open pull requests. Choose All or Closed / merged to revisit earlier work."
              : filter === "closed"
                ? "No closed or merged pull requests yet."
                : "No pull requests yet. Create one to start a review."}
          </div>
        )}
      </div>
      {list?.truncated && (
        <p className="pr-list-limit">
          Showing the 100 most recently updated pull requests in this view.
        </p>
      )}
      {selectedNumber !== null ? (
        <PullRequestDetails
          key={`${repo.fullName}/${selectedNumber}`}
          fullName={repo.fullName}
          number={selectedNumber}
          busyChanged={setBusy}
          refreshVersion={`${revision}:${selectedRow?.state ?? ""}:${selectedRow?.merged ?? ""}`}
          changed={(message) => {
            setRevision((n) => n + 1);
            changed(message);
          }}
        />
      ) : (
        <div className="pr-selection-empty">
          <GitPullRequestIcon size={28} />
          <h3>Select a pull request to review</h3>
          <p>Its description, code changes, and actions appear here.</p>
        </div>
      )}
    </section>
  );
}
