import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  FileDirectoryIcon,
  GitPullRequestIcon,
  MarkGithubIcon,
  PlusIcon,
  SearchIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SquareIcon,
  TelescopeIcon,
  TrashIcon,
  XIcon,
  CommentDiscussionIcon,
  PencilIcon,
} from "@primer/octicons-react";
import { api, external } from "./api";
import { GitHubView } from "./GitHubView";
import { PullRequestComposer } from "./PullRequestComposer";
import {
  newWorkspace,
  readWorkspace,
  removeProject,
  storageKey,
  type Workspace,
  type Session,
} from "./store";
import type { Provider, RepoSummary } from "./types";
import { useRepository } from "./useRepository";
const providers: { id: Provider; name: string; asset: string }[] = [
  { id: "claude", name: "Claude", asset: "claude-color.svg" },
  { id: "openai", name: "OpenAI / Codex", asset: "openai.svg" },
  { id: "grok", name: "Grok", asset: "grok.svg" },
];
function ProviderIcon({ provider }: { provider: Provider }) {
  const p = providers.find((p) => p.id === provider)!;
  return (
    <img
      className={`provider-icon ${provider === "claude" ? "" : "monochrome"}`}
      src={`./providers/${p.asset}`}
      alt={p.name}
    />
  );
}
type Modal =
  | { type: "repository" }
  | { type: "project" }
  | { type: "remove-project"; id: string }
  | { type: "remove-session"; id: string }
  | null;
