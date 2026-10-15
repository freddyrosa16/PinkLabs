import { useEffect, useState } from "react";
import { readWorkspaceResult, serializeWorkspace, storageKey } from "./store";

/** Keep persistence policy separate from navigation and chat rendering. */
export function useWorkspace() {
  const [saved] = useState(readWorkspaceResult);
  const [workspace, setWorkspace] = useState(saved.workspace);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (!saved.canPersist) return;
    try {
      localStorage.setItem(storageKey, serializeWorkspace(workspace));
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error && error.name !== "QuotaExceededError"
          ? error.message
          : "Could not save this workspace. Local storage may be full. Your last saved workspace is unchanged.",
      );
    }
  }, [workspace, saved.canPersist]);
  return {
    workspace,
    setWorkspace,
    storageWarning: saved.warning || saveError,
  };
}
