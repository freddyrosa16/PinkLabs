import test from "node:test";
import assert from "node:assert/strict";
import {
  newWorkspace,
  readWorkspace,
  removeProject,
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
