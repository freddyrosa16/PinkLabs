import { serializeWorkspace, WORKSPACE_LIMITS } from "./store";
import type { Message, Session, Workspace } from "./store";
import type { Provider } from "./types";

export const PRACTICE_REPLY_DELAY = 4200;
export const PRACTICE_REPLY =
  "This is a practice reply from the interface. Your message was saved, and the chat flow is working.\n\nOnce we connect your Python agent, its real answer will appear here. The provider you selected is saved with this conversation; no model was called.";

interface ChatSnapshot {
  activeSession: string | null;
  draft: string;
  provider: Provider;
  projectId: string;
  running: string | null;
}

interface ChatOptions {
  getWorkspace: () => Workspace;
  setWorkspace: (update: (workspace: Workspace) => Workspace) => void;
  notify: (message: string) => void;
  createId?: () => string;
  now?: () => number;
  schedule?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

// The controller owns the single practice timer. Workspace updates are pure so
// React may replay them without scheduling a second reply or generating new IDs.
export function createPracticeChat({
  getWorkspace,
  setWorkspace,
  notify,
  createId = () => crypto.randomUUID(),
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}: ChatOptions) {
  let state: ChatSnapshot = {
    activeSession: null,
    draft: "",
    provider: "claude",
    projectId: "",
    running: null,
  };
  const drafts = new Map<string | null, string>();
  let newDraftContext = {
    provider: state.provider,
    projectId: state.projectId,
  };
  const listeners = new Set<() => void>();
  let pending: {
    sessionId: string;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;

  function publish(next: Partial<ChatSnapshot>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }

  function rememberDraft(): boolean {
    let characters = state.draft.length;
    for (const [id, draft] of drafts) {
      if (id !== state.activeSession) characters += draft.length;
    }
    if (characters > WORKSPACE_LIMITS.serializedCharacters) {
      notify(
        "Your unsent drafts are too large to keep while switching conversations. Copy or shorten this draft first; its text is still here.",
      );
      return false;
    }
    drafts.set(state.activeSession, state.draft);
    if (state.activeSession === null)
      newDraftContext = {
        provider: state.provider,
        projectId: state.projectId,
      };
    return true;
  }

  function newChat() {
    if (!rememberDraft()) return;
    const draft = drafts.get(null) || "";
    publish({
      activeSession: null,
      draft,
      ...(draft ? newDraftContext : {}),
    });
  }

  function openSession(requested: Session) {
    const session = getWorkspace().sessions.find(
      (item) => item.id === requested.id,
    );
    if (!session) {
      notify("This conversation is no longer available.");
      return;
    }
    if (!rememberDraft()) return;
    publish({
      activeSession: session.id,
      draft: drafts.get(session.id) || "",
      provider: session.provider,
      projectId: session.projectId || "",
    });
  }

  function cancelPending() {
    if (!pending) return;
    if (pending.timer !== null) cancel(pending.timer);
    pending = null;
    publish({ running: null });
  }

  function sessionDeleted(id: string) {
    if (pending?.sessionId === id) cancelPending();
    drafts.delete(id);
    if (state.activeSession === id)
      publish({
        activeSession: null,
        draft: drafts.get(null) || "",
        ...newDraftContext,
      });
  }

  function reconcileWorkspace() {
    const workspace = getWorkspace();
    const ids = new Set(workspace.sessions.map((session) => session.id));
    for (const id of drafts.keys()) {
      if (id !== null && !ids.has(id)) drafts.delete(id);
    }
    if (pending && !ids.has(pending.sessionId)) cancelPending();
    if (state.activeSession && !ids.has(state.activeSession))
      sessionDeleted(state.activeSession);
    if (
      state.projectId &&
      !workspace.projects.some((p) => p.id === state.projectId)
    )
      publish({ projectId: "" });
    if (
      newDraftContext.projectId &&
      !workspace.projects.some((p) => p.id === newDraftContext.projectId)
    )
      newDraftContext = { ...newDraftContext, projectId: "" };
  }

  function submit() {
    if (pending) {
      if (pending.sessionId !== state.activeSession)
        notify(
          "A practice reply is running in another conversation. Open that conversation to stop it, or wait for it to finish.",
        );
      return;
    }
    const text = state.draft.trim();
    if (!text) return;
    if (state.draft.length > WORKSPACE_LIMITS.messageCharacters) {
      notify(
        `Keep each message under ${WORKSPACE_LIMITS.messageCharacters.toLocaleString()} characters. Your draft has not been changed.`,
      );
      return;
    }
    const workspace = getWorkspace();
    const session = workspace.sessions.find(
      (item) => item.id === state.activeSession,
    );
    if (state.activeSession && !session) {
      notify(
        "This conversation was removed. Start a new chat to send this draft.",
      );
      return;
    }
    const id = session?.id || createId();
    const userMessage: Message = { id: createId(), role: "user", text };
    const reply: Message = {
      id: createId(),
      role: "assistant",
      text: PRACTICE_REPLY,
    };
    const startedAt = now();
    const newSession: Session = {
      id,
      title: text.length > 42 ? `${text.slice(0, 42)}…` : text,
      provider: state.provider,
      projectId: workspace.projects.some((p) => p.id === state.projectId)
        ? state.projectId
        : null,
      messages: [userMessage],
      updated: startedAt,
    };
    const addUser = (current: Workspace): Workspace => ({
      ...current,
      sessions: session
        ? current.sessions.map((item) =>
            item.id === id
              ? {
                  ...item,
                  messages: [...item.messages, userMessage],
                  updated: startedAt,
                }
              : item,
          )
        : [newSession, ...current.sessions],
    });
    const addReply = (current: Workspace, timestamp: number): Workspace => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === id
          ? { ...item, messages: [...item.messages, reply], updated: timestamp }
          : item,
      ),
    });
    try {
      // Reserve room for both sides before clearing the user's draft.
      serializeWorkspace(addReply(addUser(workspace), startedAt));
    } catch (error) {
      notify(
        `${error instanceof Error ? error.message : "This conversation is too large."} Your draft has not been changed.`,
      );
      return;
    }
    const task = {
      sessionId: id,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    pending = task;
    setWorkspace(addUser);
    drafts.delete(state.activeSession);
    publish({ activeSession: id, draft: "", running: id });
    task.timer = schedule(() => {
      if (pending !== task) return;
      pending = null;
      const current = getWorkspace();
      if (current.sessions.some((item) => item.id === id)) {
        const timestamp = now();
        try {
          serializeWorkspace(addReply(current, timestamp));
          setWorkspace((value) => addReply(value, timestamp));
        } catch {
          notify(
            "The practice reply could not be added because the workspace reached its local limit. Your message is still saved.",
          );
        }
      }
      publish({ running: null });
    }, PRACTICE_REPLY_DELAY);
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDraft: (draft: string) => publish({ draft }),
    setProvider: (provider: Provider) => {
      if (
        !state.activeSession &&
        ["claude", "openai", "grok"].includes(provider)
      ) {
        newDraftContext = { ...newDraftContext, provider };
        publish({ provider });
      }
    },
    setProjectId: (projectId: string) => {
      if (!state.activeSession) {
        const valid = getWorkspace().projects.some(
          (project) => project.id === projectId,
        )
          ? projectId
          : "";
        newDraftContext = { ...newDraftContext, projectId: valid };
        publish({ projectId: valid });
      }
    },
    newChat,
    openSession,
    submit,
    stop: () => {
      if (pending?.sessionId !== state.activeSession) return;
      cancelPending();
      notify("Practice reply stopped.");
    },
    sessionDeleted,
    reconcileWorkspace,
    cancelPending,
  };
}
