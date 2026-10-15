import { useState, type Dispatch, type SetStateAction } from "react";
import {
  ArrowUpRightIcon,
  CodeIcon,
  FileDirectoryIcon,
} from "@primer/octicons-react";
import type { Workspace } from "./store";

export function IDEView({
  workspace,
  setWorkspace,
  notify,
}: {
  workspace: Workspace;
  setWorkspace: Dispatch<SetStateAction<Workspace>>;
  notify: (m: string) => void;
}) {
  const [id, setId] = useState(workspace.projects[0]?.id || "");
  const project =
    workspace.projects.find((p) => p.id === id) || workspace.projects[0];
  const selectedId = project?.id || "";
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
        value={selectedId}
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
                    p.id === selectedId ? { ...p, folder } : p,
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
              const destination = await window.pink.openIDE(project!.folder!);
              notify(
                destination === "file-manager"
                  ? "Project revealed in your file manager."
                  : "Project opened in your editor.",
              );
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
