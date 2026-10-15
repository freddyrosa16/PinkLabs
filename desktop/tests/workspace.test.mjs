import test from "node:test";
import assert from "node:assert/strict";
import {
  newWorkspace,
  readWorkspace,
  readWorkspaceResult,
  removeProject,
  serializeWorkspace,
  isRepositoryName,
  WORKSPACE_LIMITS,
  storageKey,
} from "../src/store.ts";

const projects = [
  {
    id: "agent",
    name: "My agent",
    folder: "/tmp/agent",
    repo: "freddyrosa16/PinkLabs",
  },
  { id: "other", name: "Another project", folder: null, repo: null },
];
const messages = [
  { id: "m-1", role: "user", text: "Help me plan my next step." },
  { id: "m-2", role: "assistant", text: "Start with one working message." },
];
const conversation = {
  id: "s-1",
  title: "First steps",
  provider: "claude",
  projectId: "agent",
  messages,
  updated: 1234,
};
const savedWorkspace = {
  projects,
  sessions: [
    conversation,
    { ...conversation, id: "s-2", provider: "grok", projectId: "other" },
    { ...conversation, id: "s-3", provider: "openai", projectId: null },
  ],
  repo: "freddyrosa16/PinkLabs",
};

function withStorage(value, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const calls = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        calls.push(key);
        if (value instanceof Error) throw value;
        return value;
      },
    },
  });
  try {
    return run(calls);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
}

test("reads saved projects, provider choices, messages, order, and selected repository", () => {
  withStorage(JSON.stringify(savedWorkspace), (calls) => {
    assert.deepEqual(readWorkspace(), savedWorkspace);
    assert.deepEqual(calls, [storageKey]);
  });
});

test("missing, corrupted, or unreadable storage recovers to a fresh workspace", () => {
  for (const value of [
    null,
    "",
    "{broken",
    "null",
    "{}",
    JSON.stringify({ projects: [], sessions: {}, repo: "owner/repo" }),
    new Error("Storage denied"),
  ]) {
    withStorage(value, () => assert.deepEqual(readWorkspace(), newWorkspace()));
  }
  const first = newWorkspace();
  first.projects[0].name = "Changed locally";
  first.sessions.push(conversation);
  assert.equal(newWorkspace().projects[0].name, "Pink Labs");
  assert.deepEqual(newWorkspace().sessions, []);
});

test("malformed records do not discard unrelated valid saved conversations", () => {
  const malformed = {
    ...savedWorkspace,
    projects: [
      ...projects,
      null,
      { ...projects[0], id: 27 },
      { ...projects[0], folder: { path: "/tmp" } },
    ],
    sessions: [
      conversation,
      null,
      { ...conversation, provider: "unknown" },
      { ...conversation, messages: null },
      {
        ...conversation,
        messages: [{ id: "bad", role: "system", text: "Unsupported role" }],
      },
      {
        ...conversation,
        messages: [{ id: "bad", role: "user", text: { unexpected: "object" } }],
      },
    ],
  };
  withStorage(JSON.stringify(malformed), () => {
    assert.deepEqual(readWorkspace(), {
      ...savedWorkspace,
      sessions: [conversation],
    });
  });
});

test("invalid session timestamps and project references cannot enter the workspace", () => {
  const malformed = {
    ...savedWorkspace,
    sessions: [
      conversation,
      { ...conversation, id: "invalid-date", updated: "yesterday" },
      { ...conversation, id: "missing-date", updated: undefined },
      { ...conversation, id: "negative-date", updated: -1 },
      { ...conversation, id: "invalid-project", projectId: { id: "agent" } },
      { ...conversation, id: "missing-project", projectId: undefined },
    ],
  };
  withStorage(JSON.stringify(malformed), () => {
    assert.deepEqual(readWorkspace().sessions, [conversation]);
  });
});

