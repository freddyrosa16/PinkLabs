import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRightIcon,
  FileCodeIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { api, external } from "./api";
import {
  MAX_DIFF_ROWS,
  MAX_DIFF_LINE_LENGTH,
  parseUnifiedDiff,
} from "./diff-lines.mjs";

interface ChangedFile {
  filename: string;
  previousFilename: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  url: string;
}
interface FilesResult {
  headSha: string;
  files: ChangedFile[];
  truncated: boolean;
}
interface LoadState {
  key: string;
  result: FilesResult | null;
  loading: boolean;
  error: string;
}

export function PullRequestDiff({
  fullName,
  number,
  headSha,
}: {
  fullName: string;
  number: number;
  headSha: string;
}) {
  const key = JSON.stringify([fullName, number, headSha]);
  const [load, setLoad] = useState<LoadState>({
    key: "",
    result: null,
    loading: true,
    error: "",
  });
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState({ key: "", filename: "" });
  useEffect(() => {
    let current = true;
    setLoad({ key, result: null, loading: true, error: "" });
    api
      .getPullRequestFiles(fullName, number, headSha)
      .then((result) => {
        if (!current) return;
        if (result.headSha.toLowerCase() !== headSha.toLowerCase()) {
          throw new Error(
            "This pull request changed. Refresh its status before reviewing the latest files.",
          );
        }
        setLoad({ key, result, loading: false, error: "" });
      })
      .catch((cause: unknown) => {
        if (!current) return;
        const error = (
          cause instanceof Error
            ? cause.message
            : "Changed files could not be loaded. Try again."
        ).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
        setLoad({ key, result: null, loading: false, error });
      });
    return () => {
      current = false;
    };
  }, [fullName, number, headSha, key, retry]);

  // A changed prop hides old data before the effect runs, as well as ignoring late responses.
  const visible =
    load.key === key ? load : { key, result: null, loading: true, error: "" };
  const files = visible.result?.files ?? [];
  const file =
    (selection.key === key &&
      files.find((item) => item.filename === selection.filename)) ||
    files[0];
  const parsed = useMemo(
    () => (file?.patch ? parseUnifiedDiff(file.patch) : null),
    [file?.patch],
  );
  const githubDiff = `https://github.com/${fullName}/pull/${number}/files`;

  return (
    <section className="pr-diff" aria-label="Changed files">
      <div className="pr-diff-header">
        <h3>Changed files {visible.result && <span>{files.length}</span>}</h3>
        <button
          className="text-button"
          disabled={visible.loading}
          onClick={() => setRetry((value) => value + 1)}
        >
          <SyncIcon size={12} className={visible.loading ? "spin" : ""} />{" "}
          Refresh files
        </button>
      </div>
      {visible.error ? (
        <div className="pr-diff-notice" role="alert">
          <p>{visible.error}</p>
          <button
            className="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry files
          </button>
        </div>
      ) : visible.loading ? (
        <div className="pr-diff-empty" role="status">
          <SyncIcon className="spin" size={16} /> Loading changed files…
        </div>
      ) : !files.length ? (
        <p className="pr-diff-empty">
          No changed files were returned for this pull request.
        </p>
      ) : (
        <>
          {visible.result?.truncated && (
            <p className="pr-diff-notice">
              Some changes are omitted or shortened. {files.length} files
              loaded.{" "}
              <button
                className="text-button"
                onClick={() => external(githubDiff)}
              >
                See all changes on GitHub <ArrowUpRightIcon size={12} />
              </button>
            </p>
          )}
          <div className="pr-diff-layout">
            <nav className="pr-diff-files" aria-label="Changed file selection">
              {files.map((item) => (
                <button
                  key={item.filename}
                  className={`pr-diff-file${item.filename === file?.filename ? " is-selected" : ""}`}
                  aria-label={item.filename}
                  aria-pressed={item.filename === file?.filename}
                  title={item.filename}
                  onClick={() => setSelection({ key, filename: item.filename })}
                >
                  <FileCodeIcon size={14} />
                  <span className="pr-diff-file-name">
                    {item.filename}
                    <small className="pr-diff-file-status">{item.status}</small>
                  </span>
                  <span className="pr-diff-file-stats">
                    <span className="green">+{item.additions}</span>
                    <span className="red">−{item.deletions}</span>
                  </span>
                </button>
              ))}
            </nav>
            {file && (
              <div className="pr-diff-panel">
                <div className="pr-diff-file-header">
                  <div>
                    <strong>{file.filename}</strong>
                    {file.previousFilename && (
                      <small>Renamed from {file.previousFilename}</small>
                    )}
                  </div>
                  <button
                    className="text-button"
                    onClick={() => external(file.url || githubDiff)}
                  >
                    View on GitHub <ArrowUpRightIcon size={12} />
                  </button>
                </div>
                {!parsed?.rows.length ? (
                  <p className="pr-diff-empty">
                    GitHub did not provide a text patch for this file. It may be
                    binary, too large, or have no textual changes.
                  </p>
                ) : (
                  <>
                    {(parsed.hasMoreLines || parsed.shortenedLines > 0) && (
                      <p className="pr-diff-notice">
                        {parsed.hasMoreLines && (
                          <>
                            Showing the first {MAX_DIFF_ROWS.toLocaleString()}{" "}
                            diff lines.{" "}
                          </>
                        )}
                        {parsed.shortenedLines > 0 && (
                          <>
                            {parsed.shortenedLines} displayed{" "}
                            {parsed.shortenedLines === 1
                              ? "line is"
                              : "lines are"}{" "}
                            shortened to {MAX_DIFF_LINE_LENGTH.toLocaleString()}{" "}
                            characters.{" "}
                          </>
                        )}
                        Use GitHub above for the full patch.
                      </p>
                    )}
                    <div
                      className="pr-diff-code-scroll"
                      tabIndex={0}
                      aria-label={`Diff for ${file.filename}`}
                    >
                      <table className="pr-diff-code">
                        <thead>
                          <tr>
                            <th scope="col">Old</th>
                            <th scope="col">New</th>
                            <th scope="col" aria-label="Change type">
                              ±
                            </th>
                            <th scope="col">Code</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.rows.map((line, index) => (
                            <tr
                              key={index}
                              className={`pr-diff-line pr-diff-${line.kind}`}
                            >
                              <td className="pr-diff-line-number">
                                {line.oldLine}
                              </td>
                              <td className="pr-diff-line-number">
                                {line.newLine}
                              </td>
                              <td
                                className="pr-diff-sign"
                                aria-label={
                                  line.kind === "addition"
                                    ? "Added"
                                    : line.kind === "deletion"
                                      ? "Removed"
                                      : undefined
                                }
                              >
                                {line.kind === "addition"
                                  ? "+"
                                  : line.kind === "deletion"
                                    ? "−"
                                    : " "}
                              </td>
                              <td className="pr-diff-line-code">
                                <code>
                                  {line.text}
                                  {line.truncated && (
                                    <span
                                      className="pr-diff-shortened"
                                      aria-label="Line shortened"
                                    >
                                      …
                                    </span>
                                  )}
                                </code>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