export function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>(readWorkspace);
  const [view, setView] = useState("github");
  const [tab, setTab] = useState("overview");
  const [sidebar, setSidebar] = useState(true);
  const [composerRepo, setComposerRepo] = useState<string | null>(null);
  const [selectedPull, setSelectedPull] = useState<{
    repo: string;
    number: number;
  } | null>(null);
  const { repo, loading, error, refresh, refreshIfStale, refreshAfterChange } =
    useRepository(workspace.repo, view === "github" || view === "pulls");
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState<Provider>("claude");
  const [projectId, setProjectId] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState("");
  const [undoSession, setUndoSession] = useState<Session | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  function notify(message: string) {
    setUndoSession(null);
    setToast(message);
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => {
      setToast("");
      setUndoSession(null);
    }, 10000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(workspace));
    } catch {
      setToast(
        "Could not save this workspace. Your browser storage may be full.",
      );
    }
  }, [workspace]);
  useEffect(() => {
    if (view === "github" || view === "pulls") refreshIfStale();
  }, [view, tab, refreshIfStale]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const session = workspace.sessions.find((s) => s.id === activeSession);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length, running]);
  const newChat = () => {
    setMobileOpen(false);
    setView("chat");
    setActiveSession(null);
    setDraft("");
  };
  const openSession = (s: Session) => {
    setMobileOpen(false);
    setView("chat");
    setActiveSession(s.id);
    setProvider(s.provider);
    setProjectId(s.projectId || "");
    setDraft("");
  };
  function submit() {
    if (!draft.trim() || running) return;
    const message = draft.trim();
    const id = session?.id || crypto.randomUUID();
    const model = session?.provider || provider;
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      text: message,
    };
    setWorkspace((w) => ({
      ...w,
      sessions: session
        ? w.sessions.map((s) =>
            s.id === id
              ? {
                  ...s,
                  messages: [...s.messages, userMessage],
                  updated: Date.now(),
                }
              : s,
          )
        : [
            {
              id,
              title: message.length > 42 ? message.slice(0, 42) + "…" : message,
              provider: model,
              projectId: projectId || null,
              messages: [userMessage],
              updated: Date.now(),
            },
            ...w.sessions,
          ],
    }));
    setActiveSession(id);
    setDraft("");
    setRunning(id);
    timer.current = setTimeout(() => {
      const text =
        "This is a practice reply from the interface. Your message was saved, and the chat flow is working.\n\nOnce we connect your Python agent, its real answer will appear here. The provider you selected is saved with this conversation; no model was called.";
      setWorkspace((w) => ({
        ...w,
        sessions: w.sessions.map((s) =>
          s.id === id
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  { id: crypto.randomUUID(), role: "assistant", text },
                ],
                updated: Date.now(),
              }
            : s,
        ),
      }));
      setRunning(null);
      timer.current = null;
    }, 4200);
  }
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRunning(null);
    notify("Practice reply stopped.");
  }
  function deleteSession(id: string) {
    const deleted = workspace.sessions.find((s) => s.id === id) || null;
    if (running === id) stop();
    setWorkspace((w) => ({
      ...w,
      sessions: w.sessions.filter((s) => s.id !== id),
    }));
    if (activeSession === id) setActiveSession(null);
    setModal(null);
    notify("Conversation deleted.");
    setUndoSession(deleted);
  }
  const nav = [
    { id: "chat", label: "New Chat", icon: <PencilIcon /> },
    { id: "agents", label: "Agents", icon: <TelescopeIcon /> },
    { id: "pulls", label: "Pull Requests", icon: <GitPullRequestIcon /> },
    { id: "github", label: "GitHub", icon: <MarkGithubIcon /> },
    { id: "ide", label: "IDE", icon: <CodeIcon /> },
  ];
  function sessionRow(s: Session) {
    return (
      <div
        className={`session-row ${view === "chat" && activeSession === s.id ? "selected" : ""}`}
        key={s.id}
      >
        <button
          className="session-select"
          onClick={() => openSession(s)}
          title={s.title}
        >
          <ProviderIcon provider={s.provider} />
          <span className={running === s.id ? "shimmer" : ""}>{s.title}</span>
          {running === s.id && (
            <span className="running-dot" aria-label="Running" />
          )}
        </button>
        <button
          className="row-delete icon-button"
          aria-label={`Delete conversation ${s.title}`}
          onClick={() => setModal({ type: "remove-session", id: s.id })}
        >
          <TrashIcon size={13} />
        </button>
      </div>
    );
  }
  return (
    <div
      className={`app ${sidebar ? "" : "sidebar-hidden"} ${mobileOpen ? "mobile-open" : ""}`}
    >
      <button
        className="mobile-menu icon-button"
        aria-label="Open navigation"
        onClick={() => {
          setSidebar(true);
          setMobileOpen(true);
        }}
      >
        <SidebarExpandIcon />
      </button>
      {mobileOpen && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="window-area">
          <span className="browser-window-dots">
            <i />
            <i />
            <i />
          </span>
          <button
            className="icon-button sidebar-toggle"
            aria-label="Collapse sidebar"
            onClick={() => {
              setSidebar(false);
              setMobileOpen(false);
            }}
          >
            <SidebarCollapseIcon />
          </button>
        </div>
        <div className="brand">
          <span className="brand-mark">
            P<span>·</span>
          </span>
          <strong>Pink Labs</strong>
          <span className="workspace-label">Personal</span>
        </div>
        <nav className="main-nav">
          {nav.map((n) => (
            <button
              className={view === n.id ? "selected" : ""}
              key={n.id}
              onClick={() => {
                setMobileOpen(false);
                if (n.id === "chat") newChat();
                else {
                  setView(n.id);
                  if (n.id === "github") setTab("overview");
                  if (n.id === "pulls") setTab("pulls");
                }
              }}
            >
              {n.icon}
              <span>{n.label}</span>
              {n.id === "pulls" && !!repo?.openPrCount && (
                <small>{repo.openPrCount}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-scroll">
          <div className="group-heading">
            <button
              onClick={() => setProjectsOpen(!projectsOpen)}
              aria-expanded={projectsOpen}
            >
              {projectsOpen ? (
                <ChevronDownIcon size={12} />
              ) : (
                <ChevronRightIcon size={12} />
              )}
              Projects
            </button>
            <button
              className="icon-button"
              aria-label="Add project"
              onClick={() => setModal({ type: "project" })}
            >
              <PlusIcon size={14} />
            </button>
          </div>
          {projectsOpen && (
            <div className="project-list">
              {workspace.projects.map((p) => (
                <div key={p.id}>
                  <div className="project-row">
                    <button
                      className="project-select"
                      onClick={() =>
                        setExpandedProjects((prev) =>
                          prev.includes(p.id)
                            ? prev.filter((id) => id !== p.id)
                            : [...prev, p.id],
                        )
                      }
                      aria-expanded={expandedProjects.includes(p.id)}
                    >
                      {expandedProjects.includes(p.id) ? (
                        <ChevronDownIcon size={12} />
                      ) : (
                        <ChevronRightIcon size={12} />
                      )}
                      <FileDirectoryIcon />
                      <span>{p.name}</span>
                    </button>
                    <button
                      className="row-delete icon-button"
                      aria-label={`Remove project ${p.name}`}
                      onClick={() =>
                        setModal({ type: "remove-project", id: p.id })
                      }
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                  {expandedProjects.includes(p.id) && (
                    <div className="project-sessions">
                      {workspace.sessions
                        .filter((s) => s.projectId === p.id)
                        .map(sessionRow)}
                      <button
                        className="project-new"
                        onClick={() => {
                          newChat();
                          setProjectId(p.id);
                        }}
                      >
                        <PlusIcon size={12} />
                        New conversation
                      </button>
                      {p.repo && (
                        <button
                          className="project-new"
                          onClick={() => {
                            setWorkspace((w) => ({ ...w, repo: p.repo! }));
                            setView("github");
                            setTab("overview");
                          }}
                        >
                          <MarkGithubIcon size={12} />
                          Open repository
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {workspace.projects.length === 0 && (
                <button
                  className="sidebar-hint"
                  onClick={() => setModal({ type: "project" })}
                >
                  Add your first project
                </button>
              )}
            </div>
          )}
          <div className="group-heading sessions-heading">
            <button
              onClick={() => setSessionsOpen(!sessionsOpen)}
              aria-expanded={sessionsOpen}
            >
              {sessionsOpen ? (
                <ChevronDownIcon size={12} />
              ) : (
                <ChevronRightIcon size={12} />
              )}
              Sessions <small>{workspace.sessions.length || ""}</small>
            </button>
          </div>
          {sessionsOpen && (
            <div className="session-list">
              {[...workspace.sessions]
                .sort((a, b) => b.updated - a.updated)
                .map(sessionRow)}
              {workspace.sessions.length === 0 && (
                <div className="sidebar-empty">
                  <CommentDiscussionIcon />
                  <p>
                    Your conversations
                    <br />
                    will appear here.
                  </p>
                  <button onClick={newChat}>
                    Start a chat <PlusIcon size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="sidebar-footer">
          <span className={`connection-dot ${error ? "offline" : ""}`} />
          <span>
            {loading
              ? repo
                ? "Updating GitHub…"
                : "Syncing GitHub…"
              : error
                ? "GitHub unavailable"
                : "Connected to GitHub"}
          </span>
          {repo && (
            <button
              className="icon-button"
              title={`Last checked ${new Date(repo.fetchedAt).toLocaleTimeString()}`}
              disabled={loading}
              onClick={refresh}
            >
              <CheckCircleIcon size={13} />
            </button>
          )}
        </div>
      </aside>
      <main className="main-content">
        {!sidebar && (
          <button
            className="restore-sidebar icon-button"
            aria-label="Expand sidebar"
            onClick={() => setSidebar(true)}
          >
            <SidebarExpandIcon />
          </button>
        )}
        {view === "github" || view === "pulls" ? (
          <GitHubView
            repo={repo}
            loading={loading}
            error={error}
            createPull={() => repo && setComposerRepo(repo.fullName)}
            openPull={(number) => {
              if (repo) setSelectedPull({ repo: repo.fullName, number });
              setView("pulls");
            }}
            selectedPull={
              selectedPull?.repo === repo?.fullName
                ? (selectedPull?.number ?? null)
                : null
            }
            selectPull={(number) =>
              setSelectedPull(
                repo && number !== null
                  ? { repo: repo.fullName, number }
                  : null,
              )
            }
            pullChanged={(message) => {
              notify(message);
              void refreshAfterChange();
            }}
            tab={view === "pulls" ? "pulls" : tab}
            setTab={(t) => {
              setView("github");
              setTab(t);
            }}
            refresh={refresh}
            chooseRepo={() => setModal({ type: "repository" })}
            notify={notify}
          />
        ) : view === "chat" ? (
          <>
            <header className="topbar">
              <span className="view-title">
                {session?.title || "New conversation"}
              </span>
              <span className="preview-badge">Practice mode</span>
            </header>
            <div className="chat-area">
              {!session ? (
                <div className="chat-welcome">
                  <span className="welcome-mark">
                    P<span>·</span>
                  </span>
                  <h1>A little idea. A place to start.</h1>
                  <p>Make room for what you’re building.</p>
                  <div className="suggestions">
                    {[
                      "Plan my agent’s first task",
                      "Think through an app idea",
                      "Break down a Python concept",
                    ].map((t) => (
                      <button key={t} onClick={() => setDraft(t)}>
                        {t}
                        <ArrowUpRightIcon size={13} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {session.messages.map((m) => (
                    <div className={`message ${m.role}`} key={m.id}>
                      {m.role === "assistant" && (
                        <ProviderIcon provider={session.provider} />
                      )}
                      <div>
                        <span className="message-label">
                          {m.role === "user" ? "You" : "Practice assistant"}
                        </span>
                        <p>{m.text}</p>
                      </div>
                    </div>
                  ))}
                  {running === session.id && (
                    <div className="message assistant">
                      <ProviderIcon provider={session.provider} />
                      <span className="shimmer" role="status">
                        Working on your practice reply…
                      </span>
                    </div>
                  )}
                  <div ref={messageEnd} />
                </div>
              )}
            </div>
            <div className="composer-area">
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="What are you working on?"
                  aria-label="Message"
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <div className="provider-select">
                    <ProviderIcon provider={session?.provider || provider} />
                    <select
                      aria-label="Model provider"
                      value={session?.provider || provider}
                      disabled={!!session}
                      onChange={(e) => setProvider(e.target.value as Provider)}
                    >
                      {providers.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <select
                    className="project-picker"
                    aria-label="Conversation project"
                    value={session?.projectId || projectId}
                    disabled={!!session}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">No project</option>
                    {workspace.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {running ? (
                    <button
                      className="send-button stop"
                      type="button"
                      onClick={stop}
                      aria-label="Stop reply"
                    >
                      <SquareIcon />
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      disabled={!draft.trim()}
                      aria-label="Send message"
                    >
                      <ArrowUpIcon size={20} />
                    </button>
                  )}
                </div>
              </form>
              <p className="composer-note">
                Practice replies stay on this device. Your Python agent will
                connect here.
              </p>
            </div>
          </>
        ) : view === "agents" ? (
          <>
            <header className="topbar">
              <span className="view-title">Agents</span>
              <span className="preview-badge">Up next</span>
            </header>
            <div className="feature-empty">
              <TelescopeIcon size={38} />
              <h1>A home for your agents.</h1>
              <p>
                This is where you’ll choose an agent, see what it’s doing,
                <br />
                and pick up where you left off.
              </p>
              <div className="provider-line">
                {providers.map((p) => (
                  <ProviderIcon key={p.id} provider={p.id} />
                ))}
              </div>
              <p className="muted small">
                We’ll shape this space together when your Python core is ready.
              </p>
              <button className="button" onClick={newChat}>
                Try the conversation flow <ArrowUpRightIcon />
              </button>
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <span className="view-title">IDE</span>
              <span className="muted small">Your project, in your editor</span>
            </header>
            <IDE
              workspace={workspace}
              setWorkspace={setWorkspace}
              notify={notify}
            />
          </>
        )}
      </main>
      {repo && (
        <PullRequestComposer
          key={repo.fullName}
          fullName={repo.fullName}
          defaultBranch={repo.branch}
          open={composerRepo === repo.fullName}
          close={() => setComposerRepo(null)}
          created={(pull) => {
            notify(`Pull request #${pull.number} is on GitHub.`);
            setSelectedPull({ repo: repo.fullName, number: pull.number });
            setView("pulls");
            void refreshAfterChange();
          }}
        />
      )}
      {modal && (
        <ModalDialog
          title={
            modal.type === "repository"
              ? "Open a repository"
              : modal.type === "project"
                ? "New project"
                : modal.type === "remove-project"
                  ? "Remove this project?"
                  : "Delete this conversation?"
          }
          close={() => setModal(null)}
        >
          {modal.type === "repository" ? (
            <RepoChooser
              current={workspace.repo}
              select={(name) => {
                setWorkspace((w) => ({ ...w, repo: name }));
                setView("github");
                setTab("overview");
                setModal(null);
              }}
            />
          ) : modal.type === "project" ? (
            <ProjectForm
              save={(p) => {
                setWorkspace((w) => ({
                  ...w,
                  projects: [...w.projects, { ...p, id: crypto.randomUUID() }],
                }));
                setProjectsOpen(true);
                setModal(null);
                notify("Project added.");
              }}
            />
          ) : modal.type === "remove-project" ? (
            <>
              <p className="modal-description">
                The project leaves your sidebar. Its conversations stay in
                Sessions, and files on your computer stay in place.
              </p>
              <div className="modal-actions">
                <button className="button" onClick={() => setModal(null)}>
                  Keep project
                </button>
                <button
                  className="button danger"
                  onClick={() => {
                    setWorkspace((w) => removeProject(w, modal.id));
                    if (projectId === modal.id) setProjectId("");
                    setModal(null);
                    notify("Project removed. Conversations kept in Sessions.");
                  }}
                >
                  Remove project
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="modal-description">
                This deletes the saved conversation from this device, including
                its messages.
              </p>
              <div className="modal-actions">
                <button className="button" onClick={() => setModal(null)}>
                  Keep conversation
                </button>
                <button
                  className="button danger"
                  onClick={() => deleteSession(modal.id)}
                >
                  Delete conversation
                </button>
              </div>
            </>
          )}
        </ModalDialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircleIcon />
          <span>{toast}</span>
          {undoSession && (
            <button
              className="button"
              onClick={() => {
                const restored = undoSession;
                setWorkspace((w) => ({
                  ...w,
                  sessions: [...w.sessions, restored],
                }));
                notify("Conversation restored.");
              }}
            >
              Undo
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <XIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function ModalDialog({
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
function RepoChooser({
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
    if (!/^[\w.-]+\/[\w.-]+$/.test(value)) {
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
function ProjectForm({
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
        if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
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
                setFolder(await window.pink!.chooseFolder());
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
function IDE({
  workspace,
  setWorkspace,
  notify,
}: {
  workspace: Workspace;
  setWorkspace: React.Dispatch<React.SetStateAction<Workspace>>;
  notify: (m: string) => void;
}) {
  const [id, setId] = useState(workspace.projects[0]?.id || "");
  const project = workspace.projects.find((p) => p.id === id);
  return (
    <div className="ide-page">
      <div className="feature-icon">
        <CodeIcon size={32} />
      </div>
      <h1>Keep building in your editor.</h1>
      <p>Open a project folder in Cursor or VS Code.</p>
      <label className="field-label" htmlFor="ide-project">
        Project
      </label>
      <select
        id="ide-project"
        value={id}
        onChange={(e) => setId(e.target.value)}
      >
        {workspace.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {!workspace.projects.length && (
        <p className="muted">Add a project from the sidebar first.</p>
      )}
      <div className="ide-folder">
        <FileDirectoryIcon />
        <span>{project?.folder || "No folder selected"}</span>
      </div>
      <div className="ide-actions">
        <button
          className="button"
          disabled={!project}
          onClick={async () => {
            if (!window.pink) {
              notify(
                "Folder selection is available in the Pink Labs desktop window.",
              );
              return;
            }
            try {
              const folder = await window.pink.chooseFolder();
              if (folder)
                setWorkspace((w) => ({
                  ...w,
                  projects: w.projects.map((p) =>
                    p.id === id ? { ...p, folder } : p,
                  ),
                }));
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        >
          Choose folder
        </button>
        <button
          className="button primary"
          disabled={!project?.folder}
          onClick={async () => {
            if (!window.pink) {
              notify(
                "Open this project in the Pink Labs desktop window to use your editor.",
              );
              return;
            }
            try {
              await window.pink.openIDE(project!.folder!);
              notify("Project opened in your editor.");
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        >
          Open in editor <ArrowUpRightIcon />
        </button>
      </div>
      <p className="muted small">
        An embedded editor can come later. This opens the editor you already
        use.
      </p>
    </div>
  );
}