test("removing a project reparents only its sessions and preserves every message", () => {
  const original = structuredClone(savedWorkspace);
  const before = structuredClone(original);
  const next = removeProject(original, "agent");
  assert.deepEqual(next.projects, [projects[1]]);
  assert.equal(next.sessions.length, original.sessions.length);
  assert.equal(next.sessions[0].projectId, null);
  assert.equal(next.sessions[1].projectId, "other");
  assert.equal(next.sessions[2].projectId, null);
  for (let index = 0; index < next.sessions.length; index++) {
    assert.deepEqual(
      next.sessions[index].messages,
      before.sessions[index].messages,
    );
  }
  assert.strictEqual(next.sessions[1], original.sessions[1]);
  assert.strictEqual(next.sessions[2], original.sessions[2]);
  assert.equal(next.repo, original.repo);
  assert.deepEqual(
    original,
    before,
    "the caller’s existing workspace must not be mutated",
  );
});

test("removing an unknown project leaves the saved workspace content intact", () => {
  assert.deepEqual(removeProject(savedWorkspace, "missing"), savedWorkspace);
});

test("valid data can be saved unchanged and missing storage allows a fresh workspace", () => {
  assert.deepEqual(
    JSON.parse(serializeWorkspace(savedWorkspace)),
    savedWorkspace,
  );
  withStorage(JSON.stringify(savedWorkspace), () => {
    assert.deepEqual(readWorkspaceResult(), {
      workspace: savedWorkspace,
      warning: null,
      canPersist: true,
    });
  });
  withStorage(null, () => assert.equal(readWorkspaceResult().canPersist, true));
});

test("invalid records and duplicate IDs pause saving without replacing unrelated data", () => {
  const raw = {
    ...savedWorkspace,
    projects: [...projects, { ...projects[0], name: "Duplicate" }],
    sessions: [
      ...savedWorkspace.sessions,
      { ...conversation, title: "Duplicate session" },
      { ...conversation, id: "bad-provider", provider: ["claude"] },
      { ...conversation, id: "", title: "Empty identity" },
      {
        ...conversation,
        id: "duplicate-message",
        messages: [messages[0], messages[0]],
      },
    ],
  };
  withStorage(JSON.stringify(raw), (calls) => {
    const result = readWorkspaceResult();
    assert.deepEqual(result.workspace, savedWorkspace);
    assert.equal(result.canPersist, false);
    assert.match(result.warning, /original saved data is unchanged/);
    assert.deepEqual(
      calls,
      [storageKey],
      "reading never writes recovered data over the original",
    );
  });
  assert.throws(
    () => serializeWorkspace(raw),
    /previous saved workspace was left unchanged/,
  );
});

test("a missing project keeps its conversation and full text as a standalone session", () => {
  const raw = { ...savedWorkspace, projects: [projects[1]] };
  withStorage(JSON.stringify(raw), () => {
    const result = readWorkspaceResult();
    assert.equal(result.workspace.sessions[0].projectId, null);
    assert.deepEqual(result.workspace.sessions[0].messages, messages);
    assert.equal(result.workspace.sessions[1].projectId, "other");
    assert.equal(result.canPersist, false);
    assert.ok(result.warning);
  });
});

test("an invalid selected repository does not hide valid projects and conversations", () => {
  withStorage(
    JSON.stringify({ ...savedWorkspace, repo: "invalid repository" }),
    () => {
      const result = readWorkspaceResult();
      assert.deepEqual(result.workspace.projects, savedWorkspace.projects);
      assert.deepEqual(result.workspace.sessions, savedWorkspace.sessions);
      assert.equal(result.workspace.repo, newWorkspace().repo);
      assert.equal(result.canPersist, false);
    },
  );
});

test("oversized messages are rejected whole, never silently truncated", () => {
  const oversized = "x".repeat(WORKSPACE_LIMITS.messageCharacters + 1);
  const raw = {
    ...savedWorkspace,
    sessions: [
      conversation,
      {
        ...conversation,
        id: "too-large",
        messages: [{ ...messages[0], text: oversized }],
      },
    ],
  };
  withStorage(JSON.stringify(raw), () => {
    const result = readWorkspaceResult();
    assert.deepEqual(result.workspace.sessions, [conversation]);
    assert.equal(result.canPersist, false);
  });
  assert.throws(() => serializeWorkspace(raw), /invalid data|limits/);
  assert.equal(raw.sessions[1].messages[0].text, oversized);
  const exact = {
    ...raw,
    sessions: [
      {
        ...conversation,
        messages: [{ ...messages[0], text: oversized.slice(1) }],
      },
    ],
  };
  assert.equal(
    JSON.parse(serializeWorkspace(exact)).sessions[0].messages[0].text.length,
    WORKSPACE_LIMITS.messageCharacters,
  );
});

