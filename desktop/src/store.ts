import type { Provider } from "./types";
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}
export interface Session {
  id: string;
  title: string;
  provider: Provider;
  projectId: string | null;
  messages: Message[];
  updated: number;
}
export interface Project {
  id: string;
  name: string;
  folder: string | null;
  repo: string | null;
}
export interface Workspace {
  projects: Project[];
  sessions: Session[];
  repo: string;
}
export const storageKey = "pink-labs.workspace.v1";
export function newWorkspace(): Workspace {
  return {
    projects: [
      {
        id: "pink-labs",
        name: "Pink Labs",
        folder: null,
        repo: "freddyrosa16/PinkLabs",
      },
    ],
    sessions: [],
    repo: "freddyrosa16/PinkLabs",
  };
}
export function readWorkspace(): Workspace {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (
      !raw ||
      !Array.isArray(raw.projects) ||
      !Array.isArray(raw.sessions) ||
      typeof raw.repo !== "string"
    )
      return newWorkspace();
    const projects = raw.projects.filter(
      (p: Project) =>
        p &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        (p.folder === null || typeof p.folder === "string") &&
        (p.repo === null || typeof p.repo === "string"),
    );
    const sessions = raw.sessions.filter(
      (s: Session) =>
        s &&
        typeof s.id === "string" &&
        typeof s.title === "string" &&
        ["claude", "openai", "grok"].includes(s.provider) &&
        (s.projectId === null || typeof s.projectId === "string") &&
        Number.isFinite(s.updated) &&
        s.updated >= 0 &&
        Array.isArray(s.messages) &&
        s.messages.every(
          (m) =>
            m &&
            typeof m.text === "string" &&
            typeof m.id === "string" &&
            ["user", "assistant"].includes(m.role),
        ),
    );
    return { projects, sessions, repo: raw.repo };
  } catch {
    return newWorkspace();
  }
}
export function removeProject(workspace: Workspace, id: string): Workspace {
  return {
    ...workspace,
    projects: workspace.projects.filter((p) => p.id !== id),
    sessions: workspace.sessions.map((s) =>
      s.projectId === id ? { ...s, projectId: null } : s,
    ),
  };
}
