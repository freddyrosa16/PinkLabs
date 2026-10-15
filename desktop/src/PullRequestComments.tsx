import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CommentDiscussionIcon,
  SyncIcon,
} from "@primer/octicons-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ago, api, external } from "./api";
import type { PullRequestComment } from "./types";

const MAX_COMMENT_LENGTH = 65_536;
// Drafts stay in this app session only, including when another PR is selected.
const drafts = new Map<string, string>();
const uncertainPosts = new Set<string>();
const pendingPosts = new Map<string, Promise<void>>();
interface CommentThread {
  comments: PullRequestComment[];
  truncated: boolean;
  canComment: boolean;
  commentBlockReason: string;
}
interface CommentsProps {
  fullName: string;
  number: number;
  refreshVersion: string;
  disabled?: boolean;
  busyChanged?: (busy: boolean) => void;
}

function commentError(cause: unknown) {
  return (
    cause instanceof Error ? cause.message : "GitHub could not be reached."
  ).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
function orderComments(comments: PullRequestComment[]) {
  return [
    ...new Map(comments.map((comment) => [comment.id, comment])).values(),
  ].sort((left, right) => {
    const difference = Date.parse(left.date) - Date.parse(right.date);
    return Number.isFinite(difference) ? difference : 0;
  });
}
function CommentMarkdown({ body }: { body: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ href, children }) => (
          <button
            type="button"
            className="markdown-link"
            onClick={() => href && external(href)}
          >
            {children}
          </button>
        ),
        img: ({ alt }) => (
          <span className="muted">{alt ? `[Image: ${alt}]` : "[Image]"}</span>
        ),
      }}
    >
      {body}
    </Markdown>
  );
}
function reviewLabel(state?: string) {
  const labels: Record<string, string> = {
    APPROVED: "Approved review",
    CHANGES_REQUESTED: "Changes requested",
    COMMENTED: "Review comment",
    DISMISSED: "Dismissed review",
    PENDING: "Pending review",
  };
  return labels[state?.toUpperCase() ?? ""] || "Review";
}

export function PullRequestComments(props: CommentsProps) {
  // Identity changes isolate drafts, outstanding reads, and post outcomes.
  return (
    <CommentsPanel
      key={JSON.stringify([props.fullName, props.number])}
      {...props}
    />
  );
}

