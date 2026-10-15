import type { Repository } from "./types";

export const REPOSITORY_POLL_MS = 2 * 60_000;
const MIN_REFRESH_GAP_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

export interface RepositoryState {
  repo: Repository | null;
  loading: boolean;
  error: string | null;
}

// One lifecycle per selected repository. Keep data on screen until its replacement
// arrives, and ignore requests that finish after navigation or unmount.
export function createRepositorySync({
  load,
  onChange,
  active = true,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  load: () => Promise<Repository>;
  onChange: (state: RepositoryState) => void;
  active?: boolean;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) {
  let state: RepositoryState = { repo: null, loading: false, error: null };
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAttempt = -Infinity;
  let retryAt = 0;
  let failures = 0;

  const publish = (next: RepositoryState) => {
    state = next;
    if (!disposed) onChange(state);
  };
  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = (delay: number) => {
    cancelTimer();
    if (disposed || !active) return;
    timer = setTimer(() => {
      timer = null;
      void refresh(false);
    }, delay);
  };

  function runRefresh(manual: boolean, force: boolean): Promise<void> {
    if (disposed) return Promise.resolve();
    if (inFlight) {
      if (manual && !state.loading) publish({ ...state, loading: true });
      return inFlight;
    }
    if (!force && !active) return Promise.resolve();
    const wait = Math.max(lastAttempt + MIN_REFRESH_GAP_MS, retryAt) - now();
    if (!force && wait > 0) {
      schedule(wait);
      return Promise.resolve();
    }
    cancelTimer();
    lastAttempt = now();
    // Routine checks keep the current screen quiet. A user's explicit refresh
    // still gets feedback, as does the initial load before any data is available.
    if (manual || !state.repo) publish({ ...state, loading: true });
    inFlight = Promise.resolve()
      .then(load)
      .then((repo) => {
        if (disposed) return;
        // Optional endpoint failures also need slower retries; they must not
        // silently turn rate limiting into a rapid loop of partial fetches.
        failures = repo.refreshIncomplete ? failures + 1 : 0;
        publish({ repo, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        failures++;
        publish({
          ...state,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "GitHub could not be reached.",
        });
      })
      .finally(() => {
        inFlight = null;
        if (disposed) return;
        const delay = failures
          ? Math.min(
              REPOSITORY_POLL_MS * 2 ** Math.min(failures, 4),
              MAX_RETRY_MS,
            )
          : REPOSITORY_POLL_MS;
        retryAt = failures ? now() + delay : 0;
        schedule(delay);
      });
    return inFlight;
  }

  function refresh(manual = true) {
    return runRefresh(manual, manual);
  }

  async function refreshAfterChange() {
    // An existing read may have captured the repository before the mutation.
    // Wait for it, then request fresh data without an overlapping read or spinner.
    if (inFlight) await inFlight;
    if (disposed) return;
    return runRefresh(false, true);
  }

  void refresh();
  return {
    refresh,
    refreshAfterChange,
    setActive(next: boolean) {
      if (disposed || next === active) return;
      active = next;
      if (active) void refresh(false);
      else cancelTimer();
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
