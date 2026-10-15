import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createPracticeChat } from "./practice-chat-state";
import type { Workspace } from "./store";

export function usePracticeChat({
  workspace,
  setWorkspace,
  notify,
}: {
  workspace: Workspace;
  setWorkspace: Dispatch<SetStateAction<Workspace>>;
  notify: (message: string) => void;
}) {
  const current = useRef({ workspace, setWorkspace, notify });
  current.current = { workspace, setWorkspace, notify };
  const [chat] = useState(() =>
    createPracticeChat({
      getWorkspace: () => current.current.workspace,
      setWorkspace: (update) => current.current.setWorkspace(update),
      notify: (message) => current.current.notify(message),
    }),
  );
  const state = useSyncExternalStore(
    chat.subscribe,
    chat.getSnapshot,
    chat.getSnapshot,
  );

  useEffect(() => {
    chat.reconcileWorkspace();
  }, [chat, workspace]);
  useEffect(() => () => chat.cancelPending(), [chat]);

  return {
    ...state,
    session: workspace.sessions.find(
      (session) => session.id === state.activeSession,
    ),
    setDraft: chat.setDraft,
    setProvider: chat.setProvider,
    setProjectId: chat.setProjectId,
    newChat: chat.newChat,
    openSession: chat.openSession,
    submit: chat.submit,
    stop: chat.stop,
    sessionDeleted: chat.sessionDeleted,
  };
}
