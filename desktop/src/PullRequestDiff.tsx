import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import type { ParsedDiff } from "./diff-lines.mjs";
import type { HighlightedDiff } from "./diff-highlighting.mjs";

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
  base,
  active,
  refreshVersion,
}: {
  fullName: string;
  number: number;
  headSha: string;
  base: string;
  active: boolean;
  refreshVersion: number;
}) {
  const key = JSON.stringify([fullName, number, headSha, base]);
  const [load, setLoad] = useState<LoadState>({
    key: "",
    result: null,
    loading: true,
    error: "",
  });
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState({ key: "", filename: "" });
  const codeViewport = useRef<HTMLDivElement>(null);
  const scrollScope = useRef(key);
  const filePositions = useRef(
    new Map<string, { top: number; left: number }>(),
  );
  const [syntax, setSyntax] = useState<{
    parsed: ParsedDiff;
    filename: string;
    result: HighlightedDiff;
  } | null>(null);
  useEffect(() => {
    let current = true;
    // Revalidate this revision without removing the reader's current file or viewport.
    setLoad((previous) => ({
      key,
      result: previous.key === key ? previous.result : null,
      loading: true,
      error: "",
    }));
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
        setLoad((previous) => ({
          key,
          result: previous.key === key ? previous.result : null,
          loading: false,
          error,
        }));
      });
    return () => {
      current = false;
    };
  }, [fullName, number, headSha, key, retry, refreshVersion]);

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
  const filename = file?.filename;
  useLayoutEffect(() => {
    if (scrollScope.current !== key) {
      filePositions.current.clear();
      scrollScope.current = key;
    }
    if (!active) return;
    const viewport = codeViewport.current;
    if (!viewport) return;
    const position = filename ? filePositions.current.get(filename) : undefined;
    viewport.scrollTop = position?.top ?? 0;
    viewport.scrollLeft = position?.left ?? 0;
  }, [key, filename, active]);
  useEffect(() => {
    let current = true;
    if (!filename || !parsed?.rows.length) return;
    // The grammar bundle loads only for an opened text diff; plain text stays readable meanwhile.
    import("./diff-highlighting.mjs")
      .then(({ highlightDiffLines }) => {
        if (current)
          setSyntax({
            parsed,
            filename,
            result: highlightDiffLines(filename, parsed.rows),
          });
      })
      .catch(() => {
        if (current) setSyntax(null);
      });
    return () => {
      current = false;
    };
  }, [filename, parsed]);
  const syntaxRows =
    syntax?.parsed === parsed && syntax.filename === filename
      ? syntax.result.rows
      : null;
  const githubDiff = `https://github.com/${fullName}/pull/${number}/files`;
  const refreshControl = (
    <button
      className="text-button"
      disabled={visible.loading}
      onClick={() => setRetry((value) => value + 1)}
    >
      <SyncIcon size={12} className={visible.loading ? "spin" : ""} />
      Refresh files
    </button>
  );

  return (
    <section className="pr-diff" aria-label="Changed files">
      {!files.length && <div className="pr-diff-header">{refreshControl}</div>}
      {visible.error && (
        <div className="pr-diff-notice" role="alert">
          {visible.result && (
            <p>Refresh failed. Showing the last loaded changes.</p>
          )}
          <p>{visible.error}</p>
          <button
            className="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry files
          </button>
        </div>
      )}
      {visible.loading && !visible.result ? (
        <div className="pr-diff-empty" role="status">
          <SyncIcon className="spin" size={16} /> Loading changed files…
        </div>
      ) : !visible.result && visible.error ? null : !files.length ? (
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
                  <div className="pr-diff-file-actions">
                    {refreshControl}
                    <button
                      className="text-button"
                      onClick={() => external(file.url || githubDiff)}
                    >
                      View on GitHub <ArrowUpRightIcon size={12} />
                    </button>
                  </div>
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
                      ref={codeViewport}
                      onScroll={(event) => {
                        if (!active || !filename || scrollScope.current !== key)
                          return;
                        filePositions.current.set(filename, {
                          top: event.currentTarget.scrollTop,
                          left: event.currentTarget.scrollLeft,
                        });
                      }}
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
                                  {syntaxRows?.[index]?.map(
                                    (token, tokenIndex) => (
                                      <span
                                        key={tokenIndex}
                                        className={token.className || undefined}
                                      >
                                        {token.text}
                                      </span>
                                    ),
                                  ) ?? line.text}
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
