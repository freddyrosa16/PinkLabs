import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronRightIcon,
  FileDirectoryIcon,
  MarkGithubIcon,
  XIcon,
} from "@primer/octicons-react";
import { api } from "./api";
import { isRepositoryName } from "./store";
import type { RepoSummary } from "./types";

export function ModalDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <XIcon />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function RepoChooser({
  current,
  select,
}: {
  current: string;
  select: (name: string) => void;
}) {
  const [name, setName] = useState(current);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api
      .repositories()
      .then((r) => {
        if (alive) setRepos(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  function submit() {
    const value = name
      .trim()
      .replace(/^https:\/\/github.com\//, "")
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
    if (!isRepositoryName(value)) {
      setError("Enter a repository as owner/name.");
      return;
    }
    select(value);
  }
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field-label" htmlFor="repo-name">
          Repository name or GitHub URL
        </label>
        <div className="input-row">
          <input
            autoFocus
            id="repo-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="owner/repository"
          />
          <button className="button primary">Open</button>
        </div>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <h3 className="chooser-heading">Your repositories</h3>
      <div className="repo-picker-list">
        {loading ? (
          <p className="muted small">Loading repositories…</p>
        ) : (
          repos.map((r) => (
            <button key={r.fullName} onClick={() => select(r.fullName)}>
              <MarkGithubIcon />
              <div>
                <strong>{r.fullName}</strong>
                <small>
                  {r.description ||
                    (r.private ? "Private repository" : "Public repository")}
                </small>
              </div>
              <ChevronRightIcon size={14} />
            </button>
          ))
        )}
      </div>
    </>
  );
}
export function ProjectForm({
  save,
}: {
  save: (p: {
    name: string;
    folder: string | null;
    repo: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (repo.trim() && !isRepositoryName(repo.trim())) {
          setError("Use owner/repository for the GitHub repository.");
          return;
        }
        save({ name: name.trim(), folder, repo: repo.trim() || null });
      }}
    >
      <label className="field-label" htmlFor="project-name">
        Project name
      </label>
      <input
        autoFocus
        required
        maxLength={60}
        id="project-name"
        placeholder="My next idea"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="field-label" htmlFor="project-repo">
        GitHub repository <span>optional</span>
      </label>
      <input
        id="project-repo"
        placeholder="owner/repository"
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
      />
      {window.pink && (
        <>
          <label className="field-label">
            Local folder <span>optional</span>
          </label>
          <button
            className="folder-choice"
            type="button"
            onClick={async () => {
              try {
                const selected = await window.pink!.chooseFolder();
                if (selected) setFolder(selected);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <FileDirectoryIcon />
            {folder || "Choose a folder"}
          </button>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="button primary" disabled={!name.trim()}>
          Create project
        </button>
      </div>
    </form>
  );
}
