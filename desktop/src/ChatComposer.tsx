import { useLayoutEffect, useRef } from "react";
import {
  ArrowUpIcon,
  FileDirectoryIcon,
  SquareIcon,
} from "@primer/octicons-react";
import { ComposerPicker } from "./ComposerPicker";
import { providers, ProviderIcon } from "./providers";
import type { Project } from "./store";
import type { Provider } from "./types";

export function ChatComposer({
  draft,
  setDraft,
  provider,
  setProvider,
  projectId,
  setProjectId,
  projects,
  locked,
  running,
  busyElsewhere,
  submit,
  stop,
}: {
  draft: string;
  setDraft: (value: string) => void;
  provider: Provider;
  setProvider: (value: Provider) => void;
  projectId: string;
  setProjectId: (value: string) => void;
  projects: Project[];
  locked: boolean;
  running: boolean;
  busyElsewhere: boolean;
  submit: () => void;
  stop: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const textarea = input.current;
    const form = frame.current;
    if (!textarea || !form) return;
    const resize = () => {
      textarea.style.height = "0px";
      textarea.style.height = `${Math.min(textarea.scrollHeight, Math.max(64, Math.min(192, window.innerHeight * 0.26)))}px`;
    };
    resize();
    // Observe width changes from sidebar resizing, not the textarea's own height.
    let lastWidth = form.clientWidth;
    const widthObserver = new ResizeObserver(() => {
      if (form.clientWidth !== lastWidth) {
        lastWidth = form.clientWidth;
        resize();
      }
    });
    widthObserver.observe(form);
    window.addEventListener("resize", resize);
    return () => {
      widthObserver.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [draft]);

  return (
    <div className="composer-area">
      <form
        ref={frame}
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="An idea, a question, a place to begin…"
          aria-label="Message"
          aria-describedby="composer-disclosure"
          rows={2}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <ComposerPicker
            composerRef={frame}
            label="Conversation project"
            value={projectId}
            disabled={locked}
            onChange={setProjectId}
            options={[
              {
                value: "",
                label: "No project",
                icon: <FileDirectoryIcon size={16} />,
              },
              ...projects.map((p) => ({
                value: p.id,
                label: p.name,
                icon: <FileDirectoryIcon size={16} />,
              })),
            ]}
          />
          <ComposerPicker
            composerRef={frame}
            label="Model provider"
            value={provider}
            disabled={locked}
            align="right"
            onChange={(value) => setProvider(value as Provider)}
            options={providers.map((p) => ({
              value: p.id,
              label: p.name,
              icon: <ProviderIcon provider={p.id} />,
            }))}
          />
          {running ? (
            <button
              className="send-button stop"
              type="button"
              onClick={stop}
              aria-label="Stop reply"
            >
              <SquareIcon size={14} />
            </button>
          ) : (
            <button
              className="send-button"
              disabled={!draft.trim() || busyElsewhere}
              aria-label="Send message"
            >
              <ArrowUpIcon size={20} />
            </button>
          )}
        </div>
      </form>
      <div className="composer-footer">
        <p className="composer-note" id="composer-disclosure">
          {busyElsewhere
            ? "Another conversation is finishing a practice reply."
            : "Local practice · No AI model connected yet."}
        </p>
        <span className="composer-key-hint">Shift Enter for a new line</span>
      </div>
    </div>
  );
}
