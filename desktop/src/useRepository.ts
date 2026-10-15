import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { createRepositorySync, type RepositoryState } from "./repository-sync";

const isRepositoryActive = (enabled: boolean) =>
  enabled &&
  document.visibilityState === "visible" &&
  document.hasFocus() &&
  navigator.onLine;

export function useRepository(fullName: string, enabled = true) {
  const [state, setState] = useState<RepositoryState & { fullName: string }>({
    fullName,
    repo: null,
    loading: true,
    error: null,
  });
  const current = useRef<ReturnType<typeof createRepositorySync> | null>(null);
  const enabledRef = useRef(enabled);

  // Changing screens only pauses/resumes this lifecycle. It does not discard
  // the selected repository or restart an in-flight read.
  useEffect(() => {
    enabledRef.current = enabled;
    current.current?.setActive(isRepositoryActive(enabled));
  }, [enabled]);

  useEffect(() => {
    const isActive = () => isRepositoryActive(enabledRef.current);
    const sync = createRepositorySync({
      load: () => api.repository(fullName),
      onChange: (next) => setState({ ...next, fullName }),
      active: isActive(),
    });
    current.current = sync;
    const updateActivity = () => sync.setActive(isActive());
    window.addEventListener("focus", updateActivity);
    window.addEventListener("blur", updateActivity);
    window.addEventListener("online", updateActivity);
    window.addEventListener("offline", updateActivity);
    document.addEventListener("visibilitychange", updateActivity);
    return () => {
      sync.dispose();
      if (current.current === sync) current.current = null;
      window.removeEventListener("focus", updateActivity);
      window.removeEventListener("blur", updateActivity);
      window.removeEventListener("online", updateActivity);
      window.removeEventListener("offline", updateActivity);
      document.removeEventListener("visibilitychange", updateActivity);
    };
  }, [fullName]);

  const refresh = useCallback(() => {
    void current.current?.refresh();
  }, []);
  const refreshIfStale = useCallback(() => {
    void current.current?.refresh(false);
  }, []);
  const refreshAfterChange = useCallback(() => {
    return current.current?.refreshAfterChange() ?? Promise.resolve();
  }, []);
  return {
    ...(state.fullName === fullName
      ? state
      : { repo: null, loading: true, error: null }),
    refresh,
    refreshIfStale,
    refreshAfterChange,
  };
}
