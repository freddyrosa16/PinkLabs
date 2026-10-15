import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MarkGithubIcon,
  PlusIcon,
  SearchIcon,
  TelescopeIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import { external } from "./api";
import { AnimatedIcon } from "./AnimatedIcon";
import { ChatComposer } from "./ChatComposer";
import { IDEView } from "./IDEView";
import { ModalDialog, RepoChooser, ProjectForm } from "./WorkspaceDialogs";
import { providers, ProviderIcon } from "./providers";
import { GitHubView } from "./GitHubView";
import { PullRequestComposer } from "./PullRequestComposer";
import { removeProject, type Session } from "./store";
import { useRepository } from "./useRepository";
import { useSidebar } from "./useSidebar";
import { useWorkspace } from "./useWorkspace";
import { usePracticeChat } from "./usePracticeChat";
type Modal =
  | { type: "repository" }
  | { type: "project" }
  | { type: "remove-project"; id: string }
  | { type: "remove-session"; id: string }
  | null;
export function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { workspace, setWorkspace, storageWarning } = useWorkspace();
  const [view, setView] = useState("github");
  const [tab, setTab] = useState("overview");
  const sidebar = useSidebar();
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const wasMobileOpen = useRef(false);
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
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState("");
  const [undoSession, setUndoSession] = useState<Session | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sidebar.mobile) setMobileOpen(false);
  }, [sidebar.mobile]);
  useEffect(() => {
    if (!sidebar.mobile) {
      wasMobileOpen.current = false;
      return;
    }
    if (!mobileOpen) {
      if (wasMobileOpen.current)
        mobileMenuRef.current?.focus({ preventScroll: true });
      wasMobileOpen.current = false;
      return;
    }
    wasMobileOpen.current = true;
    if (modal) return;
    sidebar.toggleRef.current?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !modal && !event.defaultPrevented) {
        setMobileOpen(false);
        mobileMenuRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen, sidebar.mobile, modal]);
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
    if (view === "github" || view === "pulls") refreshIfStale();
  }, [view, tab, refreshIfStale]);
  const chat = usePracticeChat({ workspace, setWorkspace, notify });
  const {
    session,
    activeSession,
    draft,
    setDraft,
    provider,
    setProvider,
    projectId,
    setProjectId,
    running,
    submit,
    stop,
  } = chat;
  const chatProject = workspace.projects.find((p) => p.id === projectId);
  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    messageEnd.current?.scrollIntoView({
      behavior: reduceMotion ? "instant" : "smooth",
    });
  }, [session?.id, session?.messages.length, running]);
  const newChat = () => {
    setMobileOpen(false);
    setView("chat");
    chat.newChat();
  };
  const openSession = (session: Session) => {
    setMobileOpen(false);
    setView("chat");
    chat.openSession(session);
  };
  function deleteSession(id: string) {
    const deleted = workspace.sessions.find((s) => s.id === id) || null;
    chat.sessionDeleted(id);
    setWorkspace((w) => ({
      ...w,
      sessions: w.sessions.filter((s) => s.id !== id),
    }));
    setModal(null);
    notify("Conversation deleted.");
    setUndoSession(deleted);
  }
  const nav = [
    { id: "chat", label: "New Chat", icon: <AnimatedIcon name="pencil" /> },
    { id: "agents", label: "Agents", icon: <AnimatedIcon name="telescope" /> },
    {
      id: "pulls",
      label: "Pull Requests",
      icon: <AnimatedIcon name="pull-request" />,
    },
    { id: "github", label: "GitHub", icon: <MarkGithubIcon /> },
    { id: "ide", label: "IDE", icon: <AnimatedIcon name="code" /> },
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
      className={`app ${sidebar.collapsed ? "sidebar-hidden" : ""} ${mobileOpen ? "mobile-open" : ""} ${sidebar.dragging ? "sidebar-resizing" : ""}`}
      style={
        {
          "--sidebar-space": `${sidebar.width}px`,
          "--sidebar-width": `${sidebar.contentWidth}px`,
        } as CSSProperties
      }
    >
      <button
        ref={mobileMenuRef}
        className="mobile-menu icon-button"
        aria-expanded={mobileOpen}
        aria-controls="workspace-navigation"
        aria-label="Open navigation"
        onClick={() => {
          setMobileOpen(true);
        }}
      >
        <AnimatedIcon name="sidebar-open" size={18} />
      </button>
      <button
        className="mobile-backdrop"
        aria-label="Close navigation"
        tabIndex={-1}
        aria-hidden={!mobileOpen}
        onClick={() => {
          setMobileOpen(false);
          mobileMenuRef.current?.focus({ preventScroll: true });
        }}
      />
      <div className="sidebar-frame" ref={sidebar.frameRef}>
        <aside
          id="workspace-navigation"
          ref={sidebar.sidebarRef}
          className="sidebar"
          aria-label="Workspace navigation"
          inert={
            sidebar.mobile
              ? !mobileOpen
              : sidebar.collapsed && !sidebar.dragging
          }
        >
          <div className="window-area">
            <span className="browser-window-dots">
              <i />
              <i />
              <i />
            </span>
            <button
              ref={sidebar.toggleRef}
              className="icon-button sidebar-toggle"
              aria-controls="workspace-navigation"
              aria-expanded={sidebar.mobile ? mobileOpen : !sidebar.collapsed}
              aria-label="Collapse sidebar"
              onClick={() => {
                if (sidebar.mobile) {
                  setMobileOpen(false);
                  mobileMenuRef.current?.focus({ preventScroll: true });
                } else {
                  sidebar.setCollapsed(true);
                  requestAnimationFrame(() =>
                    sidebar.restoreRef.current?.focus({ preventScroll: true }),
                  );
                }
              }}
            >
              <AnimatedIcon name="sidebar-close" size={18} />
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
                        <AnimatedIcon name="folder" />
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
              <button
                className="icon-button"
                aria-label="New session"
                title="New session"
                onClick={() => {
                  setSessionsOpen(true);
                  newChat();
                }}
              >
                <PlusIcon size={14} />
              </button>
            </div>
            {sessionsOpen && (
              <div className="session-list">
                {[...workspace.sessions]
                  .sort((a, b) => b.updated - a.updated)
                  .map(sessionRow)}
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
      </div>
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-controls="workspace-navigation"
        aria-valuemin={0}
        aria-valuemax={sidebar.maxWidth}
        aria-valuenow={Math.round(sidebar.width)}
        aria-valuetext={
          sidebar.width === 0
            ? "Collapsed"
            : `${Math.round(sidebar.width)} pixels`
        }
        title="Drag to resize; drag left to hide. Arrow keys resize; Enter toggles."
        tabIndex={sidebar.mobile ? -1 : 0}
        {...sidebar.resizeProps}
      />
      <main className="main-content" inert={sidebar.mobile && mobileOpen}>
        {storageWarning && (
          <p className="workspace-storage-warning" role="alert">
            {storageWarning}
          </p>
        )}
        <button
          ref={sidebar.restoreRef}
          className="restore-sidebar icon-button"
          aria-label="Expand sidebar"
          aria-expanded={!sidebar.collapsed}
          aria-controls="workspace-navigation"
          tabIndex={sidebar.collapsed ? 0 : -1}
          aria-hidden={!sidebar.collapsed}
          onClick={() => {
            sidebar.setCollapsed(false);
            requestAnimationFrame(() =>
              sidebar.toggleRef.current?.focus({ preventScroll: true }),
            );
          }}
        >
          <AnimatedIcon name="sidebar-open" size={18} />
        </button>
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
            <header className="topbar chat-topbar">
              {session && <span className="view-title">{session.title}</span>}
            </header>
            <div className={`chat-workspace${session ? "" : " is-new"}`}>
              <div className="chat-area">
                {!session ? (
                  <div className="chat-welcome">
                    <h1>
                      {chatProject
                        ? `What’s next for ${chatProject.name}?`
                        : "What are we making today?"}
                    </h1>
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
              <ChatComposer
                draft={draft}
                setDraft={setDraft}
                provider={session?.provider || provider}
                setProvider={setProvider}
                projectId={session ? session.projectId || "" : projectId}
                setProjectId={setProjectId}
                projects={workspace.projects}
                locked={!!session}
                running={!!session && running === session.id}
                busyElsewhere={!!running && running !== session?.id}
                submit={submit}
                stop={stop}
              />
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
            <IDEView
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
