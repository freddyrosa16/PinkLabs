import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { createRepositorySync, type RepositoryState } from "./repository-sync";

export function useRepository(fullName: string) {
  const [state, setState] = useState<RepositoryState & { fullName: string }>({
    fullName,
    repo: null,
    loading: true,
    error: null,
  });
  const current = useRef<ReturnType<typeof createRepositorySync> | null>(null);

  useEffect(() => {
    const isActive = () =>
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      navigator.onLine;
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
  return {
    ...(state.fullName === fullName
      ? state
      : { repo: null, loading: true, error: null }),
    refresh,
    refreshIfStale,
  };
}
