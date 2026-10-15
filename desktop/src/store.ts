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
export const WORKSPACE_LIMITS = {
  serializedCharacters: 2_000_000,
  projects: 500,
  sessions: 1_000,
  messagesPerSession: 1_000,
  totalMessages: 10_000,
  messageCharacters: 64_000,
  idCharacters: 256,
  nameCharacters: 256,
  titleCharacters: 512,
  pathCharacters: 4_096,
} as const;

export interface WorkspaceReadResult {
  workspace: Workspace;
  warning: string | null;
  canPersist: boolean;
}

const recoveryWarning =
  "Some saved workspace data is invalid or exceeds display limits. Only supported data is shown. The original saved data is unchanged; automatic saving is paused to avoid losing it.";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(
  value: unknown,
  max: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (allowEmpty || Boolean(value.trim()))
  );
}

export function isRepositoryName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [owner, name, extra] = value.split("/");
  return (
    extra === undefined &&
    /^[a-z\d][a-z\d-]{0,38}$/i.test(owner ?? "") &&
    /^[a-z\d_.-]{1,100}$/i.test(name ?? "") &&
    name !== "." &&
    name !== ".."
  );
}

function validProject(value: unknown): value is Project {
  return (
    record(value) &&
    text(value.id, WORKSPACE_LIMITS.idCharacters) &&
    text(value.name, WORKSPACE_LIMITS.nameCharacters) &&
    (value.folder === null ||
      (text(value.folder, WORKSPACE_LIMITS.pathCharacters) &&
        !value.folder.includes("\0"))) &&
    (value.repo === null || isRepositoryName(value.repo))
  );
}

function validSession(value: unknown): value is Session {
  if (
    !record(value) ||
    !text(value.id, WORKSPACE_LIMITS.idCharacters) ||
    !text(value.title, WORKSPACE_LIMITS.titleCharacters) ||
    typeof value.provider !== "string" ||
    !["claude", "openai", "grok"].includes(value.provider) ||
    (value.projectId !== null &&
      !text(value.projectId, WORKSPACE_LIMITS.idCharacters)) ||
    typeof value.updated !== "number" ||
    !Number.isFinite(value.updated) ||
    value.updated < 0 ||
    value.updated > 8_640_000_000_000_000 ||
    !Array.isArray(value.messages) ||
    value.messages.length > WORKSPACE_LIMITS.messagesPerSession
  ) {
    return false;
  }
  const ids = new Set<string>();
  return value.messages.every((message: unknown) => {
    if (
      !record(message) ||
      !text(message.id, WORKSPACE_LIMITS.idCharacters) ||
      ids.has(message.id) ||
      (message.role !== "user" && message.role !== "assistant") ||
      !text(message.text, WORKSPACE_LIMITS.messageCharacters, true)
    ) {
      return false;
    }
    ids.add(message.id);
    return true;
  });
}

function validateWorkspace(raw: unknown): WorkspaceReadResult {
  if (
    !record(raw) ||
    !Array.isArray(raw.projects) ||
    !Array.isArray(raw.sessions)
  ) {
    return {
      workspace: newWorkspace(),
      warning: recoveryWarning,
      canPersist: false,
    };
  }
  let repaired =
    !isRepositoryName(raw.repo) ||
    raw.projects.length > WORKSPACE_LIMITS.projects ||
    raw.sessions.length > WORKSPACE_LIMITS.sessions;
  const projects: Project[] = [];
  const projectIds = new Set<string>();
  for (const project of raw.projects.slice(0, WORKSPACE_LIMITS.projects)) {
    if (!validProject(project) || projectIds.has(project.id)) {
      repaired = true;
      continue;
    }
    projectIds.add(project.id);
    projects.push({
      id: project.id,
      name: project.name,
      folder: project.folder,
      repo: project.repo,
    });
  }
  const sessions: Session[] = [];
  const sessionIds = new Set<string>();
  let messageCount = 0;
  let messageCharacters = 0;
  for (const session of raw.sessions.slice(0, WORKSPACE_LIMITS.sessions)) {
    if (
      !validSession(session) ||
      sessionIds.has(session.id) ||
      messageCount + session.messages.length > WORKSPACE_LIMITS.totalMessages
    ) {
      repaired = true;
      continue;
    }
    const characters = session.messages.reduce(
      (total, message) => total + message.text.length,
      0,
    );
    if (
      messageCharacters + characters >
      WORKSPACE_LIMITS.serializedCharacters
    ) {
      repaired = true;
      continue;
    }
    sessionIds.add(session.id);
    messageCount += session.messages.length;
    messageCharacters += characters;
    const projectId =
      session.projectId && projectIds.has(session.projectId)
        ? session.projectId
        : null;
    if (projectId !== session.projectId) repaired = true;
    sessions.push({
      id: session.id,
      title: session.title,
      provider: session.provider,
      projectId,
      updated: session.updated,
      messages: session.messages.map(({ id, role, text }) => ({
        id,
        role,
        text,
      })),
    });
  }
  return {
    workspace: {
      projects,
      sessions,
      repo: isRepositoryName(raw.repo) ? raw.repo : newWorkspace().repo,
    },
    warning: repaired ? recoveryWarning : null,
    canPersist: !repaired,
  };
}
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
export function readWorkspaceResult(): WorkspaceReadResult {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null)
      return { workspace: newWorkspace(), warning: null, canPersist: true };
    if (raw.length > WORKSPACE_LIMITS.serializedCharacters)
      return {
        workspace: newWorkspace(),
        warning: recoveryWarning,
        canPersist: false,
      };
    return validateWorkspace(JSON.parse(raw));
  } catch {
    return {
      workspace: newWorkspace(),
      warning: recoveryWarning,
      canPersist: false,
    };
  }
}

export function readWorkspace(): Workspace {
  return readWorkspaceResult().workspace;
}

export function serializeWorkspace(workspace: Workspace): string {
  const checked = validateWorkspace(workspace);
  if (!checked.canPersist) {
    throw new Error(
      "This workspace contains invalid data or exceeds local storage limits. The previous saved workspace was left unchanged.",
    );
  }
  const serialized = JSON.stringify(checked.workspace);
  if (serialized.length > WORKSPACE_LIMITS.serializedCharacters) {
    throw new Error(
      "This workspace is too large to save locally. The previous saved workspace was left unchanged.",
    );
  }
  return serialized;
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