test("raw size and collection bounds prevent an unbounded persisted workspace", () => {
  withStorage(" ".repeat(WORKSPACE_LIMITS.serializedCharacters + 1), () => {
    const result = readWorkspaceResult();
    assert.deepEqual(result.workspace, newWorkspace());
    assert.equal(result.canPersist, false);
  });
  const oversizedSessions = {
    ...savedWorkspace,
    sessions: Array.from(
      { length: WORKSPACE_LIMITS.sessions + 1 },
      (_, index) => ({ ...conversation, id: `session-${index}`, messages: [] }),
    ),
  };
  withStorage(JSON.stringify(oversizedSessions), () => {
    const result = readWorkspaceResult();
    assert.equal(result.workspace.sessions.length, WORKSPACE_LIMITS.sessions);
    assert.equal(result.canPersist, false);
  });
  const oversizedMessages = {
    ...savedWorkspace,
    sessions: [
      {
        ...conversation,
        messages: Array.from(
          { length: WORKSPACE_LIMITS.messagesPerSession + 1 },
          (_, index) => ({ id: `message-${index}`, role: "user", text: "hi" }),
        ),
      },
    ],
  };
  assert.throws(() => serializeWorkspace(oversizedMessages), /limits/);
  const oversizedTotal = {
    ...savedWorkspace,
    sessions: Array.from({ length: 11 }, (_, sessionIndex) => ({
      ...conversation,
      id: `session-${sessionIndex}`,
      messages: Array.from({ length: 1000 }, (_, messageIndex) => ({
        id: `message-${messageIndex}`,
        role: "user",
        text: "hi",
      })),
    })),
  };
  assert.throws(() => serializeWorkspace(oversizedTotal), /limits/);
});

test("metadata bounds and repository validation are shared with editable forms", () => {
  for (const name of [
    "freddyrosa16/PinkLabs",
    "owner-name/repo_name",
    "a/.github",
  ])
    assert.equal(isRepositoryName(name), true, name);
  for (const name of [
    "owner_name/repo",
    "owner/..",
    "owner/repo/extra",
    "https://github.com/owner/repo",
    " owner/repo",
    "a/",
    null,
    23,
  ])
    assert.equal(isRepositoryName(name), false, String(name));
  const invalid = [
    { ...savedWorkspace, repo: "owner_name/repo" },
    {
      ...savedWorkspace,
      projects: [
        {
          ...projects[0],
          name: "x".repeat(WORKSPACE_LIMITS.nameCharacters + 1),
        },
      ],
    },
    {
      ...savedWorkspace,
      projects: [{ ...projects[0], folder: "/tmp/unsafe\0path" }],
    },
    {
      ...savedWorkspace,
      sessions: [
        { ...conversation, id: "x".repeat(WORKSPACE_LIMITS.idCharacters + 1) },
      ],
    },
    {
      ...savedWorkspace,
      sessions: [
        {
          ...conversation,
          title: "x".repeat(WORKSPACE_LIMITS.titleCharacters + 1),
        },
      ],
    },
    {
      ...savedWorkspace,
      sessions: [{ ...conversation, updated: 8_640_000_000_000_001 }],
    },
  ];
  for (const workspace of invalid)
    assert.throws(() => serializeWorkspace(workspace));
});

test("serialization checks escaped JSON size without altering message text", () => {
  const quoteText = '"'.repeat(60_000);
  const raw = {
    ...savedWorkspace,
    sessions: [
      {
        ...conversation,
        messages: Array.from({ length: 20 }, (_, index) => ({
          id: `message-${index}`,
          role: "user",
          text: quoteText,
        })),
      },
    ],
  };
  assert.throws(() => serializeWorkspace(raw), /too large to save/);
  assert.equal(raw.sessions[0].messages[0].text, quoteText);
});