function CommentsPanel({
  fullName,
  number,
  refreshVersion,
  disabled = false,
  busyChanged,
}: CommentsProps) {
  const identity = JSON.stringify([fullName, number]);
  const [thread, setThread] = useState<CommentThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualLoading, setManualLoading] = useState(false);
  const [readError, setReadError] = useState("");
  const [draft, setDraft] = useState(() => drafts.get(identity) ?? "");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [posting, setPosting] = useState(() => pendingPosts.has(identity));
  const [postError, setPostError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsRecheck, setNeedsRecheck] = useState(() =>
    uncertainPosts.has(identity),
  );
  const mounted = useRef(true);
  const submitting = useRef(pendingPosts.has(identity));
  const recoveryRequired = useRef(uncertainPosts.has(identity));
  const busyCallback = useRef(busyChanged);
  busyCallback.current = busyChanged;
  const readSequence = useRef(0);
  const activeRead = useRef<Promise<boolean> | null>(null);
  const confirmedComments = useRef(new Map<string, PullRequestComment>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readSequence.current++;
      activeRead.current = null;
      if (submitting.current) busyCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    let current = true;
    const pending = pendingPosts.get(identity);
    // A sidebar navigation can remount this panel while its original write is pending.
    const settled = () => {
      if (!current) return;
      submitting.current = false;
      const uncertain = uncertainPosts.has(identity);
      recoveryRequired.current = uncertain;
      setNeedsRecheck(uncertain);
      setDraft(drafts.get(identity) ?? "");
      setPosting(false);
      busyCallback.current?.(false);
      if (!uncertain) setNotice("Comment posted.");
    };
    if (pending) {
      submitting.current = true;
      setPosting(true);
      busyCallback.current?.(true);
      void pending.then(settled);
    } else if (submitting.current) settled();
    return () => {
      current = false;
    };
  }, [identity]);

  const readComments = useCallback((): Promise<boolean> => {
    if (submitting.current) return Promise.resolve(false);
    if (activeRead.current) return activeRead.current;
    const sequence = ++readSequence.current;
    setLoading(true);
    const request = (async () => {
      try {
        const result = await api.getPullRequestComments(fullName, number);
        if (!mounted.current || sequence !== readSequence.current) return false;
        for (const comment of result.comments)
          confirmedComments.current.delete(comment.id);
        setThread({
          ...result,
          comments: orderComments([
            ...result.comments,
            ...confirmedComments.current.values(),
          ]),
        });
        setReadError("");
        return true;
      } catch (cause) {
        if (mounted.current && sequence === readSequence.current)
          setReadError(commentError(cause));
        return false;
      } finally {
        if (mounted.current && sequence === readSequence.current) {
          setLoading(false);
          activeRead.current = null;
        }
      }
    })();
    activeRead.current = request;
    return request;
  }, [fullName, number]);

  useEffect(() => {
    if (!posting) void readComments();
  }, [refreshVersion, posting, readComments]);

  async function refreshComments() {
    if (disabled || submitting.current) return;
    setManualLoading(true);
    const refreshed = await readComments();
    if (!mounted.current) return;
    setManualLoading(false);
    if (refreshed && recoveryRequired.current) {
      recoveryRequired.current = false;
      uncertainPosts.delete(identity);
      setNeedsRecheck(false);
      setPostError("");
      setNotice(
        "Comments refreshed. Check whether your comment already appears before posting again.",
      );
    }
  }
  function updateDraft(value: string) {
    setDraft(value);
    if (value) drafts.set(identity, value);
    else drafts.delete(identity);
  }
  async function postComment() {
    if (
      disabled ||
      submitting.current ||
      pendingPosts.has(identity) ||
      !thread?.canComment ||
      recoveryRequired.current ||
      !draft.trim() ||
      draft.length > MAX_COMMENT_LENGTH
    )
      return;
    const submitted = draft;
    let completePending!: () => void;
    const pending = new Promise<void>((resolve) => {
      completePending = resolve;
    });
    pendingPosts.set(identity, pending);
    submitting.current = true;
    setPosting(true);
    busyCallback.current?.(true);
    setPostError("");
    setNotice("");
    // A response begun before this write must not hide the newly posted comment.
    readSequence.current++;
    activeRead.current = null;
    setLoading(false);
    setManualLoading(false);
    try {
      const comment = await api.createPullRequestComment(fullName, number, {
        body: submitted,
      });
      if (drafts.get(identity) === submitted) drafts.delete(identity);
      uncertainPosts.delete(identity);
      if (!mounted.current) return;
      confirmedComments.current.set(comment.id, comment);
      setThread(
        (previous) =>
          previous && {
            ...previous,
            comments: orderComments([...previous.comments, comment]),
          },
      );
      setDraft((current) => (current === submitted ? "" : current));
      setNotice("Comment posted.");
    } catch (cause) {
      uncertainPosts.add(identity);
      if (!mounted.current) return;
      recoveryRequired.current = true;
      setNeedsRecheck(true);
      setPostError(
        `${commentError(cause)} Your draft is kept. Refresh comments and check whether it was posted before trying again.`,
      );
    } finally {
      if (pendingPosts.get(identity) === pending) pendingPosts.delete(identity);
      completePending();
      submitting.current = false;
      if (mounted.current) {
        setPosting(false);
        busyCallback.current?.(false);
      }
    }
  }

  const composerId = `pr-comment-draft-${number}`;
  const cannotPost =
    disabled ||
    posting ||
    !thread?.canComment ||
    needsRecheck ||
    !draft.trim() ||
    draft.length > MAX_COMMENT_LENGTH;
  return (
    <section className="pr-comments" aria-label="Pull request conversation">
      <div className="pr-comments-heading">
        <h3>
          <CommentDiscussionIcon size={16} /> Conversation{" "}
          {thread && <span>{thread.comments.length}</span>}
        </h3>
        <button
          type="button"
          className="text-button"
          disabled={disabled || posting || manualLoading}
          onClick={() => void refreshComments()}
        >
          <SyncIcon size={12} className={manualLoading ? "spin" : ""} />{" "}
          {manualLoading ? "Refreshing…" : "Refresh comments"}
        </button>
      </div>
      {readError && (
        <div className="pr-comments-message" role="alert">
          {thread
            ? "The conversation could not be refreshed. Previously loaded comments are still shown."
            : "The conversation could not be loaded."}{" "}
          {readError}
          <button
            type="button"
            className="text-button"
            disabled={disabled || posting || manualLoading}
            onClick={() => void refreshComments()}
          >
            Retry comments
          </button>
        </div>
      )}
      {!thread ? (
        <p className="pr-comments-empty" role="status">
          {loading
            ? "Loading conversation…"
            : "Use Refresh comments to try again."}
        </p>
      ) : (
        <>
          {thread.truncated && (
            <p className="pr-comments-message">
              Some comments or reviews are omitted.{" "}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  external(`https://github.com/${fullName}/pull/${number}`)
                }
              >
                Read the full conversation on GitHub{" "}
                <ArrowUpRightIcon size={12} />
              </button>
            </p>
          )}
          {thread.comments.length === 0 ? (
            <p className="pr-comments-empty">No comments or reviews yet.</p>
          ) : (
            <ol className="pr-comments-list">
              {thread.comments.map((comment) => (
                <li key={comment.id} className="pr-comment">
                  <article>
                    <header className="pr-comment-header">
                      <strong>{comment.author.login}</strong>
                      <span className="pr-comment-kind">
                        {comment.kind === "review"
                          ? reviewLabel(comment.reviewState)
                          : comment.kind === "inline"
                            ? "Code comment"
                            : "Comment"}
                      </span>
                      <time
                        dateTime={comment.date}
                        title={new Date(comment.date).toLocaleString()}
                      >
                        {ago(comment.date)
                          ? `${ago(comment.date)} ago`
                          : "Date unavailable"}
                      </time>
                      {comment.updatedAt &&
                        comment.updatedAt !== comment.date && (
                          <span
                            className="pr-comment-edited"
                            title={`Edited ${new Date(comment.updatedAt).toLocaleString()}`}
                          >
                            edited
                          </span>
                        )}
                      {comment.url && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Open ${comment.author.login}'s comment on GitHub`}
                          onClick={() => external(comment.url)}
                        >
                          <ArrowUpRightIcon size={13} />
                        </button>
                      )}
                    </header>
                    {(comment.path || comment.replyTo) && (
                      <p className="pr-comment-context">
                        {comment.path && (
                          <code>
                            {comment.path}
                            {comment.line != null ? `:${comment.line}` : ""}
                          </code>
                        )}
                        {comment.replyTo != null && (
                          <span>Reply in a code discussion</span>
                        )}
                      </p>
                    )}
                    <div className="pr-comment-body markdown">
                      {comment.body.trim() ? (
                        <CommentMarkdown body={comment.body} />
                      ) : (
                        <p className="muted">
                          {comment.kind === "review"
                            ? "No review message provided."
                            : "No comment text available."}
                        </p>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <form
        className="pr-comment-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void postComment();
        }}
      >
        <div className="pr-comment-composer-heading">
          <label htmlFor={composerId}>Add a comment</label>
          <span>General conversation</span>
        </div>
        <div
          className="pr-comment-editor-tabs"
          role="tablist"
          aria-label="Comment editor"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "write"}
            aria-controls={`pr-comment-write-${number}`}
            id={`pr-comment-write-tab-${number}`}
            className={mode === "write" ? "active" : ""}
            onClick={() => setMode("write")}
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "preview"}
            aria-controls={`pr-comment-preview-${number}`}
            id={`pr-comment-preview-tab-${number}`}
            className={mode === "preview" ? "active" : ""}
            onClick={() => setMode("preview")}
          >
            Preview
          </button>
        </div>
        <div
          role="tabpanel"
          id={`pr-comment-write-${number}`}
          aria-labelledby={`pr-comment-write-tab-${number}`}
          hidden={mode !== "write"}
        >
          <textarea
            id={composerId}
            value={draft}
            disabled={disabled}
            maxLength={MAX_COMMENT_LENGTH}
            rows={5}
            placeholder="Leave a comment about this pull request…"
            aria-describedby={`pr-comment-help-${number}`}
            onChange={(event) => updateDraft(event.target.value)}
          />
        </div>
        <div
          className="pr-comment-preview markdown"
          role="tabpanel"
          id={`pr-comment-preview-${number}`}
          aria-labelledby={`pr-comment-preview-tab-${number}`}
          hidden={mode !== "preview"}
        >
          {draft.trim() ? (
            <CommentMarkdown body={draft} />
          ) : (
            <p className="muted">Nothing to preview yet.</p>
          )}
        </div>
        <p className="pr-comment-help" id={`pr-comment-help-${number}`}>
          Markdown supported. Posts a general comment on GitHub.
        </p>
        {thread && !thread.canComment && (
          <p className="pr-comments-message">
            {thread.commentBlockReason ||
              "Commenting is unavailable for this pull request."}
          </p>
        )}
        {postError && (
          <div className="pr-comments-message" role="alert">
            {postError}
          </div>
        )}
        {needsRecheck && !postError && (
          <div className="pr-comments-message" role="alert">
            A previous comment could not be confirmed. Refresh comments and
            check whether it was posted before trying again.
          </div>
        )}
        {notice && (
          <p className="pr-comment-notice" role="status">
            {notice}
          </p>
        )}
        <div className="pr-comment-composer-actions">
          <small>
            {draft.length.toLocaleString()} /{" "}
            {MAX_COMMENT_LENGTH.toLocaleString()}
          </small>
          <button
            className="button primary"
            type="submit"
            disabled={cannotPost}
          >
            {posting ? (
              <>
                <SyncIcon size={13} className="spin" /> Posting…
              </>
            ) : (
              "Post comment"
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
